import type pg from 'pg';
import {
  FACT_PATH_REGISTRY,
  IMPRINT_RESOLVER_VERSION,
  ImprintContractError,
  isRegisteredFactPath,
  parseImprintAssertion,
  parseImprintInvalidation,
  parseImprintWatermark,
  resolveImprintField,
  type ImprintAssertion,
  type ImprintClaimOriginName,
  type ImprintResolvedField,
} from '@millq/contracts';
import type { AuthenticatedPrincipal } from '../identity/identity-service.js';
import { ImprintPersistenceError, ImprintServiceError } from './errors.js';
import { ImprintPersistence, type AppendOutcome, type StoredClaim } from './imprint-persistence.js';
import type { AssertionInput } from './imprint-rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function message(code: string): string {
  switch (code) {
    case 'IMPRINT_PATH_UNREGISTERED':
      return 'fact path is not in the imprint registry';
    case 'IMPRINT_VALUE_REJECTED':
      return 'fact value does not match the registered schema';
    case 'IMPRINT_ORIGIN_REJECTED':
      return 'claim origin or source is not allowed for this fact path';
    case 'IMPRINT_PROVENANCE_REJECTED':
      return 'provenance is required for this fact path';
    case 'IMPRINT_SENSITIVITY_REJECTED':
      return 'sensitivity class does not match the registry';
    case 'IMPRINT_PATH_UNAVAILABLE':
      return 'fact path has no source read contract and stays UNKNOWN';
    case 'IMPRINT_SCOPE_DENIED':
      return 'outlet is outside the caller tenant';
    case 'IMPRINT_LIFECYCLE_REJECTED':
      return 'claim lifecycle target is not an assertion in this outlet';
    default:
      return 'imprint write rolled back';
  }
}

/**
 * Sealed server authority for internal Imprint source adapters (ADR-0054 R2).
 * It is not a user, grant, or OfficeSession. Request JSON cannot construct it.
 * Exact grant names remain deferred to I-07 and are not invented here.
 */
export class ImprintInternalAuthority {
  private constructor(readonly kind: 'ORGANIZATION_ADAPTER') {}

  static forOrganizationAdapter(): ImprintInternalAuthority {
    return new ImprintInternalAuthority('ORGANIZATION_ADAPTER');
  }
}

/**
 * Internal Restaurant Imprint claim service (ADR-0054 I-04 / I-05).
 * Claim payloads are validated by the I-03 registry before I-02 persistence.
 */
export class ImprintScope {
  private constructor(
    readonly tenantId: string,
    readonly outletId: string,
    readonly authority: 'PRINCIPAL' | 'INTERNAL',
  ) {}

  /**
   * Principal-bound scope for future HTTP. Outlet membership is required.
   * AccessGrant keys for Imprint read remain a deferred I-07 decision.
   */
  static async open(
    pool: pg.Pool,
    principal: AuthenticatedPrincipal,
    outletId: string,
  ): Promise<ImprintScope> {
    if (
      (principal.channel !== 'TERMINAL' && principal.channel !== 'MOBILE') ||
      !UUID.test(principal.tenantId) ||
      !UUID.test(outletId)
    ) {
      throw new ImprintServiceError('IMPRINT_SCOPE_DENIED', message('IMPRINT_SCOPE_DENIED'));
    }
    await assertOutletTenant(pool, principal.tenantId, outletId);
    return new ImprintScope(principal.tenantId, outletId, 'PRINCIPAL');
  }

