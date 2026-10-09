/**
 * ADR-0034 KiU Tax Calculation Algorithm V1 (LINE_ROUND_THEN_SUM_V1).
 * Pure arithmetic — no DB. Never use binary float for Money.
 */
import { Decimal, parseCanonicalDecimal, toCanonicalDecimal } from './decimal.js';
import { InvalidMoneyError } from './errors.js';

export type PricingTaxMode = 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE';

export type TaxTreatment =
  | 'STANDARD_RATE'
  | 'REDUCED_RATE'
  | 'ZERO_RATE'
  | 'EXEMPT'
  | 'NOT_SUBJECT_TO_TAX'
  | 'UNKNOWN'
  | 'MISSING_CONFIGURATION';

export type TaxableBaseRuleId =
  | 'TB_PRE_DISCOUNT_LIST_GROSS'
  | 'TB_POST_MERCHANT_FUNDED_DISCOUNT'
  | 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE'
  | 'TB_EXPLICIT_COMPLIMENT_ZERO';

export type TaxRoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

export type TaxRoundingContext = 'TAX_INCLUSIVE_EXTRACTION' | 'TAX_LINE_VAT_AMOUNT';

export type TaxRoundingPolicySnapshot = {
  readonly roundingPolicyId: string;
  readonly policyVersion: number;
  readonly calculationContext: TaxRoundingContext;
  readonly roundingMode: TaxRoundingMode;
  readonly quantumMinor: string;
};

export const TAX_CALCULATION_ALGORITHM_V1 = 'LINE_ROUND_THEN_SUM_V1' as const;

export type TaxLineCalcInput = {
  readonly orderLineId: string;
  readonly lineNumber: number;
  /** G — BASE_LIST_LINE_GROSS */
  readonly grossMerchandiseMinor: string;
  /** Line merchant + allocated order merchant */
  readonly merchantFundedDiscountMinor: string;
  readonly thirdPartyMerchandiseFundingMinor: string;
  readonly platformSubsidyMinor?: string;
  /** Explicit compliment evidence required for TB_EXPLICIT_COMPLIMENT_ZERO */
  readonly explicitCompliment?: boolean;
};

export type TaxPolicyCalcDims = {
  readonly pricingTaxMode: PricingTaxMode;
  readonly taxTreatment: TaxTreatment;
  /** Decimal rate string e.g. "0.08"; required for rateful + ZERO_RATE(0); absent for EXEMPT/NOT_SUBJECT */
  readonly rateDecimal: string | null;
  readonly taxableBaseRule: TaxableBaseRuleId;
  readonly inclusiveExtractionRounding: TaxRoundingPolicySnapshot | null;
  readonly vatAmountRounding: TaxRoundingPolicySnapshot | null;
};

export type TaxLineCalcResult = {
  readonly orderLineId: string;
  readonly lineNumber: number;
  readonly gMinor: string;
  readonly mMinor: string;
  readonly rCfMinor: string;
  readonly cMinor: string;
  readonly xMinor: string;
  readonly taxableBaseMinor: string | null;
  readonly vatMinor: string | null;
  readonly amountIncludingTaxMinor: string | null;
  readonly lineMerchandisePayableMinor: string;
  readonly taxTreatment: TaxTreatment;
  readonly rateDecimal: string | null;
  readonly pricingTaxMode: PricingTaxMode;
  readonly taxableBaseRule: TaxableBaseRuleId;
  readonly algorithmId: typeof TAX_CALCULATION_ALGORITHM_V1;
  readonly exactTaxableBase: string | null;
  readonly exactVat: string | null;
};

export type TaxOrderCalcResult = {
  readonly algorithmId: typeof TAX_CALCULATION_ALGORITHM_V1;
  /** Homogeneous mode across lines; null when lines have mixed PricingTaxModes. */
  readonly pricingTaxMode: PricingTaxMode | null;
  readonly lines: ReadonlyArray<TaxLineCalcResult>;
  readonly taxableBaseTotalMinor: string | null;
  readonly vatTotalMinor: string | null;
  readonly amountIncludingTaxTotalMinor: string | null;
  readonly customerPayableMerchandiseMinor: string;
};

function decimalRoundingMode(mode: TaxRoundingMode): Decimal.Rounding {
  switch (mode) {
    case 'HALF_UP':
      return Decimal.ROUND_HALF_UP;
    case 'HALF_EVEN':
      return Decimal.ROUND_HALF_EVEN;
    case 'DOWN':
      return Decimal.ROUND_DOWN;
    case 'UP':
      return Decimal.ROUND_UP;
    default: {
      const _exhaustive: never = mode;
      throw new InvalidMoneyError(`Unsupported tax rounding mode: ${_exhaustive}`);
    }
  }
}

