/**
 * ADR-0050 / ADR-0024 — pure, deterministic order-local allergen offer resolution.
 *
 * Invariants:
 * - There is no SAFE outcome. `AVAILABLE` only means "no constraint hit under declared data".
 * - Missing / incomplete composition or declaration data resolves to UNKNOWN (never absence).
 * - CONTAINS that survives the effective composition is BLOCKED; there is no override path here.
 * - Cross-contact / MAY_CONTAIN / UNKNOWN always require human confirmation.
 */
import { createHash } from 'node:crypto';
import { applyEffectiveRecipeDeltas, type ModifierRecipeDelta } from '@millq/domain';

export type AllergenCaptureChoice =
  | 'NO_ALLERGIES_CONFIRMED'
  | 'SELECT_ALLERGENS'
  | 'UNABLE_TO_CLARIFY';

export type AllergenExposure =
  | 'CONTAINS'
  | 'MAY_CONTAIN'
  | 'CROSS_CONTAMINATION_RISK'
  | 'NOT_KNOWN_TO_CONTAIN'
  | 'UNKNOWN';

export type OfferResult =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_MODIFICATION'
  | 'BLOCKED'
  | 'REQUIRES_CONFIRMATION';

export type AcknowledgementKind = 'CASHIER_GUEST_INFORMED' | 'KITCHEN_ACKNOWLEDGED';

export type FindingReason =
  | 'NOT_KNOWN_TO_CONTAIN'
  | 'MODIFICATION_REMOVES_ALLERGEN'
  | 'CONTAINS_NOT_REMOVED'
  | 'UNCERTAIN_COMPOSITION'
  | 'CROSS_CONTACT_RISK'
  | 'KITCHEN_POLICY_FORBIDS_MODIFICATION'
  | 'KITCHEN_POLICY_MISSING'
  | 'GUEST_ALLERGY_STATUS_UNKNOWN'
  | 'MODIFICATION_COMBINATION_UNSUPPORTED';

export const ALLERGEN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Flattened composition leaves (CatalogItem ids) of an Effective Recipe. */
export type Composition = {
  /** false when recipe/prep data is missing, unpublished, or cyclic → everything UNKNOWN. */
  known: boolean;
  leafIds: readonly string[];
};

export type LeafAllergenProfile = {
  declarationStatus: 'COMPLETE' | 'INCOMPLETE';
  declared: ReadonlyMap<string, 'CONTAINS' | 'MAY_CONTAIN' | 'CROSS_CONTAMINATION_RISK'>;
};

export type KitchenHandlingPolicy = {
  modificationPermitted: boolean;
  handlingCode: string | null;
};

export type AllergenFinding = {
  allergenCode: string;
  baseExposure: AllergenExposure;
  effectiveExposure: AllergenExposure;
  outcome: OfferResult;
  reason: FindingReason;
  handlingCode?: string;
};

export type KitchenWarning = {
  code:
    | 'ALLERGY_ORDER'
    | 'ALLERGY_STATUS_UNKNOWN'
    | 'ALLERGEN_MODIFICATION'
    | 'ALLERGEN_UNCERTAINTY'
    | 'CROSS_CONTACT_RISK'
    | 'ALLERGEN_BLOCKED';
  severity: 'CRITICAL';
  allergenCodes: string[];
  handlingCodes: string[];
  message: string;
};

export type RequiredAcknowledgement = { kind: AcknowledgementKind };

export type OfferResolution = {
  result: OfferResult;
  findings: AllergenFinding[];
  kitchenWarnings: KitchenWarning[];
  requiredAcknowledgements: RequiredAcknowledgement[];
};

export type ResolutionInputs = {
  choice: AllergenCaptureChoice;
  allergenCodes: readonly string[];
  base: Composition;
  effective: Composition;
  profiles: ReadonlyMap<string, LeafAllergenProfile>;
  policies: ReadonlyMap<string, KitchenHandlingPolicy>;
};

const EXPOSURE_RANK: Record<AllergenExposure, number> = {
  CONTAINS: 4,
  UNKNOWN: 3,
  MAY_CONTAIN: 2,
  CROSS_CONTAMINATION_RISK: 1,
  NOT_KNOWN_TO_CONTAIN: 0,
};

