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
 * then explicitly accept via Orders SetOrderCommercialTerms.
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

  async calculateBaseCommercialTerms(input: {
    orderId: string;
    salesContext: unknown;
  }) {
    const salesContext = input.salesContext as {
      businessDateTime?: string;
      orderChannel?: string;
      tenantId?: string;
      outletId?: string;
      brandId?: string;
    };
    if (!salesContext?.businessDateTime) {
      throw new DomainValidationError(
        'COMMERCIAL_ROUNDING_POLICY_INVALID',
        'salesContext.businessDateTime required for policy selection',
      );
    }

    const order = await this.orders.getOrder(input.orderId);
    if (order.status !== 'OPEN') {
      throw new DomainValidationError(
        'COMMERCIAL_TERMS_NOT_ACCEPTABLE',
        'Only OPEN Orders can calculate base commercial terms',
      );
    }

    const policy = await this.policies.resolveForOrder(
      this.pool,
      input.orderId,
      salesContext.businessDateTime,
    );

    const resolved = await this.menu.resolveOrderLinesFromMenu({
      orderId: input.orderId,
      salesContext: input.salesContext,
    });

    if (resolved.lines.length === 0) {
      throw new DomainValidationError('EMPTY_ORDER', 'Cannot calculate commercial terms for empty Order');
    }

    const policySnap: CommercialRoundingPolicySnapshot = {
      roundingPolicyId: policy.roundingPolicyId,
      policyVersion: policy.policyVersion,
      calculationContext: CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
      roundingMode: policy.roundingMode,
      quantumMinor: policy.quantumMinor,
    };

    const currencyCode = resolved.lines[0]!.currencyCode;
    const minorUnitExponent = resolved.lines[0]!.minorUnitExponent;
    const calculatedLines = [];

    for (const line of resolved.lines) {
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

      const orderLine = order.lines.find((l) => l.orderLineId === line.orderLineId);
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
        roundingPolicyId: policy.roundingPolicyId,
        roundingPolicyVersion: policy.policyVersion,
        roundingMode: policy.roundingMode,
        quantumMinor: policy.quantumMinor,
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
      orderId: input.orderId,
      commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED' as const,
      currencyCode,
      minorUnitExponent,
      merchandiseGrossMinor: merchandiseGrossMinor.toString(),
      roundingPolicy: {
        roundingPolicyId: policy.roundingPolicyId,
        policyVersion: policy.policyVersion,
        roundingMode: policy.roundingMode,
        quantumMinor: policy.quantumMinor,
        calculationContext: CALCULATION_CONTEXT_BASE_LIST_LINE_GROSS,
        jurisdictionCode: policy.jurisdictionCode,
      },
      businessDateTime: salesContext.businessDateTime,
      lines: calculatedLines,
    };
  }

  async calculateAndAcceptBaseCommercialTerms(input: {
    orderId: string;
    salesContext: unknown;
    idempotencyKey: string;
    actorId?: string;
    deviceId?: string;
  }) {
    const calculated = await this.calculateBaseCommercialTerms({
      orderId: input.orderId,
      salesContext: input.salesContext,
    });

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
      // Carried into BuiltCommercialLine via extended setOrder path
      exactUnroundedMinorBasis: l.exactUnroundedMinorBasis,
      roundingDelta: l.roundingDelta,
      roundingPolicyId: l.roundingPolicyId,
      roundingPolicyVersion: l.roundingPolicyVersion,
      roundingMode: l.roundingMode,
      quantumMinor: l.quantumMinor,
      calculationContext: l.calculationContext,
    }));

    const accepted = await this.orders.setOrderCommercialTerms({
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

    const status = await this.orders.getOpenCommercialStatus(input.orderId);
    return { calculated, accepted, commercialStatus: status };
  }
}
