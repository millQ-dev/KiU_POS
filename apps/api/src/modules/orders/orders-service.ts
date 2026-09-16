import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  OperationalFactType,
  parseOperationalFact,
  semanticFingerprint as factSemanticFingerprint,
} from '@millq/contracts';
import {
  DomainError,
  assertExactlyOneConsumptionPath,
  assertPositive,
  consumptionPlanProvenanceHash,
  createQuantity,
  parseCanonicalDecimal,
  resolveSaleLineConsumption,
  type GraphCatalogItem,
  type GraphPreparationVersion,
  type GraphRecipeVersion,
  type LineConsumptionPlan,
  type RecipeGraphLookup,
  type UnitDimension,
} from '@millq/domain';
import {
  buildCommercialStateFromCommand,
  freezeCommercialSnapshot,
  loadBuiltCommercialState,
  persistOpenCommercialTerms,
} from './commercial-terms.js';
import {
  DomainValidationError,
  IdempotencyConflictError,
  NotFoundError,
  OrderImmutableError,
} from './errors.js';
import type { SaleInventoryWriteOffPort } from './sale-write-off-port.js';
import {
  addOrderLineSchema,
  cancelOrderSchema,
  completeOrderSchema,
  openOrderSchema,
  removeOrderLineSchema,
  reverseCompletedOrderSchema,
  setOrderCommercialTermsSchema,
  updateOrderLineSchema,
} from './types.js';

type Pool = pg.Pool;
type Client = pg.PoolClient;

type OrderRow = {
  order_id: string;
  tenant_id: string;
  legal_entity_id: string;
  outlet_id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  channel: string;
  business_date: string | Date | null;
  business_time: string | null;
  business_order: number | null;
  actor_id: string | null;
  device_id: string | null;
  complete_idempotency_key: string | null;
  complete_semantic_fingerprint: string | null;
  resolved_issue_warehouse_id: string | null;
  consumption_plan_id: string | null;
  cancel_reason: string | null;
};

type OrderLineRow = {
  order_line_id: string;
  order_id: string;
  line_number: number;
  catalog_item_id: string;
  quantity: string;
  unit: string;
  dimension: UnitDimension;
};

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new DomainValidationError(err.code, err.message);
  }
  throw err;
}

function completeFingerprint(input: {
  orderId: string;
  businessDate: string;
  businessTime?: string | null;
  businessOrder: number;
  lineIds: string[];
  provenanceHash: string;
  warehouseId: string;
  commercialSemanticHash: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        orderId: input.orderId,
        businessDate: input.businessDate,
        businessTime: input.businessTime ?? null,
        businessOrder: input.businessOrder,
        lineIds: [...input.lineIds].sort(),
        provenanceHash: input.provenanceHash,
        warehouseId: input.warehouseId,
        commercialSemanticHash: input.commercialSemanticHash,
      }),
    )
    .digest('hex');
}

function reverseCompletionFingerprint(input: {
  orderId: string;
  goodsIssueId: string;
  businessDate: string;
  businessOrder: number;
  businessTime?: string | null;
  reason?: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        orderId: input.orderId,
        goodsIssueId: input.goodsIssueId,
        businessDate: input.businessDate,
        businessOrder: input.businessOrder,
        businessTime: input.businessTime ?? null,
        reason: input.reason ?? null,
      }),
    )
    .digest('hex');
}

export type OrdersServiceOptions = {
  /**
   * Required for successful CompleteOrder (D1.3B).
   * D1.3A leaves this undefined — CompleteOrder always rejects with SALE_WRITE_OFF_NOT_WIRED.
   */
  saleWriteOffPort?: SaleInventoryWriteOffPort;
};

/**
 * D1.3A Orders foundation.
 * OPEN/CANCELLED + line mutations + consumption resolution preview are live.
 * Persisted COMPLETED requires Inventory SaleInventoryWriteOffPort (D1.3B).
 */
export class OrdersService {
  private readonly saleWriteOffPort: SaleInventoryWriteOffPort | undefined;

  constructor(
    private readonly pool: Pool,
    options: OrdersServiceOptions = {},
  ) {
    this.saleWriteOffPort = options.saleWriteOffPort;
  }