function roundToQuantum(exact: Decimal, policy: TaxRoundingPolicySnapshot): Decimal {
  if (!/^[1-9]\d*$/.test(policy.quantumMinor)) {
    throw new InvalidMoneyError(`Invalid quantumMinor: ${policy.quantumMinor}`);
  }
  const quantum = parseCanonicalDecimal(policy.quantumMinor);
  const mode = decimalRoundingMode(policy.roundingMode);
  const roundedQuanta = exact.div(quantum).toDecimalPlaces(0, mode);
  const rounded = roundedQuanta.mul(quantum);
  if (!rounded.isInteger()) {
    throw new InvalidMoneyError('Rounded tax amount must be an integer minor amount');
  }
  return rounded;
}

function assertNonNegMinor(value: string, field: string): Decimal {
  const d = parseCanonicalDecimal(value);
  if (d.isNegative()) {
    throw new InvalidMoneyError(`${field} must be non-negative`);
  }
  if (!d.isInteger()) {
    throw new InvalidMoneyError(`${field} must be an integer minor amount`);
  }
  return d;
}

/** C0 narrow slice: R_cf = M when thirdParty=0 and platformSubsidy=0. */
export function resolveGuestMerchandiseCharge(input: {
  gMinor: string;
  mMinor: string;
  thirdPartyMerchandiseFundingMinor: string;
  platformSubsidyMinor?: string;
}): { rCfMinor: string; cMinor: string } {
  const g = assertNonNegMinor(input.gMinor, 'gMinor');
  const m = assertNonNegMinor(input.mMinor, 'mMinor');
  const third = assertNonNegMinor(
    input.thirdPartyMerchandiseFundingMinor,
    'thirdPartyMerchandiseFundingMinor',
  );
  const subsidy = assertNonNegMinor(input.platformSubsidyMinor ?? '0', 'platformSubsidyMinor');
  if (!third.isZero() || !subsidy.isZero()) {
    throw Object.assign(new InvalidMoneyError('Third-party funding / platform subsidy unsupported'), {
      code: 'TAX_THIRD_PARTY_FUNDING_UNSUPPORTED',
    });
  }
  if (m.gt(g)) {
    throw new InvalidMoneyError('Merchant-funded discount exceeds gross');
  }
  const rCf = m;
  const c = g.sub(rCf);
  return { rCfMinor: toCanonicalDecimal(rCf), cMinor: toCanonicalDecimal(c) };
}

export function resolveTaxableBaseX(input: {
  rule: TaxableBaseRuleId;
  gMinor: string;
  mMinor: string;
  cMinor: string;
  explicitCompliment?: boolean;
}): string {
  const g = assertNonNegMinor(input.gMinor, 'gMinor');
  const m = assertNonNegMinor(input.mMinor, 'mMinor');
  const c = assertNonNegMinor(input.cMinor, 'cMinor');
  let x: Decimal;
  switch (input.rule) {
    case 'TB_PRE_DISCOUNT_LIST_GROSS':
      x = g;
      break;
    case 'TB_POST_MERCHANT_FUNDED_DISCOUNT':
      x = g.sub(m);
      break;
    case 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE':
      x = c;
      break;
    case 'TB_EXPLICIT_COMPLIMENT_ZERO':
      if (!input.explicitCompliment) {
        throw Object.assign(new InvalidMoneyError('Explicit compliment evidence required'), {
          code: 'TAX_COMPLIMENT_EVIDENCE_REQUIRED',
        });
      }
      x = new Decimal(0);
      break;
    default: {
      const _exhaustive: never = input.rule;
      throw Object.assign(new InvalidMoneyError(`Unknown TaxableBaseRule: ${_exhaustive}`), {
        code: 'TAX_TAXABLE_BASE_RULE_UNKNOWN',
      });
    }
  }
  if (x.isNegative()) {
    throw new InvalidMoneyError('Taxable base X must be non-negative');
  }
  return toCanonicalDecimal(x);
}

function isRateful(treatment: TaxTreatment): boolean {
  return (
    treatment === 'STANDARD_RATE' ||
    treatment === 'REDUCED_RATE' ||
    treatment === 'ZERO_RATE'
  );
}

