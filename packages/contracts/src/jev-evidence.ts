import { z } from 'zod';
import { operationalFactTypeSchema } from './common.js';
import { ImprintClaimOrigin, isRegisteredFactPath } from './restaurant-imprint.js';

/**
 * JEV / Production Intelligence EvidenceBundle foundation (ADR-0020 execution
 * boundary, ADR-0006 Intelligence boundary). Pure, provider-neutral contracts:
 * a typed EvidenceBundle is built from authorized read projections only, never
 * from raw operational documents or direct database access. No model is
 * selected or invoked here. Recommendations are inferred evidence and carry no
 * operational authority; any operational change still goes through an explicit
 * Operational Core command (ADR-0006).
 */

export const JEV_EVIDENCE_POLICY_VERSION = 'jev-evidence-1' as const;

export const EvidenceKind = {
  OperationalFact: 'OPERATIONAL_FACT',
  DeclaredClaim: 'DECLARED_CLAIM',
  Goal: 'GOAL',
  InferredRecommendation: 'INFERRED_RECOMMENDATION',
} as const;

export type EvidenceKindName = (typeof EvidenceKind)[keyof typeof EvidenceKind];

export const EvidenceStatus = {
  Known: 'KNOWN',
  Unknown: 'UNKNOWN',
  Conflict: 'CONFLICT',
} as const;

export type EvidenceStatusName = (typeof EvidenceStatus)[keyof typeof EvidenceStatus];

export const EvidenceFreshness = {
  Fresh: 'FRESH',
  Stale: 'STALE',
  Degraded: 'DEGRADED',
} as const;

export type EvidenceFreshnessName = (typeof EvidenceFreshness)[keyof typeof EvidenceFreshness];

export const EvidenceVerification = {
  SourceVerified: 'SOURCE_VERIFIED',
  Unverified: 'UNVERIFIED',
  Inferred: 'INFERRED',
} as const;

export type EvidenceVerificationName =
  (typeof EvidenceVerification)[keyof typeof EvidenceVerification];

export const EvidenceSensitivity = {
  PublicReference: 'PUBLIC_REFERENCE',
  InternalReference: 'INTERNAL_REFERENCE',
  Sensitive: 'SENSITIVE',
} as const;

export type EvidenceSensitivityName =
  (typeof EvidenceSensitivity)[keyof typeof EvidenceSensitivity];

export class JevContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'JevContractError';
    this.code = code;
  }
}

function reject(code: string, message: string): never {
  throw new JevContractError(code, message);
}

const CONTROL = /[\u0000-\u001F\u007F]/;
const uuid = z.string().uuid();
const token = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !CONTROL.test(value), 'control character');

