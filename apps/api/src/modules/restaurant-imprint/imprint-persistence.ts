import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ImprintPersistenceError } from './errors.js';
import {
  assertAssertionShape,
  assertCursorShape,
  assertSnapshotField,
  imprintPayloadFingerprint,
  imprintRebuildInputHash,
  type AssertionInput,
  type CursorInput,
  type ImprintFieldState,
  type RebuildField,
  type SnapshotFieldInput,
} from './imprint-rules.js';

export type AppendOutcome =
  | { outcome: 'INSERTED'; claimId: string }
  | { outcome: 'DUPLICATE'; claimId: string }
  | { outcome: 'CONFLICT'; claimId: string; conflictId: string };

export type StoredClaim = {
  claimId: string;
  tenantId: string;
  outletId: string;
  canonicalValue: string | null;
  payloadFingerprint: string;
  claimEffect: 'ASSERTION' | 'INVALIDATION';
};

export type SnapshotHead = {
  revisionId: string;
  revisionNumber: string;
  freshness: 'FRESH' | 'STALE' | 'DEGRADED';
  rebuildInputHash: string;
};

type PgError = { code?: string; constraint?: string; message?: string };

function asPgError(err: unknown): PgError | null {
  if (typeof err === 'object' && err !== null && 'code' in err) return err as PgError;
  return null;
}

function rethrowImprint(err: unknown): never {
  const pgError = asPgError(err);
  const message = pgError?.message ?? '';
  if (message.includes('IMPRINT_OUTLET_TENANT_MISMATCH')) {
    throw new ImprintPersistenceError(
      'IMPRINT_OUTLET_TENANT_MISMATCH',
      'outlet does not belong to the tenant',
    );
  }
  if (message.includes('IMPRINT_SUPERSEDE_TARGET') || message.includes('IMPRINT_INVALIDATION_TARGET')) {
    throw new ImprintPersistenceError('IMPRINT_LINEAGE_REJECTED', 'lineage target is not an assertion in this outlet');
  }
  if (message.includes('IMPRINT_IMMUTABLE')) {
    throw new ImprintPersistenceError('IMPRINT_IMMUTABLE', 'imprint history cannot be updated or deleted');
  }
  throw err;
}

async function lockOutlet(client: pg.PoolClient, tenantId: string, outletId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `imprint:${tenantId}:${outletId}`,
  ]);
}

type ExistingAssertion = {
  claim_id: string;
  payload_fingerprint: string;
};

export class ImprintPersistence {
  constructor(private readonly pool: pg.Pool) {}

  async appendAssertion(input: AssertionInput): Promise<AppendOutcome> {
    assertAssertionShape(input);
    return this.transaction(input.tenantId, input.outletId, (client) =>
      this.insertAssertion(client, input),
    );
  }

  async invalidateAssertion(input: {
    tenantId: string;
    outletId: string;
    claimId: string;
    sourceModule: string;
    sourceRevision: string;
  }): Promise<{ claimId: string; outcome: 'INSERTED' | 'DUPLICATE' }> {
    assertCursorShape({
      tenantId: input.tenantId,
      outletId: input.outletId,
      sourceModule: input.sourceModule,
      cursorName: 'invalidation',
      watermark: input.sourceRevision,
    });
    return this.transaction(input.tenantId, input.outletId, async (client) => {
      const prior = await this.readAssertion(client, input.tenantId, input.outletId, input.claimId);
      const existing = await client.query<{ claim_id: string }>(
        `SELECT claim_id FROM imprint_claim
         WHERE invalidates_claim_id = $1 AND claim_effect = 'INVALIDATION'`,
        [input.claimId],
      );
      if (existing.rows[0]) return { claimId: existing.rows[0].claim_id, outcome: 'DUPLICATE' as const };
      const claimId = randomUUID();
      try {
        await client.query(
          `INSERT INTO imprint_claim (
             claim_id, tenant_id, outlet_id, origin, claim_effect, fact_path,
             sensitivity_class, retention_policy, source_module, source_entity_type,
             source_entity_id, source_revision, payload_fingerprint, invalidates_claim_id
           )
           SELECT $1, tenant_id, outlet_id, origin, 'INVALIDATION', fact_path,
                  sensitivity_class, retention_policy, $2, source_entity_type,
                  source_entity_id, $3, payload_fingerprint, claim_id
           FROM imprint_claim
           WHERE claim_id = $4`,
          [claimId, input.sourceModule, input.sourceRevision, prior.claimId],
        );
      } catch (err) {
        rethrowImprint(err);
      }
      return { claimId, outcome: 'INSERTED' as const };
    });
  }