const OUTCOME_RANK: Record<OfferResult, number> = {
  BLOCKED: 3,
  REQUIRES_CONFIRMATION: 2,
  AVAILABLE_WITH_MODIFICATION: 1,
  AVAILABLE: 0,
};

export function assertAllergenCodes(codes: readonly string[]): string[] {
  const unique = [...new Set(codes)].sort();
  for (const c of unique) {
    if (!ALLERGEN_CODE_PATTERN.test(c)) {
      throw new Error(`INVALID_ALLERGEN_CODE:${c}`);
    }
  }
  return unique;
}

function leafExposure(profile: LeafAllergenProfile | undefined, code: string): AllergenExposure {
  const declared = profile?.declared.get(code);
  if (declared) return declared;
  return profile?.declarationStatus === 'COMPLETE' ? 'NOT_KNOWN_TO_CONTAIN' : 'UNKNOWN';
}

export function aggregateExposure(
  composition: Composition,
  profiles: ReadonlyMap<string, LeafAllergenProfile>,
  code: string,
): AllergenExposure {
  if (!composition.known || composition.leafIds.length === 0) return 'UNKNOWN';
  let worst: AllergenExposure = 'NOT_KNOWN_TO_CONTAIN';
  for (const leafId of composition.leafIds) {
    const e = leafExposure(profiles.get(leafId), code);
    if (EXPOSURE_RANK[e] > EXPOSURE_RANK[worst]) worst = e;
  }
  return worst;
}

export function applyDeltasToComposition(
  composition: Composition,
  deltas: ReadonlyArray<ModifierRecipeDelta>,
): Composition {
  if (!composition.known) return composition;
  const refs = composition.leafIds.map((catalogItemId) => ({
    catalogItemId,
    quantity: '1',
    unit: 'ea',
    dimension: 'COUNT' as const,
  }));
  const next = applyEffectiveRecipeDeltas(refs, deltas);
  return { known: true, leafIds: next.map((r) => r.catalogItemId) };
}

function classifyAllergen(
  code: string,
  inputs: ResolutionInputs,
): AllergenFinding {
  const baseExposure = aggregateExposure(inputs.base, inputs.profiles, code);
  const effectiveExposure = aggregateExposure(inputs.effective, inputs.profiles, code);
  const finding = (
    outcome: OfferResult,
    reason: FindingReason,
    handlingCode?: string | null,
  ): AllergenFinding => ({
    allergenCode: code,
    baseExposure,
    effectiveExposure,
    outcome,
    reason,
    ...(handlingCode ? { handlingCode } : {}),
  });

  if (effectiveExposure === 'CONTAINS') {
    return finding('BLOCKED', 'CONTAINS_NOT_REMOVED');
  }
  if (effectiveExposure === 'UNKNOWN') {
    return finding('REQUIRES_CONFIRMATION', 'UNCERTAIN_COMPOSITION');
  }
  if (effectiveExposure === 'MAY_CONTAIN' || effectiveExposure === 'CROSS_CONTAMINATION_RISK') {
    return finding('REQUIRES_CONFIRMATION', 'CROSS_CONTACT_RISK');
  }
  // effective NOT_KNOWN_TO_CONTAIN — not a guarantee.
  if (baseExposure === 'NOT_KNOWN_TO_CONTAIN') {
    return finding('AVAILABLE', 'NOT_KNOWN_TO_CONTAIN');
  }
  const policy = inputs.policies.get(code);
  if (!policy) return finding('REQUIRES_CONFIRMATION', 'KITCHEN_POLICY_MISSING');
  if (!policy.modificationPermitted) {
    return finding('BLOCKED', 'KITCHEN_POLICY_FORBIDS_MODIFICATION', policy.handlingCode);
  }
  return finding('AVAILABLE_WITH_MODIFICATION', 'MODIFICATION_REMOVES_ALLERGEN', policy.handlingCode);
}

function worstOutcome(outcomes: readonly OfferResult[]): OfferResult {
  let worst: OfferResult = 'AVAILABLE';
  for (const o of outcomes) {
    if (OUTCOME_RANK[o] > OUTCOME_RANK[worst]) worst = o;
  }
  return worst;
}

