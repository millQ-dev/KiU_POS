/**
 * Order commercial money allocation & snapshot hashing (ADR-0028 / D1.4B).
 * Largest-remainder order-level discount allocation with stable line_number tie-break.
 */
import { createHash } from 'node:crypto';
import { InvalidMoneyError } from './errors.js';

export type CommercialCertainty = 'FINAL' | 'UNKNOWN';

export type EligibleDiscountLine = {
  readonly orderLineId: string;
  readonly lineNumber: number;
  /** Allocation basis = gross − lineMerchantFundedDiscount (third-party funding excluded). */
  readonly basisMinor: string;
};

function assertIntegerMinor(value: string, label: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new InvalidMoneyError(`${label} must be an integer minor-unit string`);
  }
  return BigInt(value);
}

function assertNonNegativeMinor(value: string, label: string): bigint {
  const n = assertIntegerMinor(value, label);
  if (n < 0n) {
    throw new InvalidMoneyError(`${label} must be non-negative`);
  }
  return n;
}

/**
 * Deterministic largest-remainder allocation of an order-level merchant-funded discount.
 *
 * For each eligible line:
 *   exact = orderDiscount × lineBasis
 *   base = floor(exact / totalBasis)
 *   remainder = exact mod totalBasis
 * Residual minor units go to lines ordered by remainder DESC, then lineNumber ASC.
 */
export function allocateOrderMerchantDiscount(
  orderDiscountMinor: string,
  lines: ReadonlyArray<EligibleDiscountLine>,
): ReadonlyMap<string, string> {
  const orderDiscount = assertNonNegativeMinor(orderDiscountMinor, 'orderMerchantFundedDiscountMinor');
  const eligible = lines
    .map((l) => ({
      orderLineId: l.orderLineId,
      lineNumber: l.lineNumber,
      basis: assertNonNegativeMinor(l.basisMinor, `basisMinor(${l.orderLineId})`),
    }))
    .filter((l) => l.basis > 0n);

  const result = new Map<string, string>();
  for (const l of lines) {
    result.set(l.orderLineId, '0');
  }

  if (orderDiscount === 0n) {
    return result;
  }

  const totalBasis = eligible.reduce((s, l) => s + l.basis, 0n);
  if (totalBasis === 0n) {
    throw new InvalidMoneyError(
      'Non-zero orderMerchantFundedDiscountMinor requires positive eligible allocation basis',
    );
  }
  if (orderDiscount > totalBasis) {
    throw new InvalidMoneyError(
      'orderMerchantFundedDiscountMinor exceeds sum of eligible allocation bases',
    );
  }

  type Row = {
    orderLineId: string;
    lineNumber: number;
    basis: bigint;
    baseAlloc: bigint;
    remainder: bigint;
  };

  const rows: Row[] = eligible.map((l) => {
    const exact = orderDiscount * l.basis;
    const baseAlloc = exact / totalBasis;
    const remainder = exact % totalBasis;
    return {
      orderLineId: l.orderLineId,
      lineNumber: l.lineNumber,
      basis: l.basis,
      baseAlloc,
      remainder,
    };
  });

  let allocated = rows.reduce((s, r) => s + r.baseAlloc, 0n);
  let residual = orderDiscount - allocated;

  const byRemainder = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) {
      return a.remainder > b.remainder ? -1 : 1;
    }
    return a.lineNumber - b.lineNumber;
  });

  const bonus = new Map<string, bigint>();
  for (const r of byRemainder) {
    if (residual <= 0n) break;
    // Never allocate more than remaining basis capacity for the line
    const capacity = r.basis - r.baseAlloc - (bonus.get(r.orderLineId) ?? 0n);
    if (capacity <= 0n) continue;
    bonus.set(r.orderLineId, (bonus.get(r.orderLineId) ?? 0n) + 1n);
    residual -= 1n;
    allocated += 1n;
  }

  if (residual !== 0n) {
    throw new InvalidMoneyError('Order discount residual could not be fully allocated');
  }

  for (const r of rows) {
    const total = r.baseAlloc + (bonus.get(r.orderLineId) ?? 0n);
    if (total > r.basis) {
      throw new InvalidMoneyError('Line order-discount allocation exceeds eligible basis');
    }
    result.set(r.orderLineId, total.toString());
  }

  const sumCheck = [...result.values()].reduce((s, v) => s + BigInt(v), 0n);
  if (sumCheck !== orderDiscount) {
    throw new InvalidMoneyError('Allocated order discount does not conserve orderMerchantFundedDiscountMinor');
  }

  return result;
}