  async commitCheckpoint(input: CursorInput & { assertions: readonly AssertionInput[] }): Promise<{
    outcomes: AppendOutcome[];
    watermark: string;
  }> {
    assertCursorShape(input);
    for (const assertion of input.assertions) {
      if (
        assertion.tenantId !== input.tenantId ||
        assertion.outletId !== input.outletId ||
        assertion.sourceModule !== input.sourceModule
      ) {
        throw new ImprintPersistenceError(
          'IMPRINT_OUTLET_TENANT_MISMATCH',
          'checkpoint assertions must use the cursor tenant, outlet, and source',
        );
      }
      assertAssertionShape(assertion);
    }
    return this.transaction(input.tenantId, input.outletId, async (client) => {
      const outcomes: AppendOutcome[] = [];
      for (const assertion of input.assertions) {
        outcomes.push(await this.insertAssertion(client, assertion));
      }
      await client.query(
        `INSERT INTO imprint_ingest_cursor (
           tenant_id, outlet_id, source_module, cursor_name, watermark, advanced_at
         ) VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (tenant_id, outlet_id, source_module, cursor_name)
         DO UPDATE SET watermark = EXCLUDED.watermark, advanced_at = NOW()
         WHERE imprint_ingest_cursor.watermark IS DISTINCT FROM EXCLUDED.watermark`,
        [input.tenantId, input.outletId, input.sourceModule, input.cursorName, input.watermark],
      );
      return { outcomes, watermark: input.watermark };
    });
  }