function buildRequiredAcknowledgements(
  choice: AllergenCaptureChoice,
  result: OfferResult,
): RequiredAcknowledgement[] {
  if (choice === 'NO_ALLERGIES_CONFIRMED' || result === 'BLOCKED') return [];
  const acks: RequiredAcknowledgement[] = [];
  if (result === 'REQUIRES_CONFIRMATION') acks.push({ kind: 'CASHIER_GUEST_INFORMED' });
  acks.push({ kind: 'KITCHEN_ACKNOWLEDGED' });
  return acks;
}

function codesFor(findings: readonly AllergenFinding[], pred: (f: AllergenFinding) => boolean) {
  return findings.filter(pred).map((f) => f.allergenCode);
}

function buildKitchenWarnings(
  choice: AllergenCaptureChoice,
  allergenCodes: readonly string[],
  findings: readonly AllergenFinding[],
): KitchenWarning[] {
  if (choice === 'NO_ALLERGIES_CONFIRMED') return [];
  if (choice === 'UNABLE_TO_CLARIFY') {
    return [
      {
        code: 'ALLERGY_STATUS_UNKNOWN',
        severity: 'CRITICAL',
        allergenCodes: [],
        handlingCodes: [],
        message:
          'Guest allergy status could NOT be clarified. Treat as unknown risk; do not assume the dish is allergen-free.',
      },
    ];
  }
  const warnings: KitchenWarning[] = [
    {
      code: 'ALLERGY_ORDER',
      severity: 'CRITICAL',
      allergenCodes: [...allergenCodes],
      handlingCodes: [],
      message: `Guest reported allergens: ${allergenCodes.join(', ')}.`,
    },
  ];
  const handling = (pred: (f: AllergenFinding) => boolean) =>
    findings.filter(pred).flatMap((f) => (f.handlingCode ? [f.handlingCode] : []));

  const modified = (f: AllergenFinding) => f.outcome === 'AVAILABLE_WITH_MODIFICATION';
  if (findings.some(modified)) {
    warnings.push({
      code: 'ALLERGEN_MODIFICATION',
      severity: 'CRITICAL',
      allergenCodes: codesFor(findings, modified),
      handlingCodes: handling(modified),
      message: 'Allergen removed/replaced by modification; follow the kitchen handling procedure.',
    });
  }
  const cross = (f: AllergenFinding) => f.reason === 'CROSS_CONTACT_RISK';
  if (findings.some(cross)) {
    warnings.push({
      code: 'CROSS_CONTACT_RISK',
      severity: 'CRITICAL',
      allergenCodes: codesFor(findings, cross),
      handlingCodes: [],
      message: 'Possible cross-contact / may-contain exposure; human review required.',
    });
  }
  const uncertain = (f: AllergenFinding) =>
    f.reason === 'UNCERTAIN_COMPOSITION' || f.reason === 'KITCHEN_POLICY_MISSING';
  if (findings.some(uncertain)) {
    warnings.push({
      code: 'ALLERGEN_UNCERTAINTY',
      severity: 'CRITICAL',
      allergenCodes: codesFor(findings, uncertain),
      handlingCodes: [],
      message: 'Composition or kitchen handling data incomplete (UNKNOWN); never treat as safe.',
    });
  }
  const blocked = (f: AllergenFinding) => f.outcome === 'BLOCKED';
  if (findings.some(blocked)) {
    warnings.push({
      code: 'ALLERGEN_BLOCKED',
      severity: 'CRITICAL',
      allergenCodes: codesFor(findings, blocked),
      handlingCodes: [],
      message: 'Dish contains a guest allergen that cannot be removed; do not prepare.',
    });
  }
  return warnings;
}

