/**
 * Settlement coverage kernel (ADR-0032).
 * Pure arithmetic — no DB, no provider logic.
 */

export type CheckCoverageInput = {
  readonly checkPayableMinor: string;
  /** Qualifying allocated amounts already attributed to this Check (integer minor strings). */
  readonly qualifyingAllocationMinors: readonly string[];
};

export type CheckCoverageResult = {
  readonly allocatedAmountMinor: string;
  readonly outstandingAmountMinor: string;
  readonly satisfied: boolean;
};

function assertNonNegIntegerMinor(value: string, label: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer minor string`);
  }
  return BigInt(value);
}

/**
 * Evaluate coverage for one Check.
 * Pending/failed allocations must not be passed in (caller filters).
 * Over-allocation (sum > payable) is invalid — throws.
 */
export function evaluateCheckCoverage(input: CheckCoverageInput): CheckCoverageResult {
  const payable = assertNonNegIntegerMinor(input.checkPayableMinor, 'checkPayableMinor');
  let allocated = 0n;
  for (const a of input.qualifyingAllocationMinors) {
    allocated += assertNonNegIntegerMinor(a, 'qualifyingAllocationMinor');
  }
  if (allocated > payable) {
    throw Object.assign(new Error('Qualifying allocations exceed Check customer payable'), {
      code: 'SETTLEMENT_OVERALLOCATION',
    });
  }
  const outstanding = payable - allocated;
  return {
    allocatedAmountMinor: allocated.toString(),
    outstandingAmountMinor: outstanding.toString(),
    satisfied: outstanding === 0n,
  };
}

/**
 * Exact conservation: SUM(check payables) must equal group payable (same currency assumed by caller).
 */
export function assertExactCheckPayableConservation(
  groupPayableMinor: string,
  checkPayableMinors: readonly string[],
): void {
  const group = assertNonNegIntegerMinor(groupPayableMinor, 'groupPayableMinor');
  let sum = 0n;
  for (const c of checkPayableMinors) {
    sum += assertNonNegIntegerMinor(c, 'checkPayableMinor');
  }
  if (sum !== group) {
    throw Object.assign(
      new Error(
        `Check payable sum ${sum.toString()} does not equal SettlementGroup payable ${group.toString()}`,
      ),
      { code: 'SETTLEMENT_SPLIT_NOT_CONSERVING' },
    );
  }
}

/**
 * Per-line conservation: SUM(allocations for line) == frozen line merchandise gross.
 */
export function assertExactLineAllocationConservation(
  lineGrossMinor: string,
  allocatedMinors: readonly string[],
): void {
  const gross = assertNonNegIntegerMinor(lineGrossMinor, 'lineGrossMinor');
  let sum = 0n;
  for (const a of allocatedMinors) {
    sum += assertNonNegIntegerMinor(a, 'allocatedMinor');
  }
  if (sum !== gross) {
    throw Object.assign(
      new Error(
        `Line allocation sum ${sum.toString()} does not equal line gross ${gross.toString()}`,
      ),
      { code: 'SETTLEMENT_SPLIT_NOT_CONSERVING' },
    );
  }
}

/** Payable component: ABSENT vs present (including authoritative zero). */
export type PayableComponent =
  | { readonly presence: 'ABSENT' }
  | { readonly presence: 'PRESENT'; readonly amountMinor: string };

export function presentOrAbsent(value: string | null | undefined): PayableComponent {
  if (value === null || value === undefined) return { presence: 'ABSENT' };
  assertNonNegIntegerMinor(value, 'payableComponent');
  return { presence: 'PRESENT', amountMinor: value };
}

export function componentContribution(c: PayableComponent): bigint {
  return c.presence === 'ABSENT' ? 0n : BigInt(c.amountMinor);
}
