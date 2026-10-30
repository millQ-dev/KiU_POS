/**
 * Client-side helpers for ADR-0051 ApprovalRequest fingerprints.
 * Must match server `parsePercentToBasisPoints` / `buildOrderMerchantDiscountFingerprint`
 * for create/consume to succeed — no new financial rules.
 */

export type MerchantDiscountMode = 'FIXED_MINOR' | 'PERCENT';

/** Parses a percentage with at most two decimals into basis points (12.5 → 1250). */
export function parsePercentToBasisPoints(percent: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(percent.trim());
  if (!match) {
    throw new Error('percent must be a positive decimal with at most two fraction digits');
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  if (basisPoints <= 0) {
    throw new Error('percent must be greater than zero');
  }
  return basisPoints;
}

export function buildMerchantDiscountApprovalFingerprint(input: {
  orderId: string;
  mode: MerchantDiscountMode;
  amountMinor?: string;
  percent?: string;
  reason: string;
}): Record<string, unknown> {
  const reason = input.reason.trim();
  if (input.mode === 'FIXED_MINOR') {
    return {
      orderId: input.orderId,
      mode: 'FIXED_MINOR',
      amountMinor: input.amountMinor,
      reason,
    };
  }
  return {
    orderId: input.orderId,
    mode: 'PERCENT',
    percentBasisPoints: parsePercentToBasisPoints(input.percent ?? ''),
    reason,
  };
}
