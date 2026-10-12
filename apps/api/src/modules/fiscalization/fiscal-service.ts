/**
 * FISC1.1 Fiscalization Core — policy, document, submission, gate (ADR-0014 / ADR-0038).
 * Consumes PaymentCollectionEvent + frozen TaxOrderSnapshot. Never recalculates Tax.
 * Never invents fiscal provider confirmation or LEGAL GATE G2.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DomainValidationError, NotFoundError } from '../orders/errors.js';
import type { FiscalCheckoutGate, FiscalCheckoutGateStatus } from '../settlement/settlement-ports.js';
import {
  unavailableFiscalProviderAdapter,
  type FiscalProviderAdapter,
} from './fiscal-provider-adapter.js';
import {
  defaultC0SatisfactionProfile,
  evidenceSatisfiesProfile,
  parseSatisfactionEvidenceProfile,
  type FiscalSatisfactionEvidenceProfile,
} from './fiscal-satisfaction-profile.js';

type Queryable = Pool | PoolClient;

export type FiscalPolicyVersionProjection = {
  fiscalPolicyId: string;
  fiscalPolicyVersionId: string;
  tenantId: string;
  legalEntityId: string;
  policyCode: string;
  policyVersion: number;
  fiscalDocumentRequired: boolean;
  satisfactionEvidenceProfile: FiscalSatisfactionEvidenceProfile;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type FiscalDocumentProjection = {
  fiscalDocumentId: string;
  settlementGroupId: string;
  settlementCheckId: string;
  orderId: string;
  paymentId: string;
  paymentCollectionEventId: string;
  taxOrderSnapshotId: string;
  fiscalPolicyId: string;
  fiscalPolicyVersionId: string;
  status: string;
  collectionBusinessTime: string;
  documentAmountMinor: string;
  currencyCode: string;
  issueIdempotencyKey: string;
};

type PolicyVersionRow = {
  fiscal_policy_version_id: string;
  fiscal_policy_id: string;
  tenant_id: string;
  legal_entity_id: string;
  policy_code: string;
  policy_version: number;
  fiscal_document_required: boolean;
  satisfaction_evidence_profile: unknown;
  effective_from: Date;
  effective_to: Date | null;
};

type DocRow = {
  fiscal_document_id: string;
  settlement_group_id: string;
  settlement_check_id: string;
  order_id: string;
  payment_id: string;
  payment_collection_event_id: string;
  tax_order_snapshot_id: string;
  fiscal_policy_id: string;
  fiscal_policy_version_id: string;
  status: string;
  collection_business_time: Date;
  document_amount_minor: string;
  currency_code: string;
  issue_idempotency_key: string;
};

function mapDoc(r: DocRow): FiscalDocumentProjection {
  return {
    fiscalDocumentId: r.fiscal_document_id,
    settlementGroupId: r.settlement_group_id,
    settlementCheckId: r.settlement_check_id,
    orderId: r.order_id,
    paymentId: r.payment_id,
    paymentCollectionEventId: r.payment_collection_event_id,
    taxOrderSnapshotId: r.tax_order_snapshot_id,
    fiscalPolicyId: r.fiscal_policy_id,
    fiscalPolicyVersionId: r.fiscal_policy_version_id,
    status: r.status,
    collectionBusinessTime: r.collection_business_time.toISOString(),
    documentAmountMinor: r.document_amount_minor,
    currencyCode: r.currency_code,
    issueIdempotencyKey: r.issue_idempotency_key,
  };
}

export type FiscalServiceDeps = {
  adapter?: FiscalProviderAdapter;
};

export class FiscalService {
  private readonly adapter: FiscalProviderAdapter;

  constructor(
    private readonly pool: Pool,
    deps: FiscalServiceDeps = {},
  ) {
    this.adapter = deps.adapter ?? unavailableFiscalProviderAdapter();
  }

  withAdapter(adapter: FiscalProviderAdapter): FiscalService {
    return new FiscalService(this.pool, { adapter });
  }

  async createFiscalPolicy(input: {
    tenantId: string;
    legalEntityId: string;
    jurisdictionCode: string;
    policyCode: string;
  }): Promise<{ fiscalPolicyId: string }> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO fiscal_policy (
         fiscal_policy_id, tenant_id, legal_entity_id, jurisdiction_code, policy_code
       ) VALUES ($1,$2,$3,$4,$5)`,
      [
        id,
        input.tenantId,
        input.legalEntityId,
        input.jurisdictionCode.toUpperCase(),
        input.policyCode.trim(),
      ],
    );
    return { fiscalPolicyId: id };
  }

  async addFiscalPolicyVersion(input: {
    fiscalPolicyId: string;
    policyVersion: number;
    fiscalDocumentRequired: boolean;
    satisfactionEvidenceProfile?: FiscalSatisfactionEvidenceProfile;
    effectiveFrom: string;
    effectiveTo?: string | null;
    createdBy?: string | null;
  }): Promise<FiscalPolicyVersionProjection> {
    const pol = await this.pool.query<{
      fiscal_policy_id: string;
      tenant_id: string;
      legal_entity_id: string;
      policy_code: string;
    }>(`SELECT * FROM fiscal_policy WHERE fiscal_policy_id = $1`, [input.fiscalPolicyId]);
    if (!pol.rows[0]) throw new NotFoundError(`FiscalPolicy not found: ${input.fiscalPolicyId}`);
    const profile = input.satisfactionEvidenceProfile ?? defaultC0SatisfactionProfile();
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO fiscal_policy_version (
         fiscal_policy_version_id, fiscal_policy_id, tenant_id, legal_entity_id,
         policy_version, fiscal_document_required, satisfaction_evidence_profile,
         effective_from, effective_to, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      [
        id,
        input.fiscalPolicyId,
        pol.rows[0].tenant_id,
        pol.rows[0].legal_entity_id,
        input.policyVersion,
        input.fiscalDocumentRequired,
        JSON.stringify(profile),
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.createdBy ?? null,
      ],
    );
    const v = await this.getPolicyVersion(id);
    return v;
  }

  async getPolicyVersion(fiscalPolicyVersionId: string): Promise<FiscalPolicyVersionProjection> {
    const res = await this.pool.query<PolicyVersionRow>(
      `SELECT fpv.*, fp.policy_code
       FROM fiscal_policy_version fpv
       INNER JOIN fiscal_policy fp ON fp.fiscal_policy_id = fpv.fiscal_policy_id
       WHERE fpv.fiscal_policy_version_id = $1`,
      [fiscalPolicyVersionId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError(`FiscalPolicyVersion not found: ${fiscalPolicyVersionId}`);
    return mapPolicyVersion(row);
  }

  /**
   * Resolve FiscalPolicyVersion at authoritative collection business time
   * (PaymentCollectionEvent.collected_at). Never wall-clock / submission /
   * reconcile / settlement satisfaction / ingest timestamps.
   * Missing → null. Ambiguous multi-policy head → FISCAL_POLICY_AMBIGUOUS.
   */
  async resolveEffectivePolicy(
    legalEntityId: string,
    collectionBusinessTime: Date | string,
  ): Promise<FiscalPolicyVersionProjection | null> {
    return this.resolveEffectivePolicyTx(this.pool, legalEntityId, collectionBusinessTime);
  }

  createCheckoutGate(): FiscalCheckoutGate {
    return {
      observe: (input) => this.observeGate(input),
    };
  }

  /** True when a FiscalDocument exists for the Settlement (blocks AbortSettlement). */
  async hasFiscalExternalEffect(settlementGroupId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM fiscal_document WHERE settlement_group_id = $1 LIMIT 1`,
      [settlementGroupId],
    );
    return res.rows.length > 0;
  }

  async observeGate(input: {
    settlementGroupId: string;
    orderId: string;
    legalEntityId: string;
  }): Promise<{ status: FiscalCheckoutGateStatus; detail?: string }> {
    const le = await this.pool.query<{ fiscal_required: boolean | null }>(
      `SELECT fiscal_required FROM legal_entity WHERE legal_entity_id = $1`,
      [input.legalEntityId],
    );
    if (!le.rows[0]) {
      return { status: 'UNAVAILABLE', detail: 'LegalEntity not found' };
    }
    const fiscalRequired = le.rows[0].fiscal_required;
    if (fiscalRequired === null) {
      return {
        status: 'UNAVAILABLE',
        detail: 'legal_entity.fiscal_required undecided; fail closed (not NOT_REQUIRED)',
      };
    }

    const doc = await this.pool.query<DocRow>(
      `SELECT * FROM fiscal_document WHERE settlement_group_id = $1`,
      [input.settlementGroupId],
    );

    let policy: FiscalPolicyVersionProjection;
    try {
      if (doc.rows[0]) {
        // Document-bound freeze — never re-resolve live policy for an existing document.
        policy = await this.getPolicyVersion(doc.rows[0].fiscal_policy_version_id);
      } else {
        const shape = await this.evaluateC0Shape(input.settlementGroupId);
        if (shape.kind === 'blocked') {
          if (fiscalRequired === true) {
            return { status: 'REQUIRED_NOT_SATISFIED', detail: shape.reason };
          }
          return {
            status: 'UNAVAILABLE',
            detail:
              'PaymentCollectionEvent required to bind FiscalPolicy at collection business time',
          };
        }
        const resolved = await this.resolveEffectivePolicy(
          input.legalEntityId,
          shape.collectedAt,
        );
        if (!resolved) {
          return {
            status: 'UNAVAILABLE',
            detail:
              'No FiscalPolicyVersion effective at PaymentCollectionEvent.collected_at; fail closed',
          };
        }
        policy = resolved;
      }
    } catch (e) {
      if (e instanceof DomainValidationError && e.code === 'FISCAL_POLICY_AMBIGUOUS') {
        return { status: 'UNAVAILABLE', detail: e.message };
      }
      throw e;
    }

    if (fiscalRequired === false) {
      if (policy.fiscalDocumentRequired !== false) {
        return {
          status: 'UNAVAILABLE',
          detail:
            'fiscal_required=FALSE requires explicit FiscalPolicyVersion.fiscal_document_required=FALSE',
        };
      }
      return { status: 'NOT_REQUIRED', detail: 'Explicit FiscalPolicy: document not required' };
    }

    if (!policy.fiscalDocumentRequired) {
      return {
        status: 'UNAVAILABLE',
        detail:
          'Contradictory fiscal_required=TRUE with FiscalPolicyVersion.fiscal_document_required=FALSE',
      };
    }

    if (!doc.rows[0]) {
      return {
        status: 'REQUIRED_NOT_SATISFIED',
        detail: 'FiscalDocument required but not issued for Settlement',
      };
    }
    if (doc.rows[0].status === 'SATISFIED') {
      const ok = await this.documentEvidenceSatisfies(doc.rows[0].fiscal_document_id, policy);
      if (ok) return { status: 'SATISFIED' };
      return {
        status: 'REQUIRED_NOT_SATISFIED',
        detail: 'FiscalDocument marked SATISFIED but evidence profile not met',
      };
    }
    if (
      doc.rows[0].status === 'ISSUED_PENDING_EVIDENCE' ||
      doc.rows[0].status === 'PENDING_ISSUE'
    ) {
      return { status: 'PENDING', detail: `FiscalDocument status ${doc.rows[0].status}` };
    }
    return {
      status: 'REQUIRED_NOT_SATISFIED',
      detail: `FiscalDocument status ${doc.rows[0].status}`,
    };
  }

  /**
   * Issue (or idempotently resume) FiscalDocument for C0 one-Payment/one-Check Settlement.
   * Consumes frozen TaxOrderSnapshot — does not recalculate Tax.
   */
  async issueForSettlement(input: {
    settlementGroupId: string;
    issueIdempotencyKey: string;
  }): Promise<FiscalDocumentProjection> {
    if (!input.issueIdempotencyKey.trim()) {
      throw new DomainValidationError('VALIDATION', 'issueIdempotencyKey is required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const group = await client.query<{
        settlement_group_id: string;
        order_id: string;
        legal_entity_id: string;
        tenant_id: string;
        state: string;
        currency_code: string;
        minor_unit_exponent: number;
        customer_payable_minor: string;
      }>(
        `SELECT settlement_group_id, order_id, legal_entity_id, tenant_id, state,
                currency_code, minor_unit_exponent, customer_payable_minor
         FROM settlement_group WHERE settlement_group_id = $1 FOR UPDATE`,
        [input.settlementGroupId],
      );
      const g = group.rows[0];
      if (!g) throw new NotFoundError(`Settlement not found: ${input.settlementGroupId}`);

      const existingKey = await client.query<DocRow>(
        `SELECT * FROM fiscal_document
         WHERE legal_entity_id = $1 AND issue_idempotency_key = $2
         FOR UPDATE`,
        [g.legal_entity_id, input.issueIdempotencyKey],
      );
      if (existingKey.rows[0]) {
        if (existingKey.rows[0].settlement_group_id !== input.settlementGroupId) {
          throw new DomainValidationError(
            'IDEMPOTENCY_CONFLICT',
            'issueIdempotencyKey already used for a different Settlement',
          );
        }
        const hit = existingKey.rows[0];
        await client.query('COMMIT');
        if (hit.status === 'PENDING_ISSUE' || hit.status === 'ISSUED_PENDING_EVIDENCE') {
          return this.reconcileDocument(hit.fiscal_document_id);
        }
        return mapDoc(hit);
      }

      const existingDoc = await client.query<DocRow>(
        `SELECT * FROM fiscal_document WHERE settlement_group_id = $1 FOR UPDATE`,
        [input.settlementGroupId],
      );
      if (existingDoc.rows[0]) {
        const existing = existingDoc.rows[0];
        await client.query('COMMIT');
        // Resume PENDING_ISSUE / ISSUED_PENDING_EVIDENCE via reconcile (never fabricate SATISFIED).
        if (
          existing.status === 'PENDING_ISSUE' ||
          existing.status === 'ISSUED_PENDING_EVIDENCE'
        ) {
          return this.reconcileDocument(existing.fiscal_document_id);
        }
        return mapDoc(existing);
      }

      const leFlag = await client.query<{ fiscal_required: boolean | null }>(
        `SELECT fiscal_required FROM legal_entity WHERE legal_entity_id = $1`,
        [g.legal_entity_id],
      );
      if (leFlag.rows[0]?.fiscal_required !== true) {
        throw new DomainValidationError(
          'FISCAL_POLICY_BLOCKED',
          'issueForSettlement requires legal_entity.fiscal_required=TRUE',
        );
      }

      const shape = await this.evaluateC0ShapeTx(client, input.settlementGroupId);
      if (shape.kind === 'blocked') {
        throw new DomainValidationError('FISCAL_SHAPE_BLOCKED', shape.reason);
      }

      // Bind FiscalPolicy at PaymentCollectionEvent.collected_at — never wall-clock.
      const policy = await this.resolveEffectivePolicyTx(
        client,
        g.legal_entity_id,
        shape.collectedAt,
      );
      if (!policy || !policy.fiscalDocumentRequired) {
        throw new DomainValidationError(
          'FISCAL_POLICY_BLOCKED',
          'No fiscal-required FiscalPolicyVersion effective at collection business time',
        );
      }

      // ADR-0014 D1: consume the same TaxOrderSnapshot identity Settlement froze.
      const snapBind = await client.query<{
        tax_order_snapshot_id: string | null;
        semantic_fingerprint: string;
        customer_payable_minor: string;
        currency_code: string;
        minor_unit_exponent: number;
      }>(
        `SELECT
           (sps.provenance_json->>'taxOrderSnapshotId')::uuid AS tax_order_snapshot_id,
           tos.semantic_fingerprint,
           tos.customer_payable_minor,
           tos.currency_code,
           tos.minor_unit_exponent
         FROM settlement_group sg
         INNER JOIN settlement_payable_snapshot sps
           ON sps.settlement_payable_snapshot_id = sg.settlement_payable_snapshot_id
         LEFT JOIN tax_order_snapshot tos
           ON tos.tax_order_snapshot_id = (sps.provenance_json->>'taxOrderSnapshotId')::uuid
         WHERE sg.settlement_group_id = $1
         FOR SHARE OF sg, sps`,
        [input.settlementGroupId],
      );
      const snap = snapBind.rows[0];
      if (!snap?.tax_order_snapshot_id || !snap.semantic_fingerprint) {
        throw new DomainValidationError(
          'FISCAL_TAX_SNAPSHOT_REQUIRED',
          'Settlement-bound TaxOrderSnapshot required; Fiscalization must not pick latest or recalculate Tax',
        );
      }
      if (snap.customer_payable_minor !== shape.amountCollectedMinor) {
        throw new DomainValidationError(
          'FISCAL_AMOUNT_MISMATCH',
          'TaxOrderSnapshot customer payable must match PaymentCollectionEvent amount',
        );
      }

      const docId = randomUUID();
      await client.query(
        `INSERT INTO fiscal_document (
           fiscal_document_id, tenant_id, legal_entity_id, settlement_group_id,
           settlement_check_id, order_id, payment_id, payment_collection_event_id,
           tax_order_snapshot_id, fiscal_policy_id, fiscal_policy_version_id,
           collection_business_time, currency_code, minor_unit_exponent,
           document_amount_minor, tax_semantic_fingerprint, issue_idempotency_key, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PENDING_ISSUE')`,
        [
          docId,
          g.tenant_id,
          g.legal_entity_id,
          g.settlement_group_id,
          shape.settlementCheckId,
          g.order_id,
          shape.paymentId,
          shape.paymentCollectionEventId,
          snap.tax_order_snapshot_id!,
          policy.fiscalPolicyId,
          policy.fiscalPolicyVersionId,
          shape.collectedAt,
          snap.currency_code,
          snap.minor_unit_exponent,
          snap.customer_payable_minor,
          snap.semantic_fingerprint,
          input.issueIdempotencyKey,
        ],
      );

      const submissionId = randomUUID();
      await client.query(
        `INSERT INTO fiscal_submission (
           fiscal_submission_id, fiscal_document_id, tenant_id, legal_entity_id,
           submission_idempotency_key, status
         ) VALUES ($1,$2,$3,$4,$5,'PENDING')`,
        [
          submissionId,
          docId,
          g.tenant_id,
          g.legal_entity_id,
          input.issueIdempotencyKey,
        ],
      );

      await client.query('COMMIT');

      // Adapter call outside the document-create transaction; outcomes are append-only.
      await this.runIssueAttempt({
        fiscalDocumentId: docId,
        fiscalSubmissionId: submissionId,
        tenantId: g.tenant_id,
        legalEntityId: g.legal_entity_id,
        settlementGroupId: g.settlement_group_id,
        orderId: g.order_id,
        paymentCollectionEventId: shape.paymentCollectionEventId,
        collectionBusinessTime: shape.collectedAt,
        taxOrderSnapshotId: snap.tax_order_snapshot_id!,
        taxSemanticFingerprint: snap.semantic_fingerprint,
        documentAmountMinor: snap.customer_payable_minor,
        currencyCode: snap.currency_code,
        issueIdempotencyKey: input.issueIdempotencyKey,
        policy,
      });

      return (await this.getDocument(docId))!;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async getDocument(fiscalDocumentId: string): Promise<FiscalDocumentProjection | null> {
    const res = await this.pool.query<DocRow>(
      `SELECT * FROM fiscal_document WHERE fiscal_document_id = $1`,
      [fiscalDocumentId],
    );
    return res.rows[0] ? mapDoc(res.rows[0]) : null;
  }

  /**
   * Reconcile after timeout / inquiry — never fabricates SATISFIED without verified evidence.
   */
  async reconcileDocument(fiscalDocumentId: string): Promise<FiscalDocumentProjection> {
    const doc = await this.getDocument(fiscalDocumentId);
    if (!doc) throw new NotFoundError(`FiscalDocument not found: ${fiscalDocumentId}`);
    if (doc.status === 'SATISFIED') return doc;

    // Always use document-bound FiscalPolicyVersion — never live re-resolve.
    const policy = await this.getPolicyVersion(doc.fiscalPolicyVersionId);

    const metaPre = await this.pool.query<{
      tenant_id: string;
      legal_entity_id: string;
      settlement_group_id: string;
      order_id: string;
      payment_collection_event_id: string;
      collection_business_time: Date;
      tax_order_snapshot_id: string;
      tax_semantic_fingerprint: string;
      document_amount_minor: string;
      currency_code: string;
      status: string;
      fiscal_policy_version_id: string;
    }>(`SELECT * FROM fiscal_document WHERE fiscal_document_id = $1`, [fiscalDocumentId]);
    const drow = metaPre.rows[0]!;
    if (drow.fiscal_policy_version_id !== doc.fiscalPolicyVersionId) {
      throw new DomainValidationError(
        'FISCAL_POLICY_BLOCKED',
        'FiscalDocument fiscal_policy_version_id mismatch',
      );
    }

    const result =
      drow.status === 'PENDING_ISSUE'
        ? await this.adapter.idempotentRetry({
            fiscalDocumentId,
            legalEntityId: drow.legal_entity_id,
            settlementGroupId: drow.settlement_group_id,
            orderId: drow.order_id,
            paymentCollectionEventId: drow.payment_collection_event_id,
            collectionBusinessTime: drow.collection_business_time.toISOString(),
            taxOrderSnapshotId: drow.tax_order_snapshot_id,
            taxSemanticFingerprint: drow.tax_semantic_fingerprint,
            documentAmountMinor: drow.document_amount_minor,
            currencyCode: drow.currency_code,
            issueIdempotencyKey: doc.issueIdempotencyKey,
          })
        : await this.adapter.reconcileTimeoutAfterSuccess({
            fiscalDocumentId,
            issueIdempotencyKey: doc.issueIdempotencyKey,
          });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const sub = await client.query<{ fiscal_submission_id: string }>(
        `SELECT fiscal_submission_id FROM fiscal_submission
         WHERE fiscal_document_id = $1
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [fiscalDocumentId],
      );
      if (!sub.rows[0]) {
        throw new DomainValidationError('VALIDATION', 'No FiscalSubmission for document');
      }
      const attemptN = await nextAttemptNumber(client, sub.rows[0].fiscal_submission_id);
      const attemptId = randomUUID();
      const meta = { rows: [{ tenant_id: drow.tenant_id, legal_entity_id: drow.legal_entity_id }] };
      const operation =
        drow.status === 'PENDING_ISSUE' ? 'IDEMPOTENT_RETRY' : 'RECONCILE_TIMEOUT';
      await client.query(
        `INSERT INTO fiscal_provider_attempt (
           fiscal_provider_attempt_id, fiscal_submission_id, fiscal_document_id,
           tenant_id, legal_entity_id, attempt_number, operation, adapter_identity, status, finished_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [
          attemptId,
          sub.rows[0].fiscal_submission_id,
          fiscalDocumentId,
          meta.rows[0]!.tenant_id,
          meta.rows[0]!.legal_entity_id,
          attemptN,
          operation,
          this.adapter.adapterIdentity,
          result.attemptStatus,
        ],
      );
      await client.query(
        `INSERT INTO fiscal_provider_outcome_evidence (
           fiscal_provider_outcome_evidence_id, fiscal_provider_attempt_id, fiscal_document_id,
           tenant_id, legal_entity_id, evidence_class, provider_reference,
           raw_provider_status, verification_status, diagnostic_metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          randomUUID(),
          attemptId,
          fiscalDocumentId,
          meta.rows[0]!.tenant_id,
          meta.rows[0]!.legal_entity_id,
          result.evidenceClass,
          result.providerReference ?? null,
          result.rawProviderStatus,
          result.verificationStatus,
          JSON.stringify(result.diagnosticMetadata ?? {}),
        ],
      );
      if (
        evidenceSatisfiesProfile(policy.satisfactionEvidenceProfile, {
          evidenceClass: result.evidenceClass,
          verificationStatus: result.verificationStatus,
        })
      ) {
        await client.query(
          `UPDATE fiscal_document SET status = 'SATISFIED' WHERE fiscal_document_id = $1`,
          [fiscalDocumentId],
        );
        await client.query(
          `UPDATE fiscal_submission SET status = 'COMPLETED'
           WHERE fiscal_submission_id = $1`,
          [sub.rows[0].fiscal_submission_id],
        );
      } else if (result.attemptStatus === 'TIMEOUT') {
        await client.query(
          `UPDATE fiscal_submission SET status = 'NEEDS_RECONCILE'
           WHERE fiscal_submission_id = $1`,
          [sub.rows[0].fiscal_submission_id],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return (await this.getDocument(fiscalDocumentId))!;
  }

  private async runIssueAttempt(input: {
    fiscalDocumentId: string;
    fiscalSubmissionId: string;
    tenantId: string;
    legalEntityId: string;
    settlementGroupId: string;
    orderId: string;
    paymentCollectionEventId: string;
    collectionBusinessTime: string;
    taxOrderSnapshotId: string;
    taxSemanticFingerprint: string;
    documentAmountMinor: string;
    currencyCode: string;
    issueIdempotencyKey: string;
    policy: FiscalPolicyVersionProjection;
  }): Promise<void> {
    const result = await this.adapter.issue({
      fiscalDocumentId: input.fiscalDocumentId,
      legalEntityId: input.legalEntityId,
      settlementGroupId: input.settlementGroupId,
      orderId: input.orderId,
      paymentCollectionEventId: input.paymentCollectionEventId,
      collectionBusinessTime: input.collectionBusinessTime,
      taxOrderSnapshotId: input.taxOrderSnapshotId,
      taxSemanticFingerprint: input.taxSemanticFingerprint,
      documentAmountMinor: input.documentAmountMinor,
      currencyCode: input.currencyCode,
      issueIdempotencyKey: input.issueIdempotencyKey,
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Durable uniqueness: allocate next attempt_number under submission lock (fail closed on race).
      await client.query(
        `SELECT fiscal_submission_id FROM fiscal_submission
         WHERE fiscal_submission_id = $1 FOR UPDATE`,
        [input.fiscalSubmissionId],
      );
      const attemptN = await nextAttemptNumber(client, input.fiscalSubmissionId);
      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO fiscal_provider_attempt (
           fiscal_provider_attempt_id, fiscal_submission_id, fiscal_document_id,
           tenant_id, legal_entity_id, attempt_number, operation, adapter_identity, status, finished_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'ISSUE',$7,$8,NOW())`,
        [
          attemptId,
          input.fiscalSubmissionId,
          input.fiscalDocumentId,
          input.tenantId,
          input.legalEntityId,
          attemptN,
          this.adapter.adapterIdentity,
          result.attemptStatus,
        ],
      );
      await client.query(
        `INSERT INTO fiscal_provider_outcome_evidence (
           fiscal_provider_outcome_evidence_id, fiscal_provider_attempt_id, fiscal_document_id,
           tenant_id, legal_entity_id, evidence_class, provider_reference,
           raw_provider_status, verification_status, diagnostic_metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          randomUUID(),
          attemptId,
          input.fiscalDocumentId,
          input.tenantId,
          input.legalEntityId,
          result.evidenceClass,
          result.providerReference ?? null,
          result.rawProviderStatus,
          result.verificationStatus,
          JSON.stringify(result.diagnosticMetadata ?? {}),
        ],
      );

      const satisfies = evidenceSatisfiesProfile(input.policy.satisfactionEvidenceProfile, {
        evidenceClass: result.evidenceClass,
        verificationStatus: result.verificationStatus,
      });

      if (satisfies) {
        await client.query(
          `UPDATE fiscal_document SET status = 'SATISFIED' WHERE fiscal_document_id = $1`,
          [input.fiscalDocumentId],
        );
        await client.query(
          `UPDATE fiscal_submission SET status = 'COMPLETED' WHERE fiscal_submission_id = $1`,
          [input.fiscalSubmissionId],
        );
      } else if (result.attemptStatus === 'TIMEOUT') {
        await client.query(
          `UPDATE fiscal_document SET status = 'ISSUED_PENDING_EVIDENCE'
           WHERE fiscal_document_id = $1`,
          [input.fiscalDocumentId],
        );
        await client.query(
          `UPDATE fiscal_submission SET status = 'NEEDS_RECONCILE'
           WHERE fiscal_submission_id = $1`,
          [input.fiscalSubmissionId],
        );
      } else if (result.attemptStatus === 'ADAPTER_UNAVAILABLE') {
        await client.query(
          `UPDATE fiscal_document SET status = 'PENDING_ISSUE' WHERE fiscal_document_id = $1`,
          [input.fiscalDocumentId],
        );
        await client.query(
          `UPDATE fiscal_submission SET status = 'FAILED' WHERE fiscal_submission_id = $1`,
          [input.fiscalSubmissionId],
        );
      } else {
        await client.query(
          `UPDATE fiscal_document SET status = 'FAILED' WHERE fiscal_document_id = $1`,
          [input.fiscalDocumentId],
        );
        await client.query(
          `UPDATE fiscal_submission SET status = 'FAILED' WHERE fiscal_submission_id = $1`,
          [input.fiscalSubmissionId],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private async documentEvidenceSatisfies(
    fiscalDocumentId: string,
    policy: FiscalPolicyVersionProjection,
  ): Promise<boolean> {
    const ev = await this.pool.query<{
      evidence_class: string;
      verification_status: string;
    }>(
      `SELECT evidence_class, verification_status
       FROM fiscal_provider_outcome_evidence
       WHERE fiscal_document_id = $1
       ORDER BY recorded_at DESC`,
      [fiscalDocumentId],
    );
    for (const row of ev.rows) {
      if (
        evidenceSatisfiesProfile(policy.satisfactionEvidenceProfile, {
          evidenceClass: row.evidence_class,
          verificationStatus: row.verification_status,
        })
      ) {
        return true;
      }
    }
    return false;
  }

  private async evaluateC0Shape(settlementGroupId: string) {
    return this.evaluateC0ShapeTx(this.pool, settlementGroupId);
  }

  private async evaluateC0ShapeTx(
    q: Queryable,
    settlementGroupId: string,
  ): Promise<
    | {
        kind: 'ok';
        settlementCheckId: string;
        paymentId: string;
        paymentCollectionEventId: string;
        collectedAt: string;
        amountCollectedMinor: string;
      }
    | { kind: 'blocked'; reason: string }
  > {
    const checks = await q.query<{
      settlement_check_id: string;
      customer_payable_minor: string;
    }>(
      `SELECT settlement_check_id, customer_payable_minor
       FROM settlement_check WHERE settlement_group_id = $1`,
      [settlementGroupId],
    );
    if (checks.rows.length !== 1) {
      return {
        kind: 'blocked',
        reason: `FISC1.1 requires exactly one SettlementCheck; found ${checks.rows.length}`,
      };
    }
    const checkId = checks.rows[0]!.settlement_check_id;
    const dueMinor = checks.rows[0]!.customer_payable_minor;

    const pce = await q.query<{
      payment_collection_event_id: string;
      payment_id: string;
      collected_at: Date;
      amount_collected_minor: string;
      settlement_check_id: string;
    }>(
      `SELECT payment_collection_event_id, payment_id, collected_at, amount_collected_minor,
              settlement_check_id
       FROM payment_collection_event
       WHERE settlement_group_id = $1`,
      [settlementGroupId],
    );
    if (pce.rows.length === 0) {
      return {
        kind: 'blocked',
        reason: 'PaymentCollectionEvent missing; fiscalization fail closed (ADR-0014 D35)',
      };
    }
    if (pce.rows.length !== 1) {
      return {
        kind: 'blocked',
        reason: `FISC1.1 requires exactly one PaymentCollectionEvent; found ${pce.rows.length}`,
      };
    }
    if (pce.rows[0]!.settlement_check_id !== checkId) {
      return {
        kind: 'blocked',
        reason: 'PaymentCollectionEvent Check must match the sole SettlementCheck',
      };
    }
    if (pce.rows[0]!.amount_collected_minor !== dueMinor) {
      return {
        kind: 'blocked',
        reason: 'PaymentCollectionEvent amount must equal Check customer payable',
      };
    }

    const allocs = await q.query<{ payment_id: string; amount_minor: string }>(
      `SELECT payment_id, amount_minor FROM payment_allocation
       WHERE settlement_check_id = $1 AND active = TRUE`,
      [checkId],
    );
    if (allocs.rows.length !== 1) {
      return {
        kind: 'blocked',
        reason: `FISC1.1 requires exactly one active qualifying allocation; found ${allocs.rows.length}`,
      };
    }
    if (allocs.rows[0]!.payment_id !== pce.rows[0]!.payment_id) {
      return {
        kind: 'blocked',
        reason: 'PaymentCollectionEvent Payment must match qualifying allocation Payment',
      };
    }
    if (allocs.rows[0]!.amount_minor !== dueMinor) {
      return {
        kind: 'blocked',
        reason: 'Check not fully covered by the single qualifying Payment allocation',
      };
    }

    return {
      kind: 'ok',
      settlementCheckId: checkId,
      paymentId: pce.rows[0]!.payment_id,
      paymentCollectionEventId: pce.rows[0]!.payment_collection_event_id,
      collectedAt: pce.rows[0]!.collected_at.toISOString(),
      amountCollectedMinor: pce.rows[0]!.amount_collected_minor,
    };
  }

  private async resolveEffectivePolicyTx(
    q: Queryable,
    legalEntityId: string,
    collectionBusinessTime: Date | string,
  ): Promise<FiscalPolicyVersionProjection | null> {
    const at =
      typeof collectionBusinessTime === 'string'
        ? new Date(collectionBusinessTime)
        : collectionBusinessTime;
    if (Number.isNaN(at.getTime())) {
      throw new DomainValidationError(
        'FISCAL_POLICY_BLOCKED',
        'Invalid collection business time for FiscalPolicy resolution',
      );
    }
    const atIso = at.toISOString();

    const policyHeads = await q.query<{ fiscal_policy_id: string }>(
      `SELECT DISTINCT fpv.fiscal_policy_id
       FROM fiscal_policy_version fpv
       WHERE fpv.legal_entity_id = $1
         AND fpv.effective_from <= $2::timestamptz
         AND (fpv.effective_to IS NULL OR fpv.effective_to > $2::timestamptz)`,
      [legalEntityId, atIso],
    );
    if (policyHeads.rows.length === 0) return null;
    if (policyHeads.rows.length > 1) {
      throw new DomainValidationError(
        'FISCAL_POLICY_AMBIGUOUS',
        `Multiple FiscalPolicy heads effective at collection business time (${policyHeads.rows.length})`,
      );
    }

    const versions = await q.query<PolicyVersionRow>(
      `SELECT fpv.*, fp.policy_code
       FROM fiscal_policy_version fpv
       INNER JOIN fiscal_policy fp ON fp.fiscal_policy_id = fpv.fiscal_policy_id
       WHERE fpv.fiscal_policy_id = $1
         AND fpv.effective_from <= $2::timestamptz
         AND (fpv.effective_to IS NULL OR fpv.effective_to > $2::timestamptz)
       ORDER BY fpv.policy_version DESC`,
      [policyHeads.rows[0]!.fiscal_policy_id, atIso],
    );
    if (versions.rows.length === 0) return null;
    if (versions.rows.length > 1) {
      throw new DomainValidationError(
        'FISCAL_POLICY_AMBIGUOUS',
        'Overlapping FiscalPolicyVersion intervals at collection business time',
      );
    }
    return mapPolicyVersion(versions.rows[0]!);
  }
}

function mapPolicyVersion(row: PolicyVersionRow): FiscalPolicyVersionProjection {
  return {
    fiscalPolicyId: row.fiscal_policy_id,
    fiscalPolicyVersionId: row.fiscal_policy_version_id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    policyCode: row.policy_code,
    policyVersion: row.policy_version,
    fiscalDocumentRequired: row.fiscal_document_required,
    satisfactionEvidenceProfile: parseSatisfactionEvidenceProfile(
      row.satisfaction_evidence_profile,
    ),
    effectiveFrom: row.effective_from.toISOString(),
    effectiveTo: row.effective_to ? row.effective_to.toISOString() : null,
  };
}

async function nextAttemptNumber(client: PoolClient, submissionId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    `SELECT COALESCE(MAX(attempt_number), 0)::int + 1 AS n
     FROM fiscal_provider_attempt WHERE fiscal_submission_id = $1`,
    [submissionId],
  );
  return res.rows[0]!.n;
}
