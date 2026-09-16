import type pg from 'pg';
import {
  calculateRoundedLineGross,
  createMoney,
  type CommercialRoundingPolicySnapshot,
} from '@millq/domain';
import { MenuResolver } from '../menu/menu-resolver.js';
import { DomainValidationError } from '../orders/errors.js';
import { OrdersService } from '../orders/orders-service.js';
import {
  CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
  CommercialRoundingPolicyService,
} from './rounding-policy-service.js';

type Pool = pg.Pool;

/**
 * C1.1 — calculate BASE_LIST_LINE_GROSS from Menu unit prices + RoundingPolicy,
 * then explicitly accept via Orders SetOrderCommercialTerms under Order lock.
 *
 * Does NOT run on tap / mutation / CompleteOrder.
 */
export class BaseCommercialAcceptanceService {
  private readonly policies: CommercialRoundingPolicyService;
  private readonly menu: MenuResolver;

  constructor(
    private readonly pool: Pool,
    private readonly orders: OrdersService,
  ) {
    this.policies = new CommercialRoundingPolicyService(pool);
    this.menu = new MenuResolver(pool);
  }

  /**
   * Preview / calculate only (same kernel as accept). Not frozen.
   */
  async calculateBaseCommercialTerms(input: {
    orderId: string;
    salesContext: unknown;
  }) {
    return this.orders.calculateBaseCommercialTermsLocked({
      orderId: input.orderId,
      salesContext: input.salesContext,
      menu: {
        resolveUnitPrices: (args) => this.menu.resolveOrderLinesFromMenu(args),
      },
      policies: this.policies,
      persist: false,
    });
  }

  async calculateAndAcceptBaseCommercialTerms(input: {
    orderId: string;
    salesContext: unknown;
    idempotencyKey: string;
    actorId?: string;
    deviceId?: string;
  }) {
    const accepted = await this.orders.calculateBaseCommercialTermsLocked({
      orderId: input.orderId,
      salesContext: input.salesContext,
      menu: {
        resolveUnitPrices: (args) => this.menu.resolveOrderLinesFromMenu(args),
      },
      policies: this.policies,
      persist: true,
      idempotencyKey: input.idempotencyKey,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    });

    const status = await this.orders.getOpenCommercialStatus(input.orderId);
    return {
      calculated: accepted.calculated,
      accepted: accepted.accepted,
      commercialStatus: status,
    };
  }
}

/** Shared pure assembly used under lock — exported for OrdersService. */
export function assembleBaseCommercialLineTerms(input: {
  orderLines: ReadonlyArray<{
    orderLineId: string;
    catalogItemId: string;
    quantity: string;
    unit: string;
    dimension: string;
  }>;
  resolvedLines: ReadonlyArray<{
    orderLineId: string;
    catalogItemId: string;
    resolvedUnitPriceMinor: string | null;
    currencyCode: string;
    minorUnitExponent: number;
    availabilityStatus: string;
    menuPublicationId: string | null;
    priceRuleId: string | null;
  }>;
  policy: {
    roundingPolicyId: string;
    policyVersion: number;
    roundingMode: CommercialRoundingPolicySnapshot['roundingMode'];
    quantumMinor: string;
    jurisdictionCode: string;
  };
  businessDateTime: string;
}) {
  if (input.resolvedLines.length === 0) {
    throw new DomainValidationError('EMPTY_ORDER', 'Cannot calculate commercial terms for empty Order');
  }

  const policySnap: CommercialRoundingPolicySnapshot = {
    roundingPolicyId: input.policy.roundingPolicyId,
    policyVersion: input.policy.policyVersion,
    calculationContext: CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
    roundingMode: input.policy.roundingMode,
    quantumMinor: input.policy.quantumMinor,
  };

  const currencyCode = input.resolvedLines[0]!.currencyCode;
  const minorUnitExponent = input.resolvedLines[0]!.minorUnitExponent;
  const calculatedLines = [];

  for (const line of input.resolvedLines) {
    if (line.availabilityStatus !== 'AVAILABLE' || line.resolvedUnitPriceMinor == null) {
      throw new DomainValidationError(
        'COMMERCIAL_PRICE_UNAVAILABLE',
        `Cannot calculate gross: line ${line.orderLineId} price/availability unavailable`,
      );
    }
    if (line.currencyCode !== currencyCode || line.minorUnitExponent !== minorUnitExponent) {
      throw new DomainValidationError(
        'COMMERCIAL_CURRENCY_MISMATCH',
        'Resolved unit prices must share one currency / exponent',
      );
    }

    const orderLine = input.orderLines.find((l) => l.orderLineId === line.orderLineId);
    if (!orderLine) {
      throw new DomainValidationError(
        'FOREIGN_ORDER_LINE',
        `Resolved line ${line.orderLineId} missing from Order`,
      );
    }

    const rounded = calculateRoundedLineGross({
      unitMoney: createMoney(line.resolvedUnitPriceMinor, line.currencyCode, line.minorUnitExponent),
      quantity: orderLine.quantity,
      roundingPolicy: policySnap,
    });

    calculatedLines.push({
      orderLineId: line.orderLineId,
      catalogItemId: line.catalogItemId,
      quantity: orderLine.quantity,
      unit: orderLine.unit,
      dimension: orderLine.dimension,
      resolvedUnitPriceMinor: line.resolvedUnitPriceMinor,
      currencyCode: line.currencyCode,
      minorUnitExponent: line.minorUnitExponent,
      exactUnroundedMinorBasis: rounded.exactUnroundedMinorBasis,
      grossMerchandiseMinor: rounded.roundedGrossMoney.amountMinor,
      roundingDelta: rounded.roundingDelta,
      roundingPolicyId: input.policy.roundingPolicyId,
      roundingPolicyVersion: input.policy.policyVersion,
      roundingMode: input.policy.roundingMode,
      quantumMinor: input.policy.quantumMinor,
      calculationContext: CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
      menuPublicationId: line.menuPublicationId,
      priceRuleId: line.priceRuleId,
      availabilityStatus: line.availabilityStatus,
    });
  }

  let merchandiseGrossMinor = 0n;
  for (const l of calculatedLines) {
    merchandiseGrossMinor += BigInt(l.grossMerchandiseMinor);
  }

  return {
    commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED' as const,
    currencyCode,
    minorUnitExponent,
    merchandiseGrossMinor: merchandiseGrossMinor.toString(),
    roundingPolicy: {
      roundingPolicyId: input.policy.roundingPolicyId,
      policyVersion: input.policy.policyVersion,
      roundingMode: input.policy.roundingMode,
      quantumMinor: input.policy.quantumMinor,
      calculationContext: CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
      jurisdictionCode: input.policy.jurisdictionCode,
    },
    businessDateTime: input.businessDateTime,
    lines: calculatedLines,
  };
}