  async openOrder(raw: unknown) {
    const cmd = openOrderSchema.parse(raw);
    await this.assertOutlet(cmd.tenantId, cmd.legalEntityId, cmd.outletId);
    const orderId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sales_order (
           order_id, tenant_id, legal_entity_id, outlet_id, status, channel, actor_id, device_id
         ) VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7)`,
        [
          orderId,
          cmd.tenantId,
          cmd.legalEntityId,
          cmd.outletId,
          cmd.channel,
          cmd.actorId ?? null,
          cmd.deviceId ?? null,
        ],
      );
      await this.mirrorFactTx(client, {
        factType: OperationalFactType.OrderOpened,
        idempotencyKey: `order-opened:${orderId}`,
        payload: { orderId, channel: cmd.channel },
        context: {
          tenantId: cmd.tenantId,
          legalEntityId: cmd.legalEntityId,
          outletId: cmd.outletId,
          actorId: cmd.actorId ?? null,
        },
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return this.getOrder(orderId);
  }

  async addOrderLine(raw: unknown) {
    const cmd = addOrderLineSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, cmd.orderId);
      this.assertOpenMutable(order);
      await this.assertNoLiveSettlement(client, cmd.orderId);
      await this.assertCatalogItem(client, order.tenant_id, cmd.catalogItemId, cmd.dimension);
      const qty = this.assertLineQuantity(cmd.quantity, cmd.dimension, cmd.unit);

      const maxLine = await client.query<{ max: number | null }>(
        `SELECT MAX(line_number) AS max FROM sales_order_line WHERE order_id = $1`,
        [cmd.orderId],
      );
      const lineNumber = (maxLine.rows[0]?.max ?? 0) + 1;
      const orderLineId = randomUUID();
      await client.query(
        `INSERT INTO sales_order_line (
           order_line_id, order_id, line_number, catalog_item_id, quantity, unit, dimension
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          orderLineId,
          cmd.orderId,
          lineNumber,
          cmd.catalogItemId,
          qty.value,
          qty.unit,
          qty.dimension,
        ],
      );
      // Line mutation invalidates accepted commercial terms (must re-accept before CompleteOrder).
      await this.clearOpenCommercialTerms(client, cmd.orderId);
      await this.mirrorFactTx(client, {
        factType: OperationalFactType.OrderItemAdded,
        idempotencyKey: `order-line-added:${orderLineId}`,
        payload: {
          orderId: cmd.orderId,
          orderItemId: orderLineId,
          menuItemId: cmd.catalogItemId,
          quantity: { value: qty.value, unit: qty.unit, dimension: qty.dimension },
        },
        context: {
          tenantId: order.tenant_id,
          legalEntityId: order.legal_entity_id,
          outletId: order.outlet_id,
          actorId: order.actor_id,
        },
      });
      await client.query('COMMIT');

      return this.getOrder(cmd.orderId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateOrderLine(raw: unknown) {
    const cmd = updateOrderLineSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, cmd.orderId);
      this.assertOpenMutable(order);
      await this.assertNoLiveSettlement(client, cmd.orderId);
      const line = await this.lockLine(client, cmd.orderId, cmd.orderLineId);
      const catalogItemId = cmd.catalogItemId ?? line.catalog_item_id;
      const quantityRaw = cmd.quantity ?? line.quantity;
      const unit = cmd.unit ?? line.unit;
      const dimension = cmd.dimension ?? line.dimension;
      await this.assertCatalogItem(client, order.tenant_id, catalogItemId, dimension);
      const qty = this.assertLineQuantity(quantityRaw, dimension, unit);
      await client.query(
        `UPDATE sales_order_line
         SET catalog_item_id = $1, quantity = $2, unit = $3, dimension = $4
         WHERE order_line_id = $5`,
        [catalogItemId, qty.value, qty.unit, qty.dimension, cmd.orderLineId],
      );
      await this.clearOpenCommercialTerms(client, cmd.orderId);
      await client.query('COMMIT');
      return this.getOrder(cmd.orderId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async removeOrderLine(raw: unknown) {
    const cmd = removeOrderLineSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, cmd.orderId);
      this.assertOpenMutable(order);
      await this.assertNoLiveSettlement(client, cmd.orderId);
      await this.lockLine(client, cmd.orderId, cmd.orderLineId);
      await client.query(`DELETE FROM sales_order_line WHERE order_line_id = $1`, [cmd.orderLineId]);
      await this.clearOpenCommercialTerms(client, cmd.orderId);
      await client.query('COMMIT');
      return this.getOrder(cmd.orderId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async cancelOrder(raw: unknown) {
    const cmd = cancelOrderSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, cmd.orderId);
      if (order.status === 'CANCELLED') {
        await client.query('COMMIT');
        return this.getOrder(cmd.orderId);
      }
      if (order.status !== 'OPEN') {
        throw new OrderImmutableError('Only OPEN orders can be cancelled');
      }
      await client.query(
        `UPDATE sales_order
         SET status = 'CANCELLED', cancelled_at = NOW(), cancel_reason = $2,
             actor_id = COALESCE($3, actor_id), device_id = COALESCE($4, device_id)
         WHERE order_id = $1`,
        [cmd.orderId, cmd.reason, cmd.actorId ?? null, cmd.deviceId ?? null],
      );
      await this.mirrorFactTx(client, {
        factType: OperationalFactType.OrderCancelled,
        idempotencyKey: `order-cancelled:${cmd.orderId}`,
        payload: {
          orderId: cmd.orderId,
          reason: cmd.reason,
          inventoryWriteOff: false,
        },
        context: {
          tenantId: order.tenant_id,
          legalEntityId: order.legal_entity_id,
          outletId: order.outlet_id,
          actorId: cmd.actorId ?? order.actor_id,
        },
      });
      await client.query('COMMIT');

      return this.getOrder(cmd.orderId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * D1.4B — Accept explicit commercial terms while Order is OPEN (ADR-0028).
   * Not a pricing engine: receives already-resolved commercial economics.
   */
  async setOrderCommercialTerms(raw: unknown) {
    const cmd = setOrderCommercialTermsSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, cmd.orderId);
      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
        throw new OrderImmutableError(
          `${order.status} order commercial terms are immutable; explicit reprice is OPEN-only`,
        );
      }
      if (order.status !== 'OPEN') {
        throw new OrderImmutableError('Only OPEN orders accept commercial terms');
      }
      await this.assertNoLiveSettlement(client, cmd.orderId);

      const lines = await this.loadLines(client, cmd.orderId);
      const state = buildCommercialStateFromCommand(cmd, lines);

      const prior = await client.query<{
        idempotency_key: string;
        semantic_fingerprint: string;
      }>(`SELECT idempotency_key, semantic_fingerprint FROM sales_order_commercial_terms WHERE order_id = $1`, [
        cmd.orderId,
      ]);
      const p = prior.rows[0];
      if (p) {
        if (p.idempotency_key === cmd.idempotencyKey && p.semantic_fingerprint === state.semanticFingerprint) {
          await client.query('COMMIT');
          return {
            status: 'duplicate' as const,
            orderId: cmd.orderId,
            certainty: state.certainty,
            netMerchandiseSalesMinor: state.netMerchandiseSalesMinor,
            semanticFingerprint: state.semanticFingerprint,
          };
        }
        if (p.idempotency_key === cmd.idempotencyKey) {
          throw new IdempotencyConflictError(
            cmd.idempotencyKey,
            'SetOrderCommercialTerms idempotency key already used with different commercial semantics',
          );
        }
        // Different key while OPEN → explicit replacement (reprice)
      }

      await persistOpenCommercialTerms(client, {
        orderId: cmd.orderId,
        tenantId: order.tenant_id,
        idempotencyKey: cmd.idempotencyKey,
        actorId: cmd.actorId ?? null,
        deviceId: cmd.deviceId ?? null,
        state,
      });
      await client.query('COMMIT');
      return {
        status: 'accepted' as const,
        orderId: cmd.orderId,
        certainty: state.certainty,
        netMerchandiseSalesMinor: state.netMerchandiseSalesMinor,
        semanticFingerprint: state.semanticFingerprint,
        grossMerchandiseMinor: state.grossMerchandiseMinor,
        merchantFundedDiscountMinor: state.merchantFundedDiscountMinor,
        thirdPartyMerchandiseFundingMinor: state.thirdPartyMerchandiseFundingMinor,
        lines: state.lines.map((l) => ({
          orderLineId: l.orderLineId,
          lineNumber: l.lineNumber,
          allocatedOrderMerchantDiscountMinor: l.allocatedOrderMerchantDiscountMinor,
          netMerchandiseSalesMinor: l.netMerchandiseSalesMinor,
        })),
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * C1.1 — under Order row lock: re-read lines, resolve Menu+policy at business instant,
   * calculate BASE_LIST_LINE_GROSS, optionally persist via SetOrderCommercialTerms path.
   * Prevents TOCTOU between preview calculation and accept.
   */
  async calculateBaseCommercialTermsLocked(input: {
    orderId: string;
    salesContext: unknown;
    menu: {
      /** Injected unit-price resolution port (Orders does not own Menu configuration). */
      resolveUnitPrices: (args: {
        orderId: string;
        salesContext: unknown;
      }) => Promise<{
      orderId: string;
      lines: Array<{
        orderLineId: string;
        catalogItemId: string;
        resolvedUnitPriceMinor: string | null;
        currencyCode: string;
        minorUnitExponent: number;
        availabilityStatus: string;
        menuPublicationId: string | null;
        priceRuleId: string | null;
      }>;
    }>;
    };
    policies: {
      resolveForOrder: (
        client: Client | Pool,
        orderId: string,
        businessDateTime: string,
      ) => Promise<{
        roundingPolicyId: string;
        policyVersion: number;
        roundingMode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';
        quantumMinor: string;
        jurisdictionCode: string;
      }>;
    };
    persist: boolean;
    idempotencyKey?: string;
    actorId?: string;
    deviceId?: string;
  }) {
    const salesContext = input.salesContext as { businessDateTime?: string };
    if (!salesContext?.businessDateTime) {
      throw new DomainValidationError(
        'COMMERCIAL_ROUNDING_POLICY_INVALID',
        'salesContext.businessDateTime required for policy selection',
      );
    }

    const { assembleBaseCommercialLineTerms } = await import(
      '../commercial-rounding/base-commercial-acceptance.js'
    );

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, input.orderId);
      if (order.status !== 'OPEN') {
        throw new DomainValidationError(
          'COMMERCIAL_TERMS_NOT_ACCEPTABLE',
          'Only OPEN Orders can calculate base commercial terms',
        );
      }
      await this.assertNoLiveSettlement(client, input.orderId);

      const lockedLines = await this.loadLines(client, input.orderId);
      const policy = await input.policies.resolveForOrder(
        client,
        input.orderId,
        salesContext.businessDateTime,
      );
      const resolved = await input.menu.resolveUnitPrices({
        orderId: input.orderId,
        salesContext: input.salesContext,
      });

      // Re-check locked quantities still match resolved line set (mutation under lock would wait).
      if (lockedLines.length !== resolved.lines.length) {
        throw new DomainValidationError(
          'COMMERCIAL_TERMS_STALE',
          'Order lines changed during commercial calculation',
        );
      }
      for (const rl of resolved.lines) {
        const live = lockedLines.find((l) => l.order_line_id === rl.orderLineId);
        if (!live) {
          throw new DomainValidationError(
            'COMMERCIAL_TERMS_STALE',
            'Resolved line missing from locked Order',
          );
        }
      }

      const calculated = {
        orderId: input.orderId,
        ...assembleBaseCommercialLineTerms({
          orderLines: lockedLines.map((l) => ({
            orderLineId: l.order_line_id,
            catalogItemId: l.catalog_item_id,
            quantity: l.quantity,
            unit: l.unit,
            dimension: l.dimension,
          })),
          resolvedLines: resolved.lines,
          policy,
          businessDateTime: salesContext.businessDateTime,
        }),
      };

      if (!input.persist) {
        await client.query('COMMIT');
        return { calculated, accepted: null as null };
      }

      if (!input.idempotencyKey) {
        throw new DomainValidationError('VALIDATION', 'idempotencyKey required to accept');
      }

      const lineTerms = calculated.lines.map((l) => ({
        orderLineId: l.orderLineId,
        resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
        grossMerchandiseMinor: l.grossMerchandiseMinor,
        lineMerchantFundedDiscountMinor: '0',
        eligibleForOrderDiscount: true,
        thirdPartyMerchandiseFundingMinor: '0',
        taxMinor: null as string | null,
        certainty: 'FINAL' as const,
        provenance: {
          source: 'C1_1_BASE_LIST_LINE_GROSS',
          commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
          catalogItemId: l.catalogItemId,
          quantity: l.quantity,
          unit: l.unit,
          dimension: l.dimension,
          resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
          exactUnroundedMinorBasis: l.exactUnroundedMinorBasis,
          roundingDelta: l.roundingDelta,
          roundingPolicyId: l.roundingPolicyId,
          roundingPolicyVersion: l.roundingPolicyVersion,
          roundingMode: l.roundingMode,
          quantumMinor: l.quantumMinor,
          calculationContext: l.calculationContext,
          menuPublicationId: l.menuPublicationId,
          priceRuleId: l.priceRuleId,
        },
        exactUnroundedMinorBasis: l.exactUnroundedMinorBasis,
        roundingDelta: l.roundingDelta,
        roundingPolicyId: l.roundingPolicyId,
        roundingPolicyVersion: l.roundingPolicyVersion,
        roundingMode: l.roundingMode,
        quantumMinor: l.quantumMinor,
        calculationContext: l.calculationContext,
      }));

      const cmd = setOrderCommercialTermsSchema.parse({
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        currencyCode: calculated.currencyCode,
        minorUnitExponent: calculated.minorUnitExponent,
        certainty: 'FINAL',
        orderMerchantFundedDiscountMinor: '0',
        taxMinor: null,
        tipMinor: null,
        nonMerchandiseChargesMinor: null,
        commercialResolution: 'BASE_LIST_LINE_GROSS via ADR-0030 RoundingPolicy',
        provenance: {
          source: 'C1_1_BASE_LIST_LINE_GROSS',
          commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
          roundingPolicy: calculated.roundingPolicy,
          businessDateTime: calculated.businessDateTime,
          merchandiseGrossMinor: calculated.merchandiseGrossMinor,
        },
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        lineTerms,
      });

      // Still under same lock — build + persist without releasing.
      const linesForBuild = lockedLines.map((l) => ({
        order_line_id: l.order_line_id,
        order_id: l.order_id,
        line_number: l.line_number,
        catalog_item_id: l.catalog_item_id,
        quantity: l.quantity,
      }));
      const state = buildCommercialStateFromCommand(cmd, linesForBuild);

      const prior = await client.query<{
        idempotency_key: string;
        semantic_fingerprint: string;
      }>(`SELECT idempotency_key, semantic_fingerprint FROM sales_order_commercial_terms WHERE order_id = $1`, [
        input.orderId,
      ]);
      const p = prior.rows[0];
      if (p) {
        if (p.idempotency_key === cmd.idempotencyKey && p.semantic_fingerprint === state.semanticFingerprint) {
          await client.query('COMMIT');
          return {
            calculated,
            accepted: {
              status: 'duplicate' as const,
              orderId: input.orderId,
              certainty: state.certainty,
              netMerchandiseSalesMinor: state.netMerchandiseSalesMinor,
              semanticFingerprint: state.semanticFingerprint,
            },
          };
        }
        if (p.idempotency_key === cmd.idempotencyKey) {
          throw new IdempotencyConflictError(
            cmd.idempotencyKey,
            'SetOrderCommercialTerms idempotency key already used with different commercial semantics',
          );
        }
      }

      await persistOpenCommercialTerms(client, {
        orderId: input.orderId,
        tenantId: order.tenant_id,
        idempotencyKey: cmd.idempotencyKey,
        actorId: cmd.actorId ?? null,
        deviceId: cmd.deviceId ?? null,
        state,
      });
      await client.query('COMMIT');
      return {
        calculated,
        accepted: {
          status: 'accepted' as const,
          orderId: input.orderId,
          certainty: state.certainty,
          netMerchandiseSalesMinor: state.netMerchandiseSalesMinor,
          semanticFingerprint: state.semanticFingerprint,
          grossMerchandiseMinor: state.grossMerchandiseMinor,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Bind CatalogItem RecipeProfile → RecipeSpecification (ADR-0009 direction).
   * Item-level default only in D1.3A (product_variant_id remains NULL / reserved).
   */
  async bindCatalogItemRecipeProfile(raw: {
    tenantId: string;
    catalogItemId: string;
    recipeSpecificationId: string;
  }) {
    await this.assertCatalogItemExists(raw.tenantId, raw.catalogItemId);
    const spec = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM recipe_specification WHERE recipe_specification_id = $1`,
      [raw.recipeSpecificationId],
    );
    if (!spec.rows[0] || spec.rows[0].tenant_id !== raw.tenantId) {
      throw new NotFoundError(`Recipe specification not found: ${raw.recipeSpecificationId}`);
    }

    const existing = await this.pool.query<{ catalog_item_recipe_profile_id: string }>(
      `SELECT catalog_item_recipe_profile_id FROM catalog_item_recipe_profile
       WHERE tenant_id = $1 AND catalog_item_id = $2 AND product_variant_id IS NULL`,
      [raw.tenantId, raw.catalogItemId],
    );
    if (existing.rows[0]) {
      await this.pool.query(
        `UPDATE catalog_item_recipe_profile
         SET recipe_specification_id = $1
         WHERE catalog_item_recipe_profile_id = $2`,
        [raw.recipeSpecificationId, existing.rows[0].catalog_item_recipe_profile_id],
      );
    } else {
      await this.pool.query(
        `INSERT INTO catalog_item_recipe_profile (
           catalog_item_recipe_profile_id, tenant_id, catalog_item_id, product_variant_id, recipe_specification_id
         ) VALUES ($1,$2,$3,NULL,$4)`,
        [randomUUID(), raw.tenantId, raw.catalogItemId, raw.recipeSpecificationId],
      );
    }
    return {
      catalogItemId: raw.catalogItemId,
      recipeSpecificationId: raw.recipeSpecificationId,
    };
  }

  /**
   * Resolve consumption plan for an OPEN order without persisting COMPLETED / snapshot / GoodsIssue.
   * Used by D1.3A tests and as the resolution step inside D1.3B CompleteOrder.
   */
  async resolveConsumptionPlanPreview(orderId: string) {
    const order = await this.requireOrder(orderId);
    if (order.status !== 'OPEN') {
      throw new OrderImmutableError('Consumption preview applies to OPEN orders only');
    }
    const lines = await this.loadLines(this.pool, orderId);
    if (lines.length === 0) {
      throw new DomainValidationError('EMPTY_ORDER', 'Cannot resolve consumption for an empty order');
    }
    const warehouseId = await this.resolveAuthoritativeIssueWarehouse(
      this.pool,
      order.tenant_id,
      order.outlet_id,
      order.legal_entity_id,
    );
    const client = await this.pool.connect();
    try {
      const lookup = await this.buildSyncLookup(
        client,
        order.tenant_id,
        lines.map((l) => l.catalog_item_id),
      );
      const resolvedLines: Array<LineConsumptionPlan & { orderLineId: string; lineNumber: number }> =
        [];
      for (const line of lines) {
        try {
          const plan = resolveSaleLineConsumption(
            {
              catalogItemId: line.catalog_item_id,
              quantity: line.quantity,
              unit: line.unit,
              dimension: line.dimension,
            },
            lookup,
          );
          assertExactlyOneConsumptionPath(plan);
          resolvedLines.push({
            ...plan,
            orderLineId: line.order_line_id,
            lineNumber: line.line_number,
          });
        } catch (e) {
          mapDomainError(e);
        }
      }
      const provenanceHash = consumptionPlanProvenanceHash({
        orderId,
        outletId: order.outlet_id,
        resolvedIssueWarehouseId: warehouseId,
        lines: resolvedLines,
      });
      return {
        orderId,
        outletId: order.outlet_id,
        resolvedIssueWarehouseId: warehouseId,
        provenanceHash,
        lines: resolvedLines,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Operational CompleteOrder — requires Inventory SaleInventoryWriteOffPort (D1.3B).
   * D1.3A leaves the port unwired; this method then rejects without mutating to COMPLETED.
   */
  async completeOrder(raw: unknown) {
    const cmd = completeOrderSchema.parse(raw);

    if (!this.saleWriteOffPort) {
      // Hard D1.3A boundary: never persist COMPLETED / snapshot / OrderCompleted without GoodsIssue.
      throw new DomainValidationError(
        'SALE_WRITE_OFF_NOT_WIRED',
        'CompleteOrder requires Inventory SaleInventoryWriteOffPort (D1.3B). D1.3A cannot persist COMPLETED without GoodsIssue',
      );
    }

    const peek = await this.requireOrder(cmd.orderId);
    if (peek.status === 'COMPLETED') {
      if (peek.complete_idempotency_key === cmd.idempotencyKey && peek.complete_semantic_fingerprint) {
        const lines = await this.loadLines(this.pool, cmd.orderId);
        const plan = await this.pool.query<{ provenance_hash: string; resolved_issue_warehouse_id: string }>(
          `SELECT provenance_hash, resolved_issue_warehouse_id FROM consumption_plan_snapshot
           WHERE consumption_plan_id = $1`,
          [peek.consumption_plan_id],
        );
        const p = plan.rows[0];
        if (!p) throw new NotFoundError('ConsumptionPlanSnapshot missing for completed order');
        const snap = await this.pool.query<{ semantic_hash: string }>(
          `SELECT semantic_hash FROM order_commercial_snapshot WHERE order_id = $1`,
          [cmd.orderId],
        );
        const commercialSemanticHash = snap.rows[0]?.semantic_hash;
        if (!commercialSemanticHash) {
          throw new NotFoundError('OrderCommercialSnapshot missing for completed order');
        }
        const fp = completeFingerprint({
          orderId: cmd.orderId,
          businessDate: cmd.businessDate,
          businessTime: cmd.businessTime ?? null,
          businessOrder: cmd.businessOrder,
          lineIds: lines.map((l) => l.order_line_id),
          provenanceHash: p.provenance_hash,
          warehouseId: p.resolved_issue_warehouse_id,
          commercialSemanticHash,
        });
        if (peek.complete_semantic_fingerprint === fp) {
          return { status: 'duplicate' as const, order: await this.getOrder(cmd.orderId) };
        }
      }
      throw new IdempotencyConflictError(
        cmd.idempotencyKey,
        'Order already COMPLETED with a different idempotency key or semantic fingerprint',
      );
    }
    if (peek.status === 'CANCELLED') {
      throw new OrderImmutableError('CANCELLED order cannot be completed');
    }

    const keyConflict = await this.pool.query(
      `SELECT order_id FROM sales_order
       WHERE legal_entity_id = $1 AND complete_idempotency_key = $2 AND order_id <> $3`,
      [peek.legal_entity_id, cmd.idempotencyKey, cmd.orderId],
    );
    if (keyConflict.rows[0]) {
      throw new IdempotencyConflictError(
        cmd.idempotencyKey,
        'Idempotency key already used by another order in this legal entity',
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, cmd.orderId);
      if (order.status === 'COMPLETED') {
        if (
          order.complete_idempotency_key === cmd.idempotencyKey &&
          order.complete_semantic_fingerprint
        ) {
          const linesLocked = await this.loadLines(client, cmd.orderId);
          const plan = await client.query<{
            provenance_hash: string;
            resolved_issue_warehouse_id: string;
          }>(
            `SELECT provenance_hash, resolved_issue_warehouse_id FROM consumption_plan_snapshot
             WHERE consumption_plan_id = $1`,
            [order.consumption_plan_id],
          );
          const p = plan.rows[0];
          if (!p) {
            throw new NotFoundError('ConsumptionPlanSnapshot missing for completed order');
          }
          const snap = await client.query<{ semantic_hash: string }>(
            `SELECT semantic_hash FROM order_commercial_snapshot WHERE order_id = $1`,
            [cmd.orderId],
          );
          const commercialSemanticHash = snap.rows[0]?.semantic_hash;
          if (!commercialSemanticHash) {
            throw new NotFoundError('OrderCommercialSnapshot missing for completed order');
          }
          const lockedFp = completeFingerprint({
            orderId: cmd.orderId,
            businessDate: cmd.businessDate,
            businessTime: cmd.businessTime ?? null,
            businessOrder: cmd.businessOrder,
            lineIds: linesLocked.map((l) => l.order_line_id),
            provenanceHash: p.provenance_hash,
            warehouseId: p.resolved_issue_warehouse_id,
            commercialSemanticHash,
          });
          if (order.complete_semantic_fingerprint === lockedFp) {
            await client.query('COMMIT');
            return { status: 'duplicate' as const, order: await this.getOrder(cmd.orderId) };
          }
        }
        throw new IdempotencyConflictError(
          cmd.idempotencyKey,
          'Concurrent completion conflict: already COMPLETED with different key or semantics',
        );
      }
      if (order.status !== 'OPEN') {
        throw new OrderImmutableError('Only OPEN orders can be completed');
      }

      const lines = await this.loadLines(client, cmd.orderId);
      if (lines.length === 0) {
        throw new DomainValidationError('EMPTY_ORDER', 'Cannot complete an order with no lines');
      }

      const commercialState = await loadBuiltCommercialState(client, cmd.orderId);
      if (!commercialState) {
        throw new DomainValidationError(
          'COMMERCIAL_TERMS_REQUIRED',
          'CompleteOrder requires explicit SetOrderCommercialTerms (FINAL or UNKNOWN) before completion',
        );
      }

      const warehouseId = await this.resolveAuthoritativeIssueWarehouse(
        client,
        order.tenant_id,
        order.outlet_id,
        order.legal_entity_id,
      );
      const lookup = await this.buildSyncLookup(
        client,
        order.tenant_id,
        lines.map((l) => l.catalog_item_id),
      );
      const resolvedLines: Array<LineConsumptionPlan & { orderLineId: string; lineNumber: number }> =
        [];
      for (const line of lines) {
        try {
          const plan = resolveSaleLineConsumption(
            {
              catalogItemId: line.catalog_item_id,
              quantity: line.quantity,
              unit: line.unit,
              dimension: line.dimension,
            },
            lookup,
          );
          assertExactlyOneConsumptionPath(plan);
          resolvedLines.push({
            ...plan,
            orderLineId: line.order_line_id,
            lineNumber: line.line_number,
          });
        } catch (e) {
          mapDomainError(e);
        }
      }

      const provenanceHash = consumptionPlanProvenanceHash({
        orderId: cmd.orderId,
        outletId: order.outlet_id,
        resolvedIssueWarehouseId: warehouseId,
        lines: resolvedLines,
      });

      // Freeze commercial snapshot before inventory write-off (same TX).
      const frozen = await freezeCommercialSnapshot(client, {
        orderId: cmd.orderId,
        tenantId: order.tenant_id,
        legalEntityId: order.legal_entity_id,
        outletId: order.outlet_id,
        businessDate: cmd.businessDate,
        businessOrder: cmd.businessOrder,
        businessTime: cmd.businessTime ?? null,
        state: commercialState,
      });

      const fp = completeFingerprint({
        orderId: cmd.orderId,
        businessDate: cmd.businessDate,
        businessTime: cmd.businessTime ?? null,
        businessOrder: cmd.businessOrder,
        lineIds: lines.map((l) => l.order_line_id),
        provenanceHash,
        warehouseId,
        commercialSemanticHash: frozen.semanticHash,
      });

      const planJson = {
        orderId: cmd.orderId,
        outletId: order.outlet_id,
        resolvedIssueWarehouseId: warehouseId,
        provenanceHash,
        lines: resolvedLines,
      };

      const physicalLeaves = resolvedLines.flatMap((l) =>
        l.physicalLeaves.map((leaf) => ({
          orderLineId: l.orderLineId,
          catalogItemId: leaf.catalogItemId,
          quantityBase: leaf.quantityBase,
          unitBase: leaf.unitBase,
          dimension: leaf.dimension,
        })),
      );

      // ADR-0025 §4: persist ConsumptionPlanSnapshot before Inventory GoodsIssue.
      const consumptionPlanId = randomUUID();
      await client.query(
        `INSERT INTO consumption_plan_snapshot (
           consumption_plan_id, order_id, tenant_id, outlet_id,
           resolved_issue_warehouse_id, provenance_hash, plan_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          consumptionPlanId,
          cmd.orderId,
          order.tenant_id,
          order.outlet_id,
          warehouseId,
          provenanceHash,
          JSON.stringify(planJson),
        ],
      );

      for (const line of resolvedLines) {
        const planLineId = randomUUID();
        await client.query(
          `INSERT INTO consumption_plan_line (
             consumption_plan_line_id, consumption_plan_id, order_line_id, line_number,
             sold_catalog_item_id, sold_quantity, sold_unit, sold_dimension,
             root_kind, root_recipe_version_id, root_preparation_version_id, applied_strategy
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            planLineId,
            consumptionPlanId,
            line.orderLineId,
            line.lineNumber,
            line.soldCatalogItemId,
            line.soldQuantity,
            line.soldUnit,
            line.soldDimension,
            line.rootKind,
            line.rootRecipeVersionId,
            line.rootPreparationVersionId,
            line.appliedStrategy,
          ],
        );
        for (const v of line.resolvedVersions) {
          await client.query(
            `INSERT INTO consumption_plan_resolved_version (
               consumption_plan_resolved_version_id, consumption_plan_id, consumption_plan_line_id,
               version_kind, recipe_version_id, preparation_version_id, materialization_mode
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              randomUUID(),
              consumptionPlanId,
              planLineId,
              v.versionKind,
              v.recipeVersionId ?? null,
              v.preparationVersionId ?? null,
              v.materializationMode ?? null,
            ],
          );
        }
        for (const leaf of line.physicalLeaves) {
          await client.query(
            `INSERT INTO consumption_plan_physical_leaf (
               consumption_plan_physical_leaf_id, consumption_plan_id, consumption_plan_line_id,
               catalog_item_id, quantity_base, unit_base, dimension, leaf_path
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              randomUUID(),
              consumptionPlanId,
              planLineId,
              leaf.catalogItemId,
              leaf.quantityBase,
              leaf.unitBase,
              leaf.dimension,
              leaf.leafPath,
            ],
          );
        }
      }

      // Inventory posts GoodsIssue from frozen leaves only (same TX). Failure → full ROLLBACK.
      const goodsIssue = await this.saleWriteOffPort!.postGoodsIssueFromConsumptionPlan(client, {
        orderId: cmd.orderId,
        tenantId: order.tenant_id,
        legalEntityId: order.legal_entity_id,
        outletId: order.outlet_id,
        warehouseId,
        businessDate: cmd.businessDate,
        businessTime: cmd.businessTime ?? null,
        businessOrder: cmd.businessOrder,
        actorId: cmd.actorId ?? null,
        deviceId: cmd.deviceId ?? null,
        idempotencyKey: cmd.idempotencyKey,
        provenanceHash,
        planJson,
        physicalLeaves,
      });

      await client.query(
        `UPDATE sales_order SET
           status = 'COMPLETED',
           completed_at = NOW(),
           business_date = $2::date,
           business_time = $3,
           business_order = $4,
           actor_id = COALESCE($5, actor_id),
           device_id = COALESCE($6, device_id),
           complete_idempotency_key = $7,
           complete_semantic_fingerprint = $8,
           resolved_issue_warehouse_id = $9,
           consumption_plan_id = $10,
           order_commercial_snapshot_id = $11
         WHERE order_id = $1`,
        [
          cmd.orderId,
          cmd.businessDate,
          cmd.businessTime ?? null,
          cmd.businessOrder,
          cmd.actorId ?? null,
          cmd.deviceId ?? null,
          cmd.idempotencyKey,
          fp,
          warehouseId,
          consumptionPlanId,
          frozen.snapshotId,
        ],
      );

      await this.mirrorFactTx(client, {
        factType: OperationalFactType.OrderCompleted,
        idempotencyKey: `order-completed:${order.legal_entity_id}:${cmd.idempotencyKey}`,
        payload: {
          orderId: cmd.orderId,
          consumptionPlanId,
          orderCommercialSnapshotId: frozen.snapshotId,
          commercialSemanticHash: frozen.semanticHash,
          resolvedIssueWarehouseId: warehouseId,
          provenanceHash,
          lineCount: lines.length,
        },
        context: {
          tenantId: order.tenant_id,
          legalEntityId: order.legal_entity_id,
          outletId: order.outlet_id,
          actorId: cmd.actorId ?? order.actor_id,
          warehouseId,
        },
        position: {
          businessDate: cmd.businessDate,
          ...(cmd.businessTime ? { businessTime: cmd.businessTime } : {}),
          businessOrder: cmd.businessOrder,
        },
      });

      await client.query('COMMIT');
      return {
        status: 'completed' as const,
        goodsIssueId: goodsIssue.goodsIssueId,
        order: await this.getOrder(cmd.orderId),
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * ReverseCompletedOrder — explicit compensating truth (ADR-0025 §9).
   * Original Order remains COMPLETED; GoodsIssue + movements stay immutable.
   */
  async reverseCompletedOrder(raw: unknown) {
    const cmd = reverseCompletedOrderSchema.parse(raw);

    if (!this.saleWriteOffPort) {
      throw new DomainValidationError(
        'SALE_WRITE_OFF_NOT_WIRED',
        'ReverseCompletedOrder requires Inventory SaleInventoryWriteOffPort (D1.3B)',
      );
    }

    const peek = await this.requireOrder(cmd.orderId);
    if (peek.status !== 'COMPLETED') {
      throw new DomainValidationError(
        'NOT_COMPLETED',
        'Only COMPLETED orders can be reversed via ReverseCompletedOrder',
      );
    }

    const giPeek = await this.pool.query<{ goods_issue_id: string }>(
      `SELECT goods_issue_id FROM goods_issue WHERE source_order_id = $1`,
      [cmd.orderId],
    );
    const goodsIssueId = giPeek.rows[0]?.goods_issue_id;
    if (!goodsIssueId) {
      throw new NotFoundError(`GoodsIssue not found for completed order: ${cmd.orderId}`);
    }

    const fp = reverseCompletionFingerprint({
      orderId: cmd.orderId,
      goodsIssueId,
      businessDate: cmd.businessDate,
      businessOrder: cmd.businessOrder,
      businessTime: cmd.businessTime ?? null,
      reason: cmd.reason ?? null,
    });

    const priorRev = await this.pool.query<{
      sales_order_completion_reversal_id: string;
      idempotency_key: string;
      semantic_fingerprint: string;
      goods_issue_reversal_id: string;
    }>(`SELECT * FROM sales_order_completion_reversal WHERE order_id = $1`, [cmd.orderId]);
    const prior = priorRev.rows[0];
    if (prior) {
      if (prior.idempotency_key === cmd.idempotencyKey && prior.semantic_fingerprint === fp) {
        return {
          status: 'duplicate' as const,
          reversalId: prior.sales_order_completion_reversal_id,
          goodsIssueReversalId: prior.goods_issue_reversal_id,
          order: await this.getOrder(cmd.orderId),
        };
      }
      if (prior.idempotency_key === cmd.idempotencyKey) {
        throw new IdempotencyConflictError(
          cmd.idempotencyKey,
          'Order completion already reversed with a different semantic fingerprint',
        );
      }
      throw new DomainValidationError(
        'ALREADY_REVERSED',
        'Order completion is already reversed',
      );
    }

    const keyConflict = await this.pool.query(
      `SELECT order_id FROM sales_order_completion_reversal
       WHERE legal_entity_id = $1 AND idempotency_key = $2 AND order_id <> $3`,
      [peek.legal_entity_id, cmd.idempotencyKey, cmd.orderId],
    );
    if (keyConflict.rows[0]) {
      throw new IdempotencyConflictError(
        cmd.idempotencyKey,
        'Reversal idempotency key already used by another order in this legal entity',
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, cmd.orderId);
      if (order.status !== 'COMPLETED') {
        throw new DomainValidationError(
          'NOT_COMPLETED',
          'Only COMPLETED orders can be reversed via ReverseCompletedOrder',
        );
      }

      const concurrent = await client.query<{
        sales_order_completion_reversal_id: string;
        idempotency_key: string;
        semantic_fingerprint: string;
        goods_issue_reversal_id: string;
      }>(
        `SELECT * FROM sales_order_completion_reversal WHERE order_id = $1 FOR UPDATE`,
        [cmd.orderId],
      );
      const concurrentPrior = concurrent.rows[0];
      if (concurrentPrior) {
        if (
          concurrentPrior.idempotency_key === cmd.idempotencyKey &&
          concurrentPrior.semantic_fingerprint === fp
        ) {
          await client.query('COMMIT');
          return {
            status: 'duplicate' as const,
            reversalId: concurrentPrior.sales_order_completion_reversal_id,
            goodsIssueReversalId: concurrentPrior.goods_issue_reversal_id,
            order: await this.getOrder(cmd.orderId),
          };
        }
        throw new DomainValidationError(
          'ALREADY_REVERSED',
          'Order completion is already reversed',
        );
      }

      const gi = await client.query<{ goods_issue_id: string }>(
        `SELECT goods_issue_id FROM goods_issue WHERE source_order_id = $1 FOR UPDATE`,
        [cmd.orderId],
      );
      const lockedGiId = gi.rows[0]?.goods_issue_id;
      if (!lockedGiId) {
        throw new NotFoundError(`GoodsIssue not found for completed order: ${cmd.orderId}`);
      }

      const inventoryReverse = await this.saleWriteOffPort!.reverseGoodsIssueFromOrder(client, {
        orderId: cmd.orderId,
        goodsIssueId: lockedGiId,
        tenantId: order.tenant_id,
        legalEntityId: order.legal_entity_id,
        idempotencyKey: cmd.idempotencyKey,
        businessDate: cmd.businessDate,
        businessOrder: cmd.businessOrder,
        businessTime: cmd.businessTime ?? null,
        reason: cmd.reason ?? null,
        actorId: cmd.actorId ?? null,
        deviceId: cmd.deviceId ?? null,
      });

      const reversalId = randomUUID();
      await client.query(
        `INSERT INTO sales_order_completion_reversal (
           sales_order_completion_reversal_id, tenant_id, order_id, goods_issue_id,
           goods_issue_reversal_id, legal_entity_id, idempotency_key, semantic_fingerprint,
           business_date, business_time, business_order,
           reason, actor_id, device_id, reversed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,NOW())`,
        [
          reversalId,
          order.tenant_id,
          cmd.orderId,
          lockedGiId,
          inventoryReverse.goodsIssueReversalId,
          order.legal_entity_id,
          cmd.idempotencyKey,
          fp,
          cmd.businessDate,
          cmd.businessTime ?? null,
          cmd.businessOrder,
          cmd.reason ?? null,
          cmd.actorId ?? null,
          cmd.deviceId ?? null,
        ],
      );

      const reverseContext: {
        tenantId: string;
        legalEntityId: string;
        outletId: string;
        actorId: string | null;
        warehouseId?: string;
      } = {
        tenantId: order.tenant_id,
        legalEntityId: order.legal_entity_id,
        outletId: order.outlet_id,
        actorId: cmd.actorId ?? order.actor_id,
      };
      if (order.resolved_issue_warehouse_id) {
        reverseContext.warehouseId = order.resolved_issue_warehouse_id;
      }

      await this.mirrorFactTx(client, {
        factType: OperationalFactType.OrderCompletionReversed,
        idempotencyKey: `order-completion-reversed:${order.legal_entity_id}:${cmd.idempotencyKey}`,
        payload: {
          orderId: cmd.orderId,
          salesOrderCompletionReversalId: reversalId,
          goodsIssueId: lockedGiId,
          goodsIssueReversalId: inventoryReverse.goodsIssueReversalId,
          ...(cmd.reason ? { reason: cmd.reason } : {}),
        },
        context: reverseContext,
        position: {
          businessDate: cmd.businessDate,
          ...(cmd.businessTime ? { businessTime: cmd.businessTime } : {}),
          businessOrder: cmd.businessOrder,
        },
      });

      await client.query('COMMIT');
      return {
        status: 'reversed' as const,
        reversalId,
        goodsIssueReversalId: inventoryReverse.goodsIssueReversalId,
        order: await this.getOrder(cmd.orderId),
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getOrder(orderId: string) {
    const row = await this.requireOrder(orderId);
    const lines = await this.loadLines(this.pool, orderId);
    return {
      orderId: row.order_id,
      tenantId: row.tenant_id,
      legalEntityId: row.legal_entity_id,
      outletId: row.outlet_id,
      status: row.status,
      channel: row.channel,
      businessDate:
        row.business_date instanceof Date
          ? `${row.business_date.getFullYear()}-${String(row.business_date.getMonth() + 1).padStart(2, '0')}-${String(row.business_date.getDate()).padStart(2, '0')}`
          : row.business_date,
      businessTime: row.business_time,
      businessOrder: row.business_order,
      actorId: row.actor_id,
      deviceId: row.device_id,
      resolvedIssueWarehouseId: row.resolved_issue_warehouse_id,
      consumptionPlanId: row.consumption_plan_id,
      cancelReason: row.cancel_reason,
      completeIdempotencyKey: row.complete_idempotency_key,
      lines: lines.map((l) => ({
        orderLineId: l.order_line_id,
        lineNumber: l.line_number,
        catalogItemId: l.catalog_item_id,
        quantity: l.quantity,
        unit: l.unit,
        dimension: l.dimension,
      })),
    };
  }

  /**
   * OPEN commercial acceptance status for cashier UX (D1.4B).
   * Absence after line mutation = NEEDS_REACCEPTANCE (terms cleared, not a STALE row).
   */
  async getOpenCommercialStatus(orderId: string) {
    const order = await this.requireOrder(orderId);
    const head = await this.pool.query<{
      currency_code: string;
      minor_unit_exponent: number;
      semantic_fingerprint: string;
      provenance_json: unknown;
    }>(
      `SELECT currency_code, minor_unit_exponent, semantic_fingerprint, provenance_json
       FROM sales_order_commercial_terms WHERE order_id = $1`,
      [orderId],
    );
    if (head.rowCount !== 1) {
      return {
        orderId,
        orderStatus: order.status,
        commercialState: 'NOT_ACCEPTED' as const,
        presentationHint: 'NEEDS_REACCEPTANCE' as const,
        currencyCode: null,
        minorUnitExponent: null,
        acceptedGrossMerchandiseMinor: null,
        merchandiseGrossMinor: null,
        commercialGrossPolicy: null,
        roundingProvenance: null,
        lines: [] as Array<{
          orderLineId: string;
          resolvedUnitPriceMinor: string | null;
          grossMerchandiseMinor: string;
          exactUnroundedMinorBasis: string | null;
          roundingDelta: string | null;
          roundingPolicyId: string | null;
          roundingPolicyVersion: number | null;
        }>,
      };
    }
    const h = head.rows[0]!;
    const lines = await this.pool.query<{
      order_line_id: string;
      resolved_unit_price_minor: string | null;
      gross_merchandise_minor: string;
      exact_unrounded_minor_basis: string | null;
      rounding_delta: string | null;
      rounding_policy_id: string | null;
      rounding_policy_version: number | null;
      rounding_mode: string | null;
      quantum_minor: string | null;
      calculation_context: string | null;
    }>(
      `SELECT order_line_id, resolved_unit_price_minor, gross_merchandise_minor,
              exact_unrounded_minor_basis, rounding_delta, rounding_policy_id,
              rounding_policy_version, rounding_mode, quantum_minor, calculation_context
       FROM sales_order_commercial_line_terms WHERE order_id = $1 ORDER BY line_number ASC`,
      [orderId],
    );
    let acceptedGross = 0n;
    for (const l of lines.rows) {
      acceptedGross += BigInt(l.gross_merchandise_minor);
    }
    const first = lines.rows[0];
    const allHaveRounding = lines.rows.every((l) => l.rounding_policy_id != null);
    const provenance =
      h.provenance_json && typeof h.provenance_json === 'object'
        ? (h.provenance_json as Record<string, unknown>)
        : null;
    return {
      orderId,
      orderStatus: order.status,
      commercialState: 'ACCEPTED' as const,
      presentationHint: 'COMMERCIAL_CURRENT' as const,
      currencyCode: h.currency_code,
      minorUnitExponent: h.minor_unit_exponent,
      /** Authoritative merchandise gross = Σ accepted rounded line gross (no Order re-round). */
      acceptedGrossMerchandiseMinor: acceptedGross.toString(),
      merchandiseGrossMinor: acceptedGross.toString(),
      commercialGrossPolicy: allHaveRounding
        ? ('BASE_LIST_LINE_GROSS_ROUNDED' as const)
        : ('LEGACY_EXPLICIT_GROSS_READ_ONLY' as const),
      roundingProvenance: allHaveRounding
        ? {
            roundingPolicyId: first!.rounding_policy_id,
            roundingPolicyVersion: first!.rounding_policy_version,
            roundingMode: first!.rounding_mode,
            quantumMinor: first!.quantum_minor,
            calculationContext: first!.calculation_context,
            orderProvenance: provenance,
          }
        : null,
      lines: lines.rows.map((l) => ({
        orderLineId: l.order_line_id,
        resolvedUnitPriceMinor: l.resolved_unit_price_minor,
        grossMerchandiseMinor: l.gross_merchandise_minor,
        exactUnroundedMinorBasis: l.exact_unrounded_minor_basis,
        roundingDelta: l.rounding_delta,
        roundingPolicyId: l.rounding_policy_id,
        roundingPolicyVersion: l.rounding_policy_version,
      })),
    };
  }

  async getCommercialSnapshot(orderId: string) {
    const snap = await this.pool.query(
      `SELECT * FROM order_commercial_snapshot WHERE order_id = $1`,
      [orderId],
    );
    const row = snap.rows[0];
    if (!row) return null;
    const lines = await this.pool.query(
      `SELECT * FROM order_line_commercial_snapshot
       WHERE order_commercial_snapshot_id = $1
       ORDER BY line_number ASC`,
      [row.order_commercial_snapshot_id],
    );
    return {
      orderCommercialSnapshotId: row.order_commercial_snapshot_id,
      orderId: row.order_id,
      tenantId: row.tenant_id,
      legalEntityId: row.legal_entity_id,
      outletId: row.outlet_id,
      currencyCode: row.currency_code,
      minorUnitExponent: row.minor_unit_exponent,
      businessDate:
        typeof row.business_date === 'string'
          ? row.business_date.slice(0, 10)
          : `${row.business_date.getFullYear()}-${String(row.business_date.getMonth() + 1).padStart(2, '0')}-${String(row.business_date.getDate()).padStart(2, '0')}`,
      businessOrder: row.business_order,
      businessTime: row.business_time,
      certainty: row.certainty,
      grossMerchandiseMinor: row.gross_merchandise_minor,
      merchantFundedDiscountMinor: row.merchant_funded_discount_minor,
      thirdPartyMerchandiseFundingMinor: row.third_party_merchandise_funding_minor,
      netMerchandiseSalesMinor: row.net_merchandise_sales_minor,
      taxMinor: row.tax_minor,
      nonMerchandiseChargesMinor: row.non_merchandise_charges_minor,
      tipMinor: row.tip_minor,
      customerPayableMinor: row.customer_payable_minor,
      commercialResolution: row.commercial_resolution,
      semanticHash: row.semantic_hash,
      lines: lines.rows.map((l) => ({
        orderLineCommercialSnapshotId: l.order_line_commercial_snapshot_id,
        orderLineId: l.order_line_id,
        lineNumber: l.line_number,
        soldCatalogItemId: l.sold_catalog_item_id,
        quantity: l.quantity,
        resolvedUnitPriceMinor: l.resolved_unit_price_minor,
        grossMerchandiseMinor: l.gross_merchandise_minor,
        lineMerchantFundedDiscountMinor: l.line_merchant_funded_discount_minor,
        allocatedOrderMerchantDiscountMinor: l.allocated_order_merchant_discount_minor,
        thirdPartyMerchandiseFundingMinor: l.third_party_merchandise_funding_minor,
        netMerchandiseSalesMinor: l.net_merchandise_sales_minor,
        taxMinor: l.tax_minor,
        certainty: l.certainty,
        fundingProvenance: l.funding_provenance,
        exactUnroundedMinorBasis: l.exact_unrounded_minor_basis ?? null,
        roundingDelta: l.rounding_delta ?? null,
        roundingPolicyId: l.rounding_policy_id ?? null,
        roundingPolicyVersion: l.rounding_policy_version ?? null,
        roundingMode: l.rounding_mode ?? null,
        quantumMinor: l.quantum_minor ?? null,
        calculationContext: l.calculation_context ?? null,
      })),
    };
  }

  private async clearOpenCommercialTerms(client: Client, orderId: string): Promise<void> {
    await client.query(`DELETE FROM sales_order_commercial_line_terms WHERE order_id = $1`, [orderId]);
    await client.query(`DELETE FROM sales_order_commercial_terms WHERE order_id = $1`, [orderId]);
  }

  private assertOpenMutable(order: OrderRow): void {
    if (order.status !== 'OPEN') {
      throw new OrderImmutableError(
        `Cannot mutate order in status ${order.status}; COMPLETED/CANCELLED content is immutable`,
      );
    }
  }

  /** ADR-0032: live Settlement freezes Order commercial edits (backend authoritative). */
  private async assertNoLiveSettlement(client: Client, orderId: string): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM settlement_group
       WHERE order_id = $1 AND state IN ('COLLECTING', 'SATISFIED')
       LIMIT 1`,
      [orderId],
    );
    if ((res.rowCount ?? 0) > 0) {
      throw new DomainValidationError(
        'SETTLEMENT_EDIT_LOCKED',
        'Order commercial content cannot mutate while a live Settlement exists',
      );
    }
  }

  private async requireOrder(orderId: string): Promise<OrderRow> {
    const res = await this.pool.query<OrderRow>(`SELECT * FROM sales_order WHERE order_id = $1`, [
      orderId,
    ]);
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`Order not found: ${orderId}`);
    return row;
  }

  private async lockOrder(client: Client, orderId: string): Promise<OrderRow> {
    const res = await client.query<OrderRow>(
      `SELECT * FROM sales_order WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`Order not found: ${orderId}`);
    return row;
  }

  private async lockLine(client: Client, orderId: string, orderLineId: string): Promise<OrderLineRow> {
    const res = await client.query<OrderLineRow>(
      `SELECT order_line_id, order_id, line_number, catalog_item_id, quantity, unit,
              dimension::text AS dimension
       FROM sales_order_line WHERE order_line_id = $1 AND order_id = $2 FOR UPDATE`,
      [orderLineId, orderId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`Order line not found: ${orderLineId}`);
    return row;
  }

  private async loadLines(client: Client | Pool, orderId: string): Promise<OrderLineRow[]> {
    const res = await client.query<OrderLineRow>(
      `SELECT order_line_id, order_id, line_number, catalog_item_id, quantity, unit,
              dimension::text AS dimension
       FROM sales_order_line WHERE order_id = $1 ORDER BY line_number`,
      [orderId],
    );
    return res.rows;
  }

  private async assertOutlet(tenantId: string, legalEntityId: string, outletId: string) {
    const res = await this.pool.query<{
      outlet_id: string;
      tenant_id: string;
      legal_entity_id: string;
    }>(`SELECT outlet_id, tenant_id, legal_entity_id FROM outlet WHERE outlet_id = $1`, [outletId]);
    const row = res.rows[0];
    if (!row || row.tenant_id !== tenantId || row.legal_entity_id !== legalEntityId) {
      throw new NotFoundError(`Outlet not found for tenant/legal entity: ${outletId}`);
    }
  }

  private assertLineQuantity(value: string, dimension: UnitDimension, unit: string) {
    try {
      const q = createQuantity(value, dimension, unit);
      assertPositive(parseCanonicalDecimal(q.value), 'quantity');
      return q;
    } catch (err) {
      if (err instanceof DomainError) {
        throw new DomainValidationError('INVALID_QUANTITY', err.message);
      }
      throw err;
    }
  }

  private async assertCatalogItemExists(tenantId: string, catalogItemId: string) {
    const res = await this.pool.query(
      `SELECT catalog_item_id FROM catalog_item WHERE catalog_item_id = $1 AND tenant_id = $2`,
      [catalogItemId, tenantId],
    );
    if (!res.rows[0]) throw new NotFoundError(`Catalog item not found: ${catalogItemId}`);
  }

  private async assertCatalogItem(
    client: Client,
    tenantId: string,
    catalogItemId: string,
    dimension: UnitDimension,
  ) {
    const res = await client.query<{
      catalog_item_id: string;
      tenant_id: string;
      dimension: UnitDimension;
    }>(
      `SELECT catalog_item_id, tenant_id, dimension::text AS dimension
       FROM catalog_item WHERE catalog_item_id = $1`,
      [catalogItemId],
    );
    const row = res.rows[0];
    if (!row || row.tenant_id !== tenantId) {
      throw new NotFoundError(`Catalog item not found: ${catalogItemId}`);
    }
    if (row.dimension !== dimension) {
      throw new DomainValidationError(
        'DIMENSION_MISMATCH',
        `Line dimension ${dimension} does not match catalog item ${row.dimension}`,
      );
    }
  }

  private async resolveAuthoritativeIssueWarehouse(
    client: Client | Pool,
    tenantId: string,
    outletId: string,
    legalEntityId: string,
  ): Promise<string> {
    const res = await client.query<{
      default_sales_issue_warehouse_id: string | null;
    }>(
      `SELECT default_sales_issue_warehouse_id FROM outlet
       WHERE outlet_id = $1 AND tenant_id = $2`,
      [outletId, tenantId],
    );
    const outlet = res.rows[0];
    if (!outlet) throw new NotFoundError(`Outlet not found: ${outletId}`);
    if (!outlet.default_sales_issue_warehouse_id) {
      throw new DomainValidationError(
        'DEFAULT_ISSUE_WAREHOUSE_REQUIRED',
        'Outlet has no authoritative default_sales_issue_warehouse_id',
      );
    }
    const wh = await client.query<{
      warehouse_id: string;
      tenant_id: string;
      legal_entity_id: string;
    }>(`SELECT warehouse_id, tenant_id, legal_entity_id FROM warehouse WHERE warehouse_id = $1`, [
      outlet.default_sales_issue_warehouse_id,
    ]);
    const row = wh.rows[0];
    if (!row || row.tenant_id !== tenantId || row.legal_entity_id !== legalEntityId) {
      throw new DomainValidationError(
        'DEFAULT_ISSUE_WAREHOUSE_INVALID',
        'Outlet default issue warehouse must belong to the same tenant and legal entity',
      );
    }
    return row.warehouse_id;
  }

  async buildSyncLookup(
    client: Client,
    tenantId: string,
    soldCatalogItemIds: string[],
  ): Promise<RecipeGraphLookup> {
    const catalogs = new Map<string, GraphCatalogItem>();
    const recipesByItem = new Map<string, GraphRecipeVersion>();
    const stockPrepByOutput = new Map<string, GraphPreparationVersion>();
    const preps = new Map<string, GraphPreparationVersion>();

    const loadCatalog = async (id: string) => {
      if (catalogs.has(id)) return;
      const res = await client.query<{
        catalog_item_id: string;
        base_unit: string;
        dimension: UnitDimension;
        tenant_id: string;
      }>(
        `SELECT catalog_item_id, base_unit, dimension::text AS dimension, tenant_id
         FROM catalog_item WHERE catalog_item_id = $1`,
        [id],
      );
      const row = res.rows[0];
      if (row && row.tenant_id === tenantId) {
        catalogs.set(id, {
          catalogItemId: row.catalog_item_id,
          baseUnit: row.base_unit,
          dimension: row.dimension,
        });
      }
    };

    const loadPrep = async (prepVersionId: string): Promise<GraphPreparationVersion | null> => {
      if (preps.has(prepVersionId)) return preps.get(prepVersionId)!;
      const res = await client.query<{
        preparation_version_id: string;
        preparation_specification_id: string;
        status: 'DRAFT' | 'PUBLISHED';
        materialization_mode: 'VIRTUAL' | 'STOCK_TRACKED';
        output_catalog_item_id: string | null;
        normative_output_quantity: string;
        normative_output_unit: string;
        normative_output_dimension: UnitDimension;
      }>(
        `SELECT preparation_version_id, preparation_specification_id, status,
                materialization_mode, output_catalog_item_id,
                normative_output_quantity, normative_output_unit,
                normative_output_dimension::text AS normative_output_dimension
         FROM preparation_version WHERE preparation_version_id = $1`,
        [prepVersionId],
      );
      const row = res.rows[0];
      if (!row) return null;
      const comps = await client.query<{
        line_number: number;
        component_kind: 'CATALOG_ITEM' | 'PREPARATION_VERSION';
        catalog_item_id: string | null;
        nested_preparation_version_id: string | null;
        quantity: string;
        unit: string;
        dimension: UnitDimension;
      }>(
        `SELECT line_number, component_kind, catalog_item_id, nested_preparation_version_id,
                quantity, unit, dimension::text AS dimension
         FROM preparation_component WHERE preparation_version_id = $1 ORDER BY line_number`,
        [prepVersionId],
      );
      const prep: GraphPreparationVersion = {
        preparationVersionId: row.preparation_version_id,
        preparationSpecificationId: row.preparation_specification_id,
        status: row.status,
        materializationMode: row.materialization_mode,
        outputCatalogItemId: row.output_catalog_item_id,
        normativeOutputQuantity: row.normative_output_quantity,
        normativeOutputUnit: row.normative_output_unit,
        normativeOutputDimension: row.normative_output_dimension,
        components: comps.rows.map((c) => ({
          lineNumber: c.line_number,
          componentKind: c.component_kind,
          catalogItemId: c.catalog_item_id,
          nestedPreparationVersionId: c.nested_preparation_version_id,
          quantity: c.quantity,
          unit: c.unit,
          dimension: c.dimension,
        })),
      };
      preps.set(prepVersionId, prep);
      for (const c of prep.components) {
        if (c.catalogItemId) await loadCatalog(c.catalogItemId);
        if (c.nestedPreparationVersionId) await loadPrep(c.nestedPreparationVersionId);
      }
      if (prep.outputCatalogItemId) await loadCatalog(prep.outputCatalogItemId);
      return prep;
    };

    for (const soldId of soldCatalogItemIds) {
      await loadCatalog(soldId);

      const profileRes = await client.query<{
        recipe_specification_id: string;
      }>(
        `SELECT recipe_specification_id
         FROM catalog_item_recipe_profile
         WHERE tenant_id = $1
           AND catalog_item_id = $2
           AND product_variant_id IS NULL`,
        [tenantId, soldId],
      );
      const profile = profileRes.rows[0];
      if (profile) {
        const recipeRes = await client.query<{
          recipe_version_id: string;
          recipe_specification_id: string;
          status: 'DRAFT' | 'PUBLISHED';
          batch_size_quantity: string;
          batch_size_unit: string;
          batch_size_dimension: UnitDimension;
        }>(
          `SELECT recipe_version_id, recipe_specification_id, status,
                  batch_size_quantity, batch_size_unit,
                  batch_size_dimension::text AS batch_size_dimension
           FROM recipe_version
           WHERE recipe_specification_id = $1 AND status = 'PUBLISHED'
           ORDER BY version_number DESC
           LIMIT 1`,
          [profile.recipe_specification_id],
        );
        const rv = recipeRes.rows[0];
        if (!rv) {
          throw new DomainValidationError(
            'RECIPE_PROFILE_UNPUBLISHED',
            `CatalogItem ${soldId} has a RecipeProfile but no PUBLISHED RecipeVersion`,
          );
        }
        const comps = await client.query<{
          line_number: number;
          component_kind: 'CATALOG_ITEM' | 'PREPARATION_VERSION';
          catalog_item_id: string | null;
          nested_preparation_version_id: string | null;
          quantity: string;
          unit: string;
          dimension: UnitDimension;
        }>(
          `SELECT line_number, component_kind, catalog_item_id, nested_preparation_version_id,
                  quantity, unit, dimension::text AS dimension
           FROM recipe_component WHERE recipe_version_id = $1 ORDER BY line_number`,
          [rv.recipe_version_id],
        );
        const recipe: GraphRecipeVersion = {
          recipeVersionId: rv.recipe_version_id,
          recipeSpecificationId: rv.recipe_specification_id,
          status: rv.status,
          batchSizeQuantity: rv.batch_size_quantity,
          batchSizeUnit: rv.batch_size_unit,
          batchSizeDimension: rv.batch_size_dimension,
          components: comps.rows.map((c) => ({
            lineNumber: c.line_number,
            componentKind: c.component_kind,
            catalogItemId: c.catalog_item_id,
            nestedPreparationVersionId: c.nested_preparation_version_id,
            quantity: c.quantity,
            unit: c.unit,
            dimension: c.dimension,
          })),
        };
        recipesByItem.set(soldId, recipe);
        for (const c of recipe.components) {
          if (c.catalogItemId) await loadCatalog(c.catalogItemId);
          if (c.nestedPreparationVersionId) await loadPrep(c.nestedPreparationVersionId);
        }
      }

      const stockRoots = await client.query<{
        preparation_specification_id: string;
        preparation_version_id: string;
      }>(
        `SELECT DISTINCT ON (pv.preparation_specification_id)
            pv.preparation_specification_id, pv.preparation_version_id
         FROM preparation_version pv
         JOIN preparation_specification ps ON ps.preparation_specification_id = pv.preparation_specification_id
         WHERE ps.tenant_id = $1
           AND pv.status = 'PUBLISHED'
           AND pv.materialization_mode = 'STOCK_TRACKED'
           AND pv.output_catalog_item_id = $2
         ORDER BY pv.preparation_specification_id, pv.version_number DESC`,
        [tenantId, soldId],
      );
      if (stockRoots.rows.length > 1) {
        throw new DomainValidationError(
          'AMBIGUOUS_CONSUMPTION_ROOT',
          `Sold item ${soldId} has multiple STOCK_TRACKED preparation roots; configuration must be unique`,
        );
      }
      if (stockRoots.rows[0]) {
        const prep = await loadPrep(stockRoots.rows[0].preparation_version_id);
        if (prep) stockPrepByOutput.set(soldId, prep);
      }
    }

    return {
      getCatalogItem: (id) => catalogs.get(id) ?? null,
      getPublishedRecipeForCatalogItem: (id) => recipesByItem.get(id) ?? null,
      getPublishedStockTrackedPrepForOutput: (id) => stockPrepByOutput.get(id) ?? null,
      getPreparationVersion: (id) => preps.get(id) ?? null,
    };
  }

  private async mirrorFact(input: {
    factType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    context: {
      tenantId: string;
      legalEntityId: string;
      outletId: string;
      actorId: string | null;
      warehouseId?: string;
    };
    position?: { businessDate: string; businessTime?: string; businessOrder: number };
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.mirrorFactTx(client, input);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private async mirrorFactTx(
    client: Client,
    input: {
      factType: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
      context: {
        tenantId: string;
        legalEntityId: string;
        outletId: string;
        actorId: string | null;
        warehouseId?: string;
      };
      position?: { businessDate: string; businessTime?: string; businessOrder: number };
    },
  ) {
    const now = new Date().toISOString();
    const position = input.position ?? {
      businessDate: now.slice(0, 10),
      businessOrder: 0,
    };
    const fact = parseOperationalFact({
      factId: randomUUID(),
      factType: input.factType,
      idempotencyKey: input.idempotencyKey,
      occurredAt: now,
      recordedAt: now,
      position: {
        businessDate: position.businessDate,
        ...(position.businessTime ? { businessTime: position.businessTime } : {}),
        businessOrder: position.businessOrder,
      },
      context: {
        businessGroupId: input.context.tenantId,
        legalEntityId: input.context.legalEntityId,
        restaurantLocationId: input.context.outletId,
        ...(input.context.warehouseId ? { warehouseId: input.context.warehouseId } : {}),
        actorId: input.context.actorId ?? '00000000-0000-4000-8000-000000000000',
        jurisdictionProfileVersionId: '00000000-0000-4000-8000-000000000001',
        valuationCurrencyCode: 'VND',
      },
      payload: input.payload,
    });
    const fp = factSemanticFingerprint(fact);
    await client.query(
      `INSERT INTO operational_fact_feed (
         fact_id, fact_type, idempotency_key, semantic_fingerprint,
         occurred_at, recorded_at, business_date, business_order, business_time, context, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::jsonb,$11::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        fact.factId,
        fact.factType,
        fact.idempotencyKey,
        fp,
        fact.occurredAt,
        fact.recordedAt,
        fact.position.businessDate,
        fact.position.businessOrder,
        fact.position.businessTime ?? null,
        JSON.stringify(fact.context),
        JSON.stringify(fact.payload),
      ],
    );
  }
}
