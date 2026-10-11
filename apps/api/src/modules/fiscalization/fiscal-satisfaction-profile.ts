/**
 * FiscalSatisfactionEvidenceProfile — versioned with FiscalPolicy (ADR-0014 D8).
 * Configurable / fail-closed. Does not claim legal sufficiency (LEGAL_UNKNOWN).
 */

import type { FiscalEvidenceClass } from './fiscal-provider-adapter.js';

export type FiscalSatisfactionEvidenceProfile = {
  /** Evidence classes that may map gate → SATISFIED when VERIFIED. */
  readonly acceptedEvidenceClasses: readonly FiscalEvidenceClass[];
  /** Require verification_status = VERIFIED (always true for C0 production profiles). */
  readonly requireVerified: boolean;
};

const SATISFYING_DEFAULT: readonly FiscalEvidenceClass[] = [
  'AUTHORITY_ACCEPTED',
  'PROVIDER_CONFIRMED_ISSUED',
  'AUTHORITATIVE_RETRIEVAL',
] as const;

export function parseSatisfactionEvidenceProfile(
  raw: unknown,
): FiscalSatisfactionEvidenceProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('satisfaction_evidence_profile must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const classes = obj.acceptedEvidenceClasses;
  if (!Array.isArray(classes) || classes.length === 0) {
    throw new Error('satisfaction_evidence_profile.acceptedEvidenceClasses required');
  }
  const acceptedEvidenceClasses = classes.map((c) => String(c)) as FiscalEvidenceClass[];
  const requireVerified = obj.requireVerified !== false;
  return { acceptedEvidenceClasses, requireVerified };
}

export function defaultC0SatisfactionProfile(): FiscalSatisfactionEvidenceProfile {
  return {
    acceptedEvidenceClasses: SATISFYING_DEFAULT,
    requireVerified: true,
  };
}

export function evidenceSatisfiesProfile(
  profile: FiscalSatisfactionEvidenceProfile,
  evidence: { evidenceClass: string; verificationStatus: string },
): boolean {
  if (profile.requireVerified && evidence.verificationStatus !== 'VERIFIED') {
    return false;
  }
  return profile.acceptedEvidenceClasses.includes(evidence.evidenceClass as FiscalEvidenceClass);
}
