import type { Pool, PoolClient } from 'pg';
import { DomainValidationError } from './errors.js';
import {
  isEffectiveAt,
  localBusinessDateIso,
  localBusinessTimeIso,
  SCOPE_RANK,
} from './effective-time.js';
import { validateSalesContext, type ValidatedSalesContext } from './sales-context.js';
import {
  resolveMenuItemSchema,
  resolveMenuSchema,
  resolveOrderLinesFromMenuSchema,
  type SalesContextInput,
} from './types.js';

export type AvailabilityProvenance =
  | {
      readonly source: 'DEFAULT_MEMBERSHIP';
      readonly availabilityRuleId: null;
    }
  | {
      readonly source: 'AVAILABILITY_RULE';
      readonly availabilityRuleId: string;
      readonly scopeKind: 'TENANT' | 'BRAND' | 'OUTLET';
    };

export type ResolvedPriceQuote = {
  readonly catalogItemId: string;
  readonly orderLineId?: string;
  readonly resolvedUnitPriceMinor: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly menuPublicationId: string;
  readonly menuAssignmentId: string;
  readonly priceRuleId: string;
  readonly priceRuleScopeKind: 'TENANT' | 'BRAND' | 'OUTLET';
  readonly availability: AvailabilityProvenance;
  readonly salesContext: {
    readonly tenantId: string;
    readonly brandId: string;
    readonly outletId: string;
    readonly orderChannel: string;
    readonly businessDateTime: string;
    readonly outletTimezone: string;
    readonly localBusinessDate: string;
    readonly localBusinessTime: string;
  };
};

export type PriceState =
  | { readonly status: 'RESOLVED'; readonly quote: ResolvedPriceQuote }
  | { readonly status: 'PRICE_UNAVAILABLE' };

export type ResolvedMenuItem = {
  readonly catalogItemId: string;
  readonly availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE';
  readonly availabilityProvenance: AvailabilityProvenance;
  readonly price: PriceState;
  readonly menuPublicationId: string;
  readonly menuAssignmentId: string;
  readonly menuProvenance: {
    readonly scopeKind: 'TENANT' | 'BRAND' | 'OUTLET';
    readonly publicationVersion: number;
  };
};

export type ResolvedMenu = {
  readonly salesContext: ValidatedSalesContext;
  readonly menuPublicationId: string;
  readonly menuAssignmentId: string;
  readonly assignmentScopeKind: 'TENANT' | 'BRAND' | 'OUTLET';
  readonly publicationVersion: number;
  readonly localBusinessDate: string;
  readonly localBusinessTime: string;
  readonly items: ResolvedMenuItem[];
};

export type ResolvedOrderLineFromMenu = {
  readonly orderLineId: string;
  readonly catalogItemId: string;
  readonly quantity: string;
  readonly availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE';
  readonly availabilityProvenance: AvailabilityProvenance;
  readonly resolvedUnitPriceMinor: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly menuPublicationId: string;
  readonly menuAssignmentId: string;
  readonly priceRuleId: string;
  readonly salesContextProvenance: ResolvedPriceQuote['salesContext'];
};

type AssignmentRow = {
  menu_assignment_id: string;
  menu_publication_id: string;
  scope_kind: 'TENANT' | 'BRAND' | 'OUTLET';
  brand_id: string | null;
  outlet_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
  publication_version: number;
};

type RuleRow = {
  id: string;
  scope_kind: 'TENANT' | 'BRAND' | 'OUTLET';
  brand_id: string | null;
  outlet_id: string | null;
  order_channel: string | null;
  effective_from: Date;
  effective_to: Date | null;
};

function matchesScope(
  scopeKind: 'TENANT' | 'BRAND' | 'OUTLET',
  brandId: string | null,
  outletId: string | null,
  ctx: ValidatedSalesContext,
): boolean {
  if (scopeKind === 'TENANT') return true;
  if (scopeKind === 'BRAND') return brandId === ctx.brandId;
  if (scopeKind === 'OUTLET') return outletId === ctx.outletId;
  return false;
}

function channelMatches(ruleChannel: string | null, orderChannel: string): boolean {
  if (ruleChannel == null || ruleChannel === '') return true;
  return ruleChannel === orderChannel;
}

function pickHighestSpecificity<T extends { scope_kind: 'TENANT' | 'BRAND' | 'OUTLET' }>(
  rows: T[],
  ambiguousCode: string,
  ambiguousMessage: string,
): T {
  let bestRank = -1;
  const winners: T[] = [];
  for (const row of rows) {
    const rank = SCOPE_RANK[row.scope_kind];
    if (rank > bestRank) {
      bestRank = rank;
      winners.length = 0;
      winners.push(row);
    } else if (rank === bestRank) {
      winners.push(row);
    }
  }
  if (winners.length === 0) {
    throw new DomainValidationError(ambiguousCode, ambiguousMessage);
  }
  if (winners.length > 1) {
    throw new DomainValidationError(ambiguousCode, ambiguousMessage);
  }
  return winners[0]!;
}

