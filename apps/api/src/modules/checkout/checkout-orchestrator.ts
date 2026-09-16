import type { Pool } from 'pg';
import { DomainValidationError } from '../orders/errors.js';
import type { OrdersService } from '../orders/orders-service.js';
import type { FiscalCheckoutGate, QualifyingPaymentCoverageReader } from '../settlement/settlement-ports.js';
import { SettlementService } from '../settlement/settlement-service.js';

/**
 * Checkout application orchestration (ADR-0032).
 * Does not own Settlement or Order aggregates.
 */
export class CheckoutOrchestrator {
  constructor(
    private readonly pool: Pool,
    private readonly orders: OrdersService,
    private readonly settlements: SettlementService,
  ) {}

  withSettlement(settlements: SettlementService): CheckoutOrchestrator {
    return new CheckoutOrchestrator(this.pool, this.orders, settlements);
  }

  async tryAdvanceCheckout(raw: {
    settlementGroupId: string;
    completeIdempotencyKey: string;
    businessDate: string;
    businessOrder: number;
    businessTime?: string | null;
    actorId?: string | null;
    deviceId?: string | null;
  }) {
    let settlement = await this.settlements.reconcileSettlementCoverage(raw.settlementGroupId);
    if (settlement.state === 'ABORTED') {
      throw new DomainValidationError(
        'SETTLEMENT_NOT_SATISFIED',
        'Cannot advance checkout for an ABORTED Settlement',
      );
    }
    if (settlement.state !== 'SATISFIED') {
      throw new DomainValidationError(
        'SETTLEMENT_NOT_SATISFIED',
        `Settlement is ${settlement.state}; CompleteOrder requires SATISFIED`,
      );
    }

    const fiscal = await this.settlements.observeFiscalGate(raw.settlementGroupId);
    if (fiscal.status === 'UNAVAILABLE') {
      throw new DomainValidationError(
        'CHECKOUT_FISCAL_PREREQUISITE_UNAVAILABLE',
        fiscal.detail ?? 'Fiscal prerequisite cannot be determined authoritatively',
      );
    }
    if (fiscal.status === 'PENDING' || fiscal.status === 'REQUIRED_NOT_SATISFIED') {
      throw new DomainValidationError(
        'CHECKOUT_FISCAL_PREREQUISITE_PENDING',
        `Fiscal prerequisite status: ${fiscal.status}`,
      );
    }
    // NOT_REQUIRED | SATISFIED → permit

    const completion = await this.orders.completeOrder({
      orderId: settlement.orderId,
      idempotencyKey: raw.completeIdempotencyKey,
      businessDate: raw.businessDate,
      businessOrder: raw.businessOrder,
      ...(raw.businessTime != null ? { businessTime: raw.businessTime } : {}),
      ...(raw.actorId ? { actorId: raw.actorId } : {}),
      ...(raw.deviceId ? { deviceId: raw.deviceId } : {}),
    });

    return {
      settlement,
      fiscal,
      completion,
    };
  }
}

export type { QualifyingPaymentCoverageReader, FiscalCheckoutGate };
