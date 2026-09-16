import type { Pool } from 'pg';
import type { OrdersService } from '../orders/orders-service.js';
import { DomainValidationError, NotFoundError } from './errors.js';
import { PosSurfaceResolver } from './pos-surface-resolver.js';
import {
  selectPosCountTapSchema,
  selectPosItemSchema,
  type SelectPosCountTapInput,
  type SelectPosItemInput,
} from './types.js';

/**
 * Narrow cashier selection path (ADR-0031 / P1.1).
 * Re-resolves current POS surface; requires ACTIVE; delegates AddOrderLine to Orders.
 * POS module does NOT write sales_order / sales_order_line tables.
 */
export class PosSelectionService {
  private readonly surfaceResolver: PosSurfaceResolver;

  constructor(
    private readonly pool: Pool,
    private readonly orders: OrdersService,
  ) {
    this.surfaceResolver = new PosSurfaceResolver(pool);
  }

  /**
   * P1.2 COUNT one-tap path. Does not invent MASS/VOLUME quantity=1.
   * Revalidates surface; Catalog dimension must be COUNT.
   */
  async selectPosCountTap(raw: unknown) {
    const cmd = selectPosCountTapSchema.parse(raw) as SelectPosCountTapInput;
    const surface = await this.surfaceResolver.resolvePosSurface({
      presentationContext: cmd.presentationContext,
      salesContext: cmd.salesContext,
    });
    const slot = this.surfaceResolver.findActiveSlot(surface, cmd.layoutPublicationSlotId);
    if (!slot) {
      throw new DomainValidationError(
        'POS_SLOT_NOT_ACTIVE',
        'Selected layout slot is not present as an active/visible slot on current ResolvedPosSurface',
      );
    }
    if (slot.state === 'DISABLED_UNAVAILABLE') {
      throw new DomainValidationError(
        'POS_SLOT_UNAVAILABLE',
        'Selected POS slot is DISABLED_UNAVAILABLE',
      );
    }
    if (slot.state === 'DISABLED_PRICE_UNAVAILABLE') {
      throw new DomainValidationError(
        'POS_SLOT_PRICE_UNAVAILABLE',
        'Selected POS slot is DISABLED_PRICE_UNAVAILABLE',
      );
    }
    if (slot.state === 'CONFIGURATION_ERROR' || slot.state !== 'ACTIVE') {
      throw new DomainValidationError('POS_SLOT_NOT_ACTIVE', 'Selected POS slot is not ACTIVE');
    }
    if (slot.dimension !== 'COUNT' || slot.quantityEntry !== 'COUNT_ONE') {
      throw new DomainValidationError(
        'POS_QUANTITY_ENTRY_DEFERRED',
        'MASS/VOLUME quantity entry is deferred — do not invent quantity=1 for weighted items',
      );
    }
    return this.selectPosItem({
      orderId: cmd.orderId,
      layoutPublicationSlotId: cmd.layoutPublicationSlotId,
      presentationContext: cmd.presentationContext,
      salesContext: cmd.salesContext,
      quantity: '1',
      unit: slot.baseUnit,
      dimension: 'COUNT',
    });
  }

  async selectPosItem(raw: unknown) {
    const cmd = selectPosItemSchema.parse(raw) as SelectPosItemInput;

    const orderRow = await this.pool.query<{
      order_id: string;
      tenant_id: string;
      outlet_id: string;
      legal_entity_id: string;
      status: string;
    }>(
      `SELECT order_id, tenant_id, outlet_id, legal_entity_id, status
       FROM sales_order WHERE order_id = $1`,
      [cmd.orderId],
    );
    if (orderRow.rowCount !== 1) {
      throw new NotFoundError('Order not found');
    }
    const order = orderRow.rows[0]!;
    if (order.status !== 'OPEN') {
      throw new DomainValidationError('POS_SLOT_NOT_ACTIVE', 'Order must be OPEN for POS selection');
    }
    if (order.tenant_id !== cmd.presentationContext.tenantId) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'Order tenant does not match PresentationContext',
      );
    }
    if (order.outlet_id !== cmd.presentationContext.outletId) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'Order outlet does not match PresentationContext',
      );
    }
    if (
      cmd.salesContext.tenantId !== cmd.presentationContext.tenantId ||
      cmd.salesContext.outletId !== cmd.presentationContext.outletId ||
      cmd.salesContext.brandId !== cmd.presentationContext.brandId
    ) {
      throw new DomainValidationError(
        'INVALID_PRESENTATION_CONTEXT',
        'SalesContext must match PresentationContext topology',
      );
    }

    // Stale client ACTIVE is not authority — re-resolve current surface
    const surface = await this.surfaceResolver.resolvePosSurface({
      presentationContext: cmd.presentationContext,
      salesContext: cmd.salesContext,
    });

    const slot = this.surfaceResolver.findActiveSlot(surface, cmd.layoutPublicationSlotId);
    if (!slot) {
      throw new DomainValidationError(
        'POS_SLOT_NOT_ACTIVE',
        'Selected layout slot is not present as an active/visible slot on current ResolvedPosSurface',
      );
    }

    if (slot.state === 'DISABLED_UNAVAILABLE') {
      throw new DomainValidationError(
        'POS_SLOT_UNAVAILABLE',
        'Selected POS slot is DISABLED_UNAVAILABLE',
      );
    }
    if (slot.state === 'DISABLED_PRICE_UNAVAILABLE') {
      throw new DomainValidationError(
        'POS_SLOT_PRICE_UNAVAILABLE',
        'Selected POS slot is DISABLED_PRICE_UNAVAILABLE',
      );
    }
    if (slot.state === 'CONFIGURATION_ERROR') {
      throw new DomainValidationError(
        'POS_SLOT_NOT_ACTIVE',
        'Selected POS slot is CONFIGURATION_ERROR',
      );
    }
    if (slot.state !== 'ACTIVE') {
      throw new DomainValidationError('POS_SLOT_NOT_ACTIVE', 'Selected POS slot is not ACTIVE');
    }

    // Delegate — POS never writes Order tables directly; use revalidated slot catalog id
    const basket = await this.orders.addOrderLine({
      orderId: cmd.orderId,
      catalogItemId: slot.catalogItemId,
      quantity: cmd.quantity,
      unit: cmd.unit,
      dimension: cmd.dimension,
    });

    return {
      order: basket,
      selected: {
        layoutPublicationSlotId: slot.layoutPublicationSlotId,
        catalogItemId: slot.catalogItemId,
        state: slot.state,
        unitPrice: slot.unitPrice,
      },
      surfaceProvenance: {
        layoutPublicationId: surface.layoutPublicationId,
        layoutPublicationVersion: surface.layoutPublicationVersion,
        menuPublicationId: surface.menuPublicationId,
        menuAssignmentId: surface.menuAssignmentId,
      },
    };
  }
}