const provenanceSchema = z
  .object({
    sourceModule: token,
    sourceEntityType: token,
    sourceEntityId: uuid,
    sourceRevision: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !CONTROL.test(value), 'control character'),
    observedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export type EvidenceProvenance = z.infer<typeof provenanceSchema>;

const baseShape = {
  tenantId: uuid,
  outletId: uuid,
  status: z.enum([EvidenceStatus.Known, EvidenceStatus.Unknown, EvidenceStatus.Conflict]),
  freshness: z.enum([
    EvidenceFreshness.Fresh,
    EvidenceFreshness.Stale,
    EvidenceFreshness.Degraded,
  ]),
  sensitivity: z.enum([
    EvidenceSensitivity.PublicReference,
    EvidenceSensitivity.InternalReference,
    EvidenceSensitivity.Sensitive,
  ]),
  requiredProcessingAuthorization: token.nullable(),
  recordedAt: z.string().datetime(),
  observedAt: z.string().datetime().nullable().optional(),
  provenance: provenanceSchema,
  resolverVersion: token,
  usableForInference: z.boolean(),
};

const operationalFactItemSchema = z
  .object({
    kind: z.literal(EvidenceKind.OperationalFact),
    verification: z.literal(EvidenceVerification.SourceVerified),
    factId: uuid,
    factType: operationalFactTypeSchema,
    ...baseShape,
  })
  .strict();

const declaredClaimItemSchema = z
  .object({
    kind: z.literal(EvidenceKind.DeclaredClaim),
    verification: z.literal(EvidenceVerification.Unverified),
    claimId: uuid,
    factPath: z.string().min(1).max(128),
    origin: z.enum([
      ImprintClaimOrigin.Declared,
      ImprintClaimOrigin.Configured,
      ImprintClaimOrigin.Observed,
    ]),
    ...baseShape,
  })
  .strict();

const goalItemSchema = z
  .object({
    kind: z.literal(EvidenceKind.Goal),
    verification: z.literal(EvidenceVerification.Unverified),
    claimId: uuid,
    factPath: z.string().min(1).max(128),
    origin: z.literal(ImprintClaimOrigin.Target),
    ...baseShape,
  })
  .strict();

const recommendationItemSchema = z
  .object({
    kind: z.literal(EvidenceKind.InferredRecommendation),
    verification: z.literal(EvidenceVerification.Inferred),
    recommendationId: uuid,
    recommendationType: token,
    assertsOperationalAuthority: z.boolean(),
    ...baseShape,
  })
  .strict();

const evidenceItemSchema = z.discriminatedUnion('kind', [
  operationalFactItemSchema,
  declaredClaimItemSchema,
  goalItemSchema,
  recommendationItemSchema,
]);

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

/**
 * Parse and semantically validate one evidence item. Rejects unregistered
 * fields, missing provenance, sensitive items without a declared authorization,
 * stale/unknown/conflicting evidence marked usable for inference, and a
 * recommendation that claims operational authority.
 */
export function parseEvidenceItem(input: unknown): EvidenceItem {
  const parsed = evidenceItemSchema.safeParse(input);
  if (!parsed.success) {
    reject('JEV_ITEM_REJECTED', 'evidence item does not match the typed contract');
  }
  const item = parsed.data;

  if (
    (item.kind === EvidenceKind.DeclaredClaim || item.kind === EvidenceKind.Goal) &&
    !isRegisteredFactPath(item.factPath)
  ) {
    reject('JEV_UNREGISTERED_FIELD', 'evidence claim uses a fact path outside the registry');
  }

  if (item.kind === EvidenceKind.OperationalFact && item.status !== EvidenceStatus.Known) {
    reject('JEV_ITEM_REJECTED', 'an operational fact evidence item must be KNOWN');
  }

  if (
    item.sensitivity === EvidenceSensitivity.Sensitive &&
    item.requiredProcessingAuthorization === null
  ) {
    reject(
      'JEV_SENSITIVITY_REQUIRES_AUTH',
      'a sensitive evidence item must name its required processing authorization',
    );
  }

  if (
    item.usableForInference &&
    (item.freshness !== EvidenceFreshness.Fresh || item.status !== EvidenceStatus.Known)
  ) {
    reject('JEV_STALE_EVIDENCE', 'stale, unknown, or conflicting evidence cannot back inference');
  }

  if (item.kind === EvidenceKind.InferredRecommendation && item.assertsOperationalAuthority) {
    reject(
      'JEV_RECOMMENDATION_AUTHORITY',
      'an inferred recommendation cannot claim operational authority',
    );
  }

  return item;
}

const bundleEnvelopeSchema = z
  .object({
    bundleId: uuid,
    tenantId: uuid,
    authorizedOutletId: uuid,
    policyVersion: token,
    resolverVersion: token,
    builtAt: z.string().datetime(),
    authorizedProcessingGrants: z.array(token).max(32),
    items: z.array(z.unknown()).max(512),
    degraded: z.boolean().optional(),
  })
  .strict();

export type EvidenceBundle = {
  bundleId: string;
  tenantId: string;
  authorizedOutletId: string;
  policyVersion: string;
  resolverVersion: string;
  builtAt: string;
  authorizedProcessingGrants: string[];
  items: EvidenceItem[];
  degraded: boolean;
};

/**
 * EvidenceBuilder pure core (ADR-0020). Builds a validated, tenant/outlet-scoped
 * EvidenceBundle from already-authorized projection inputs. Enforces single
 * tenant + authorized outlet scope across every item, default-deny processing
 * authorization (data presence is never consent), and marks the bundle degraded
 * when any input is not fresh/known. No database or model access occurs here.
 */
export function buildEvidenceBundle(input: unknown): EvidenceBundle {
  const envelope = bundleEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    reject('JEV_BUNDLE_REJECTED', 'evidence bundle envelope does not match the typed contract');
  }
  const { bundleId, tenantId, authorizedOutletId, policyVersion, resolverVersion, builtAt } =
    envelope.data;
  const grants = new Set(envelope.data.authorizedProcessingGrants);
  const items = envelope.data.items.map((raw) => parseEvidenceItem(raw));

  let degraded = false;
  for (const item of items) {
    if (item.tenantId !== tenantId || item.outletId !== authorizedOutletId) {
      reject(
        'JEV_TENANT_SCOPE',
        'an evidence item is outside the bundle tenant and authorized outlet',
      );
    }
    if (
      item.requiredProcessingAuthorization !== null &&
      !grants.has(item.requiredProcessingAuthorization)
    ) {
      reject(
        'JEV_PROCESSING_AUTHORIZATION_REQUIRED',
        'evidence requires a processing authorization that was not granted',
      );
    }
    if (item.freshness !== EvidenceFreshness.Fresh || item.status !== EvidenceStatus.Known) {
      degraded = true;
    }
  }

  return {
    bundleId,
    tenantId,
    authorizedOutletId,
    policyVersion,
    resolverVersion,
    builtAt,
    authorizedProcessingGrants: [...grants].sort(),
    items,
    degraded,
  };
}

