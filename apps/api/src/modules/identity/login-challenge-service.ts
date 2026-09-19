import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  audit,
  CHALLENGE_TOKEN_BYTES,
  generateOpaqueToken,
  sha256Hex,
  type AuthenticatedPrincipal,
  type IdentityService,
} from './identity-service.js';
import {
  APPROVAL_TTL_SECONDS,
  CHALLENGE_TTL_SECONDS,
  IdentityDomainError,
  PERMISSION_CASH_SHIFT_OPEN_APPROVE,
} from './errors.js';
import type { NotificationPort } from './notification-port.js';

const uuid = z.string().uuid();

export type LoginChallengeCreated = {
  readonly loginChallengeId: string;
  readonly qrToken: string;
  readonly expiresAt: string;
  readonly outletId: string;
  readonly terminalId: string;
};

/**
 * LoginChallenge: QR possession alone never authenticates.
 * Confirm requires already-authenticated MOBILE principal matching target user.
 * Confirm does NOT create a new cashier Session.
 */
export class LoginChallengeService {
  constructor(
    private readonly pool: Pool,
    private readonly identity: IdentityService,
  ) {}

  async createChallenge(
    principal: AuthenticatedPrincipal,
    raw: unknown,
  ): Promise<LoginChallengeCreated> {
    if (principal.channel !== 'TERMINAL') {
      throw new IdentityDomainError('FORBIDDEN', 'Login challenge must be created from terminal session');
    }
    const cmd = z
      .object({
        outletId: uuid,
        terminalId: uuid,
      })
      .strict()
      .parse(raw);

    const terminal = await this.pool.query<{
      terminal_id: string;
      outlet_id: string;
      tenant_id: string;
    }>(
      `SELECT terminal_id, outlet_id, tenant_id FROM terminal
       WHERE terminal_id = $1 AND tenant_id = $2`,
      [cmd.terminalId, principal.tenantId],
    );
    if (terminal.rowCount !== 1 || terminal.rows[0]!.outlet_id !== cmd.outletId) {
      throw new IdentityDomainError('TERMINAL_NOT_FOUND', 'Terminal not found for outlet');
    }

    const qrToken = generateOpaqueToken(CHALLENGE_TOKEN_BYTES);
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

    await this.pool.query(
      `INSERT INTO identity_login_challenge (
         login_challenge_id, tenant_id, outlet_id, terminal_id,
         user_id, employee_id, session_id, challenge_token_hash,
         status, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9)`,
      [
        challengeId,
        principal.tenantId,
        cmd.outletId,
        cmd.terminalId,
        principal.userId,
        principal.employeeId,
        principal.sessionId,
        sha256Hex(qrToken),
        expiresAt.toISOString(),
      ],
    );

    await audit(this.pool, {
      tenantId: principal.tenantId,
      eventType: 'LOGIN_CHALLENGE_CREATED',
      actorUserId: principal.userId,
      subjectRef: challengeId,
      payload: { outletId: cmd.outletId, terminalId: cmd.terminalId },
    });

    return {
      loginChallengeId: challengeId,
      qrToken,
      expiresAt: expiresAt.toISOString(),
      outletId: cmd.outletId,
      terminalId: cmd.terminalId,
    };
  }

