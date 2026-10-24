import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  audit,
  type AuthenticatedPrincipal,
  type IdentityService,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_POS_OPERATE,
} from '../identity/index.js';
import { CASH_SHIFT_OPERATION_TYPE, CashDomainError } from './errors.js';
import {
  assertOpeningCashMoney,
  buildOpenCashShiftFingerprint,
  fingerprintsMatch,
  type OpenCashAuthMode,
} from './open-fingerprint.js';

const uuid = z.string().uuid();

export type CashShiftVarianceKind = 'BALANCED' | 'SURPLUS' | 'SHORTAGE';

export type CashShiftProjection = {
  cashShiftId: string;
  tenantId: string;
  outletId: string;
  terminalId: string;
  status: 'OPEN' | 'CLOSED' | 'RECONCILED' | 'ACCEPTED';
  openingAmountMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  openedByUserId: string;
  openedByEmployeeId: string | null;
  authMode: OpenCashAuthMode;
  approvalRequestId: string | null;
  loginChallengeId: string | null;
  openedAt: string;
  closedAt: string | null;
  closedByUserId: string | null;
  closedByEmployeeId: string | null;
  actualAmountMinor: string | null;
  expectedAmountMinor: string | null;
  differenceMinor: string | null;
  varianceKind: CashShiftVarianceKind | null;
  closeReasonText: string | null;
  closeIdempotencyKey: string | null;
  expectedSourceRefs: string[] | null;
};

type CashShiftRow = {
  cash_shift_id: string;
  tenant_id: string;
  outlet_id: string;
  terminal_id: string;
  status: CashShiftProjection['status'];
  opening_amount_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
  opened_by_user_id: string;
  opened_by_employee_id: string | null;
  auth_mode: OpenCashAuthMode;
  approval_request_id: string | null;
  login_challenge_id: string | null;
  opened_at: Date;
  closed_at: Date | null;
  closed_by_user_id: string | null;
  closed_by_employee_id: string | null;
  actual_amount_minor: string | null;
  expected_amount_minor: string | null;
  difference_minor: string | null;
  variance_kind: CashShiftVarianceKind | null;
  close_reason_text: string | null;
  close_idempotency_key: string | null;
  expected_source_refs: unknown;
};

function parseSourceRefs(raw: unknown): string[] | null {
  if (raw == null) return null;
  const arr = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(arr)) return null;
  return arr.map((x) => String(x));
}

function mapRow(r: CashShiftRow): CashShiftProjection {
  return {
    cashShiftId: r.cash_shift_id,
    tenantId: r.tenant_id,
    outletId: r.outlet_id,
    terminalId: r.terminal_id,
    status: r.status,
    openingAmountMinor: r.opening_amount_minor,
    currencyCode: r.currency_code,
    minorUnitExponent: r.minor_unit_exponent,
    openedByUserId: r.opened_by_user_id,
    openedByEmployeeId: r.opened_by_employee_id,
    authMode: r.auth_mode,
    approvalRequestId: r.approval_request_id,
    loginChallengeId: r.login_challenge_id,
    openedAt: r.opened_at.toISOString(),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    closedByUserId: r.closed_by_user_id,
    closedByEmployeeId: r.closed_by_employee_id,
    actualAmountMinor: r.actual_amount_minor,
    expectedAmountMinor: r.expected_amount_minor,
    differenceMinor: r.difference_minor,
    varianceKind: r.variance_kind,
    closeReasonText: r.close_reason_text,
    closeIdempotencyKey: r.close_idempotency_key,
    expectedSourceRefs: parseSourceRefs(r.expected_source_refs),
  };
}

function assertNonNegativeMinor(amountMinor: string, field: string): void {
  if (!/^[0-9]+$/.test(amountMinor)) {
    throw new CashDomainError('INVALID_ACTUAL_CASH', `${field} must be a non-negative integer string`);
  }
}

function signedDifferenceMinor(actual: string, expected: string): string {
  const diff = BigInt(actual) - BigInt(expected);
  return diff.toString();
}

function varianceFromDifference(differenceMinor: string): CashShiftVarianceKind {
  const d = BigInt(differenceMinor);
  if (d === 0n) return 'BALANCED';
  if (d > 0n) return 'SURPLUS';
  return 'SHORTAGE';
}

