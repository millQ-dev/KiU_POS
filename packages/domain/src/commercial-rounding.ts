/**
 * ADR-0030 commercial Money rounding kernel (BASE_LIST_LINE_GROSS).
 * Pure arithmetic — no DB access. Never use binary float.
 */
import { Decimal, parseCanonicalDecimal, toCanonicalDecimal } from './decimal.js';
import { InvalidMoneyError } from './errors.js';
import { createMoney, type Money } from './money.js';

export type CommercialRoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

export type CommercialRoundingPolicySnapshot = {
  readonly roundingPolicyId: string;
  readonly policyVersion: number;
  readonly calculationContext: 'BASE_LIST_LINE_GROSS';
  readonly roundingMode: CommercialRoundingMode;
  /** Positive integer minor-unit quantum as canonical decimal string (e.g. "1"). */
  readonly quantumMinor: string;
};

export type RoundedLineGrossResult = {
  readonly exactUnroundedMinorBasis: string;
  readonly roundedGrossMoney: Money;
  readonly roundingDelta: string;
  readonly policyProvenance: CommercialRoundingPolicySnapshot;
};

function decimalRoundingMode(mode: CommercialRoundingMode): Decimal.Rounding {
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
      throw new InvalidMoneyError(`Unsupported rounding mode: ${_exhaustive}`);
    }
  }
}

/**
 * exactUnroundedMinorBasis = unitPrice.amountMinor × canonicalQuantity
 * rounded = round_to_quantum(exact, mode, quantumMinor)
 * roundingDelta = rounded − exact
 */
export function calculateRoundedLineGross(input: {
  unitMoney: Money;
  quantity: string;
  roundingPolicy: CommercialRoundingPolicySnapshot;
}): RoundedLineGrossResult {
  const { unitMoney, quantity, roundingPolicy } = input;
  if (roundingPolicy.calculationContext !== 'BASE_LIST_LINE_GROSS') {
    throw new InvalidMoneyError(
      `Unsupported calculation context: ${roundingPolicy.calculationContext}`,
    );
  }
  if (!/^[1-9]\d*$/.test(roundingPolicy.quantumMinor)) {
    throw new InvalidMoneyError(`Invalid quantumMinor: ${roundingPolicy.quantumMinor}`);
  }

  const unitMinor = parseCanonicalDecimal(unitMoney.amountMinor);
  const qty = parseCanonicalDecimal(quantity);
  const exact = unitMinor.mul(qty);
  const quantum = parseCanonicalDecimal(roundingPolicy.quantumMinor);
  const mode = decimalRoundingMode(roundingPolicy.roundingMode);

  // Round exact/quantum to integer quanta, then × quantum.
  const quanta = exact.div(quantum);
  const roundedQuanta = quanta.toDecimalPlaces(0, mode);
  const rounded = roundedQuanta.mul(quantum);

  if (!rounded.isInteger()) {
    throw new InvalidMoneyError('Rounded gross must be an integer minor amount');
  }

  const roundedMinor = toCanonicalDecimal(rounded);
  const delta = toCanonicalDecimal(rounded.sub(exact));

  return {
    exactUnroundedMinorBasis: toCanonicalDecimal(exact),
    roundedGrossMoney: {
      amountMinor: roundedMinor,
      currencyCode: unitMoney.currencyCode,
      minorUnitExponent: unitMoney.minorUnitExponent,
    },
    roundingDelta: delta,
    policyProvenance: { ...roundingPolicy },
  };
}

export type ConfiguredMerchandiseLineGross = RoundedLineGrossResult & {
  readonly baseUnitMinor: string;
  readonly perUnitModifierMinor: string;
  readonly configuredUnitMinor: string;
};

/**
 * ADR-0052 M2. Signed per-unit modifier deltas enter the unit price.
 * One ADR-0030 BASE_LIST_LINE_GROSS call then rounds
 * (base unit + deltas) × canonical quantity.
 */
export function roundConfiguredMerchandiseLine(input: {
  baseUnitMinor: string;
  perUnitModifierMinor: string;
  quantity: string;
  currencyCode: string;
  minorUnitExponent: number;
  roundingPolicy: CommercialRoundingPolicySnapshot;
}): ConfiguredMerchandiseLineGross {
  let base;
  let delta;
  try {
    base = parseCanonicalDecimal(input.baseUnitMinor);
    delta = parseCanonicalDecimal(input.perUnitModifierMinor);
  } catch {
    throw new InvalidMoneyError('Modifier unit prices must be canonical integer minors');
  }
  if (!base.isInteger() || !delta.isInteger()) {
    throw new InvalidMoneyError('Modifier unit prices must be integer minors');
  }
  const configured = base.add(delta);
  if (configured.isNegative()) {
    throw new InvalidMoneyError('Configured unit price must be >= 0');
  }
  const configuredUnitMinor = toCanonicalDecimal(configured);
  const rounded = calculateRoundedLineGross({
    unitMoney: createMoney(configuredUnitMinor, input.currencyCode, input.minorUnitExponent),
    quantity: input.quantity,
    roundingPolicy: input.roundingPolicy,
  });
  return {
    ...rounded,
    baseUnitMinor: toCanonicalDecimal(base),
    perUnitModifierMinor: toCanonicalDecimal(delta),
    configuredUnitMinor,
  };
}
