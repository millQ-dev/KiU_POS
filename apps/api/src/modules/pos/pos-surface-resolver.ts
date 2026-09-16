import type { Pool } from 'pg';
import {
  MenuResolver,
  type AvailabilityProvenance,
  type ResolvedMenu,
  type ResolvedMenuItem,
} from '../menu/index.js';
import { DomainValidationError } from './errors.js';
import { LayoutResolver, type LayoutAssignmentProvenance, type ResolvedLayout } from './layout-resolver.js';
import { resolvePosSurfaceSchema } from './types.js';

export type PosSlotState =
  | 'ACTIVE'
  | 'DISABLED_UNAVAILABLE'
  | 'DISABLED_PRICE_UNAVAILABLE'
  | 'CONFIGURATION_ERROR'
  | 'HIDDEN';

export type ResolvedUnitMoney = {
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
};

export type ResolvedPosSlot = {
  readonly layoutPublicationSlotId: string;
  readonly catalogItemId: string;
  readonly zone: 'PAGE' | 'QUICK_ACCESS';
  readonly position: number;
  readonly labelOverride: string | null;
  readonly colorToken: string | null;
  readonly state: Exclude<PosSlotState, 'HIDDEN'>;
  readonly unitPrice: ResolvedUnitMoney | null;
  readonly availabilityProvenance: AvailabilityProvenance | null;
  readonly menuProvenance: ResolvedMenuItem['menuProvenance'] | null;
  readonly layoutProvenance: {
    readonly layoutPublicationId: string;
    readonly layoutPublicationSlotId: string;
    readonly publicationVersion: number;
  };
};

export type ResolvedPosPage = {
  readonly layoutPublicationPageId: string;
  readonly pageCode: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly colorToken: string | null;
  readonly slots: ResolvedPosSlot[];
};

export type ResolvedPosSurface = {
  readonly presentationContext: ResolvedLayout['presentationContext'];
  readonly salesContext: ResolvedMenu['salesContext'];
  readonly layoutPublicationId: string;
  readonly layoutPublicationVersion: number;
  readonly layoutAssignment: LayoutAssignmentProvenance;
  readonly menuPublicationId: string;
  readonly menuAssignmentId: string;
  readonly menuPublicationVersion: number;
  readonly menuAssignmentScopeKind: ResolvedMenu['assignmentScopeKind'];
  readonly pages: ResolvedPosPage[];
  readonly quickAccess: ResolvedPosSlot[];
};

type PubPageRow = {
  layout_publication_page_id: string;
  page_code: string;
  label: string;
  sort_order: number;
  color_token: string | null;
};

type PubSlotRow = {
  layout_publication_slot_id: string;
  zone: 'PAGE' | 'QUICK_ACCESS';
  layout_publication_page_id: string | null;
  catalog_item_id: string;
  position: number;
  label_override: string | null;
  color_token: string | null;
};

function intersectSlot(
  slot: PubSlotRow,
  menuByCatalog: Map<string, ResolvedMenuItem>,
  layout: ResolvedLayout,
): ResolvedPosSlot | null {
  const menuItem = menuByCatalog.get(slot.catalog_item_id);
  const layoutProvenance = {
    layoutPublicationId: layout.layoutPublicationId,
    layoutPublicationSlotId: slot.layout_publication_slot_id,
    publicationVersion: layout.publicationVersion,
  };
  const base = {
    layoutPublicationSlotId: slot.layout_publication_slot_id,
    catalogItemId: slot.catalog_item_id,
    zone: slot.zone,
    position: slot.position,
    labelOverride: slot.label_override,
    colorToken: slot.color_token,
    layoutProvenance,
  };

  if (!menuItem) {
    // Case A — absent from effective ResolvedMenu → HIDDEN (omit from surface lists)
    return null;
  }

  if (menuItem.availabilityStatus === 'UNAVAILABLE') {
    return {
      ...base,
      state: 'DISABLED_UNAVAILABLE',
      unitPrice: null,
      availabilityProvenance: menuItem.availabilityProvenance,
      menuProvenance: menuItem.menuProvenance,
    };
  }

  if (menuItem.availabilityStatus === 'AVAILABLE' && menuItem.price.status === 'PRICE_UNAVAILABLE') {
    return {
      ...base,
      state: 'DISABLED_PRICE_UNAVAILABLE',
      unitPrice: null,
      availabilityProvenance: menuItem.availabilityProvenance,
      menuProvenance: menuItem.menuProvenance,
    };
  }

  if (menuItem.availabilityStatus === 'AVAILABLE' && menuItem.price.status === 'RESOLVED') {
    const q = menuItem.price.quote;
    return {
      ...base,
      state: 'ACTIVE',
      unitPrice: {
        amountMinor: q.resolvedUnitPriceMinor,
        currencyCode: q.currencyCode,
        minorUnitExponent: q.minorUnitExponent,
      },
      availabilityProvenance: menuItem.availabilityProvenance,
      menuProvenance: menuItem.menuProvenance,
    };
  }

  // Defensive: unexpected ResolvedMenuItem shape — never collapse to UNAVAILABLE
  return {
    ...base,
    state: 'CONFIGURATION_ERROR',
    unitPrice: null,
    availabilityProvenance: menuItem.availabilityProvenance,
    menuProvenance: menuItem.menuProvenance,
  };
}