  async publishRevision(input: {
    tenantId: string;
    outletId: string;
    resolverVersion: string;
    fields: readonly SnapshotFieldInput[];
  }): Promise<SnapshotHead> {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(input.resolverVersion)) {
      throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'resolver version is not a stable token');
    }
    const paths = new Set<string>();
    for (const field of input.fields) {
      assertSnapshotField(field);
      if (paths.has(field.factPath)) {
        throw new ImprintPersistenceError('IMPRINT_FIELD_REJECTED', 'a snapshot has one row per fact path');
      }
      paths.add(field.factPath);
    }
    return this.transaction(input.tenantId, input.outletId, async (client) => {
      const cursors = await client.query<{
        source_module: string;
        cursor_name: string;
        watermark: string;
      }>(
        `SELECT source_module, cursor_name, watermark
         FROM imprint_ingest_cursor
         WHERE tenant_id = $1 AND outlet_id = $2`,
        [input.tenantId, input.outletId],
      );
      const storedFields: RebuildField[] = [];
      for (const field of input.fields) {
        storedFields.push(await this.resolveField(client, input.tenantId, input.outletId, field));
      }
      const rebuildInputHash = imprintRebuildInputHash({
        resolverVersion: input.resolverVersion,
        cursors: cursors.rows.map((row) => ({
          sourceModule: row.source_module,
          cursorName: row.cursor_name,
          watermark: row.watermark,
        })),
        fields: storedFields,
      });
      const revisionNumber = await client.query<{ n: string }>(
        `SELECT (COALESCE(MAX(revision_number), 0) + 1)::text AS n
         FROM imprint_projection_revision
         WHERE tenant_id = $1 AND outlet_id = $2`,
        [input.tenantId, input.outletId],
      );
      const revisionId = randomUUID();
      const number = revisionNumber.rows[0]?.n ?? '1';
      await client.query(
        `INSERT INTO imprint_projection_revision (
           revision_id, tenant_id, outlet_id, revision_number, resolver_version,
           rebuild_input_hash, published_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [revisionId, input.tenantId, input.outletId, number, input.resolverVersion, rebuildInputHash],
      );
      for (const field of storedFields) {
        await client.query(
          `INSERT INTO imprint_snapshot_field (
             revision_id, fact_path, field_state, claim_id, canonical_value
           ) VALUES ($1, $2, $3, $4, $5)`,
          [revisionId, field.factPath, field.fieldState, field.claimId, field.canonicalValue],
        );
      }
      await client.query(
        `INSERT INTO imprint_snapshot_head (tenant_id, outlet_id, revision_id, freshness)
         VALUES ($1, $2, $3, 'FRESH')
         ON CONFLICT (tenant_id, outlet_id)
         DO UPDATE SET revision_id = EXCLUDED.revision_id, freshness = 'FRESH'`,
        [input.tenantId, input.outletId, revisionId],
      );
      return {
        revisionId,
        revisionNumber: number,
        freshness: 'FRESH',
        rebuildInputHash,
      };
    });
  }

  async recordSourceFailure(input: {
    tenantId: string;
    outletId: string;
    sourceModule: string;
    errorCode: string;
    freshness: 'STALE' | 'DEGRADED';
  }): Promise<SnapshotHead | null> {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(input.sourceModule)) {
      throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'source module is not a stable identifier');
    }
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(input.errorCode)) {
      throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'error code is not a stable token');
    }
    return this.transaction(input.tenantId, input.outletId, async (client) => {
      await client.query(
        `INSERT INTO imprint_projection_error (
           error_id, tenant_id, outlet_id, source_module, error_code
         ) VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), input.tenantId, input.outletId, input.sourceModule, input.errorCode],
      );
      const updated = await client.query(
        `UPDATE imprint_snapshot_head
         SET freshness = $3
         WHERE tenant_id = $1 AND outlet_id = $2`,
        [input.tenantId, input.outletId, input.freshness],
      );
      if (updated.rowCount !== 1) return null;
      return this.loadHead(client, input.tenantId, input.outletId);
    });
  }

  async readClaim(tenantId: string, outletId: string, claimId: string): Promise<StoredClaim | null> {
    const client = await this.pool.connect();
    try {
      return await this.readStoredClaim(client, tenantId, outletId, claimId);
    } finally {
      client.release();
    }
  }

  async participatingClaimIds(tenantId: string, outletId: string): Promise<string[]> {
    const result = await this.pool.query<{ claim_id: string }>(
      `SELECT c.claim_id
       FROM imprint_claim c
       WHERE c.tenant_id = $1 AND c.outlet_id = $2 AND c.claim_effect = 'ASSERTION'
         AND NOT EXISTS (
           SELECT 1 FROM imprint_claim newer WHERE newer.supersedes_claim_id = c.claim_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM imprint_claim gone
           WHERE gone.invalidates_claim_id = c.claim_id AND gone.claim_effect = 'INVALIDATION'
         )
       ORDER BY c.claim_id`,
      [tenantId, outletId],
    );
    return result.rows.map((row) => row.claim_id);
  }

  async readCursor(
    tenantId: string,
    outletId: string,
    sourceModule: string,
    cursorName: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ watermark: string }>(
      `SELECT watermark FROM imprint_ingest_cursor
       WHERE tenant_id = $1 AND outlet_id = $2 AND source_module = $3 AND cursor_name = $4`,
      [tenantId, outletId, sourceModule, cursorName],
    );
    return result.rows[0]?.watermark ?? null;
  }

  async countClaims(tenantId: string, outletId: string): Promise<number> {
    const result = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM imprint_claim WHERE tenant_id = $1 AND outlet_id = $2`,
      [tenantId, outletId],
    );
    return result.rows[0]?.n ?? 0;
  }

  async countConflicts(tenantId: string, outletId: string): Promise<number> {
    const result = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM imprint_claim_conflict WHERE tenant_id = $1 AND outlet_id = $2`,
      [tenantId, outletId],
    );
    return result.rows[0]?.n ?? 0;
  }

  private async transaction<T>(
    tenantId: string,
    outletId: string,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockOutlet(client, tenantId, outletId);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async insertAssertion(client: pg.PoolClient, input: AssertionInput): Promise<AppendOutcome> {
    const fingerprint = imprintPayloadFingerprint(input.origin, input.factPath, input.canonicalValue);
    const claimId = randomUUID();
    await client.query('SAVEPOINT imprint_claim');
    try {
      await client.query(
        `INSERT INTO imprint_claim (
           claim_id, tenant_id, outlet_id, origin, claim_effect, fact_path,
           sensitivity_class, retention_policy, source_module, source_entity_type,
           source_entity_id, source_revision, payload_fingerprint, canonical_value,
           supersedes_claim_id, observed_at, effective_from, effective_to,
           business_date, business_order
         ) VALUES (
           $1, $2, $3, $4, 'ASSERTION', $5,
           $6, 'OUTLET_LIFETIME', $7, $8,
           $9, $10, $11, $12,
           $13, $14, $15, $16,
           $17, $18
         )`,
        [
          claimId,
          input.tenantId,
          input.outletId,
          input.origin,
          input.factPath,
          input.sensitivityClass,
          input.sourceModule,
          input.sourceEntityType,
          input.sourceEntityId,
          input.sourceRevision,
          fingerprint,
          input.canonicalValue,
          input.supersedesClaimId ?? null,
          input.observedAt ?? null,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          input.businessDate ?? null,
          input.businessOrder ?? null,
        ],
      );
      await client.query('RELEASE SAVEPOINT imprint_claim');
      return { outcome: 'INSERTED', claimId };
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT imprint_claim');
      const pgError = asPgError(err);
      if (pgError?.code === '23505' && pgError.constraint === 'imprint_claim_assertion_identity_uq') {
        const existing = await this.findIdentity(client, input);
        if (!existing) throw err;
        if (existing.payload_fingerprint === fingerprint) {
          return { outcome: 'DUPLICATE', claimId: existing.claim_id };
        }
        const conflictId = await this.insertConflict(client, input, existing, fingerprint);
        return { outcome: 'CONFLICT', claimId: existing.claim_id, conflictId };
      }
      if (pgError?.code === '23505' && pgError.constraint === 'imprint_claim_supersede_uq') {
        const successor = await client.query<ExistingAssertion>(
          `SELECT claim_id, payload_fingerprint FROM imprint_claim WHERE supersedes_claim_id = $1`,
          [input.supersedesClaimId],
        );
        const row = successor.rows[0];
        if (!row) throw err;
        const conflictId = await this.insertConflict(client, input, row, fingerprint);
        return { outcome: 'CONFLICT', claimId: row.claim_id, conflictId };
      }
      rethrowImprint(err);
    }
  }

  private async findIdentity(
    client: pg.PoolClient,
    input: AssertionInput,
  ): Promise<ExistingAssertion | null> {
    const found = await client.query<ExistingAssertion>(
      `SELECT claim_id, payload_fingerprint
       FROM imprint_claim
       WHERE tenant_id = $1 AND outlet_id = $2 AND source_module = $3
         AND source_entity_type = $4 AND source_entity_id = $5
         AND source_revision = $6 AND fact_path = $7 AND claim_effect = 'ASSERTION'`,
      [
        input.tenantId,
        input.outletId,
        input.sourceModule,
        input.sourceEntityType,
        input.sourceEntityId,
        input.sourceRevision,
        input.factPath,
      ],
    );
    return found.rows[0] ?? null;
  }

  private async insertConflict(
    client: pg.PoolClient,
    input: AssertionInput,
    existing: ExistingAssertion,
    rejectedFingerprint: string,
  ): Promise<string> {
    const already = await client.query<{ conflict_id: string }>(
      `SELECT conflict_id FROM imprint_claim_conflict
       WHERE tenant_id = $1 AND outlet_id = $2 AND existing_claim_id = $3
         AND rejected_fingerprint = $4`,
      [input.tenantId, input.outletId, existing.claim_id, rejectedFingerprint],
    );
    if (already.rows[0]) return already.rows[0].conflict_id;
    const conflictId = randomUUID();
    await client.query(
      `INSERT INTO imprint_claim_conflict (
         conflict_id, tenant_id, outlet_id, existing_claim_id, fact_path,
         source_module, source_entity_type, source_entity_id, source_revision,
         existing_fingerprint, rejected_fingerprint
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        conflictId,
        input.tenantId,
        input.outletId,
        existing.claim_id,
        input.factPath,
        input.sourceModule,
        input.sourceEntityType,
        input.sourceEntityId,
        input.sourceRevision,
        existing.payload_fingerprint,
        rejectedFingerprint,
      ],
    );
    return conflictId;
  }

  private async readAssertion(
    client: pg.PoolClient,
    tenantId: string,
    outletId: string,
    claimId: string,
  ): Promise<StoredClaim> {
    const claim = await this.readStoredClaim(client, tenantId, outletId, claimId);
    if (!claim || claim.claimEffect !== 'ASSERTION') {
      throw new ImprintPersistenceError('IMPRINT_CLAIM_ABSENT', 'assertion is not in this outlet');
    }
    return claim;
  }

  private async readStoredClaim(
    client: pg.PoolClient,
    tenantId: string,
    outletId: string,
    claimId: string,
  ): Promise<StoredClaim | null> {
    const result = await client.query<{
      claim_id: string;
      tenant_id: string;
      outlet_id: string;
      canonical_value: string | null;
      payload_fingerprint: string;
      claim_effect: 'ASSERTION' | 'INVALIDATION';
    }>(
      `SELECT claim_id, tenant_id, outlet_id, canonical_value, payload_fingerprint, claim_effect
       FROM imprint_claim
       WHERE claim_id = $1 AND tenant_id = $2 AND outlet_id = $3`,
      [claimId, tenantId, outletId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      claimId: row.claim_id,
      tenantId: row.tenant_id,
      outletId: row.outlet_id,
      canonicalValue: row.canonical_value,
      payloadFingerprint: row.payload_fingerprint,
      claimEffect: row.claim_effect,
    };
  }

  private async resolveField(
    client: pg.PoolClient,
    tenantId: string,
    outletId: string,
    field: SnapshotFieldInput,
  ): Promise<RebuildField> {
    if (field.fieldState !== 'KNOWN') {
      return {
        factPath: field.factPath,
        fieldState: field.fieldState,
        claimId: null,
        canonicalValue: null,
      };
    }
    const participating = await client.query<{ canonical_value: string }>(
      `SELECT c.canonical_value
       FROM imprint_claim c
       WHERE c.claim_id = $1 AND c.tenant_id = $2 AND c.outlet_id = $3
         AND c.fact_path = $4 AND c.claim_effect = 'ASSERTION'
         AND NOT EXISTS (
           SELECT 1 FROM imprint_claim newer WHERE newer.supersedes_claim_id = c.claim_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM imprint_claim gone
           WHERE gone.invalidates_claim_id = c.claim_id AND gone.claim_effect = 'INVALIDATION'
         )`,
      [field.claimId, tenantId, outletId, field.factPath],
    );
    const value = participating.rows[0]?.canonical_value;
    if (!value) {
      throw new ImprintPersistenceError(
        'IMPRINT_FIELD_REJECTED',
        'a known field must name a participating claim on that path',
      );
    }
    return {
      factPath: field.factPath,
      fieldState: 'KNOWN' satisfies ImprintFieldState,
      claimId: field.claimId ?? null,
      canonicalValue: value,
    };
  }

  private async loadHead(
    client: pg.PoolClient,
    tenantId: string,
    outletId: string,
  ): Promise<SnapshotHead | null> {
    const result = await client.query<{
      revision_id: string;
      revision_number: string;
      freshness: 'FRESH' | 'STALE' | 'DEGRADED';
      rebuild_input_hash: string;
    }>(
      `SELECT h.revision_id, r.revision_number::text, h.freshness, r.rebuild_input_hash
       FROM imprint_snapshot_head h
       JOIN imprint_projection_revision r ON r.revision_id = h.revision_id
       WHERE h.tenant_id = $1 AND h.outlet_id = $2`,
      [tenantId, outletId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      revisionId: row.revision_id,
      revisionNumber: row.revision_number,
      freshness: row.freshness,
      rebuildInputHash: row.rebuild_input_hash,
    };
  }
}
