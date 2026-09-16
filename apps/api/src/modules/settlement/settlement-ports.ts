/**
 * Narrow Ports for S1.1 Settlement consumption (ADR-0032).
 * Production has no Payment/Fiscal writers — only readers/gates.
 */

/** One qualifying allocated amount toward a Check (Payments consumption view). */
export type QualifyingCheckAllocation = {
  readonly allocationIdentity: string;
  readonly settlementCheckId: string;
  readonly amountMinor: string;
  /** Only true outcomes are returned by the reader. */
  readonly qualifies: true;
};

export type QualifyingPaymentCoverageReader = {
  listQualifyingAllocations(input: {
    settlementGroupId: string;
    settlementCheckIds: readonly string[];
  }): Promise<readonly QualifyingCheckAllocation[]>;
};

export type EmptyPaymentCoverageReader = QualifyingPaymentCoverageReader;

export function emptyPaymentCoverageReader(): EmptyPaymentCoverageReader {
  return {
    async listQualifyingAllocations() {
      return [];
    },
  };
}

/** In-memory stub for tests — not a production Payment writer. */
export function stubPaymentCoverageReader(
  allocations: readonly QualifyingCheckAllocation[],
): QualifyingPaymentCoverageReader {
  return {
    async listQualifyingAllocations(input) {
      const set = new Set(input.settlementCheckIds);
      const seen = new Set<string>();
      const out: QualifyingCheckAllocation[] = [];
      for (const a of allocations) {
        if (!set.has(a.settlementCheckId)) continue;
        if (seen.has(a.allocationIdentity)) continue;
        seen.add(a.allocationIdentity);
        out.push(a);
      }
      return out;
    },
  };
}

export type FiscalCheckoutGateStatus =
  | 'NOT_REQUIRED'
  | 'SATISFIED'
  | 'PENDING'
  | 'REQUIRED_NOT_SATISFIED'
  | 'UNAVAILABLE';

export type FiscalCheckoutGate = {
  observe(input: {
    settlementGroupId: string;
    orderId: string;
    legalEntityId: string;
  }): Promise<{ status: FiscalCheckoutGateStatus; detail?: string }>;
};

/** Production default until Fiscalization runtime exists — fail closed. */
export function unavailableFiscalCheckoutGate(): FiscalCheckoutGate {
  return {
    async observe() {
      return {
        status: 'UNAVAILABLE',
        detail: 'Fiscalization runtime not available; cannot authoritatively determine fiscal prerequisite',
      };
    },
  };
}

export function fixedFiscalCheckoutGate(status: FiscalCheckoutGateStatus): FiscalCheckoutGate {
  return {
    async observe() {
      return { status };
    },
  };
}

/** External effects that forbid safe AbortSettlement (ADR-0032 §8). */
export type SettlementExternalEffectProbe = {
  hasQualifyingPaymentExternalEffect(settlementGroupId: string): Promise<boolean>;
  hasFiscalExternalEffect(settlementGroupId: string): Promise<boolean>;
};

export function emptyExternalEffectProbe(): SettlementExternalEffectProbe {
  return {
    async hasQualifyingPaymentExternalEffect() {
      return false;
    },
    async hasFiscalExternalEffect() {
      return false;
    },
  };
}

export function stubExternalEffectProbe(opts: {
  payment?: boolean;
  fiscal?: boolean;
}): SettlementExternalEffectProbe {
  return {
    async hasQualifyingPaymentExternalEffect() {
      return opts.payment === true;
    },
    async hasFiscalExternalEffect() {
      return opts.fiscal === true;
    },
  };
}