/** Resolve one configured (actual Effective Recipe) line against the order-local context. */
export function resolveConfiguredOffer(inputs: ResolutionInputs): OfferResolution {
  if (inputs.choice === 'NO_ALLERGIES_CONFIRMED') {
    return {
      result: 'AVAILABLE',
      findings: [],
      kitchenWarnings: [],
      requiredAcknowledgements: [],
    };
  }
  if (inputs.choice === 'UNABLE_TO_CLARIFY') {
    const result: OfferResult = 'REQUIRES_CONFIRMATION';
    return {
      result,
      findings: [],
      kitchenWarnings: buildKitchenWarnings(inputs.choice, [], []),
      requiredAcknowledgements: buildRequiredAcknowledgements(inputs.choice, result),
    };
  }
  const codes = assertAllergenCodes(inputs.allergenCodes);
  const findings = codes.map((c) => classifyAllergen(c, inputs));
  const result = worstOutcome(findings.map((f) => f.outcome));
  return {
    result,
    findings,
    kitchenWarnings: buildKitchenWarnings(inputs.choice, codes, findings),
    requiredAcknowledgements: buildRequiredAcknowledgements(inputs.choice, result),
  };
}

export type ModificationCandidate = {
  modifierGroupId: string;
  modifierOptionId: string;
  selectionMode: 'SINGLE' | 'MULTI';
  deltas: ReadonlyArray<ModifierRecipeDelta>;
};

export type OfferWithOptions = OfferResolution & {
  /** Options the cashier UI must present/apply for AVAILABLE_WITH_MODIFICATION at offer level. */
  requiredOptions: Array<{ modifierGroupId: string; modifierOptionId: string }>;
};

/**
 * Offer-level (pre-configuration) resolution. If the base recipe CONTAINS a constrained allergen,
 * search approved ModifierOption deltas that remove/replace it; the proposal is then re-verified
 * against the actual resulting Effective Recipe and kitchen policy.
 */
export function resolveCatalogOffer(
  inputs: Omit<ResolutionInputs, 'effective'>,
  candidates: ReadonlyArray<ModificationCandidate>,
): OfferWithOptions {
  const direct = resolveConfiguredOffer({ ...inputs, effective: inputs.base });
  const noOptions: OfferWithOptions = { ...direct, requiredOptions: [] };
  const contested = direct.findings.filter((f) => f.reason === 'CONTAINS_NOT_REMOVED');
  if (contested.length === 0) return noOptions;

  const chosen = new Map<string, ModificationCandidate>();
  for (const f of contested) {
    // Prefer a candidate that clears to NOT_KNOWN_TO_CONTAIN. Do not auto-propose
    // UNKNOWN / MAY_CONTAIN / CROSS_CONTAMINATION_RISK replacements as requiredOptions.
    const ranked = candidates
      .map((cand) => {
        const eff = applyDeltasToComposition(inputs.base, cand.deltas);
        const exposure = aggregateExposure(eff, inputs.profiles, f.allergenCode);
        return { cand, exposure };
      })
      .filter((row) => row.exposure !== 'CONTAINS');
    const preferred = ranked.find((row) => row.exposure === 'NOT_KNOWN_TO_CONTAIN');
    if (!preferred) return noOptions;
    chosen.set(preferred.cand.modifierOptionId, preferred.cand);
  }
  const picked = [...chosen.values()];
  const singleGroups = new Set<string>();
  for (const p of picked) {
    if (p.selectionMode !== 'SINGLE') continue;
    if (singleGroups.has(p.modifierGroupId)) {
      return {
        ...noOptions,
        findings: contested.map((f) => ({ ...f, reason: 'MODIFICATION_COMBINATION_UNSUPPORTED' })),
      };
    }
    singleGroups.add(p.modifierGroupId);
  }
  const effective = picked.reduce<Composition>(
    (acc, p) => applyDeltasToComposition(acc, p.deltas),
    inputs.base,
  );
  const verified = resolveConfiguredOffer({ ...inputs, effective });
  if (verified.result === 'BLOCKED') return noOptions;
  return {
    ...verified,
    requiredOptions: picked.map((p) => ({
      modifierGroupId: p.modifierGroupId,
      modifierOptionId: p.modifierOptionId,
    })),
  };
}

export function resolutionFingerprint(parts: {
  orderLineId: string;
  contextRevision: number;
  choice: AllergenCaptureChoice;
  allergenCodes: readonly string[];
  configurationFingerprint: string;
  resolution: OfferResolution;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        l: parts.orderLineId,
        r: parts.contextRevision,
        c: parts.choice,
        a: [...parts.allergenCodes].sort(),
        f: parts.configurationFingerprint,
        o: parts.resolution.result,
        x: parts.resolution.findings,
      }),
    )
    .digest('hex');
}
