import { z } from 'zod';

/**
 * Closed Restaurant Imprint FactPath registry (ADR-0054 I-03).
 * A dotted string is not a path until it is listed here.
 * Persistence keeps a syntax-only gate so earlier rows stay readable.
 */

const CONTROL = /[\u0000-\u001F\u007F]/;
const CURSOR_NAME = /^[a-z][a-z0-9_]{0,79}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const CAPABILITY_KEY = /^[a-z][a-z0-9_.]{0,31}$/;

export const IMPRINT_RESOLVER_VERSION = 'imprint-snapshot-1' as const;

export const ImprintClaimOrigin = {
  Declared: 'DECLARED',
  Configured: 'CONFIGURED',
  Observed: 'OBSERVED',
  Target: 'TARGET',
} as const;

export type ImprintClaimOriginName =
  (typeof ImprintClaimOrigin)[keyof typeof ImprintClaimOrigin];

export const ImprintFieldState = {
  Known: 'KNOWN',
  Unknown: 'UNKNOWN',
  Conflict: 'CONFLICT',
  Stale: 'STALE',
  Degraded: 'DEGRADED',
} as const;

export type ImprintFieldStateName =
  (typeof ImprintFieldState)[keyof typeof ImprintFieldState];

export const ImprintSensitivity = {
  PublicReference: 'PUBLIC_REFERENCE',
  InternalReference: 'INTERNAL_REFERENCE',
} as const;

export type ImprintSensitivityName =
  (typeof ImprintSensitivity)[keyof typeof ImprintSensitivity];

export const ImprintRetention = {
  OutletLifetime: 'OUTLET_LIFETIME',
} as const;

export const ImprintVerificationState = {
  Unverified: 'UNVERIFIED',
} as const;

export const ImprintFreshness = {
  Fresh: 'FRESH',
  Stale: 'STALE',
  Degraded: 'DEGRADED',
} as const;

export type ImprintFreshnessName = (typeof ImprintFreshness)[keyof typeof ImprintFreshness];

export const FactPath = {
  OutletIdentity: 'organization.outlet.identity',
  OutletBrandRef: 'organization.outlet.brand_ref',
  OutletLegalEntityRef: 'organization.outlet.legal_entity_ref',
  OutletCapabilities: 'organization.outlet.capabilities',
  WarehouseRefs: 'inventory.warehouse_refs',
  LastPostedReceiptRef: 'procurement.last_posted_receipt_ref',
  ActiveTerminalRefs: 'operations.active_terminal_refs',
} as const;

export type RegisteredFactPath = (typeof FactPath)[keyof typeof FactPath];

export class ImprintContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImprintContractError';
    this.code = code;
  }
}

const uuidSchema = z.string().uuid();

const displayNameSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => !CONTROL.test(value), 'display name contains a control character');

const identityValueSchema = z
  .object({
    outletId: uuidSchema,
    name: displayNameSchema,
  })
  .strict();

const brandRefValueSchema = z.object({ brandId: uuidSchema }).strict();
const legalEntityRefValueSchema = z.object({ legalEntityId: uuidSchema }).strict();

const capabilityKeysSchema = z
  .array(z.string().regex(CAPABILITY_KEY))
  .max(4)
  .superRefine((keys, context) => {
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: 'capability keys must be unique' });
    }
  })
  .transform((keys) => [...keys].sort());

const capabilitiesValueSchema = z.object({ keys: capabilityKeysSchema }).strict();

const warehouseRefsValueSchema = z
  .object({
    warehouseIds: z
      .array(uuidSchema)
      .max(4)
      .superRefine((ids, context) => {
        if (new Set(ids).size !== ids.length) {
          context.addIssue({ code: 'custom', message: 'warehouse ids must be unique' });
        }
      })
      .transform((ids) => [...ids].sort()),
  })
  .strict();

const receiptRefValueSchema = z
  .object({
    goodsReceiptId: uuidSchema,
    postingStatus: z.enum(['POSTED', 'REVERSED']),
  })
  .strict();