export function calculateTaxLine(
  line: TaxLineCalcInput,
  policy: TaxPolicyCalcDims,
): TaxLineCalcResult {
  if (policy.taxTreatment === 'UNKNOWN' || policy.taxTreatment === 'MISSING_CONFIGURATION') {
    throw Object.assign(new InvalidMoneyError('Tax treatment cannot be accepted'), {
      code: 'TAX_TREATMENT_FAIL_CLOSED',
    });
  }

  const { rCfMinor, cMinor } = resolveGuestMerchandiseCharge({
    gMinor: line.grossMerchandiseMinor,
    mMinor: line.merchantFundedDiscountMinor,
    thirdPartyMerchandiseFundingMinor: line.thirdPartyMerchandiseFundingMinor,
    ...(line.platformSubsidyMinor !== undefined
      ? { platformSubsidyMinor: line.platformSubsidyMinor }
      : {}),
  });
  const xMinor = resolveTaxableBaseX({
    rule: policy.taxableBaseRule,
    gMinor: line.grossMerchandiseMinor,
    mMinor: line.merchantFundedDiscountMinor,
    cMinor,
    ...(line.explicitCompliment !== undefined
      ? { explicitCompliment: line.explicitCompliment }
      : {}),
  });
  const x = parseCanonicalDecimal(xMinor);
  const c = parseCanonicalDecimal(cMinor);

  if (policy.taxTreatment === 'EXEMPT' || policy.taxTreatment === 'NOT_SUBJECT_TO_TAX') {
    if (policy.rateDecimal != null) {
      throw Object.assign(new InvalidMoneyError('EXEMPT/NOT_SUBJECT must not store a rate'), {
        code: 'TAX_NON_RATE_TREATMENT_INVALID',
      });
    }
    return {
      orderLineId: line.orderLineId,
      lineNumber: line.lineNumber,
      gMinor: line.grossMerchandiseMinor,
      mMinor: line.merchantFundedDiscountMinor,
      rCfMinor,
      cMinor,
      xMinor,
      taxableBaseMinor: null,
      vatMinor: null,
      amountIncludingTaxMinor: null,
      lineMerchandisePayableMinor: toCanonicalDecimal(c),
      taxTreatment: policy.taxTreatment,
      rateDecimal: null,
      pricingTaxMode: policy.pricingTaxMode,
      taxableBaseRule: policy.taxableBaseRule,
      algorithmId: TAX_CALCULATION_ALGORITHM_V1,
      exactTaxableBase: null,
      exactVat: null,
    };
  }

  if (!isRateful(policy.taxTreatment) || policy.rateDecimal == null) {
    throw Object.assign(new InvalidMoneyError('Rateful treatment requires rateDecimal'), {
      code: 'TAX_RATE_REQUIRED',
    });
  }
  const r = parseCanonicalDecimal(policy.rateDecimal);
  if (r.isNegative()) {
    throw new InvalidMoneyError('rateDecimal must be non-negative');
  }
  if (policy.taxTreatment === 'ZERO_RATE' && !r.isZero()) {
    throw Object.assign(new InvalidMoneyError('ZERO_RATE requires rateDecimal 0'), {
      code: 'TAX_ZERO_RATE_INVALID',
    });
  }

  if (policy.pricingTaxMode === 'TAX_INCLUSIVE') {
    if (!policy.inclusiveExtractionRounding) {
      throw Object.assign(new InvalidMoneyError('TAX_INCLUSIVE_EXTRACTION rounding required'), {
        code: 'TAX_ROUNDING_POLICY_REQUIRED',
      });
    }
    if (policy.inclusiveExtractionRounding.calculationContext !== 'TAX_INCLUSIVE_EXTRACTION') {
      throw new InvalidMoneyError('Wrong rounding context for inclusive extraction');
    }
    const exactTaxableBase = x.div(r.plus(1));
    const taxableBase = roundToQuantum(exactTaxableBase, policy.inclusiveExtractionRounding);
    const vat = x.sub(taxableBase);
    if (!taxableBase.plus(vat).eq(x)) {
      throw new InvalidMoneyError('Inclusive conservation failed: base+VAT must equal X');
    }
    return {
      orderLineId: line.orderLineId,
      lineNumber: line.lineNumber,
      gMinor: line.grossMerchandiseMinor,
      mMinor: line.merchantFundedDiscountMinor,
      rCfMinor,
      cMinor,
      xMinor,
      taxableBaseMinor: toCanonicalDecimal(taxableBase),
      vatMinor: toCanonicalDecimal(vat),
      amountIncludingTaxMinor: toCanonicalDecimal(x),
      lineMerchandisePayableMinor: toCanonicalDecimal(c),
      taxTreatment: policy.taxTreatment,
      rateDecimal: policy.rateDecimal,
      pricingTaxMode: policy.pricingTaxMode,
      taxableBaseRule: policy.taxableBaseRule,
      algorithmId: TAX_CALCULATION_ALGORITHM_V1,
      exactTaxableBase: toCanonicalDecimal(exactTaxableBase),
      exactVat: null,
    };
  }

  // TAX_EXCLUSIVE
  if (!policy.vatAmountRounding) {
    throw Object.assign(new InvalidMoneyError('TAX_LINE_VAT_AMOUNT rounding required'), {
      code: 'TAX_ROUNDING_POLICY_REQUIRED',
    });
  }
  if (policy.vatAmountRounding.calculationContext !== 'TAX_LINE_VAT_AMOUNT') {
    throw new InvalidMoneyError('Wrong rounding context for exclusive VAT');
  }
  const taxableBase = x;
  const exactVat = x.mul(r);
  const vat = roundToQuantum(exactVat, policy.vatAmountRounding);
  const amountIncludingTax = taxableBase.plus(vat);
  return {
    orderLineId: line.orderLineId,
    lineNumber: line.lineNumber,
    gMinor: line.grossMerchandiseMinor,
    mMinor: line.merchantFundedDiscountMinor,
    rCfMinor,
    cMinor,
    xMinor,
    taxableBaseMinor: toCanonicalDecimal(taxableBase),
    vatMinor: toCanonicalDecimal(vat),
    amountIncludingTaxMinor: toCanonicalDecimal(amountIncludingTax),
    lineMerchandisePayableMinor: toCanonicalDecimal(c.plus(vat)),
    taxTreatment: policy.taxTreatment,
    rateDecimal: policy.rateDecimal,
    pricingTaxMode: policy.pricingTaxMode,
    taxableBaseRule: policy.taxableBaseRule,
    algorithmId: TAX_CALCULATION_ALGORITHM_V1,
    exactTaxableBase: null,
    exactVat: toCanonicalDecimal(exactVat),
  };
}