export type CommercialLineCanonical = {
  readonly lineNumber: number;
  readonly orderLineId: string;
  readonly soldCatalogItemId: string;
  readonly quantity: string;
  readonly resolvedUnitPriceMinor: string | null;
  readonly grossMerchandiseMinor: string;
  readonly lineMerchantFundedDiscountMinor: string;
  readonly allocatedOrderMerchantDiscountMinor: string;
  readonly thirdPartyMerchandiseFundingMinor: string;
  readonly netMerchandiseSalesMinor: string | null;
  readonly taxMinor: string | null;
  readonly certainty: CommercialCertainty;
  readonly fundingProvenance: string | null;
};

export type CommercialSnapshotCanonical = {
  readonly orderId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly outletId: string;
  readonly currencyCode: string;
  readonly minorUnitExponent: number;
  readonly businessDate: string;
  readonly businessOrder: number;
  readonly businessTime: string | null;
  readonly certainty: CommercialCertainty;
  readonly grossMerchandiseMinor: string;
  readonly merchantFundedDiscountMinor: string;
  readonly thirdPartyMerchandiseFundingMinor: string;
  readonly netMerchandiseSalesMinor: string | null;
  readonly taxMinor: string | null;
  readonly nonMerchandiseChargesMinor: string | null;
  readonly tipMinor: string | null;
  readonly customerPayableMinor: string | null;
  readonly lines: ReadonlyArray<CommercialLineCanonical>;
};