  /**
   * Server-only ingest scope for source adapters. Default-deny without a sealed authority
   * and without a matching organization outlet row. Outlet membership is not a grant.
   */
  static async openInternal(
    pool: pg.Pool,
    authority: ImprintInternalAuthority,
    tenantId: string,
    outletId: string,
  ): Promise<ImprintScope> {
    if (!(authority instanceof ImprintInternalAuthority) || authority.kind !== 'ORGANIZATION_ADAPTER') {
      throw new ImprintServiceError('IMPRINT_SCOPE_DENIED', message('IMPRINT_SCOPE_DENIED'));
    }
    if (!UUID.test(tenantId) || !UUID.test(outletId)) {
      throw new ImprintServiceError('IMPRINT_SCOPE_DENIED', message('IMPRINT_SCOPE_DENIED'));
    }
    await assertOutletTenant(pool, tenantId, outletId);
    return new ImprintScope(tenantId, outletId, 'INTERNAL');
  }
}

async function assertOutletTenant(pool: pg.Pool, tenantId: string, outletId: string): Promise<void> {
  const found = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM outlet WHERE outlet_id = $1 AND tenant_id = $2`,
    [outletId, tenantId],
  );
  if (!found.rows[0]) {
    throw new ImprintServiceError('IMPRINT_SCOPE_DENIED', message('IMPRINT_SCOPE_DENIED'));
  }
}

export class ImprintClaimService {
  private readonly persistence: ImprintPersistence;

  constructor(private readonly pool: pg.Pool) {
    this.persistence = new ImprintPersistence(pool);
  }

  async appendAssertion(scope: ImprintScope, input: unknown): Promise<AppendOutcome> {
    const parsed = parseAssertion(input);
    assertPayloadScope(scope, parsed.tenantId, parsed.outletId);
    if (parsed.supersedesClaimId) {
      await this.requireMatchingTarget(
        scope,
        parsed.supersedesClaimId,
        parsed.factPath,
        parsed.provenance.sourceModule,
      );
    }
    return this.write(() => this.persistence.appendAssertion(toAssertionInput(parsed)));
  }

  async supersedeAssertion(scope: ImprintScope, input: unknown): Promise<AppendOutcome> {
    const parsed = parseAssertion(input);
    if (!parsed.supersedesClaimId) {
      throw new ImprintServiceError(
        'IMPRINT_LIFECYCLE_REJECTED',
        message('IMPRINT_LIFECYCLE_REJECTED')
      );
    }
    return this.appendAssertion(scope, input);
  }

  async invalidateAssertion(
    scope: ImprintScope,
    input: unknown,
  ): Promise<{ claimId: string; outcome: 'INSERTED' | 'DUPLICATE' }> {
    const parsed = parseInvalidation(input);
    assertPayloadScope(scope, parsed.tenantId, parsed.outletId);
    await this.requireMatchingTarget(
      scope,
      parsed.invalidatesClaimId,
      parsed.factPath,
      parsed.provenance.sourceModule,
    );
    return this.write(() =>
      this.persistence.invalidateAssertion({
        tenantId: scope.tenantId,
        outletId: scope.outletId,
        claimId: parsed.invalidatesClaimId,
        sourceModule: parsed.provenance.sourceModule,
        sourceRevision: parsed.provenance.sourceRevision,
      }),
    );
  }

  async commitCheckpoint(
    scope: ImprintScope,
    input: unknown,
  ): Promise<{ outcomes: AppendOutcome[]; watermark: string }> {
    const parsed = parseCheckpoint(scope, input);
    for (const assertion of parsed.assertions) {
      if (assertion.supersedesClaimId) {
        await this.requireMatchingTarget(
          scope,
          assertion.supersedesClaimId,
          assertion.factPath,
          assertion.sourceModule,
        );
      }
    }
    return this.write(() =>
      this.persistence.commitCheckpoint({
        tenantId: scope.tenantId,
        outletId: scope.outletId,
        sourceModule: parsed.sourceModule,
        cursorName: parsed.cursorName,
        watermark: parsed.watermark,
        assertions: parsed.assertions,
      }),
    );
  }

  async readClaim(
    scope: ImprintScope,
    claimId: string,
  ): Promise<(StoredClaim & { active: boolean }) | null> {
    if (!UUID.test(claimId)) return null;
    const claim = await this.persistence.readClaim(scope.tenantId, scope.outletId, claimId);
    if (!claim) return null;
    const active = await this.persistence.participatingClaimIds(scope.tenantId, scope.outletId);
    return { ...claim, active: active.includes(claim.claimId) };
  }

  async resolveField(scope: ImprintScope, factPath: string): Promise<ImprintResolvedField> {
    if (!isRegisteredFactPath(factPath) || !(factPath in FACT_PATH_REGISTRY)) {
      throw new ImprintServiceError(
        'IMPRINT_PATH_UNREGISTERED',
        message('IMPRINT_PATH_UNREGISTERED')
      );
    }
    if (FACT_PATH_REGISTRY[factPath].resolverVersion !== IMPRINT_RESOLVER_VERSION) {
      throw new ImprintServiceError(
        'IMPRINT_VALUE_REJECTED',
        message('IMPRINT_VALUE_REJECTED')
      );
    }
    const rows = await this.persistence.readParticipatingClaims(scope.tenantId, scope.outletId);
    const claims = rows
      .filter((row) => row.factPath === factPath)
      .map((row) => ({
        tenantId: scope.tenantId,
        outletId: scope.outletId,
        factPath,
        claimId: row.claimId,
        origin: row.origin as ImprintClaimOriginName,
        canonicalValue: row.canonicalValue,
      }));
    try {
      return resolveImprintField({
        tenantId: scope.tenantId,
        outletId: scope.outletId,
        factPath,
        claims,
      });
    } catch (err) {
      throw toImprintServiceError(err);
    }
  }

  private async requireMatchingTarget(
    scope: ImprintScope,
    claimId: string,
    factPath: string,
    sourceModule: string,
  ): Promise<void> {
    const claim = await this.persistence.readClaim(scope.tenantId, scope.outletId, claimId);
    if (
      !claim ||
      claim.claimEffect !== 'ASSERTION' ||
      claim.factPath !== factPath ||
      claim.sourceModule !== sourceModule
    ) {
      throw new ImprintServiceError(
        'IMPRINT_LIFECYCLE_REJECTED',
        message('IMPRINT_LIFECYCLE_REJECTED'),
      );
    }
    const active = await this.persistence.participatingClaimIds(scope.tenantId, scope.outletId);
    if (!active.includes(claimId)) {
      throw new ImprintServiceError(
        'IMPRINT_LIFECYCLE_REJECTED',
        message('IMPRINT_LIFECYCLE_REJECTED'),
      );
    }
  }

  async recordSourceFailure(
    scope: ImprintScope,
    input: { sourceModule: string; errorCode: string; freshness: 'STALE' | 'DEGRADED' },
  ): Promise<void> {
    await this.write(() =>
      this.persistence.recordSourceFailure({
        tenantId: scope.tenantId,
        outletId: scope.outletId,
        sourceModule: input.sourceModule,
        errorCode: input.errorCode,
        freshness: input.freshness,
      }),
    );
  }

  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      throw toImprintServiceError(err);
    }
  }
}

function assertPayloadScope(scope: ImprintScope, tenantId: string, outletId: string): void {
  if (tenantId !== scope.tenantId || outletId !== scope.outletId) {
    throw new ImprintServiceError('IMPRINT_SCOPE_DENIED', message('IMPRINT_SCOPE_DENIED'));
  }
}

function parseAssertion(input: unknown): ImprintAssertion {
  try {
    return parseImprintAssertion(input);
  } catch (err) {
    throw toImprintServiceError(err);
  }
}

function parseInvalidation(input: unknown) {
  try {
    return parseImprintInvalidation(input);
  } catch (err) {
    throw toImprintServiceError(err);
  }
}

function parseCheckpoint(scope: ImprintScope, input: unknown): {
  sourceModule: string;
  cursorName: string;
  watermark: string;
  assertions: AssertionInput[];
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ImprintServiceError('IMPRINT_VALUE_REJECTED', message('IMPRINT_VALUE_REJECTED'));
  }
  const record = input as Record<string, unknown>;
  let watermark;
  try {
    watermark = parseImprintWatermark({
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      sourceModule: record.sourceModule,
      cursorName: record.cursorName,
      watermark: record.watermark,
      freshness: 'FRESH',
    });
  } catch (err) {
    throw toImprintServiceError(err);
  }
  if (!Array.isArray(record.assertions)) {
    throw new ImprintServiceError('IMPRINT_VALUE_REJECTED', message('IMPRINT_VALUE_REJECTED'));
  }
  const assertions = record.assertions.map((item) => {
    const parsed = parseAssertion(item);
    assertPayloadScope(scope, parsed.tenantId, parsed.outletId);
    if (parsed.provenance.sourceModule !== watermark.sourceModule) {
      throw new ImprintServiceError('IMPRINT_ORIGIN_REJECTED', message('IMPRINT_ORIGIN_REJECTED'));
    }
    return toAssertionInput(parsed);
  });
  return {
    sourceModule: watermark.sourceModule,
    cursorName: watermark.cursorName,
    watermark: watermark.watermark,
    assertions,
  };
}

function toAssertionInput(parsed: ImprintAssertion): AssertionInput {
  return {
    tenantId: parsed.tenantId,
    outletId: parsed.outletId,
    origin: parsed.origin,
    factPath: parsed.factPath,
    sensitivityClass: parsed.sensitivityClass,
    sourceModule: parsed.provenance.sourceModule,
    sourceEntityType: parsed.provenance.sourceEntityType,
    sourceEntityId: parsed.provenance.sourceEntityId,
    sourceRevision: parsed.provenance.sourceRevision,
    canonicalValue: parsed.canonicalValue,
    supersedesClaimId: parsed.supersedesClaimId,
    observedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    businessDate: null,
    businessOrder: null,
  };
}

export function toImprintServiceError(err: unknown): ImprintServiceError {
  if (err instanceof ImprintServiceError) return err;
  if (err instanceof ImprintContractError) {
    const code = contractCode(err.code);
    return new ImprintServiceError(code, message(code));
  }
  if (err instanceof ImprintPersistenceError) {
    const code = persistenceCode(err.code);
    return new ImprintServiceError(code, message(code));
  }
  return new ImprintServiceError(
    'IMPRINT_TRANSACTION_ROLLED_BACK',
    message('IMPRINT_TRANSACTION_ROLLED_BACK')
  );
}

function contractCode(code: string): string {
  if (code === 'IMPRINT_UNKNOWN_VALUE') return 'IMPRINT_VALUE_REJECTED';
  if (code === 'IMPRINT_SENSITIVITY_REJECTED') return 'IMPRINT_SENSITIVITY_REJECTED';
  if (code === 'IMPRINT_VERIFICATION_REJECTED' || code === 'IMPRINT_TENANT_SCOPE') {
    return code === 'IMPRINT_TENANT_SCOPE' ? 'IMPRINT_SCOPE_DENIED' : 'IMPRINT_ORIGIN_REJECTED';
  }
  if (message(code) !== 'imprint write rolled back' || code === 'IMPRINT_TRANSACTION_ROLLED_BACK') {
    return code;
  }
  return 'IMPRINT_VALUE_REJECTED';
}

function persistenceCode(code: string): string {
  if (code === 'IMPRINT_LINEAGE_REJECTED' || code === 'IMPRINT_CLAIM_ABSENT') {
    return 'IMPRINT_LIFECYCLE_REJECTED';
  }
  if (code === 'IMPRINT_OUTLET_TENANT_MISMATCH') return 'IMPRINT_SCOPE_DENIED';
  if (message(code) !== 'imprint write rolled back' || code === 'IMPRINT_TRANSACTION_ROLLED_BACK') {
    return code;
  }
  return 'IMPRINT_TRANSACTION_ROLLED_BACK';
}

