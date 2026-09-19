import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { CompanyIdentityService, normalizeCompanyCode } from '../organization/company-identity-service.js';
import {
  dummyPinWork,
  generateOpaqueToken,
  hashPin,
  isValidPinFormat,
  pinLookupHash,
  requirePepper,
  sha256Hex,
  verifyPin,
  CHALLENGE_TOKEN_BYTES,
  SESSION_SECRET_BYTES,
} from './crypto.js';
import {
  IdentityDomainError,
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  SESSION_TTL_HOURS,
} from './errors.js';

const uuid = z.string().uuid();

export type AuthenticatedPrincipal = {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly employeeId: string | null;
  readonly displayName: string;
  readonly channel: 'TERMINAL' | 'MOBILE';
};

export type PinAuthResult = {
  readonly sessionToken: string;
  readonly userId: string;
  readonly employeeId: string | null;
  readonly displayName: string;
};

async function audit(
  client: Pool | PoolClient,
  row: {
    tenantId: string;
    eventType: string;
    actorUserId?: string | null;
    subjectRef?: string | null;
    payload?: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO identity_audit_event
       (audit_event_id, tenant_id, event_type, actor_user_id, subject_ref, payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      randomUUID(),
      row.tenantId,
      row.eventType,
      row.actorUserId ?? null,
      row.subjectRef ?? null,
      JSON.stringify(row.payload ?? {}),
    ],
  );
}

export class IdentityService {
  private readonly pepper: string;
  private readonly company: CompanyIdentityService;

  constructor(
    private readonly pool: Pool,
    pepper: string | undefined,
  ) {
    this.pepper = requirePepper(pepper);
    this.company = new CompanyIdentityService(pool);
  }

