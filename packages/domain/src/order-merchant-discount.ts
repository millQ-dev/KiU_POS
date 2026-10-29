/**
 * ApplyOrderMerchantDiscount v1 policy (ADR-0051 D3/D4).
 * Pure resolution of an order-level merchant-funded discount amount from a cashier request.
 * Allocation across lines stays in allocateOrderMerchantDiscount (ADR-0028).
 */
import { Decimal, parseCanonicalDecimal, toCanonicalDecimal } from './decimal.js';
import { DomainError } from './errors.js';

/** ADR-0051 D3 — maximum order-level discount: 20% of eligible merchandise basis. */
export const MAX_ORDER_MERCHANT_DISCOUNT_BASIS_POINTS = 2000;
const BASIS_POINTS_DENOMINATOR = 10000n;

/**
 * ADR-0051 Accepted WITH CHANGES — named rounding context for percent → minor.
 * Not BASE_LIST_LINE_GROSS. HALF_UP, quantum 1, versioned on the commercial snapshot.
 */
export const MERCHANT_DISCOUNT_PERCENT_TO_MINOR = {
  calculationContext: 'MERCHANT_DISCOUNT_PERCENT_TO_MINOR',
  roundingMode: 'HALF_UP',
  quantumMinor: '1',
  policyVersion: 1,
} as const;

export class MerchantDiscountPolicyError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'MerchantDiscountPolicyError';
  }
}

export type OrderMerchantDiscountRequest =
  | { readonly mode: 'FIXED_MINOR'; readonly amountMinor: string }
  | { readonly mode: 'PERCENT'; readonly percent: string };

export type ResolvedOrderMerchantDiscount = {
  readonly mode: 'FIXED_MINOR' | 'PERCENT';
  readonly discountMinor: string;
  /** Present only for PERCENT requests. */
  readonly percentBasisPoints: number | null;
  readonly eligibleBasisMinor: string;
  readonly reason: string;
};

/** Parses a percentage with at most two decimals into basis points (12.5 → 1250). */
export function parsePercentToBasisPoints(percent: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(percent.trim());
  if (!match) {
    throw new MerchantDiscountPolicyError(
      'DISCOUNT_PERCENT_INVALID',
      'percent must be a positive decimal with at most two fraction digits',
    );
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  if (basisPoints <= 0) {
    throw new MerchantDiscountPolicyError('DISCOUNT_PERCENT_INVALID', 'percent must be greater than zero');
  }
  return basisPoints;
}

export function normalizeDiscountReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length === 0) {
    throw new MerchantDiscountPolicyError('DISCOUNT_REASON_REQUIRED', 'Discount reason is mandatory');
  }
  return normalized;
}

function assertWithinCap(discount: bigint, basis: bigint): void {
  if (discount * BASIS_POINTS_DENOMINATOR > basis * BigInt(MAX_ORDER_MERCHANT_DISCOUNT_BASIS_POINTS)) {
    throw new MerchantDiscountPolicyError(
      'DISCOUNT_EXCEEDS_CAP',
      'Order merchant discount exceeds 20% of eligible merchandise basis',
    );
  }
}

/**
 * Resolves the discount amount in minor units.
 * PERCENT converts through MERCHANT_DISCOUNT_PERCENT_TO_MINOR (HALF_UP, quantum 1).
 */
export function resolveOrderMerchantDiscount(input: {
  readonly request: OrderMerchantDiscountRequest;
  readonly eligibleBasisMinor: string;
  readonly reason: string;
}): ResolvedOrderMerchantDiscount {
  const reason = normalizeDiscountReason(input.reason);
  if (!/^\d+$/.test(input.eligibleBasisMinor)) {
    throw new MerchantDiscountPolicyError(
      'DISCOUNT_BASIS_INVALID',
      'eligibleBasisMinor must be a non-negative integer string',
    );
  }
  const basis = BigInt(input.eligibleBasisMinor);
  if (basis === 0n) {
    throw new MerchantDiscountPolicyError(
      'DISCOUNT_BASIS_EMPTY',
      'Order has no eligible merchandise basis for a discount',
    );
  }

  if (input.request.mode === 'FIXED_MINOR') {
    if (!/^[1-9]\d*$/.test(input.request.amountMinor)) {
      throw new MerchantDiscountPolicyError(
        'DISCOUNT_AMOUNT_INVALID',
        'amountMinor must be a positive integer string',
      );
    }
    const discount = BigInt(input.request.amountMinor);
    assertWithinCap(discount, basis);
    return {
      mode: 'FIXED_MINOR',
      discountMinor: discount.toString(),
      percentBasisPoints: null,
      eligibleBasisMinor: basis.toString(),
      reason,
    };
  }

  const basisPoints = parsePercentToBasisPoints(input.request.percent);
  if (basisPoints > MAX_ORDER_MERCHANT_DISCOUNT_BASIS_POINTS) {
    throw new MerchantDiscountPolicyError(
      'DISCOUNT_EXCEEDS_CAP',
      'Order merchant discount exceeds 20% of eligible merchandise basis',
    );
  }
  const exact = parseCanonicalDecimal(basis.toString())
    .mul(basisPoints)
    .div(Number(BASIS_POINTS_DENOMINATOR));
  const rounded = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const discountMinor = toCanonicalDecimal(rounded);
  const discount = BigInt(discountMinor);
  if (discount === 0n) {
    throw new MerchantDiscountPolicyError(
      'DISCOUNT_AMOUNT_INVALID',
      'Percentage discount rounds to zero minor units',
    );
  }
  assertWithinCap(discount, basis);
  return {
    mode: 'PERCENT',
    discountMinor,
    percentBasisPoints: basisPoints,
    eligibleBasisMinor: basis.toString(),
    reason,
  };
}