const valueSchemas = {
  [FactPath.OutletIdentity]: identityValueSchema,
  [FactPath.OutletBrandRef]: brandRefValueSchema,
  [FactPath.OutletLegalEntityRef]: legalEntityRefValueSchema,
  [FactPath.OutletCapabilities]: capabilitiesValueSchema,
  [FactPath.WarehouseRefs]: warehouseRefsValueSchema,
  [FactPath.LastPostedReceiptRef]: receiptRefValueSchema,
} as const;

export type ImprintPathValue =
  | z.infer<typeof identityValueSchema>
  | z.infer<typeof brandRefValueSchema>
  | z.infer<typeof legalEntityRefValueSchema>
  | z.output<typeof capabilitiesValueSchema>
  | z.output<typeof warehouseRefsValueSchema>
  | z.infer<typeof receiptRefValueSchema>;

type SourceAvailability = 'SOURCE_CONTRACT' | 'UNKNOWN';

export type FactPathDefinition = {
  factPath: RegisteredFactPath;
  ownerModule: string;
  sourceEntityType: string;
  allowedOrigins: readonly ImprintClaimOriginName[];
  authoritativeOrigins: readonly ImprintClaimOriginName[];
  sensitivityClass: ImprintSensitivityName;
  retentionClass: typeof ImprintRetention.OutletLifetime;
  provenanceRequired: true;
  stage1: SourceAvailability;
  resolverVersion: typeof IMPRINT_RESOLVER_VERSION;
};

const observed = [ImprintClaimOrigin.Observed] as const;
const observedOrDeclared = [ImprintClaimOrigin.Observed, ImprintClaimOrigin.Declared] as const;
const configuredOrObserved = [ImprintClaimOrigin.Configured, ImprintClaimOrigin.Observed] as const;

function definition(
  factPath: RegisteredFactPath,
  ownerModule: string,
  sourceEntityType: string,
  allowedOrigins: readonly ImprintClaimOriginName[],
  authoritativeOrigins: readonly ImprintClaimOriginName[],
  sensitivityClass: ImprintSensitivityName,
  stage1: SourceAvailability,
): FactPathDefinition {
  return {
    factPath,
    ownerModule,
    sourceEntityType,
    allowedOrigins,
    authoritativeOrigins,
    sensitivityClass,
    retentionClass: ImprintRetention.OutletLifetime,
    provenanceRequired: true,
    stage1,
    resolverVersion: IMPRINT_RESOLVER_VERSION,
  };
}

export const FACT_PATH_REGISTRY: Record<RegisteredFactPath, FactPathDefinition> = {
  [FactPath.OutletIdentity]: definition(
    FactPath.OutletIdentity,
    'organization',
    'Outlet',
    observedOrDeclared,
    observed,
    ImprintSensitivity.PublicReference,
    'SOURCE_CONTRACT',
  ),
  [FactPath.OutletBrandRef]: definition(
    FactPath.OutletBrandRef,
    'organization',
    'Brand',
    observed,
    observed,
    ImprintSensitivity.PublicReference,
    'SOURCE_CONTRACT',
  ),
  [FactPath.OutletLegalEntityRef]: definition(
    FactPath.OutletLegalEntityRef,
    'organization',
    'LegalEntity',
    observed,
    observed,
    ImprintSensitivity.PublicReference,
    'SOURCE_CONTRACT',
  ),
  [FactPath.OutletCapabilities]: definition(
    FactPath.OutletCapabilities,
    'organization',
    'OutletCapabilityConfig',
    configuredOrObserved,
    configuredOrObserved,
    ImprintSensitivity.InternalReference,
    'SOURCE_CONTRACT',
  ),
  [FactPath.WarehouseRefs]: definition(
    FactPath.WarehouseRefs,
    'organization',
    'Warehouse',
    observed,
    observed,
    ImprintSensitivity.InternalReference,
    'SOURCE_CONTRACT',
  ),
  [FactPath.LastPostedReceiptRef]: definition(
    FactPath.LastPostedReceiptRef,
    'procurement',
    'GoodsReceipt',
    observed,
    observed,
    ImprintSensitivity.InternalReference,
    'SOURCE_CONTRACT',
  ),
  [FactPath.ActiveTerminalRefs]: definition(
    FactPath.ActiveTerminalRefs,
    'organization',
    'Terminal',
    observed,
    observed,
    ImprintSensitivity.InternalReference,
    'UNKNOWN',
  ),
};