/** Deterministic semantic hash — line_number ASC; no technical IDs/timestamps. */
export function commercialSnapshotSemanticHash(input: CommercialSnapshotCanonical): string {
  const lines = [...input.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const normalized = {
    orderId: input.orderId,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    outletId: input.outletId,
    currencyCode: input.currencyCode,
    minorUnitExponent: input.minorUnitExponent,
    businessDate: input.businessDate,
    businessOrder: input.businessOrder,
    businessTime: input.businessTime,
    certainty: input.certainty,
    grossMerchandiseMinor: input.grossMerchandiseMinor,
    merchantFundedDiscountMinor: input.merchantFundedDiscountMinor,
    thirdPartyMerchandiseFundingMinor: input.thirdPartyMerchandiseFundingMinor,
    netMerchandiseSalesMinor: input.netMerchandiseSalesMinor,
    taxMinor: input.taxMinor,
    nonMerchandiseChargesMinor: input.nonMerchandiseChargesMinor,
    tipMinor: input.tipMinor,
    customerPayableMinor: input.customerPayableMinor,
    lines: lines.map((l) => ({
      lineNumber: l.lineNumber,
      orderLineId: l.orderLineId,
      soldCatalogItemId: l.soldCatalogItemId,
      quantity: l.quantity,
      resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
      grossMerchandiseMinor: l.grossMerchandiseMinor,
      lineMerchantFundedDiscountMinor: l.lineMerchantFundedDiscountMinor,
      allocatedOrderMerchantDiscountMinor: l.allocatedOrderMerchantDiscountMinor,
      thirdPartyMerchandiseFundingMinor: l.thirdPartyMerchandiseFundingMinor,
      netMerchandiseSalesMinor: l.netMerchandiseSalesMinor,
      taxMinor: l.taxMinor,
      certainty: l.certainty,
      fundingProvenance: l.fundingProvenance,
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/** Semantic fingerprint for SetOrderCommercialTerms idempotency (no technical clocks). */
export function commercialTermsSemanticFingerprint(input: {
  currencyCode: string;
  minorUnitExponent: number;
  certainty: CommercialCertainty;
  orderMerchantFundedDiscountMinor: string;
  taxMinor: string | null;
  nonMerchandiseChargesMinor: string | null;
  tipMinor: string | null;
  customerPayableMinor: string | null;
  commercialResolution: string | null;
  provenance: unknown;
  lines: ReadonlyArray<{
    orderLineId: string;
    lineNumber: number;
    soldCatalogItemId: string;
    resolvedUnitPriceMinor: string | null;
    grossMerchandiseMinor: string;
    lineMerchantFundedDiscountMinor: string;
    eligibleForOrderDiscount: boolean;
    thirdPartyMerchandiseFundingMinor: string;
    taxMinor: string | null;
    certainty: CommercialCertainty;
    fundingProvenance: string | null;
    provenance: unknown;
  }>;
}): string {
  const lines = [...input.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  return createHash('sha256')
    .update(
      JSON.stringify({
        currencyCode: input.currencyCode,
        minorUnitExponent: input.minorUnitExponent,
        certainty: input.certainty,
        orderMerchantFundedDiscountMinor: input.orderMerchantFundedDiscountMinor,
        taxMinor: input.taxMinor,
        nonMerchandiseChargesMinor: input.nonMerchandiseChargesMinor,
        tipMinor: input.tipMinor,
        customerPayableMinor: input.customerPayableMinor,
        commercialResolution: input.commercialResolution,
        provenance: input.provenance ?? null,
        lines: lines.map((l) => ({
          orderLineId: l.orderLineId,
          lineNumber: l.lineNumber,
          soldCatalogItemId: l.soldCatalogItemId,
          resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
          grossMerchandiseMinor: l.grossMerchandiseMinor,
          lineMerchantFundedDiscountMinor: l.lineMerchantFundedDiscountMinor,
          eligibleForOrderDiscount: l.eligibleForOrderDiscount,
          thirdPartyMerchandiseFundingMinor: l.thirdPartyMerchandiseFundingMinor,
          taxMinor: l.taxMinor,
          certainty: l.certainty,
          fundingProvenance: l.fundingProvenance,
          provenance: l.provenance ?? null,
        })),
      }),
    )
    .digest('hex');
}

export function computeLineNetMerchandiseSalesMinor(input: {
  grossMerchandiseMinor: string;
  lineMerchantFundedDiscountMinor: string;
  allocatedOrderMerchantDiscountMinor: string;
  thirdPartyMerchandiseFundingMinor: string;
}): string {
  const gross = assertNonNegativeMinor(input.grossMerchandiseMinor, 'grossMerchandiseMinor');
  const lineDisc = assertNonNegativeMinor(
    input.lineMerchantFundedDiscountMinor,
    'lineMerchantFundedDiscountMinor',
  );
  const orderDisc = assertNonNegativeMinor(
    input.allocatedOrderMerchantDiscountMinor,
    'allocatedOrderMerchantDiscountMinor',
  );
  const third = assertNonNegativeMinor(
    input.thirdPartyMerchandiseFundingMinor,
    'thirdPartyMerchandiseFundingMinor',
  );
  if (lineDisc > gross) {
    throw new InvalidMoneyError('lineMerchantFundedDiscountMinor exceeds grossMerchandiseMinor');
  }
  const afterLine = gross - lineDisc;
  if (orderDisc > afterLine) {
    throw new InvalidMoneyError('allocatedOrderMerchantDiscountMinor exceeds remaining line basis');
  }
  return (afterLine - orderDisc + third).toString();
}