export class MenuResolver {
  constructor(private readonly pool: Pool) {}

  async resolveMenu(raw: unknown): Promise<ResolvedMenu> {
    const cmd = resolveMenuSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      return await this.resolveMenuKernel(client, cmd.salesContext);
    } finally {
      client.release();
    }
  }

  async resolveMenuItem(raw: unknown): Promise<ResolvedMenuItem> {
    const cmd = resolveMenuItemSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      const menu = await this.resolveMenuKernel(client, cmd.salesContext);
      const item = menu.items.find((i) => i.catalogItemId === cmd.catalogItemId);
      if (!item) {
        throw new DomainValidationError(
          'MENU_ITEM_NOT_FOUND',
          'CatalogItem is not a member of the effective MenuPublication',
        );
      }
      return item;
    } finally {
      client.release();
    }
  }

  /**
   * Orders-facing unit-price resolution (OPTION A).
   * Returns resolved UNIT prices + provenance. Does NOT compute grossMerchandiseMinor.
   */
  async resolveOrderLinesFromMenu(raw: unknown): Promise<{
    orderId: string;
    salesContext: ValidatedSalesContext;
    lines: ResolvedOrderLineFromMenu[];
  }> {
    const cmd = resolveOrderLinesFromMenuSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      const order = await client.query<{
        order_id: string;
        tenant_id: string;
        outlet_id: string;
        channel: string;
        status: string;
      }>(`SELECT order_id, tenant_id, outlet_id, channel, status FROM sales_order WHERE order_id = $1`, [
        cmd.orderId,
      ]);
      if (order.rowCount !== 1) {
        throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Order not found');
      }
      const o = order.rows[0]!;
      if (o.status !== 'OPEN') {
        throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Order must be OPEN for menu resolution');
      }

      const outlet = await client.query<{ brand_id: string; timezone: string | null }>(
        `SELECT brand_id, timezone FROM outlet WHERE outlet_id = $1`,
        [o.outlet_id],
      );
      if (outlet.rowCount !== 1) {
        throw new DomainValidationError('INVALID_SALES_CONTEXT', 'Order outlet missing');
      }

      const salesContextInput: SalesContextInput =
        cmd.salesContext ??
        ({
          tenantId: o.tenant_id,
          brandId: outlet.rows[0]!.brand_id,
          outletId: o.outlet_id,
          orderChannel: o.channel,
          businessDateTime: new Date().toISOString(),
        } as SalesContextInput);

      if (salesContextInput.tenantId !== o.tenant_id || salesContextInput.outletId !== o.outlet_id) {
        throw new DomainValidationError(
          'INVALID_SALES_CONTEXT',
          'SalesContext tenant/outlet must match the Order',
        );
      }

      const menu = await this.resolveMenuKernel(client, salesContextInput);
      const lines = await client.query<{
        order_line_id: string;
        catalog_item_id: string;
        quantity: string;
      }>(
        `SELECT order_line_id, catalog_item_id, quantity
         FROM sales_order_line WHERE order_id = $1 ORDER BY line_number`,
        [cmd.orderId],
      );
      if (lines.rowCount === 0) {
        throw new DomainValidationError('EMPTY_ORDER', 'Order has no lines');
      }

      const resolvedLines: ResolvedOrderLineFromMenu[] = [];
      for (const line of lines.rows) {
        const item = menu.items.find((i) => i.catalogItemId === line.catalog_item_id);
        if (!item) {
          throw new DomainValidationError(
            'MENU_ITEM_NOT_FOUND',
            `Order line ${line.order_line_id} catalog item not on effective menu`,
          );
        }
        if (item.availabilityStatus === 'UNAVAILABLE') {
          throw new DomainValidationError(
            'ITEM_UNAVAILABLE',
            `Order line ${line.order_line_id} item is UNAVAILABLE`,
          );
        }
        if (item.price.status !== 'RESOLVED') {
          throw new DomainValidationError(
            'PRICE_UNAVAILABLE',
            `Order line ${line.order_line_id} has no resolvable base price`,
          );
        }
        const quote = item.price.quote;
        resolvedLines.push({
          orderLineId: line.order_line_id,
          catalogItemId: line.catalog_item_id,
          quantity: line.quantity,
          availabilityStatus: item.availabilityStatus,
          availabilityProvenance: item.availabilityProvenance,
          resolvedUnitPriceMinor: quote.resolvedUnitPriceMinor,
          currencyCode: quote.currencyCode,
          minorUnitExponent: quote.minorUnitExponent,
          menuPublicationId: quote.menuPublicationId,
          menuAssignmentId: quote.menuAssignmentId,
          priceRuleId: quote.priceRuleId,
          salesContextProvenance: quote.salesContext,
        });
      }

      // One Order currency
      const c0 = resolvedLines[0]!;
      for (const l of resolvedLines) {
        if (l.currencyCode !== c0.currencyCode || l.minorUnitExponent !== c0.minorUnitExponent) {
          throw new DomainValidationError(
            'ORDER_COMMERCIAL_CURRENCY_MISMATCH',
            'Resolved menu unit prices use incompatible currencies for one Order',
          );
        }
      }

      return { orderId: cmd.orderId, salesContext: menu.salesContext, lines: resolvedLines };
    } finally {
      client.release();
    }
  }

  /** Single resolution kernel used by resolveMenu / resolveMenuItem / order path. */
  private async resolveMenuKernel(
    client: PoolClient,
    salesContextRaw: SalesContextInput,
  ): Promise<ResolvedMenu> {
    const ctx = await validateSalesContext(client, salesContextRaw);
    const assignment = await this.resolveAssignment(client, ctx);
    const membership = await client.query<{ catalog_item_id: string }>(
      `SELECT catalog_item_id FROM menu_publication_item
       WHERE menu_publication_id = $1 AND tenant_id = $2
       ORDER BY catalog_item_id`,
      [assignment.menu_publication_id, ctx.tenantId],
    );

    const localBusinessDate = localBusinessDateIso(ctx.businessDateTime, ctx.outletTimezone);
    const localBusinessTime = localBusinessTimeIso(ctx.businessDateTime, ctx.outletTimezone);

    const items: ResolvedMenuItem[] = [];
    for (const row of membership.rows) {
      items.push(
        await this.resolveItemKernel(
          client,
          ctx,
          assignment,
          row.catalog_item_id,
          localBusinessDate,
          localBusinessTime,
        ),
      );
    }

    return {
      salesContext: ctx,
      menuPublicationId: assignment.menu_publication_id,
      menuAssignmentId: assignment.menu_assignment_id,
      assignmentScopeKind: assignment.scope_kind,
      publicationVersion: assignment.publication_version,
      localBusinessDate,
      localBusinessTime,
      items,
    };
  }

  private async resolveAssignment(
    client: PoolClient,
    ctx: ValidatedSalesContext,
  ): Promise<AssignmentRow> {
    const rows = await client.query<AssignmentRow>(
      `SELECT a.menu_assignment_id, a.menu_publication_id, a.scope_kind,
              a.brand_id, a.outlet_id, a.effective_from, a.effective_to,
              p.publication_version
       FROM menu_assignment a
       JOIN menu_publication p ON p.menu_publication_id = a.menu_publication_id
       WHERE a.tenant_id = $1
         AND p.tenant_id = $1
         AND (
           a.scope_kind = 'TENANT'
           OR (a.scope_kind = 'BRAND' AND a.brand_id = $2)
           OR (a.scope_kind = 'OUTLET' AND a.outlet_id = $3)
         )`,
      [ctx.tenantId, ctx.brandId, ctx.outletId],
    );

    const effective = rows.rows.filter((r) =>
      isEffectiveAt(ctx.businessDateTime, new Date(r.effective_from), r.effective_to ? new Date(r.effective_to) : null),
    );
    if (effective.length === 0) {
      throw new DomainValidationError('MENU_NOT_ASSIGNED', 'No effective MenuAssignment for SalesContext');
    }

    return pickHighestSpecificity(
      effective,
      'AMBIGUOUS_MENU_ASSIGNMENT',
      'Multiple MenuAssignments at the same winning specificity',
    );
  }

  private async resolveItemKernel(
    client: PoolClient,
    ctx: ValidatedSalesContext,
    assignment: AssignmentRow,
    catalogItemId: string,
    localBusinessDate: string,
    localBusinessTime: string,
  ): Promise<ResolvedMenuItem> {
    const availability = await this.resolveAvailability(client, ctx, catalogItemId);
    const price = await this.resolvePrice(
      client,
      ctx,
      assignment,
      catalogItemId,
      availability.provenance,
      localBusinessDate,
      localBusinessTime,
    );

    return {
      catalogItemId,
      availabilityStatus: availability.status,
      availabilityProvenance: availability.provenance,
      price,
      menuPublicationId: assignment.menu_publication_id,
      menuAssignmentId: assignment.menu_assignment_id,
      menuProvenance: {
        scopeKind: assignment.scope_kind,
        publicationVersion: assignment.publication_version,
      },
    };
  }

  private async resolveAvailability(
    client: PoolClient,
    ctx: ValidatedSalesContext,
    catalogItemId: string,
  ): Promise<{ status: 'AVAILABLE' | 'UNAVAILABLE'; provenance: AvailabilityProvenance }> {
    const rows = await client.query<{
      availability_rule_id: string;
      scope_kind: 'TENANT' | 'BRAND' | 'OUTLET';
      brand_id: string | null;
      outlet_id: string | null;
      order_channel: string | null;
      availability_status: 'AVAILABLE' | 'UNAVAILABLE';
      effective_from: Date;
      effective_to: Date | null;
    }>(
      `SELECT availability_rule_id, scope_kind, brand_id, outlet_id, order_channel,
              availability_status, effective_from, effective_to
       FROM availability_rule
       WHERE tenant_id = $1 AND catalog_item_id = $2`,
      [ctx.tenantId, catalogItemId],
    );

    const applicable = rows.rows.filter(
      (r) =>
        matchesScope(r.scope_kind, r.brand_id, r.outlet_id, ctx) &&
        channelMatches(r.order_channel, ctx.orderChannel) &&
        isEffectiveAt(
          ctx.businessDateTime,
          new Date(r.effective_from),
          r.effective_to ? new Date(r.effective_to) : null,
        ),
    );

    if (applicable.length === 0) {
      return {
        status: 'AVAILABLE',
        provenance: { source: 'DEFAULT_MEMBERSHIP', availabilityRuleId: null },
      };
    }

    const winner = pickHighestSpecificity(
      applicable,
      'AMBIGUOUS_AVAILABILITY_RULE',
      'Multiple AvailabilityRules at the same winning specificity',
    );

    return {
      status: winner.availability_status,
      provenance: {
        source: 'AVAILABILITY_RULE',
        availabilityRuleId: winner.availability_rule_id,
        scopeKind: winner.scope_kind,
      },
    };
  }

  private async resolvePrice(
    client: PoolClient,
    ctx: ValidatedSalesContext,
    assignment: AssignmentRow,
    catalogItemId: string,
    availability: AvailabilityProvenance,
    localBusinessDate: string,
    localBusinessTime: string,
  ): Promise<PriceState> {
    const rows = await client.query<{
      price_rule_id: string;
      scope_kind: 'TENANT' | 'BRAND' | 'OUTLET';
      brand_id: string | null;
      outlet_id: string | null;
      order_channel: string | null;
      amount_minor: string;
      currency_code: string;
      minor_unit_exponent: number;
      effective_from: Date;
      effective_to: Date | null;
    }>(
      `SELECT price_rule_id, scope_kind, brand_id, outlet_id, order_channel,
              amount_minor, currency_code, minor_unit_exponent, effective_from, effective_to
       FROM price_rule
       WHERE tenant_id = $1 AND catalog_item_id = $2`,
      [ctx.tenantId, catalogItemId],
    );

    const applicable = rows.rows.filter(
      (r) =>
        matchesScope(r.scope_kind, r.brand_id, r.outlet_id, ctx) &&
        channelMatches(r.order_channel, ctx.orderChannel) &&
        isEffectiveAt(
          ctx.businessDateTime,
          new Date(r.effective_from),
          r.effective_to ? new Date(r.effective_to) : null,
        ),
    );

    if (applicable.length === 0) {
      return { status: 'PRICE_UNAVAILABLE' };
    }

    const winner = pickHighestSpecificity(
      applicable,
      'AMBIGUOUS_PRICE_RULE',
      'Multiple PriceRules at the same winning specificity',
    );

    // Missing price ≠ zero: amount_minor '0' is a valid intentional Money quote only if configured.
    // Zero is allowed as an explicit PriceRule value; absence of rule is PRICE_UNAVAILABLE.

    const quote: ResolvedPriceQuote = {
      catalogItemId,
      resolvedUnitPriceMinor: winner.amount_minor,
      currencyCode: winner.currency_code,
      minorUnitExponent: winner.minor_unit_exponent,
      menuPublicationId: assignment.menu_publication_id,
      menuAssignmentId: assignment.menu_assignment_id,
      priceRuleId: winner.price_rule_id,
      priceRuleScopeKind: winner.scope_kind,
      availability,
      salesContext: {
        tenantId: ctx.tenantId,
        brandId: ctx.brandId,
        outletId: ctx.outletId,
        orderChannel: ctx.orderChannel,
        businessDateTime: ctx.businessDateTime.toISOString(),
        outletTimezone: ctx.outletTimezone,
        localBusinessDate,
        localBusinessTime,
      },
    };
    return { status: 'RESOLVED', quote };
  }
}
