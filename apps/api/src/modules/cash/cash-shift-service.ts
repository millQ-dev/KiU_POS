import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  audit,
  type AuthenticatedPrincipal,
  type IdentityService,
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
};

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
  };
}

/**
 * Cash owns CashShift. CASH1.1: OpenCashShift only.
 * Authorization evidence from Identity (Session / AccessGrant / ApprovalRequest / optional LoginChallenge).
 * Permission composition (SEC-0): pos.operate AND (cash_shift.open | APPROVAL path).
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