export type ApprovedModelRegistryEntry = {
  purpose: string;
  schemaId: string;
  approved: boolean;
};

export type ModelGatewayRequest = {
  requestId: string;
  purpose: string;
  schemaId: string;
  bundleId: string;
  tenantId: string;
  authorizedOutletId: string;
  policyVersion: string;
  resolverVersion: string;
  evidence: EvidenceBundle;
};

/**
 * ModelGateway + ApprovedModelRegistry contract (ADR-0020), with no provider
 * selected and no model invoked. The gateway's only data input is a revalidated
 * typed EvidenceBundle (references, not raw documents or SQL), so a model never
 * receives arbitrary database access. Rejects a purpose/schema that the approved
 * registry does not authorize.
 */
export function prepareModelGatewayRequest(input: {
  requestId: string;
  purpose: string;
  schemaId: string;
  bundle: EvidenceBundle;
  registry: readonly ApprovedModelRegistryEntry[];
}): ModelGatewayRequest {
  const requestId = uuid.safeParse(input.requestId);
  if (!requestId.success) {
    reject('JEV_MODEL_REQUEST_REJECTED', 'model gateway request id must be an identifier');
  }
  if (typeof input.purpose !== 'string' || input.purpose.length < 1) {
    reject('JEV_MODEL_REQUEST_REJECTED', 'model gateway purpose is required');
  }
  if (typeof input.schemaId !== 'string' || input.schemaId.length < 1) {
    reject('JEV_MODEL_REQUEST_REJECTED', 'model gateway schema id is required');
  }
  const approved = input.registry.some(
    (entry) => entry.approved && entry.purpose === input.purpose && entry.schemaId === input.schemaId,
  );
  if (!approved) {
    reject(
      'JEV_MODEL_PURPOSE_NOT_APPROVED',
      'no approved model is registered for this purpose and schema',
    );
  }
  const evidence = buildEvidenceBundle(input.bundle);
  return {
    requestId: requestId.data,
    purpose: input.purpose,
    schemaId: input.schemaId,
    bundleId: evidence.bundleId,
    tenantId: evidence.tenantId,
    authorizedOutletId: evidence.authorizedOutletId,
    policyVersion: evidence.policyVersion,
    resolverVersion: evidence.resolverVersion,
    evidence,
  };
}