/** Aggregate already-calculated lines (supports heterogeneous per-line TaxPolicy). */
export function aggregateTaxLineResults(
  resultsIn: ReadonlyArray<TaxLineCalcResult>,
): TaxOrderCalcResult {
  if (resultsIn.length === 0) {
    throw Object.assign(new InvalidMoneyError('Tax calculation requires at least one line'), {
      code: 'TAX_LINES_REQUIRED',
    });
  }
  const results = [...resultsIn].sort((a, b) => a.lineNumber - b.lineNumber);
  const modes = new Set(results.map((r) => r.pricingTaxMode));
  const pricingTaxMode: PricingTaxMode | null =
    modes.size === 1 ? results[0]!.pricingTaxMode : null;

  let payable = new Decimal(0);
  let baseSum: Decimal | null = new Decimal(0);
  let vatSum: Decimal | null = new Decimal(0);
  let inclSum: Decimal | null = new Decimal(0);
  let anyNullBase = false;
  let anyNullVat = false;
  let anyNullIncl = false;

  for (const r of results) {
    payable = payable.plus(parseCanonicalDecimal(r.lineMerchandisePayableMinor));
    if (r.taxableBaseMinor == null) anyNullBase = true;
    else baseSum = baseSum!.plus(parseCanonicalDecimal(r.taxableBaseMinor));
    if (r.vatMinor == null) anyNullVat = true;
    else vatSum = vatSum!.plus(parseCanonicalDecimal(r.vatMinor));
    if (r.amountIncludingTaxMinor == null) anyNullIncl = true;
    else inclSum = inclSum!.plus(parseCanonicalDecimal(r.amountIncludingTaxMinor));
  }

  return {
    algorithmId: TAX_CALCULATION_ALGORITHM_V1,
    pricingTaxMode,
    lines: results,
    taxableBaseTotalMinor: anyNullBase ? null : toCanonicalDecimal(baseSum!),
    vatTotalMinor: anyNullVat ? null : toCanonicalDecimal(vatSum!),
    amountIncludingTaxTotalMinor: anyNullIncl ? null : toCanonicalDecimal(inclSum!),
    customerPayableMerchandiseMinor: toCanonicalDecimal(payable),
  };
}

export function calculateTaxOrder(
  lines: ReadonlyArray<TaxLineCalcInput>,
  policy: TaxPolicyCalcDims,
): TaxOrderCalcResult {
  if (lines.length === 0) {
    throw Object.assign(new InvalidMoneyError('Tax calculation requires at least one line'), {
      code: 'TAX_LINES_REQUIRED',
    });
  }
  const sorted = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
  return aggregateTaxLineResults(sorted.map((l) => calculateTaxLine(l, policy)));
}
