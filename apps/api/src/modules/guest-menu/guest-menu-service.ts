import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { MenuResolver, type ResolvedMenu } from '../menu/index.js';

const uuid = z.string().uuid();
const CAPABILITY_GUEST_QR = 'guest_menu.qr' as const;
const DEFAULT_FALLBACK_LOCALE = 'en';
const SUPPORTED_LOCALES = new Set(['vi', 'en', 'ru']);

export class GuestMenuDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GuestMenuDomainError';
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function generateOpaqueToken(): string {
  return randomBytes(24).toString('base64url');
}

function publicItemRef(tenantId: string, catalogItemId: string): string {
  return createHash('sha256')
    .update(`${tenantId}:${catalogItemId}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

const createLinkSchema = z
  .object({
    tenantId: uuid,
    outletId: uuid,
    diningAreaId: uuid.nullable().optional(),
    tableRef: z.string().trim().min(1).max(64).nullable().optional(),
    validFrom: z.string().datetime({ offset: true }).nullable().optional(),
    validTo: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export type CreatePublicMenuLinkInput = z.infer<typeof createLinkSchema>;

export type PublicMenuLinkCreated = {
  readonly publicMenuLinkId: string;
  readonly opaqueToken: string;
  readonly publicPath: string;
  readonly tenantId: string;
  readonly outletId: string;
  readonly brandId: string;
  readonly diningAreaId: string | null;
  readonly tableRef: string | null;
};

export type GuestMenuPriceDto =
  | {
      readonly status: 'AVAILABLE';
      readonly amountMinor: string;
      readonly currencyCode: string;
      readonly minorUnitExponent: number;
    }
  | { readonly status: 'UNAVAILABLE' };

export type GuestMenuItemDto = {
  readonly publicItemRef: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly price: GuestMenuPriceDto;
};

export type GuestMenuCategoryDto = {
  readonly publicCategoryRef: string;
  readonly name: string;
  readonly itemRefs: string[];
};

export type GuestMenuDto = {
  readonly language: string;
  readonly outlet: { readonly name: string };
  readonly brand: { readonly name: string };
  readonly tableRef: string | null;
  readonly menuPublicationVersion: number;
  readonly categories: GuestMenuCategoryDto[];
  readonly items: GuestMenuItemDto[];
};

type LinkRow = {
  public_menu_link_id: string;
  tenant_id: string;
  outlet_id: string;
  brand_id: string;
  dining_area_id: string | null;
  table_ref: string | null;
  token_hash: string;
  enabled: boolean;
  valid_from: Date | null;
  valid_to: Date | null;
  revoked_at: Date | null;
};

export class PublicMenuLinkService {
  constructor(private readonly pool: Pool) {}

  async setOutletCapability(input: {
    tenantId: string;
    outletId: string;
    capabilityKey: string;
    enabled: boolean;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO outlet_capability_config (tenant_id, outlet_id, capability_key, enabled, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (tenant_id, outlet_id, capability_key)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [input.tenantId, input.outletId, input.capabilityKey, input.enabled],
    );
  }

  async createLink(raw: unknown): Promise<PublicMenuLinkCreated> {
    const input = createLinkSchema.parse(raw);
    const outlet = await this.pool.query<{
      outlet_id: string;
      tenant_id: string;
      brand_id: string;
    }>(
      `SELECT outlet_id, tenant_id, brand_id FROM outlet
       WHERE outlet_id = $1 AND tenant_id = $2`,
      [input.outletId, input.tenantId],
    );
    if (outlet.rowCount !== 1) {
      throw new GuestMenuDomainError('OUTLET_NOT_FOUND', 'Outlet not found for tenant');
    }
    const brandId = outlet.rows[0]!.brand_id;
    const opaqueToken = generateOpaqueToken();
    const tokenHash = sha256Hex(opaqueToken);
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO public_menu_link (
         public_menu_link_id, tenant_id, outlet_id, brand_id,
         dining_area_id, table_ref, token_hash, enabled,
         valid_from, valid_to
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9)`,
      [
        id,
        input.tenantId,
        input.outletId,
        brandId,
        input.diningAreaId ?? null,
        input.tableRef ?? null,
        tokenHash,
        input.validFrom ?? null,
        input.validTo ?? null,
      ],
    );
    return {
      publicMenuLinkId: id,
      opaqueToken,
      publicPath: `/m/${opaqueToken}`,
      tenantId: input.tenantId,
      outletId: input.outletId,
      brandId,
      diningAreaId: input.diningAreaId ?? null,
      tableRef: input.tableRef ?? null,
    };
  }

  async revokeLink(publicMenuLinkId: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE public_menu_link
       SET revoked_at = NOW(), enabled = FALSE
       WHERE public_menu_link_id = $1 AND revoked_at IS NULL`,
      [publicMenuLinkId],
    );
    if (res.rowCount !== 1) {
      throw new GuestMenuDomainError('PUBLIC_MENU_LINK_NOT_FOUND', 'Public menu link not found or already revoked');
    }
  }

  async rotateLink(publicMenuLinkId: string): Promise<PublicMenuLinkCreated> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<LinkRow>(
        `SELECT * FROM public_menu_link WHERE public_menu_link_id = $1 FOR UPDATE`,
        [publicMenuLinkId],
      );
      if (cur.rowCount !== 1) {
        throw new GuestMenuDomainError('PUBLIC_MENU_LINK_NOT_FOUND', 'Public menu link not found');
      }
      const row = cur.rows[0]!;
      await client.query(
        `UPDATE public_menu_link SET revoked_at = NOW(), enabled = FALSE WHERE public_menu_link_id = $1`,
        [publicMenuLinkId],
      );
      const opaqueToken = generateOpaqueToken();
      const tokenHash = sha256Hex(opaqueToken);
      const id = randomUUID();
      await client.query(
        `INSERT INTO public_menu_link (
           public_menu_link_id, tenant_id, outlet_id, brand_id,
           dining_area_id, table_ref, token_hash, enabled,
           valid_from, valid_to
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9)`,
        [
          id,
          row.tenant_id,
          row.outlet_id,
          row.brand_id,
          row.dining_area_id,
          row.table_ref,
          tokenHash,
          row.valid_from,
          row.valid_to,
        ],
      );
      await client.query('COMMIT');
      return {
        publicMenuLinkId: id,
        opaqueToken,
        publicPath: `/m/${opaqueToken}`,
        tenantId: row.tenant_id,
        outletId: row.outlet_id,
        brandId: row.brand_id,
        diningAreaId: row.dining_area_id,
        tableRef: row.table_ref,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async resolveLinkByOpaqueToken(opaqueToken: string, at: Date = new Date()): Promise<LinkRow> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(opaqueToken)) {
      throw new GuestMenuDomainError('PUBLIC_MENU_TOKEN_INVALID', 'Invalid public menu token');
    }
    const tokenHash = sha256Hex(opaqueToken);
    const res = await this.pool.query<LinkRow>(
      `SELECT * FROM public_menu_link WHERE token_hash = $1`,
      [tokenHash],
    );
    if (res.rowCount !== 1) {
      throw new GuestMenuDomainError('PUBLIC_MENU_TOKEN_INVALID', 'Invalid public menu token');
    }
    const row = res.rows[0]!;
    if (row.revoked_at != null || !row.enabled) {
      throw new GuestMenuDomainError('PUBLIC_MENU_TOKEN_REVOKED', 'Public menu link revoked or disabled');
    }
    if (row.valid_from && at < row.valid_from) {
      throw new GuestMenuDomainError('PUBLIC_MENU_TOKEN_NOT_YET_VALID', 'Public menu link not yet valid');
    }
    if (row.valid_to && at >= row.valid_to) {
      throw new GuestMenuDomainError('PUBLIC_MENU_TOKEN_EXPIRED', 'Public menu link expired');
    }
    return row;
  }
}

export class GuestMenuProjectionService {
  private readonly menuResolver: MenuResolver;
  private readonly links: PublicMenuLinkService;

  constructor(private readonly pool: Pool) {
    this.menuResolver = new MenuResolver(pool);
    this.links = new PublicMenuLinkService(pool);
  }

  get linkService(): PublicMenuLinkService {
    return this.links;
  }

  async resolveGuestMenu(input: {
    opaqueToken: string;
    language?: string;
    businessDateTime?: string;
  }): Promise<GuestMenuDto> {
    const link = await this.links.resolveLinkByOpaqueToken(input.opaqueToken);
    await this.assertCapability(link.tenant_id, link.outlet_id);

    const locale = normalizeLocale(input.language);
    const businessDateTime =
      input.businessDateTime ?? new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');

    // MVP: resolve against existing DIRECT commercial surface (no new channel taxonomy).
    const resolved: ResolvedMenu = await this.menuResolver.resolveMenu({
      salesContext: {
        tenantId: link.tenant_id,
        brandId: link.brand_id,
        outletId: link.outlet_id,
        orderChannel: 'DIRECT',
        businessDateTime,
      },
    });

    const presentation = await this.loadPresentation(
      link.tenant_id,
      resolved.items.map((i) => i.catalogItemId),
      locale,
    );

    const outlet = await this.pool.query<{ name: string }>(
      `SELECT name FROM outlet WHERE outlet_id = $1 AND tenant_id = $2`,
      [link.outlet_id, link.tenant_id],
    );
    const brand = await this.pool.query<{ name: string }>(
      `SELECT name FROM brand WHERE brand_id = $1 AND tenant_id = $2`,
      [link.brand_id, link.tenant_id],
    );

    const items: GuestMenuItemDto[] = resolved.items.map((item) => {
      const p = presentation.get(item.catalogItemId);
      const price: GuestMenuPriceDto =
        item.price.status === 'RESOLVED'
          ? {
              status: 'AVAILABLE',
              amountMinor: item.price.quote.resolvedUnitPriceMinor,
              currencyCode: item.price.quote.currencyCode,
              minorUnitExponent: item.price.quote.minorUnitExponent,
            }
          : { status: 'UNAVAILABLE' };
      return {
        publicItemRef: publicItemRef(link.tenant_id, item.catalogItemId),
        name: p?.name ?? p?.canonicalName ?? 'Item',
        description: p?.description ?? null,
        imageUrl: p?.imageUrl ?? null,
        availability: item.availabilityStatus,
        price,
      };
    });

    const categoryName =
      locale === 'vi' ? 'Thực đơn' : locale === 'ru' ? 'Меню' : 'Menu';

    return {
      language: locale,
      outlet: { name: outlet.rows[0]?.name ?? 'Outlet' },
      brand: { name: brand.rows[0]?.name ?? 'Brand' },
      tableRef: link.table_ref,
      menuPublicationVersion: resolved.publicationVersion,
      categories: [
        {
          publicCategoryRef: 'menu',
          name: categoryName,
          itemRefs: items.map((i) => i.publicItemRef),
        },
      ],
      items,
    };
  }

  private async assertCapability(tenantId: string, outletId: string): Promise<void> {
    const res = await this.pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM outlet_capability_config
       WHERE tenant_id = $1 AND outlet_id = $2 AND capability_key = $3`,
      [tenantId, outletId, CAPABILITY_GUEST_QR],
    );
    if (res.rowCount !== 1 || !res.rows[0]!.enabled) {
      throw new GuestMenuDomainError(
        'GUEST_MENU_CAPABILITY_DISABLED',
        'Guest QR menu is not enabled for this outlet',
      );
    }
  }

  private async loadPresentation(
    tenantId: string,
    catalogItemIds: string[],
    locale: string,
  ): Promise<
    Map<
      string,
      {
        name: string;
        canonicalName: string;
        description: string | null;
        imageUrl: string | null;
      }
    >
  > {
    const out = new Map<
      string,
      { name: string; canonicalName: string; description: string | null; imageUrl: string | null }
    >();
    if (catalogItemIds.length === 0) return out;

    const canonical = await this.pool.query<{ catalog_item_id: string; name: string }>(
      `SELECT catalog_item_id, name FROM catalog_item
       WHERE tenant_id = $1 AND catalog_item_id = ANY($2::uuid[])`,
      [tenantId, catalogItemIds],
    );
    for (const row of canonical.rows) {
      out.set(row.catalog_item_id, {
        name: row.name,
        canonicalName: row.name,
        description: null,
        imageUrl: null,
      });
    }

    const locales = localeCandidates(locale);
    const pres = await this.pool.query<{
      catalog_item_id: string;
      locale: string;
      name: string;
      description: string | null;
      public_url: string | null;
    }>(
      `SELECT cip.catalog_item_id, cip.locale, cip.name, cip.description, pma.public_url
       FROM catalog_item_presentation cip
       LEFT JOIN presentation_media_asset pma
         ON pma.media_asset_id = cip.media_asset_id AND pma.status = 'ACTIVE'
       WHERE cip.catalog_item_id = ANY($1::uuid[])
         AND cip.locale = ANY($2::text[])`,
      [catalogItemIds, locales],
    );

    const byItem = new Map<string, typeof pres.rows>();
    for (const row of pres.rows) {
      const list = byItem.get(row.catalog_item_id) ?? [];
      list.push(row);
      byItem.set(row.catalog_item_id, list);
    }

    for (const [itemId, rows] of byItem) {
      const base = out.get(itemId);
      if (!base) continue;
      const picked = pickLocaleRow(rows, locales);
      if (!picked) continue;
      out.set(itemId, {
        name: picked.name,
        canonicalName: base.canonicalName,
        description: picked.description,
        imageUrl: picked.public_url,
      });
    }
    return out;
  }
}

function normalizeLocale(raw?: string): string {
  if (!raw) return DEFAULT_FALLBACK_LOCALE;
  const base = raw.trim().toLowerCase().slice(0, 2);
  if (SUPPORTED_LOCALES.has(base)) return base;
  return DEFAULT_FALLBACK_LOCALE;
}

function localeCandidates(locale: string): string[] {
  const out = [locale];
  if (locale !== DEFAULT_FALLBACK_LOCALE) out.push(DEFAULT_FALLBACK_LOCALE);
  return out;
}

function pickLocaleRow<T extends { locale: string }>(rows: T[], order: string[]): T | null {
  for (const loc of order) {
    const hit = rows.find((r) => r.locale === loc);
    if (hit) return hit;
  }
  return null;
}

export { CAPABILITY_GUEST_QR };