  async confirmChallenge(
    mobilePrincipal: AuthenticatedPrincipal,
    raw: unknown,
  ): Promise<{ confirmed: true }> {
    if (mobilePrincipal.channel !== 'MOBILE') {
      throw new IdentityDomainError('FORBIDDEN', 'Challenge confirmation requires mobile session');
    }
    const cmd = z
      .object({
        qrToken: z.string().min(20).max(128),
      })
      .strict()
      .parse(raw);

    const hash = sha256Hex(cmd.qrToken);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{
        login_challenge_id: string;
        tenant_id: string;
        user_id: string;
        status: string;
        expires_at: Date;
      }>(
        `SELECT login_challenge_id, tenant_id, user_id, status, expires_at
         FROM identity_login_challenge
         WHERE challenge_token_hash = $1
         FOR UPDATE`,
        [hash],
      );

      if (res.rowCount !== 1) {
        await audit(client, {
          tenantId: mobilePrincipal.tenantId,
          eventType: 'LOGIN_CHALLENGE_CONFIRM_FAILED',
          actorUserId: mobilePrincipal.userId,
          payload: { reason: 'NOT_FOUND' },
        });
        throw new IdentityDomainError('CHALLENGE_INVALID', 'Challenge invalid or expired');
      }
      const row = res.rows[0]!;
      if (row.tenant_id !== mobilePrincipal.tenantId || row.user_id !== mobilePrincipal.userId) {
        await audit(client, {
          tenantId: mobilePrincipal.tenantId,
          eventType: 'LOGIN_CHALLENGE_CONFIRM_FAILED',
          actorUserId: mobilePrincipal.userId,
          subjectRef: row.login_challenge_id,
          payload: { reason: 'SCOPE_MISMATCH' },
        });
        throw new IdentityDomainError('CHALLENGE_INVALID', 'Challenge invalid or expired');
      }
      if (row.status !== 'PENDING' || row.expires_at <= new Date()) {
        await client.query(
          `UPDATE identity_login_challenge SET status = 'EXPIRED'
           WHERE login_challenge_id = $1 AND status = 'PENDING'`,
          [row.login_challenge_id],
        );
        await audit(client, {
          tenantId: mobilePrincipal.tenantId,
          eventType: 'LOGIN_CHALLENGE_CONFIRM_FAILED',
          actorUserId: mobilePrincipal.userId,
          subjectRef: row.login_challenge_id,
          payload: { reason: row.status === 'PENDING' ? 'EXPIRED' : 'REUSE' },
        });
        throw new IdentityDomainError('CHALLENGE_INVALID', 'Challenge invalid or expired');
      }

      await client.query(
        `UPDATE identity_login_challenge
         SET status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by_session_id = $2
         WHERE login_challenge_id = $1 AND status = 'PENDING'`,
        [row.login_challenge_id, mobilePrincipal.sessionId],
      );
      await audit(client, {
        tenantId: mobilePrincipal.tenantId,
        eventType: 'LOGIN_CHALLENGE_CONFIRMED',
        actorUserId: mobilePrincipal.userId,
        subjectRef: row.login_challenge_id,
      });
      await client.query('COMMIT');
      // Does NOT create a cashier Session — existing terminal session remains.
      return { confirmed: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

export class ApprovalRequestService {
  constructor(
    private readonly pool: Pool,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationPort,
  ) {}

  async createRequest(
    principal: AuthenticatedPrincipal,
    raw: unknown,
  ): Promise<{ approvalRequestId: string; expiresAt: string }> {
    const cmd = z
      .object({
        outletId: uuid,
        terminalId: uuid,
        operationType: z.string().min(3).max(64),
        operationFingerprint: z.record(z.unknown()),
        loginChallengeId: uuid.optional(),
      })
      .strict()
      .parse(raw);

    const terminal = await this.pool.query(
      `SELECT 1 FROM terminal WHERE terminal_id = $1 AND tenant_id = $2 AND outlet_id = $3`,
      [cmd.terminalId, principal.tenantId, cmd.outletId],
    );
    if (terminal.rowCount !== 1) {
      throw new IdentityDomainError('TERMINAL_NOT_FOUND', 'Terminal not found for outlet');
    }

    if (cmd.loginChallengeId) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const ch = await client.query<{
          status: string;
          user_id: string;
          tenant_id: string;
          outlet_id: string;
          terminal_id: string;
        }>(
          `SELECT status, user_id, tenant_id, outlet_id, terminal_id
           FROM identity_login_challenge
           WHERE login_challenge_id = $1
           FOR UPDATE`,
          [cmd.loginChallengeId],
        );
        const row = ch.rows[0];
        if (
          !row ||
          row.tenant_id !== principal.tenantId ||
          row.user_id !== principal.userId ||
          row.outlet_id !== cmd.outletId ||
          row.terminal_id !== cmd.terminalId ||
          row.status !== 'CONFIRMED'
        ) {
          throw new IdentityDomainError('CHALLENGE_INVALID', 'Challenge invalid or expired');
        }
        await client.query(
          `UPDATE identity_login_challenge
           SET status = 'CONSUMED', consumed_at = NOW()
           WHERE login_challenge_id = $1 AND status = 'CONFIRMED'`,
          [cmd.loginChallengeId],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_SECONDS * 1000);
    const fingerprint = {
      ...cmd.operationFingerprint,
      operationType: cmd.operationType,
      tenantId: principal.tenantId,
      outletId: cmd.outletId,
      terminalId: cmd.terminalId,
      requesterUserId: principal.userId,
    };

    await this.pool.query(
      `INSERT INTO identity_approval_request (
         approval_request_id, tenant_id, outlet_id, terminal_id,
         requester_user_id, requester_employee_id, operation_type, operation_fingerprint,
         login_challenge_id, status, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'PENDING',$10)`,
      [
        requestId,
        principal.tenantId,
        cmd.outletId,
        cmd.terminalId,
        principal.userId,
        principal.employeeId,
        cmd.operationType,
        JSON.stringify(fingerprint),
        cmd.loginChallengeId ?? null,
        expiresAt.toISOString(),
      ],
    );

    await audit(this.pool, {
      tenantId: principal.tenantId,
      eventType: 'APPROVAL_REQUEST_CREATED',
      actorUserId: principal.userId,
      subjectRef: requestId,
      payload: { operationType: cmd.operationType, outletId: cmd.outletId, terminalId: cmd.terminalId },
    });

    await this.notifications.enqueue({
      type: 'DANGEROUS_OPERATION_APPROVAL_REQUESTED',
      tenantId: principal.tenantId,
      outletId: cmd.outletId,
      terminalId: cmd.terminalId,
      approvalRequestId: requestId,
      requesterUserId: principal.userId,
      requesterEmployeeId: principal.employeeId,
      requesterDisplayName: principal.displayName,
      operationType: cmd.operationType,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    });

    return { approvalRequestId: requestId, expiresAt: expiresAt.toISOString() };
  }

  async decide(
    principal: AuthenticatedPrincipal,
    approvalRequestId: string,
    raw: unknown,
  ): Promise<{ status: 'APPROVED' | 'REJECTED' }> {
    const cmd = z
      .object({
        decision: z.enum(['APPROVE', 'REJECT']),
      })
      .strict()
      .parse(raw);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{
        approval_request_id: string;
        tenant_id: string;
        outlet_id: string;
        terminal_id: string;
        requester_user_id: string;
        status: string;
        expires_at: Date;
      }>(
        `SELECT * FROM identity_approval_request WHERE approval_request_id = $1 FOR UPDATE`,
        [approvalRequestId],
      );
      if (res.rowCount !== 1 || res.rows[0]!.tenant_id !== principal.tenantId) {
        throw new IdentityDomainError('APPROVAL_NOT_FOUND', 'Approval request not found');
      }
      const row = res.rows[0]!;
      const canApprove = await this.identity.hasPermission(
        client,
        principal.tenantId,
        principal.userId,
        PERMISSION_CASH_SHIFT_OPEN_APPROVE,
        row.outlet_id,
        row.terminal_id,
      );
      if (!canApprove) {
        throw new IdentityDomainError('FORBIDDEN', 'Permission denied');
      }
      if (row.requester_user_id === principal.userId) {
        throw new IdentityDomainError('FORBIDDEN', 'Cannot approve own request');
      }
      if (row.status !== 'PENDING' || row.expires_at <= new Date()) {
        if (row.status === 'PENDING') {
          await client.query(
            `UPDATE identity_approval_request SET status = 'EXPIRED' WHERE approval_request_id = $1`,
            [approvalRequestId],
          );
        }
        throw new IdentityDomainError('APPROVAL_INVALID', 'Approval request invalid or expired');
      }

      const next = cmd.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await client.query(
        `UPDATE identity_approval_request
         SET status = $2, decided_by_user_id = $3, decided_at = NOW()
         WHERE approval_request_id = $1 AND status = 'PENDING'`,
        [approvalRequestId, next, principal.userId],
      );
      await audit(client, {
        tenantId: principal.tenantId,
        eventType: next === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
        actorUserId: principal.userId,
        subjectRef: approvalRequestId,
      });
      await client.query('COMMIT');
      return { status: next };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