const ORIGIN_RANK: Record<ImprintClaimOriginName, number> = {
  OBSERVED: 4,
  CONFIGURED: 3,
  DECLARED: 2,
  TARGET: 1,
};

export function listRegisteredFactPaths(): RegisteredFactPath[] {
  return Object.values(FactPath).sort();
}

export function isRegisteredFactPath(factPath: string): factPath is RegisteredFactPath {
  return Object.prototype.hasOwnProperty.call(FACT_PATH_REGISTRY, factPath);
}

function reject(code: string, message: string): never {
  throw new ImprintContractError(code, message);
}

function readRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    reject('IMPRINT_VALUE_REJECTED', `${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function requireRegisteredPath(factPath: unknown): RegisteredFactPath {
  if (typeof factPath !== 'string' || !isRegisteredFactPath(factPath)) {
    reject('IMPRINT_PATH_UNREGISTERED', 'fact path is not in the imprint registry');
  }
  return factPath;
}

function requireSourceContract(path: RegisteredFactPath): FactPathDefinition {
  const entry = FACT_PATH_REGISTRY[path];
  if (entry.stage1 !== 'SOURCE_CONTRACT') {
    reject('IMPRINT_PATH_UNAVAILABLE', 'fact path has no source read contract and stays UNKNOWN');
  }
  return entry;
}

export function canonicalImprintValue(factPath: RegisteredFactPath, value: unknown): string {
  const entry = requireSourceContract(factPath);
  const schema = valueSchemas[factPath as keyof typeof valueSchemas];
  if (!schema) {
    reject('IMPRINT_PATH_UNAVAILABLE', 'fact path has no value schema');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    reject('IMPRINT_VALUE_REJECTED', 'fact value does not match the registered schema');
  }
  const canonical = stableJson(parsed.data);
  if (canonical.length < 1 || canonical.length > 256 || CONTROL.test(canonical)) {
    reject('IMPRINT_VALUE_REJECTED', 'canonical value exceeds the persistence text limit');
  }
  return canonical;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function decodeImprintValue(
  factPath: RegisteredFactPath,
  canonicalValue: string,
): ImprintPathValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalValue);
  } catch {
    reject('IMPRINT_VALUE_REJECTED', 'canonical value is not registered JSON');
  }
  const schema = valueSchemas[factPath as keyof typeof valueSchemas];
  if (!schema) {
    reject('IMPRINT_PATH_UNAVAILABLE', 'fact path has no value schema');
  }
  const result = schema.safeParse(parsed);
  if (!result.success || canonicalImprintValue(factPath, result.data) !== canonicalValue) {
    reject('IMPRINT_VALUE_REJECTED', 'canonical value does not match the registered schema');
  }
  return result.data;
}

const provenanceSchema = z
  .object({
    sourceModule: z.string().min(1),
    sourceEntityType: z.string().min(1),
    sourceEntityId: uuidSchema,
    sourceRevision: z.string().min(1).max(128),
    observedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export type ImprintProvenance = z.infer<typeof provenanceSchema>;

function readProvenance(
  input: Record<string, unknown>,
  entry: FactPathDefinition,
): ImprintProvenance {
  if (input.provenance == null) {
    reject('IMPRINT_PROVENANCE_REJECTED', 'provenance is required for this fact path');
  }
  const parsed = provenanceSchema.safeParse(input.provenance);
  if (!parsed.success || CONTROL.test(parsed.data.sourceRevision)) {
    reject('IMPRINT_PROVENANCE_REJECTED', 'provenance is incomplete or not minimized');
  }
  if (parsed.data.sourceModule !== entry.ownerModule) {
    reject('IMPRINT_ORIGIN_REJECTED', 'source module is not the owner of this fact path');
  }
  if (parsed.data.sourceEntityType !== entry.sourceEntityType) {
    reject('IMPRINT_ORIGIN_REJECTED', 'source entity type is not the owner of this fact path');
  }
  return parsed.data;
}

function readOrigin(input: Record<string, unknown>, entry: FactPathDefinition): ImprintClaimOriginName {
  if (typeof input.origin !== 'string' || !entry.allowedOrigins.includes(input.origin as ImprintClaimOriginName)) {
    reject('IMPRINT_ORIGIN_REJECTED', 'claim origin is not allowed for this fact path');
  }
  return input.origin as ImprintClaimOriginName;
}

function readSensitivity(
  input: Record<string, unknown>,
  entry: FactPathDefinition,
): ImprintSensitivityName {
  if (input.sensitivityClass !== entry.sensitivityClass) {
    reject('IMPRINT_SENSITIVITY_REJECTED', 'sensitivity class does not match the registry');
  }
  return entry.sensitivityClass;
}

function assertValueMatchesSource(
  factPath: RegisteredFactPath,
  scope: { tenantId: string; outletId: string },
  provenance: ImprintProvenance,
  value: ImprintPathValue,
): void {
  if (factPath === FactPath.OutletIdentity) {
    const identity = value as z.infer<typeof identityValueSchema>;
    if (identity.outletId !== scope.outletId || provenance.sourceEntityId !== scope.outletId) {
      reject('IMPRINT_VALUE_REJECTED', 'outlet identity must name the scoped outlet');
    }
    return;
  }
  const referencedId = referencedEntityId(factPath, value);
  if (referencedId != null && provenance.sourceEntityId !== referencedId) {
    reject('IMPRINT_ORIGIN_REJECTED', 'provenance must name the referenced source entity');
  }
  if (referencedId == null && provenance.sourceEntityId !== scope.outletId) {
    reject('IMPRINT_ORIGIN_REJECTED', 'a set fact must cite the scoped outlet');
  }
}

function referencedEntityId(factPath: RegisteredFactPath, value: ImprintPathValue): string | null {
  if (factPath === FactPath.OutletBrandRef) return (value as z.infer<typeof brandRefValueSchema>).brandId;
  if (factPath === FactPath.OutletLegalEntityRef) {
    return (value as z.infer<typeof legalEntityRefValueSchema>).legalEntityId;
  }
  if (factPath === FactPath.LastPostedReceiptRef) {
    return (value as z.infer<typeof receiptRefValueSchema>).goodsReceiptId;
  }
  return null;
}

function readVerification(input: Record<string, unknown>): typeof ImprintVerificationState.Unverified {
  if (
    input.verificationState != null &&
    input.verificationState !== ImprintVerificationState.Unverified
  ) {
    reject('IMPRINT_VERIFICATION_REJECTED', 'a claim is not a verified operational fact');
  }
  return ImprintVerificationState.Unverified;
}

function readScope(input: Record<string, unknown>): { tenantId: string; outletId: string } {
  const tenantId = uuidSchema.safeParse(input.tenantId);
  const outletId = uuidSchema.safeParse(input.outletId);
  if (!tenantId.success || !outletId.success) {
    reject('IMPRINT_VALUE_REJECTED', 'tenant and outlet must be identifiers');
  }
  return { tenantId: tenantId.data, outletId: outletId.data };
}

export type ImprintAssertion = {
  effect: 'ASSERTION';
  tenantId: string;
  outletId: string;
  factPath: RegisteredFactPath;
  origin: ImprintClaimOriginName;
  sensitivityClass: ImprintSensitivityName;
  retentionClass: typeof ImprintRetention.OutletLifetime;
  provenance: ImprintProvenance;
  value: ImprintPathValue;
  canonicalValue: string;
  verificationState: typeof ImprintVerificationState.Unverified;
  sourceAuthoritative: boolean;
  supersedesClaimId: string | null;
  resolverVersion: typeof IMPRINT_RESOLVER_VERSION;
};

export function parseImprintAssertion(input: unknown): ImprintAssertion {
  const record = readRecord(input, 'assertion');
  const factPath = requireRegisteredPath(record.factPath);
  const entry = requireSourceContract(factPath);
  const origin = readOrigin(record, entry);
  const sensitivityClass = readSensitivity(record, entry);
  if (
    record.retentionClass != null &&
    record.retentionClass !== ImprintRetention.OutletLifetime
  ) {
    reject('IMPRINT_VALUE_REJECTED', 'retention class does not match the registry');
  }
  const provenance = readProvenance(record, entry);
  const scope = readScope(record);
  const canonicalValue = canonicalImprintValue(factPath, record.value);
  const value = decodeImprintValue(factPath, canonicalValue);
  assertValueMatchesSource(factPath, scope, provenance, value);
  const supersedes = record.supersedesClaimId == null
    ? null
    : uuidSchema.safeParse(record.supersedesClaimId);
  if (supersedes && !supersedes.success) {
    reject('IMPRINT_VALUE_REJECTED', 'superseded claim must be an identifier');
  }
  return {
    effect: 'ASSERTION',
    ...scope,
    factPath,
    origin,
    sensitivityClass,
    retentionClass: ImprintRetention.OutletLifetime,
    provenance,
    value,
    canonicalValue,
    verificationState: readVerification(record),
    sourceAuthoritative: entry.authoritativeOrigins.includes(origin),
    supersedesClaimId: supersedes?.data ?? null,
    resolverVersion: entry.resolverVersion,
  };
}

export type ImprintInvalidation = {
  effect: 'INVALIDATION';
  tenantId: string;
  outletId: string;
  factPath: RegisteredFactPath;
  invalidatesClaimId: string;
  origin: ImprintClaimOriginName;
  provenance: ImprintProvenance;
  verificationState: typeof ImprintVerificationState.Unverified;
  resolverVersion: typeof IMPRINT_RESOLVER_VERSION;
};

export function parseImprintInvalidation(input: unknown): ImprintInvalidation {
  const record = readRecord(input, 'invalidation');
  const factPath = requireRegisteredPath(record.factPath);
  const entry = requireSourceContract(factPath);
  const claimId = uuidSchema.safeParse(record.invalidatesClaimId);
  if (!claimId.success) {
    reject('IMPRINT_VALUE_REJECTED', 'invalidated claim must be an identifier');
  }
  if (record.value != null) {
    reject('IMPRINT_VALUE_REJECTED', 'an invalidation does not carry a replacement value');
  }
  return {
    effect: 'INVALIDATION',
    ...readScope(record),
    factPath,
    invalidatesClaimId: claimId.data,
    origin: readOrigin(record, entry),
    provenance: readProvenance(record, entry),
    verificationState: readVerification(record),
    resolverVersion: entry.resolverVersion,
  };
}

export type ImprintSnapshotField = {
  factPath: RegisteredFactPath;
  fieldState: ImprintFieldStateName;
  claimId: string | null;
  origin: ImprintClaimOriginName | null;
  value: ImprintPathValue | null;
  canonicalValue: string | null;
  sourceAuthoritative: boolean;
  resolverVersion: typeof IMPRINT_RESOLVER_VERSION;
};

const FIELD_STATES = new Set<string>(Object.values(ImprintFieldState));

function readFieldState(value: unknown): ImprintFieldStateName {
  if (typeof value !== 'string' || !FIELD_STATES.has(value)) {
    reject('IMPRINT_VALUE_REJECTED', 'field state is not a snapshot state');
  }
  return value as ImprintFieldStateName;
}

function blankSnapshotField(
  factPath: RegisteredFactPath,
  fieldState: ImprintFieldStateName,
): ImprintSnapshotField {
  return {
    factPath,
    fieldState,
    claimId: null,
    origin: null,
    value: null,
    canonicalValue: null,
    sourceAuthoritative: false,
    resolverVersion: FACT_PATH_REGISTRY[factPath].resolverVersion,
  };
}

function assertNoCarriedValue(record: Record<string, unknown>): void {
  if (record.value != null || record.canonicalValue != null || record.claimId != null) {
    reject('IMPRINT_UNKNOWN_VALUE', 'UNKNOWN cannot carry a fabricated value');
  }
}

function knownSnapshotField(
  record: Record<string, unknown>,
  factPath: RegisteredFactPath,
  entry: FactPathDefinition,
): ImprintSnapshotField {
  const claimId = uuidSchema.safeParse(record.claimId);
  if (!claimId.success) {
    reject('IMPRINT_VALUE_REJECTED', 'a known field names its claim');
  }
  const origin = readOrigin(record, entry);
  const canonicalValue = canonicalImprintValue(factPath, record.value);
  if (typeof record.canonicalValue === 'string' && record.canonicalValue !== canonicalValue) {
    reject('IMPRINT_VALUE_REJECTED', 'canonical value does not match the registered value');
  }
  return {
    factPath,
    fieldState: ImprintFieldState.Known,
    claimId: claimId.data,
    origin,
    value: decodeImprintValue(factPath, canonicalValue),
    canonicalValue,
    sourceAuthoritative: entry.authoritativeOrigins.includes(origin),
    resolverVersion: entry.resolverVersion,
  };
}

export function parseImprintSnapshotField(input: unknown): ImprintSnapshotField {
  const record = readRecord(input, 'snapshot field');
  const factPath = requireRegisteredPath(record.factPath);
  const entry = FACT_PATH_REGISTRY[factPath];
  const fieldState = readFieldState(record.fieldState);
  if (entry.stage1 !== 'SOURCE_CONTRACT' || fieldState !== ImprintFieldState.Known) {
    assertNoCarriedValue(record);
    const visible =
      entry.stage1 === 'SOURCE_CONTRACT' ? fieldState : ImprintFieldState.Unknown;
    return blankSnapshotField(factPath, visible);
  }
  return knownSnapshotField(record, factPath, entry);
}

export type ImprintWatermark = {
  tenantId: string;
  outletId: string;
  sourceModule: string;
  cursorName: string;
  watermark: string;
  freshness: ImprintFreshnessName;
};

const SOURCE_MODULE = /^[a-z][a-z0-9_-]{0,63}$/;
const FRESHNESS = new Set<string>(Object.values(ImprintFreshness));

function readCursorIdentity(record: Record<string, unknown>): { sourceModule: string; cursorName: string } {
  if (typeof record.sourceModule !== 'string' || typeof record.cursorName !== 'string') {
    reject('IMPRINT_VALUE_REJECTED', 'cursor identity is not stable');
  }
  if (!SOURCE_MODULE.test(record.sourceModule) || !CURSOR_NAME.test(record.cursorName)) {
    reject('IMPRINT_VALUE_REJECTED', 'cursor identity is not stable');
  }
  return { sourceModule: record.sourceModule, cursorName: record.cursorName };
}

function readWatermarkText(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || CONTROL.test(value)) {
    reject('IMPRINT_VALUE_REJECTED', 'watermark must be a short value without control characters');
  }
  return value;
}

function readFreshness(value: unknown): ImprintFreshnessName {
  if (typeof value !== 'string' || !FRESHNESS.has(value)) {
    reject('IMPRINT_VALUE_REJECTED', 'freshness is not a watermark state');
  }
  return value as ImprintFreshnessName;
}

export function parseImprintWatermark(input: unknown): ImprintWatermark {
  const record = readRecord(input, 'watermark');
  return {
    ...readScope(record),
    ...readCursorIdentity(record),
    watermark: readWatermarkText(record.watermark),
    freshness: readFreshness(record.freshness),
  };
}

export type ImprintConflict = {
  tenantId: string;
  outletId: string;
  factPath: RegisteredFactPath;
  existingClaimId: string;
  existingFingerprint: string;
  rejectedFingerprint: string;
};

export function parseImprintConflict(input: unknown): ImprintConflict {
  const record = readRecord(input, 'conflict');
  const factPath = requireRegisteredPath(record.factPath);
  const existingClaimId = uuidSchema.safeParse(record.existingClaimId);
  if (!existingClaimId.success) {
    reject('IMPRINT_VALUE_REJECTED', 'conflict names the existing claim');
  }
  if (
    typeof record.existingFingerprint !== 'string' ||
    typeof record.rejectedFingerprint !== 'string' ||
    !FINGERPRINT.test(record.existingFingerprint) ||
    !FINGERPRINT.test(record.rejectedFingerprint)
  ) {
    reject('IMPRINT_VALUE_REJECTED', 'conflict fingerprints must be minimized hashes');
  }
  if (record.existingFingerprint === record.rejectedFingerprint) {
    reject('IMPRINT_VALUE_REJECTED', 'a conflict records two different values');
  }
  if ('canonicalValue' in record || 'value' in record) {
    reject('IMPRINT_VALUE_REJECTED', 'a conflict record does not copy fact values');
  }
  return {
    ...readScope(record),
    factPath,
    existingClaimId: existingClaimId.data,
    existingFingerprint: record.existingFingerprint,
    rejectedFingerprint: record.rejectedFingerprint,
  };
}

export type ImprintResolvedField = ImprintSnapshotField;

export type ImprintResolverClaim = {
  tenantId: string;
  outletId: string;
  factPath: RegisteredFactPath;
  claimId: string;
  origin: ImprintClaimOriginName;
  canonicalValue: string;
};

function assertResolverScope(
  scope: { tenantId: string; outletId: string },
  factPath: RegisteredFactPath,
  claims: readonly ImprintResolverClaim[],
): void {
  for (const claim of claims) {
    if (claim.tenantId !== scope.tenantId || claim.outletId !== scope.outletId) {
      reject('IMPRINT_TENANT_SCOPE', 'a resolver cannot read another tenant or outlet');
    }
    if (claim.factPath !== factPath) {
      reject('IMPRINT_PATH_UNREGISTERED', 'a resolver claim uses a different fact path');
    }
  }
}

function highestRankClaims(
  entry: FactPathDefinition,
  claims: readonly ImprintResolverClaim[],
): ImprintResolverClaim[] {
  let bestRank = 0;
  const ranked: ImprintResolverClaim[] = [];
  for (const claim of claims) {
    if (!entry.allowedOrigins.includes(claim.origin)) {
      reject('IMPRINT_ORIGIN_REJECTED', 'claim origin is not allowed for this fact path');
    }
    const rank = ORIGIN_RANK[claim.origin];
    if (rank > bestRank) {
      bestRank = rank;
      ranked.length = 0;
    }
    if (rank === bestRank) ranked.push(claim);
  }
  return ranked;
}

function claimIdOrder(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function resolveImprintField(input: {
  tenantId: string;
  outletId: string;
  factPath: RegisteredFactPath;
  claims: readonly ImprintResolverClaim[];
}): ImprintResolvedField {
  const scope = readScope(input);
  const factPath = requireRegisteredPath(input.factPath);
  assertResolverScope(scope, factPath, input.claims);
  const entry = FACT_PATH_REGISTRY[factPath];
  if (entry.stage1 !== 'SOURCE_CONTRACT' || input.claims.length === 0) {
    return blankSnapshotField(factPath, ImprintFieldState.Unknown);
  }
  const ranked = highestRankClaims(entry, input.claims);
  for (const claim of ranked) decodeImprintValue(factPath, claim.canonicalValue);
  const distinct = new Set(ranked.map((claim) => claim.canonicalValue));
  if (distinct.size !== 1) {
    return blankSnapshotField(factPath, ImprintFieldState.Conflict);
  }
  const winner = [...ranked].sort((left, right) => claimIdOrder(left.claimId, right.claimId))[0];
  if (!winner) return blankSnapshotField(factPath, ImprintFieldState.Unknown);
  return {
    factPath,
    fieldState: ImprintFieldState.Known,
    claimId: winner.claimId,
    origin: winner.origin,
    value: decodeImprintValue(factPath, winner.canonicalValue),
    canonicalValue: winner.canonicalValue,
    sourceAuthoritative: entry.authoritativeOrigins.includes(winner.origin),
    resolverVersion: entry.resolverVersion,
  };
}