/**
 * Cash owns CashShift. CASH1.1 Open + CASH1.2 Close (ADR-0046).
 * Authorization evidence from Identity (Session / AccessGrant / ApprovalRequest / optional LoginChallenge).
 * Open permission composition (SEC-0): pos.operate AND (cash_shift.open | APPROVAL path).
 * Close: balanced/surplus → pos.operate + cash_shift.close; shortage → cash_shift.close.shortage only.
 */
export class CashShiftService {
  constructor(
    private readonly pool: Pool,
    private readonly identity: IdentityService,
  ) {}

  async getOpenShiftForTerminal(
    principal: AuthenticatedPrincipal,
    terminalId: string,
  ): Promise<CashShiftProjection | null> {
    const res = await this.pool.query<CashShiftRow>(
      `SELECT * FROM cash_shift
       WHERE tenant_id = $1 AND terminal_id = $2 AND status = 'OPEN'`,
      [principal.tenantId, terminalId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  /**
   * Authorized terminals with server-derived Organization topology for CashierContext.
   * brandId / legalEntityId come from Outlet → Brand / LegalEntity — never from the caller.
   */
  async listTerminalsForOpen(principal: AuthenticatedPrincipal): Promise<
    Array<{
      outletId: string;
      outletName: string;
      terminalId: string;
      terminalCode: string;
      terminalName: string;
      brandId: string;
      brandName: string;
      legalEntityId: string;
      legalEntityName: string;
    }>
  > {
    const res = await this.pool.query<{
      outlet_id: string;
      outlet_name: string;
      terminal_id: string;
      code: string;
      name: string;
      brand_id: string;
      brand_name: string;
      legal_entity_id: string;
      legal_entity_name: string;
    }>(
      `SELECT DISTINCT
          o.outlet_id,
          o.name AS outlet_name,
          t.terminal_id,
          t.code,
          t.name,
          b.brand_id,
          b.name AS brand_name,
          le.legal_entity_id,
          le.name AS legal_entity_name
       FROM terminal t
       INNER JOIN outlet o
         ON o.outlet_id = t.outlet_id AND o.tenant_id = t.tenant_id
       INNER JOIN brand b
         ON b.brand_id = o.brand_id AND b.tenant_id = o.tenant_id
       INNER JOIN legal_entity le
         ON le.legal_entity_id = o.legal_entity_id AND le.tenant_id = o.tenant_id
       INNER JOIN identity_access_grant g
         ON g.tenant_id = t.tenant_id
        AND g.user_id = $2
        AND g.permission_key = $3
        AND g.enabled AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > NOW())
        AND (g.outlet_id IS NULL OR g.outlet_id = t.outlet_id)
        AND (g.terminal_id IS NULL OR g.terminal_id = t.terminal_id)
       WHERE t.tenant_id = $1
       ORDER BY o.name, t.code`,
      [principal.tenantId, principal.userId, PERMISSION_POS_OPERATE],
    );
    return res.rows.map((r) => ({
      outletId: r.outlet_id,
      outletName: r.outlet_name,
      terminalId: r.terminal_id,
      terminalCode: r.code,
      terminalName: r.name,
      brandId: r.brand_id,
      brandName: r.brand_name,
      legalEntityId: r.legal_entity_id,
      legalEntityName: r.legal_entity_name,
    }));
  }

  async openShift(principal: AuthenticatedPrincipal, raw: unknown): Promise<CashShiftProjection> {
    const cmd = z
      .object({
        outletId: uuid,
        terminalId: uuid,
        openIdempotencyKey: z.string().min(8).max(128),
        openingCash: z
          .object({
            amountMinor: z.string(),
            currencyCode: z.string(),
            minorUnitExponent: z.number(),
          })
          .strict(),
        approvalRequestId: uuid.optional(),
        loginChallengeId: uuid.optional(),
        // Reject mass-assignment of authoritative fields if present at top-level via .strict().
      })
      .strict()
      .parse(raw);

    const openingCash = assertOpeningCashMoney(
      cmd.openingCash.amountMinor,
      cmd.openingCash.currencyCode,
      cmd.openingCash.minorUnitExponent,
    );

    const fingerprint = buildOpenCashShiftFingerprint({
      tenantId: principal.tenantId,
      outletId: cmd.outletId,
      terminalId: cmd.terminalId,
      requesterUserId: principal.userId,
      openingCash,
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Serialize concurrent retries of the same idempotency identity (process-safe).
      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1 || chr(31) || $2, 0)
         )`,
        [principal.tenantId, cmd.openIdempotencyKey],
      );

      // Idempotent retry — same key + same semantics.
      const existing = await client.query<CashShiftRow>(
        `SELECT * FROM cash_shift
         WHERE tenant_id = $1 AND open_idempotency_key = $2
         FOR UPDATE`,
        [principal.tenantId, cmd.openIdempotencyKey],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        const same =
          row.outlet_id === cmd.outletId &&
          row.terminal_id === cmd.terminalId &&
          row.opening_amount_minor === openingCash.amountMinor &&
          row.currency_code === openingCash.currencyCode &&
          row.minor_unit_exponent === openingCash.minorUnitExponent &&
          row.opened_by_user_id === principal.userId;
        if (!same) {
          throw new CashDomainError(
            'IDEMPOTENCY_CONFLICT',
            'openIdempotencyKey reused with different semantics',
          );
        }
        await client.query('COMMIT');
        return mapRow(row);
      }

      // SEC-0 composition: pos.operate required for cashier cash HTTP surface.
      const posOk = await this.identity.hasPermission(
        client,
        principal.tenantId,
        principal.userId,
        PERMISSION_POS_OPERATE,
        cmd.outletId,
        cmd.terminalId,
      );
      if (!posOk) {
        throw new CashDomainError('FORBIDDEN', 'Permission denied');
      }

      const terminal = await client.query<{ terminal_id: string; outlet_id: string; tenant_id: string }>(
        `SELECT terminal_id, outlet_id, tenant_id FROM terminal
         WHERE terminal_id = $1 AND tenant_id = $2 AND outlet_id = $3
         FOR SHARE`,
        [cmd.terminalId, principal.tenantId, cmd.outletId],
      );
      if (terminal.rowCount !== 1) {
        throw new CashDomainError('NOT_FOUND', 'Terminal not found');
      }

      let loginChallengeId: string | null = null;
      if (cmd.loginChallengeId) {
        loginChallengeId = await this.consumeLoginChallenge(
          client,
          principal,
          cmd.loginChallengeId,
          cmd.outletId,
          cmd.terminalId,
        );
      }

      let authMode: OpenCashAuthMode;
      let approvalRequestId: string | null = null;

      const canOpen = await this.identity.hasPermission(
        client,
        principal.tenantId,
        principal.userId,
        PERMISSION_CASH_SHIFT_OPEN,
        cmd.outletId,
        cmd.terminalId,
      );

      if (canOpen) {
        if (cmd.approvalRequestId) {
          throw new CashDomainError(
            'AUTH_EVIDENCE_INVALID',
            'Approval must not be supplied on direct permission path',
          );
        }
        authMode = 'DIRECT_PERMISSION';
      } else {
        if (!cmd.approvalRequestId) {
          throw new CashDomainError('APPROVAL_REQUIRED', 'Approval required to open CashShift');
        }
        approvalRequestId = await this.consumeApproval(
          client,
          principal,
          cmd.approvalRequestId,
          fingerprint,
          cmd.outletId,
          cmd.terminalId,
          loginChallengeId,
        );
        authMode = 'APPROVAL';
      }

      const cashShiftId = randomUUID();
      await client.query('SAVEPOINT cash_shift_insert');
      try {
        await client.query(
          `INSERT INTO cash_shift (
             cash_shift_id, tenant_id, outlet_id, terminal_id, status,
             opening_amount_minor, currency_code, minor_unit_exponent,
             opened_by_user_id, opened_by_employee_id, auth_mode,
             approval_request_id, login_challenge_id, operation_fingerprint,
             open_idempotency_key
           ) VALUES (
             $1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14
           )`,
          [
            cashShiftId,
            principal.tenantId,
            cmd.outletId,
            cmd.terminalId,
            openingCash.amountMinor,
            openingCash.currencyCode,
            openingCash.minorUnitExponent,
            principal.userId,
            principal.employeeId,
            authMode,
            approvalRequestId,
            loginChallengeId,
            JSON.stringify(fingerprint),
            cmd.openIdempotencyKey,
          ],
        );
      } catch (err) {
        const pgErr = err as { code?: unknown; constraint?: unknown };
        const code = pgErr.code != null ? String(pgErr.code) : '';
        const constraint = pgErr.constraint != null ? String(pgErr.constraint) : '';
        if (code === '23505') {
          await client.query('ROLLBACK TO SAVEPOINT cash_shift_insert');
          if (
            constraint === 'cash_shift_open_idempotency_uq' ||
            constraint.includes('open_idempotency')
          ) {
            const raced = await client.query<CashShiftRow>(
              `SELECT * FROM cash_shift
               WHERE tenant_id = $1 AND open_idempotency_key = $2`,
              [principal.tenantId, cmd.openIdempotencyKey],
            );
            const row = raced.rows[0];
            if (
              row &&
              row.outlet_id === cmd.outletId &&
              row.terminal_id === cmd.terminalId &&
              row.opening_amount_minor === openingCash.amountMinor &&
              row.currency_code === openingCash.currencyCode &&
              row.minor_unit_exponent === openingCash.minorUnitExponent &&
              row.opened_by_user_id === principal.userId
            ) {
              // Peer won the insert; discard any local approval/challenge consume.
              await client.query('ROLLBACK');
              return mapRow(row);
            }
            throw new CashDomainError(
              'IDEMPOTENCY_CONFLICT',
              'openIdempotencyKey reused with different semantics',
            );
          }
          throw new CashDomainError('CASH_SHIFT_ALREADY_OPEN', 'Terminal already has an open CashShift');
        }
        throw err;
      }

      await audit(client, {
        tenantId: principal.tenantId,
        eventType: 'CASH_SHIFT_OPENED',
        actorUserId: principal.userId,
        subjectRef: cashShiftId,
        payload: {
          outletId: cmd.outletId,
          terminalId: cmd.terminalId,
          authMode,
          approvalRequestId,
          loginChallengeId,
          openingAmountMinor: openingCash.amountMinor,
          currencyCode: openingCash.currencyCode,
          minorUnitExponent: openingCash.minorUnitExponent,
          openIdempotencyKey: cmd.openIdempotencyKey,
        },
      });

      const inserted = await client.query<CashShiftRow>(
        `SELECT * FROM cash_shift WHERE cash_shift_id = $1`,
        [cashShiftId],
      );
      await client.query('COMMIT');
      return mapRow(inserted.rows[0]!);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * CloseCashShift (ADR-0046 / CASH1.2).
   * Server-authoritative expected from opening + Σ CASH PCE amount_collected_minor.
   * Locks cash_shift FOR UPDATE (ReceiveCash uses FOR SHARE on OPEN shift).
   */
  async closeShift(principal: AuthenticatedPrincipal, raw: unknown): Promise<CashShiftProjection> {
    const cmd = z
      .object({
        cashShiftId: uuid,
        closeIdempotencyKey: z.string().min(8).max(128),
        actualAmountMinor: z.string(),
        currencyCode: z.string(),
        minorUnitExponent: z.number().int(),
        reasonText: z.string().max(2000).optional(),
        expectedAmountMinor: z.string().optional(),
      })
      .strict()
      .parse(raw);

    assertNonNegativeMinor(cmd.actualAmountMinor, 'actualAmountMinor');
    if (cmd.expectedAmountMinor !== undefined) {
      assertNonNegativeMinor(cmd.expectedAmountMinor, 'expectedAmountMinor');
    }
    if (!/^[A-Z]{3}$/.test(cmd.currencyCode)) {
      throw new CashDomainError('INVALID_ACTUAL_CASH', 'currencyCode must be ISO-4217 alpha-3');
    }
    if (cmd.minorUnitExponent < 0 || cmd.minorUnitExponent > 4) {
      throw new CashDomainError('INVALID_ACTUAL_CASH', 'minorUnitExponent out of range');
    }

    const reasonTrimmed =
      cmd.reasonText !== undefined ? cmd.reasonText.trim() : undefined;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1 || chr(31) || $2, 0)
         )`,
        [principal.tenantId, `close:${cmd.closeIdempotencyKey}`],
      );

      const byKey = await client.query<CashShiftRow>(
        `SELECT * FROM cash_shift
         WHERE tenant_id = $1 AND close_idempotency_key = $2
         FOR UPDATE`,
        [principal.tenantId, cmd.closeIdempotencyKey],
      );
      if (byKey.rows[0]) {
        const row = byKey.rows[0];
        const same =
          row.cash_shift_id === cmd.cashShiftId &&
          row.actual_amount_minor === cmd.actualAmountMinor &&
          row.currency_code === cmd.currencyCode &&
          row.minor_unit_exponent === cmd.minorUnitExponent &&
          row.closed_by_user_id === principal.userId &&
          (row.close_reason_text ?? null) === (reasonTrimmed && reasonTrimmed.length > 0 ? reasonTrimmed : null);
        if (!same) {
          throw new CashDomainError(
            'IDEMPOTENCY_CONFLICT',
            'closeIdempotencyKey reused with different semantics',
          );
        }
        await client.query('COMMIT');
        return mapRow(row);
      }

      const locked = await client.query<CashShiftRow>(
        `SELECT * FROM cash_shift
         WHERE cash_shift_id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [cmd.cashShiftId, principal.tenantId],
      );
      const shift = locked.rows[0];
      if (!shift) {
        throw new CashDomainError('NOT_FOUND', 'CashShift not found');
      }
      if (shift.status === 'CLOSED') {
        throw new CashDomainError('CASH_SHIFT_ALREADY_CLOSED', 'CashShift already closed');
      }
      if (shift.status !== 'OPEN') {
        throw new CashDomainError('INVALID_STATE', `CashShift status ${shift.status} cannot close`);
      }

      if (
        shift.currency_code !== cmd.currencyCode ||
        shift.minor_unit_exponent !== cmd.minorUnitExponent
      ) {
        throw new CashDomainError(
          'CURRENCY_MISMATCH',
          'Close currency/exponent must match OPEN CashShift',
        );
      }

      const expected = await this.computeExpectedFromCashPce(client, shift);
      if (
        cmd.expectedAmountMinor !== undefined &&
        cmd.expectedAmountMinor !== expected.expectedAmountMinor
      ) {
        throw new CashDomainError(
          'EXPECTED_MISMATCH',
          'Client expectedAmountMinor does not match server expected',
        );
      }

      const differenceMinor = signedDifferenceMinor(
        cmd.actualAmountMinor,
        expected.expectedAmountMinor,
      );
      const varianceKind = varianceFromDifference(differenceMinor);
      const reasonText =
        reasonTrimmed && reasonTrimmed.length > 0 ? reasonTrimmed : null;

      if (varianceKind !== 'BALANCED' && !reasonText) {
        throw new CashDomainError(
          'REASON_REQUIRED',
          'reasonText is required when actual differs from expected',
        );
      }

      if (varianceKind === 'SHORTAGE') {
        const ok = await this.identity.hasPermission(
          client,
          principal.tenantId,
          principal.userId,
          PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE,
          shift.outlet_id,
          shift.terminal_id,
        );
        if (!ok) {
          throw new CashDomainError('FORBIDDEN', 'Shortage close requires cash_shift.close.shortage');
        }
      } else {
        const posOk = await this.identity.hasPermission(
          client,
          principal.tenantId,
          principal.userId,
          PERMISSION_POS_OPERATE,
          shift.outlet_id,
          shift.terminal_id,
        );
        const closeOk = await this.identity.hasPermission(
          client,
          principal.tenantId,
          principal.userId,
          PERMISSION_CASH_SHIFT_CLOSE,
          shift.outlet_id,
          shift.terminal_id,
        );
        if (!posOk || !closeOk) {
          throw new CashDomainError('FORBIDDEN', 'Permission denied');
        }
      }

      await client.query('SAVEPOINT cash_shift_close');
      try {
        await client.query(
          `UPDATE cash_shift SET
             status = 'CLOSED',
             closed_at = NOW(),
             closed_by_user_id = $2,
             closed_by_employee_id = $3,
             actual_amount_minor = $4,
             expected_amount_minor = $5,
             difference_minor = $6,
             variance_kind = $7,
             close_reason_text = $8,
             close_idempotency_key = $9,
             expected_source_refs = $10::jsonb
           WHERE cash_shift_id = $1 AND status = 'OPEN'`,
          [
            cmd.cashShiftId,
            principal.userId,
            principal.employeeId,
            cmd.actualAmountMinor,
            expected.expectedAmountMinor,
            differenceMinor,
            varianceKind,
            reasonText,
            cmd.closeIdempotencyKey,
            JSON.stringify(expected.sourceRefs),
          ],
        );
      } catch (err) {
        const pgErr = err as { code?: unknown; constraint?: unknown };
        const code = pgErr.code != null ? String(pgErr.code) : '';
        if (code === '23505') {
          await client.query('ROLLBACK TO SAVEPOINT cash_shift_close');
          const raced = await client.query<CashShiftRow>(
            `SELECT * FROM cash_shift
             WHERE tenant_id = $1 AND close_idempotency_key = $2`,
            [principal.tenantId, cmd.closeIdempotencyKey],
          );
          const row = raced.rows[0];
          if (
            row &&
            row.cash_shift_id === cmd.cashShiftId &&
            row.actual_amount_minor === cmd.actualAmountMinor &&
            row.closed_by_user_id === principal.userId
          ) {
            await client.query('ROLLBACK');
            return mapRow(row);
          }
          throw new CashDomainError(
            'IDEMPOTENCY_CONFLICT',
            'closeIdempotencyKey reused with different semantics',
          );
        }
        throw err;
      }

      const updated = await client.query<{ status: string }>(
        `SELECT status FROM cash_shift WHERE cash_shift_id = $1`,
        [cmd.cashShiftId],
      );
      if (updated.rows[0]?.status !== 'CLOSED') {
        throw new CashDomainError('CASH_SHIFT_ALREADY_CLOSED', 'CashShift already closed');
      }

      await audit(client, {
        tenantId: principal.tenantId,
        eventType: 'CASH_SHIFT_CLOSED',
        actorUserId: principal.userId,
        subjectRef: cmd.cashShiftId,
        payload: {
          outletId: shift.outlet_id,
          terminalId: shift.terminal_id,
          actualAmountMinor: cmd.actualAmountMinor,
          expectedAmountMinor: expected.expectedAmountMinor,
          differenceMinor,
          varianceKind,
          closeReasonText: reasonText,
          closeIdempotencyKey: cmd.closeIdempotencyKey,
          expectedSourceRefs: expected.sourceRefs,
        },
      });

      const closed = await client.query<CashShiftRow>(
        `SELECT * FROM cash_shift WHERE cash_shift_id = $1`,
        [cmd.cashShiftId],
      );
      await client.query('COMMIT');
      return mapRow(closed.rows[0]!);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Fail-closed expected: opening + Σ amount_collected_minor of CASH_RECEIVE PCE
   * bound via payment_cash_collection_evidence.cash_shift_id.
   */
  private async computeExpectedFromCashPce(
    client: PoolClient,
    shift: CashShiftRow,
  ): Promise<{ expectedAmountMinor: string; sourceRefs: string[] }> {
    const res = await client.query<{
      payment_collection_event_id: string;
      amount_collected_minor: string;
      currency_code: string;
      minor_unit_exponent: number;
    }>(
      `SELECT pce.payment_collection_event_id,
              pce.amount_collected_minor,
              pce.currency_code,
              pce.minor_unit_exponent
       FROM payment_collection_event pce
       INNER JOIN payment_cash_collection_evidence e
         ON e.payment_cash_collection_evidence_id = pce.payment_cash_collection_evidence_id
       WHERE e.cash_shift_id = $1
         AND pce.tenant_id = $2
         AND pce.collection_evidence_kind = 'CASH_RECEIVE'
         AND pce.instrument_family = 'CASH'
       ORDER BY pce.collected_at ASC, pce.payment_collection_event_id ASC`,
      [shift.cash_shift_id, shift.tenant_id],
    );

    let sum = BigInt(shift.opening_amount_minor);
    const sourceRefs: string[] = [];
    for (const row of res.rows) {
      if (!/^[0-9]+$/.test(row.amount_collected_minor)) {
        throw new CashDomainError(
          'EXPECTED_BASE_INCOMPLETE',
          'PaymentCollectionEvent amount_collected_minor is not a non-negative digit string',
        );
      }
      if (
        row.currency_code !== shift.currency_code ||
        row.minor_unit_exponent !== shift.minor_unit_exponent
      ) {
        throw new CashDomainError(
          'CURRENCY_MISMATCH',
          'Cash PCE currency/exponent incompatible with OPEN CashShift',
        );
      }
      sum += BigInt(row.amount_collected_minor);
      sourceRefs.push(row.payment_collection_event_id);
    }

    return { expectedAmountMinor: sum.toString(), sourceRefs };
  }

  private async consumeLoginChallenge(
    client: PoolClient,
    principal: AuthenticatedPrincipal,
    loginChallengeId: string,
    outletId: string,
    terminalId: string,
  ): Promise<string> {
    const ch = await client.query<{
      login_challenge_id: string;
      tenant_id: string;
      outlet_id: string;
      terminal_id: string;
      user_id: string;
      status: string;
      expires_at: Date;
    }>(
      `SELECT * FROM identity_login_challenge WHERE login_challenge_id = $1 FOR UPDATE`,
      [loginChallengeId],
    );
    const row = ch.rows[0];
    if (
      !row ||
      row.tenant_id !== principal.tenantId ||
      row.user_id !== principal.userId ||
      row.outlet_id !== outletId ||
      row.terminal_id !== terminalId ||
      row.status !== 'CONFIRMED' ||
      row.expires_at <= new Date()
    ) {
      throw new CashDomainError('AUTH_EVIDENCE_INVALID', 'LoginChallenge invalid');
    }
    const upd = await client.query(
      `UPDATE identity_login_challenge
       SET status = 'CONSUMED', consumed_at = NOW()
       WHERE login_challenge_id = $1 AND status = 'CONFIRMED'`,
      [loginChallengeId],
    );
    if (upd.rowCount !== 1) {
      throw new CashDomainError('AUTH_EVIDENCE_INVALID', 'LoginChallenge invalid');
    }
    return row.login_challenge_id;
  }

  private async consumeApproval(
    client: PoolClient,
    principal: AuthenticatedPrincipal,
    approvalRequestId: string,
    expectedFingerprint: Record<string, unknown>,
    outletId: string,
    terminalId: string,
    loginChallengeId: string | null,
  ): Promise<string> {
    const res = await client.query<{
      approval_request_id: string;
      tenant_id: string;
      outlet_id: string;
      terminal_id: string;
      requester_user_id: string;
      operation_type: string;
      operation_fingerprint: Record<string, unknown>;
      login_challenge_id: string | null;
      status: string;
      expires_at: Date;
    }>(
      `SELECT * FROM identity_approval_request WHERE approval_request_id = $1 FOR UPDATE`,
      [approvalRequestId],
    );
    const row = res.rows[0];
    if (!row || row.tenant_id !== principal.tenantId) {
      throw new CashDomainError('NOT_FOUND', 'Approval request not found');
    }
    if (
      row.requester_user_id !== principal.userId ||
      row.outlet_id !== outletId ||
      row.terminal_id !== terminalId ||
      row.operation_type !== CASH_SHIFT_OPERATION_TYPE ||
      row.status !== 'APPROVED' ||
      row.expires_at <= new Date()
    ) {
      throw new CashDomainError('AUTH_EVIDENCE_INVALID', 'Approval request invalid');
    }
    if (loginChallengeId && row.login_challenge_id && row.login_challenge_id !== loginChallengeId) {
      throw new CashDomainError('AUTH_EVIDENCE_INVALID', 'Approval challenge mismatch');
    }
    const stored =
      typeof row.operation_fingerprint === 'string'
        ? (JSON.parse(row.operation_fingerprint) as Record<string, unknown>)
        : row.operation_fingerprint;
    if (!fingerprintsMatch(stored, expectedFingerprint)) {
      throw new CashDomainError('AUTH_EVIDENCE_INVALID', 'Approval fingerprint mismatch');
    }
    const upd = await client.query(
      `UPDATE identity_approval_request
       SET status = 'CONSUMED', consumed_at = NOW()
       WHERE approval_request_id = $1 AND status = 'APPROVED'`,
      [approvalRequestId],
    );
    if (upd.rowCount !== 1) {
      throw new CashDomainError('AUTH_EVIDENCE_INVALID', 'Approval already consumed');
    }
    return row.approval_request_id;
  }
}