export class PosSurfaceResolver {
  private readonly layoutResolver: LayoutResolver;
  private readonly menuResolver: MenuResolver;

  constructor(private readonly pool: Pool) {
    this.layoutResolver = new LayoutResolver(pool);
    this.menuResolver = new MenuResolver(pool);
  }

  async resolvePosSurface(raw: unknown): Promise<ResolvedPosSurface> {
    const cmd = resolvePosSurfaceSchema.parse(raw);

    const layout = await this.layoutResolver.resolveLayout({
      presentationContext: cmd.presentationContext,
      businessDateTime: cmd.salesContext.businessDateTime,
    });

    let menu: ResolvedMenu;
    try {
      menu = await this.menuResolver.resolveMenu({ salesContext: cmd.salesContext });
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : null;
      if (code) {
        // Do not collapse menu configuration failures into UNAVAILABLE slot states
        throw new DomainValidationError(
          'MENU_RESOLUTION_FAILED',
          `MenuResolver failed during POS surface composition (${code})`,
        );
      }
      throw err;
    }

    // Topology consistency: presentation and sales must address the same outlet topology
    if (
      layout.presentationContext.tenantId !== menu.salesContext.tenantId ||
      layout.presentationContext.brandId !== menu.salesContext.brandId ||
      layout.presentationContext.outletId !== menu.salesContext.outletId
    ) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'PresentationContext and SalesContext topology mismatch',
      );
    }

    const pages = await this.pool.query<PubPageRow>(
      `SELECT layout_publication_page_id, page_code, label, sort_order, color_token
       FROM layout_publication_page
       WHERE layout_publication_id = $1
       ORDER BY sort_order ASC, page_code ASC`,
      [layout.layoutPublicationId],
    );
    const slots = await this.pool.query<PubSlotRow>(
      `SELECT layout_publication_slot_id, zone, layout_publication_page_id,
              catalog_item_id, position, label_override, color_token
       FROM layout_publication_slot
       WHERE layout_publication_id = $1
       ORDER BY zone ASC, position ASC`,
      [layout.layoutPublicationId],
    );

    const menuByCatalog = new Map(menu.items.map((i) => [i.catalogItemId, i]));
    const resolvedSlots = slots.rows
      .map((s) => intersectSlot(s, menuByCatalog, layout))
      .filter((s): s is ResolvedPosSlot => s !== null);

    const pageSlots = new Map<string, ResolvedPosSlot[]>();
    const quickAccess: ResolvedPosSlot[] = [];
    for (const s of resolvedSlots) {
      if (s.zone === 'QUICK_ACCESS') {
        quickAccess.push(s);
      } else {
        const pageId = slots.rows.find(
          (r) => r.layout_publication_slot_id === s.layoutPublicationSlotId,
        )!.layout_publication_page_id!;
        const list = pageSlots.get(pageId) ?? [];
        list.push(s);
        pageSlots.set(pageId, list);
      }
    }

    quickAccess.sort((a, b) => a.position - b.position);

    const resolvedPages: ResolvedPosPage[] = pages.rows.map((p) => ({
      layoutPublicationPageId: p.layout_publication_page_id,
      pageCode: p.page_code,
      label: p.label,
      sortOrder: p.sort_order,
      colorToken: p.color_token,
      slots: (pageSlots.get(p.layout_publication_page_id) ?? []).sort(
        (a, b) => a.position - b.position,
      ),
    }));

    return {
      presentationContext: layout.presentationContext,
      salesContext: menu.salesContext,
      layoutPublicationId: layout.layoutPublicationId,
      layoutPublicationVersion: layout.publicationVersion,
      layoutAssignment: layout.assignment,
      menuPublicationId: menu.menuPublicationId,
      menuAssignmentId: menu.menuAssignmentId,
      menuPublicationVersion: menu.publicationVersion,
      menuAssignmentScopeKind: menu.assignmentScopeKind,
      pages: resolvedPages,
      quickAccess,
    };
  }

  /** Find a currently ACTIVE slot by publication slot id (revalidation path). */
  findActiveSlot(surface: ResolvedPosSurface, layoutPublicationSlotId: string): ResolvedPosSlot | null {
    for (const page of surface.pages) {
      for (const slot of page.slots) {
        if (slot.layoutPublicationSlotId === layoutPublicationSlotId) return slot;
      }
    }
    for (const slot of surface.quickAccess) {
      if (slot.layoutPublicationSlotId === layoutPublicationSlotId) return slot;
    }
    return null;
  }
}