  async provisionUserWithPin(input: {
    tenantId: string;
    displayName: string;
    pin: string;
    employeeDisplayName?: string;
    grants?: Array<{
      permissionKey: string;
      outletId?: string | null;
      terminalId?: string | null;
    }>;
  }): Promise<{ userId: string; employeeId: string }> {
    if (!isValidPinFormat(input.pin)) {
      throw new IdentityDomainError('INVALID_PIN_FORMAT', 'PIN must be 4–12 digits');
    }
    const lookup = pinLookupHash(input.pin, this.pepper, input.tenantId);
    const clash = await this.pool.query(
      `SELECT 1 FROM identity_pin_credential WHERE tenant_id = $1 AND pin_lookup_hash = $2`,
      [input.tenantId, lookup],
    );
    if ((clash.rowCount ?? 0) > 0) {
      throw new IdentityDomainError('PIN_ALREADY_IN_USE', 'PIN already in use for this company');
    }
    const userId = randomUUID();
    const employeeId = randomUUID();
    const { saltHex, hashHex, kdfVersion } = hashPin(input.pin, this.pepper);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO identity_user (user_id, tenant_id, display_name) VALUES ($1,$2,$3)`,
        [userId, input.tenantId, input.displayName],
      );
      await client.query(
        `INSERT INTO workforce_employee (employee_id, tenant_id, display_name, user_id)
         VALUES ($1,$2,$3,$4)`,
        [employeeId, input.tenantId, input.employeeDisplayName ?? input.displayName, userId],
      );
      await client.query(
        `INSERT INTO identity_pin_credential
           (user_id, tenant_id, pin_hash, pin_salt, pin_lookup_hash, kdf_version)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, input.tenantId, hashHex, saltHex, lookup, kdfVersion],
      );
      for (const g of input.grants ?? []) {
        await client.query(
          `INSERT INTO identity_access_grant
             (access_grant_id, tenant_id, user_id, permission_key, outlet_id, terminal_id, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
          [
            randomUUID(),
            input.tenantId,
            userId,
            g.permissionKey,
            g.outletId ?? null,
            g.terminalId ?? null,
          ],
        );
      }
      await client.query('COMMIT');
      return { userId, employeeId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Atomic throttle increment. Parallel callers cannot lose increments.
   * Returns whether the dimension is currently locked after this update.
   */
  async bumpThrottle(
    client: Pool | PoolClient,
    tenantId: string,
    dimension: 'IP' | 'COMPANY_IP' | 'PIN_CANDIDATE',
    dimKey: string,
  ): Promise<{ locked: boolean; failedAttempts: number }> {
    const res = await client.query<{ failed_attempts: number; locked_until: Date | null }>(
      `INSERT INTO identity_auth_throttle
         (throttle_id, tenant_id, dimension, dim_key, failed_attempts, locked_until, updated_at)
       VALUES ($1,$2,$3,$4,1,NULL,NOW())
       ON CONFLICT (tenant_id, dimension, dim_key) DO UPDATE
         SET failed_attempts = identity_auth_throttle.failed_attempts + 1,
             locked_until = CASE
               WHEN identity_auth_throttle.failed_attempts + 1 >= $5
               THEN NOW() + ($6::text || ' minutes')::interval
               ELSE identity_auth_throttle.locked_until
             END,
             updated_at = NOW()
       RETURNING failed_attempts, locked_until`,
      [randomUUID(), tenantId, dimension, dimKey, PIN_MAX_ATTEMPTS, String(PIN_LOCK_MINUTES)],
    );
    const row = res.rows[0]!;
    const locked = !!(row.locked_until && row.locked_until > new Date());
    return { locked, failedAttempts: row.failed_attempts };
  }

  async isThrottleLocked(
    client: Pool | PoolClient,
    tenantId: string,
    dimension: string,
    dimKey: string,
  ): Promise<boolean> {
    const res = await client.query<{ locked_until: Date | null }>(
      `SELECT locked_until FROM identity_auth_throttle
       WHERE tenant_id = $1 AND dimension = $2 AND dim_key = $3`,
      [tenantId, dimension, dimKey],
    );
    const until = res.rows[0]?.locked_until;
    return !!(until && until > new Date());
  }

  async authenticatePin(
    raw: unknown,
    networkKey: string,
  ): Promise<PinAuthResult> {
    const cmd = z
      .object({
        companyCode: z.string().min(3).max(32),
        pin: z.string().min(1).max(32),
        channel: z.enum(['TERMINAL', 'MOBILE']).default('TERMINAL'),
      })
      .strict()
      .parse(raw);

    const companyCode = normalizeCompanyCode(cmd.companyCode);
    const tenantId = await this.company.resolveTenantIdByCompanyCode(companyCode);

    const fail = async (tid: string | null, reason: string) => {
      if (tid) {
        await audit(this.pool, {
          tenantId: tid,
          eventType: 'PIN_AUTH_FAILED',
          payload: { reason },
        });
      }
      throw new IdentityDomainError('AUTH_FAILED', 'Invalid credentials');
    };

    if (!tenantId) {
      dummyPinWork(this.pepper);
      throw new IdentityDomainError('AUTH_FAILED', 'Invalid credentials');
    }

    if (!isValidPinFormat(cmd.pin)) {
      dummyPinWork(this.pepper);
      await fail(tenantId, 'FORMAT');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const companyIpKey = sha256Hex(`${companyCode}|${networkKey}`);
      if (await this.isThrottleLocked(client, tenantId, 'COMPANY_IP', companyIpKey)) {
        await audit(client, {
          tenantId,
          eventType: 'PIN_AUTH_FAILED',
          payload: { reason: 'THROTTLE_LOCKED' },
        });
        await client.query('COMMIT');
        throw new IdentityDomainError('AUTH_FAILED', 'Invalid credentials');
      }

      const lookup = pinLookupHash(cmd.pin, this.pepper, tenantId);
      const cred = await client.query<{
        user_id: string;
        pin_hash: string;
        pin_salt: string;
        failed_attempts: number;
        locked_until: Date | null;
        display_name: string;
        status: string;
        employee_id: string | null;
        kdf_version: number;
      }>(
        `SELECT c.user_id, c.pin_hash, c.pin_salt, c.failed_attempts, c.locked_until,
                c.kdf_version, u.display_name, u.status, e.employee_id
         FROM identity_pin_credential c
         JOIN identity_user u ON u.user_id = c.user_id AND u.tenant_id = c.tenant_id
         LEFT JOIN workforce_employee e ON e.user_id = u.user_id AND e.tenant_id = u.tenant_id
         WHERE c.tenant_id = $1 AND c.pin_lookup_hash = $2
         FOR UPDATE OF c`,
        [tenantId, lookup],
      );

      if (cred.rowCount !== 1) {
        await this.bumpThrottle(client, tenantId, 'COMPANY_IP', companyIpKey);
        await this.bumpThrottle(client, tenantId, 'PIN_CANDIDATE', lookup);
        dummyPinWork(this.pepper);
        await audit(client, {
          tenantId,
          eventType: 'PIN_AUTH_FAILED',
          payload: { reason: 'NO_MATCH' },
        });
        await client.query('COMMIT');
        throw new IdentityDomainError('AUTH_FAILED', 'Invalid credentials');
      }

      const row = cred.rows[0]!;
      const now = new Date();
      if (row.status !== 'ACTIVE' || (row.locked_until && row.locked_until > now)) {
        await this.bumpThrottle(client, tenantId, 'COMPANY_IP', companyIpKey);
        await audit(client, {
          tenantId,
          eventType: 'PIN_AUTH_FAILED',
          actorUserId: row.user_id,
          payload: { reason: 'LOCKED_OR_DISABLED' },
        });
        await client.query('COMMIT');
        throw new IdentityDomainError('AUTH_FAILED', 'Invalid credentials');
      }

      if (!verifyPin(cmd.pin, this.pepper, row.pin_salt, row.pin_hash)) {
        // Integrity mismatch: treat as failure against this credential (atomic).
        const upd = await client.query<{ failed_attempts: number; locked_until: Date | null }>(
          `UPDATE identity_pin_credential
           SET failed_attempts = failed_attempts + 1,
               locked_until = CASE
                 WHEN failed_attempts + 1 >= $2
                 THEN NOW() + ($3::text || ' minutes')::interval
                 ELSE locked_until
               END,
               updated_at = NOW()
           WHERE user_id = $1
           RETURNING failed_attempts, locked_until`,
          [row.user_id, PIN_MAX_ATTEMPTS, String(PIN_LOCK_MINUTES)],
        );
        await this.bumpThrottle(client, tenantId, 'COMPANY_IP', companyIpKey);
        await audit(client, {
          tenantId,
          eventType: 'PIN_AUTH_FAILED',
          actorUserId: row.user_id,
          payload: {
            reason: 'VERIFY_FAIL',
            failedAttempts: upd.rows[0]?.failed_attempts,
          },
        });
        await client.query('COMMIT');
        throw new IdentityDomainError('AUTH_FAILED', 'Invalid credentials');
      }

      await client.query(
        `UPDATE identity_pin_credential
         SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
         WHERE user_id = $1`,
        [row.user_id],
      );
      await client.query(
        `DELETE FROM identity_auth_throttle
         WHERE tenant_id = $1 AND dimension = 'COMPANY_IP' AND dim_key = $2`,
        [tenantId, companyIpKey],
      );

      const sessionToken = generateOpaqueToken(SESSION_SECRET_BYTES);
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);
      await client.query(
        `INSERT INTO identity_session
           (session_id, tenant_id, user_id, employee_id, token_hash, channel, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          sessionId,
          tenantId,
          row.user_id,
          row.employee_id,
          sha256Hex(sessionToken),
          cmd.channel,
          expiresAt.toISOString(),
        ],
      );

      await audit(client, {
        tenantId,
        eventType: 'PIN_AUTH_SUCCEEDED',
        actorUserId: row.user_id,
        subjectRef: sessionId,
        payload: { channel: cmd.channel },
      });
      await client.query('COMMIT');

      return {
        sessionToken,
        userId: row.user_id,
        employeeId: row.employee_id,
        displayName: row.display_name,
      };
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

  async resolveSession(sessionToken: string): Promise<AuthenticatedPrincipal> {
    if (!sessionToken || sessionToken.length < 20) {
      throw new IdentityDomainError('SESSION_INVALID', 'Invalid session');
    }
    const hash = sha256Hex(sessionToken);
    const res = await this.pool.query<{
      session_id: string;
      tenant_id: string;
      user_id: string;
      employee_id: string | null;
      display_name: string;
      channel: 'TERMINAL' | 'MOBILE';
      expires_at: Date;
      revoked_at: Date | null;
      status: string;
    }>(
      `SELECT s.session_id, s.tenant_id, s.user_id, s.employee_id, s.channel,
              s.expires_at, s.revoked_at, u.display_name, u.status
       FROM identity_session s
       JOIN identity_user u ON u.user_id = s.user_id AND u.tenant_id = s.tenant_id
       WHERE s.token_hash = $1`,
      [hash],
    );
    if (res.rowCount !== 1) {
      throw new IdentityDomainError('SESSION_INVALID', 'Invalid session');
    }
    const row = res.rows[0]!;
    if (row.revoked_at || row.expires_at <= new Date() || row.status !== 'ACTIVE') {
      throw new IdentityDomainError('SESSION_INVALID', 'Invalid session');
    }
    return {
      sessionId: row.session_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      employeeId: row.employee_id,
      displayName: row.display_name,
      channel: row.channel,
    };
  }

  async revokeSession(principal: AuthenticatedPrincipal): Promise<void> {
    await this.pool.query(
      `UPDATE identity_session SET revoked_at = NOW()
       WHERE session_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [principal.sessionId, principal.tenantId],
    );
    await audit(this.pool, {
      tenantId: principal.tenantId,
      eventType: 'SESSION_REVOKED',
      actorUserId: principal.userId,
      subjectRef: principal.sessionId,
    });
  }

  async hasPermission(
    client: Pool | PoolClient,
    tenantId: string,
    userId: string,
    permissionKey: string,
    outletId: string | null,
    terminalId: string | null = null,
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM identity_access_grant
       WHERE tenant_id = $1 AND user_id = $2 AND permission_key = $3
         AND enabled AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (outlet_id IS NULL OR outlet_id = $4)
         AND (terminal_id IS NULL OR terminal_id = $5)
       LIMIT 1`,
      [tenantId, userId, permissionKey, outletId, terminalId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async assertPermission(
    principal: AuthenticatedPrincipal,
    permissionKey: string,
    outletId: string | null,
    terminalId: string | null = null,
  ): Promise<void> {
    const ok = await this.hasPermission(
      this.pool,
      principal.tenantId,
      principal.userId,
      permissionKey,
      outletId,
      terminalId,
    );
    if (!ok) {
      await audit(this.pool, {
        tenantId: principal.tenantId,
        eventType: 'ACCESS_GRANT_DENIED',
        actorUserId: principal.userId,
        payload: { permissionKey, outletId, terminalId },
      });
      throw new IdentityDomainError('FORBIDDEN', 'Permission denied');
    }
  }

  get poolRef(): Pool {
    return this.pool;
  }

  get pepperForTests(): string {
    return this.pepper;
  }
}

export { audit, generateOpaqueToken, sha256Hex, CHALLENGE_TOKEN_BYTES };
