/**
 * F05 — LoginChallenge denial audit survives failed-confirm rollback.
 * Destructive — millq_ci_pos_* only. Assert allowlist before migrate/TRUNCATE.
 * Scope: existing POS LoginChallenge (ADR-0036 / ID1.1). Not Office/Global Account QR/MFA.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import {
  assertPosDisposableDatabaseUrl,
  isPosDisposableDatabaseUrl,
} from '../../test/disposable-database-url.js';
import { resolvePinPepper } from '../../config.js';
import { IdentityService, LoginChallengeService, requirePepper } from './index.js';
import { generateOpaqueToken, sha256Hex, CHALLENGE_TOKEN_BYTES } from './crypto.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RUN_DISPOSABLE = isPosDisposableDatabaseUrl(DATABASE_URL);
const describeDenial = RUN_DISPOSABLE ? describe : describe.skip;

const PEPPER = resolvePinPepper({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DATABASE_URL,
  CORS_ORIGINS: 'http://localhost:5173',
} as never);

let pool: pg.Pool;
let fx: BlockCFixture;
let identity: IdentityService;
let challenges: LoginChallengeService;
let companyCode: string;
let terminalId: string;

async function truncateBusiness() {
  assertPosDisposableDatabaseUrl(DATABASE_URL);
  await pool.query(`
    TRUNCATE
      cash_shift,
      identity_notification_outbox, identity_audit_event,
      identity_approval_request, identity_login_challenge,
      identity_session, identity_access_grant, identity_auth_throttle,
      identity_network_throttle,
      identity_pin_credential, workforce_employee, identity_user, terminal,
      operational_fact_feed, audit_record,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function createTerminal(tenantId: string, outletId: string) {
  terminalId = randomUUID();
  await pool.query(
    `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
     VALUES ($1,$2,$3,'T1','Front POS')`,
    [terminalId, tenantId, outletId],
  );
}

async function provisionAndSessions(pin = '123456') {
  await identity.provisionUserWithPin({
    tenantId: fx.tenantId,
    displayName: 'Cashier',
    pin,
  });
  const term = await identity.authenticatePin(
    { companyCode, pin, channel: 'TERMINAL' },
    '1.1.1.1',
  );
  const mobile = await identity.authenticatePin(
    { companyCode, pin, channel: 'MOBILE' },
    '2.2.2.2',
  );
  return {
    termPrincipal: await identity.resolveSession(term.sessionToken),
    mobilePrincipal: await identity.resolveSession(mobile.sessionToken),
  };
}

async function countSessions() {
  const r = await pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM identity_session`);
  return r.rows[0]!.c;
}

async function denialAudits(reason?: string) {
  const r = await pool.query<{
    event_type: string;
    actor_user_id: string | null;
    subject_ref: string | null;
    payload: { reason?: string };
  }>(
    `SELECT event_type, actor_user_id, subject_ref, payload
     FROM identity_audit_event
     WHERE event_type = 'LOGIN_CHALLENGE_CONFIRM_FAILED'
     ORDER BY occurred_at ASC`,
  );
  const rows = r.rows;
  if (reason) {
    return rows.filter((row) => row.payload?.reason === reason);
  }
  return rows;
}

function assertNoSecretsInPayload(payload: unknown, qrToken: string) {
  const text = JSON.stringify(payload ?? {});
  expect(text).not.toContain(qrToken);
  expect(text.toLowerCase()).not.toMatch(/qrtoken|token_hash|password|pin|pepper/);
  // hash of token must not appear either
  expect(text).not.toContain(sha256Hex(qrToken));
}

describeDenial('LoginChallenge denial audit (F05)', () => {
  beforeAll(async () => {
    assertPosDisposableDatabaseUrl(DATABASE_URL);
    requirePepper(PEPPER);
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    identity = new IdentityService(pool, PEPPER);
    challenges = new LoginChallengeService(pool, identity);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await truncateBusiness();
    fx = await seedBlockCFixture(pool);
    await createTerminal(fx.tenantId, fx.outletId);
    const row = await pool.query<{ company_code: string }>(
      `SELECT company_code FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );
    companyCode = row.rows[0]!.company_code;
  });

  it('NOT_FOUND: denial audit persists after failed confirm; no new session', async () => {
    const { mobilePrincipal } = await provisionAndSessions();
    const sessionsBefore = await countSessions();
    const fakeToken = generateOpaqueToken(CHALLENGE_TOKEN_BYTES);

    await expect(
      challenges.confirmChallenge(mobilePrincipal, { qrToken: fakeToken }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });

    const audits = await denialAudits('NOT_FOUND');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_user_id).toBe(mobilePrincipal.userId);
    expect(audits[0]!.subject_ref).toBeNull();
    assertNoSecretsInPayload(audits[0]!.payload, fakeToken);
    expect(await countSessions()).toBe(sessionsBefore);
  });

  it('SCOPE_MISMATCH (cross-user): denial audit persists; challenge stays PENDING', async () => {
    const { termPrincipal, mobilePrincipal } = await provisionAndSessions('111111');
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Other',
      pin: '222222',
    });
    const otherMobile = await identity.authenticatePin(
      { companyCode, pin: '222222', channel: 'MOBILE' },
      '3.3.3.3',
    );
    const otherPrincipal = await identity.resolveSession(otherMobile.sessionToken);

    const created = await challenges.createChallenge(termPrincipal, {
      outletId: fx.outletId,
      terminalId,
    });
    const sessionsBefore = await countSessions();

    await expect(
      challenges.confirmChallenge(otherPrincipal, { qrToken: created.qrToken }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });

    const audits = await denialAudits('SCOPE_MISMATCH');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.subject_ref).toBe(created.loginChallengeId);
    expect(audits[0]!.actor_user_id).toBe(otherPrincipal.userId);
    assertNoSecretsInPayload(audits[0]!.payload, created.qrToken);

    const ch = await pool.query<{ status: string }>(
      `SELECT status FROM identity_login_challenge WHERE login_challenge_id = $1`,
      [created.loginChallengeId],
    );
    expect(ch.rows[0]!.status).toBe('PENDING');
    expect(await countSessions()).toBe(sessionsBefore);

    // Owner can still confirm after mismatch denial.
    const ok = await challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken });
    expect(ok.confirmed).toBe(true);
  });

  it('SCOPE_MISMATCH (cross-tenant): denial audit persists', async () => {
    const { termPrincipal } = await provisionAndSessions('111111');
    const created = await challenges.createChallenge(termPrincipal, {
      outletId: fx.outletId,
      terminalId,
    });

    const otherTenant = randomUUID();
    const otherCode = `X${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await pool.query(`INSERT INTO tenant (tenant_id, name, company_code) VALUES ($1,'Other',$2)`, [
      otherTenant,
      otherCode,
    ]);
    await identity.provisionUserWithPin({
      tenantId: otherTenant,
      displayName: 'Foreign',
      pin: '333333',
    });
    const foreignMobile = await identity.authenticatePin(
      { companyCode: otherCode, pin: '333333', channel: 'MOBILE' },
      '4.4.4.4',
    );
    const foreignPrincipal = await identity.resolveSession(foreignMobile.sessionToken);
    const sessionsBefore = await countSessions();

    await expect(
      challenges.confirmChallenge(foreignPrincipal, { qrToken: created.qrToken }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });

    const audits = await denialAudits('SCOPE_MISMATCH');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_user_id).toBe(foreignPrincipal.userId);
    expect(audits[0]!.subject_ref).toBe(created.loginChallengeId);
    assertNoSecretsInPayload(audits[0]!.payload, created.qrToken);
    expect(await countSessions()).toBe(sessionsBefore);
  });

  it('EXPIRED: marks EXPIRED + denial audit persists', async () => {
    const { termPrincipal, mobilePrincipal } = await provisionAndSessions();
    const created = await challenges.createChallenge(termPrincipal, {
      outletId: fx.outletId,
      terminalId,
    });
    await pool.query(
      `UPDATE identity_login_challenge
       SET expires_at = NOW() - INTERVAL '1 second'
       WHERE login_challenge_id = $1`,
      [created.loginChallengeId],
    );
    const sessionsBefore = await countSessions();

    await expect(
      challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });

    const audits = await denialAudits('EXPIRED');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.subject_ref).toBe(created.loginChallengeId);
    assertNoSecretsInPayload(audits[0]!.payload, created.qrToken);

    const ch = await pool.query<{ status: string }>(
      `SELECT status FROM identity_login_challenge WHERE login_challenge_id = $1`,
      [created.loginChallengeId],
    );
    expect(ch.rows[0]!.status).toBe('EXPIRED');
    expect(await countSessions()).toBe(sessionsBefore);
  });

  it('REUSE: second confirm denial audit persists; no new session', async () => {
    const { termPrincipal, mobilePrincipal } = await provisionAndSessions();
    const created = await challenges.createChallenge(termPrincipal, {
      outletId: fx.outletId,
      terminalId,
    });
    await challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken });
    const sessionsBefore = await countSessions();

    await expect(
      challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });

    const audits = await denialAudits('REUSE');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.subject_ref).toBe(created.loginChallengeId);
    assertNoSecretsInPayload(audits[0]!.payload, created.qrToken);

    const confirmed = await pool.query(
      `SELECT 1 FROM identity_audit_event
       WHERE event_type = 'LOGIN_CHALLENGE_CONFIRMED' AND subject_ref = $1`,
      [created.loginChallengeId],
    );
    expect(confirmed.rowCount).toBe(1);
    expect(await countSessions()).toBe(sessionsBefore);
  });

  it('success path: CONFIRMED status + CONFIRMED audit atomic; no extra session', async () => {
    const { termPrincipal, mobilePrincipal } = await provisionAndSessions();
    const created = await challenges.createChallenge(termPrincipal, {
      outletId: fx.outletId,
      terminalId,
    });
    const sessionsBefore = await countSessions();

    const ok = await challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken });
    expect(ok.confirmed).toBe(true);

    const ch = await pool.query<{ status: string }>(
      `SELECT status FROM identity_login_challenge WHERE login_challenge_id = $1`,
      [created.loginChallengeId],
    );
    expect(ch.rows[0]!.status).toBe('CONFIRMED');
    const confirmed = await pool.query(
      `SELECT 1 FROM identity_audit_event
       WHERE event_type = 'LOGIN_CHALLENGE_CONFIRMED' AND subject_ref = $1`,
      [created.loginChallengeId],
    );
    expect(confirmed.rowCount).toBe(1);
    expect(await denialAudits()).toHaveLength(0);
    expect(await countSessions()).toBe(sessionsBefore);
  });

  it('concurrent confirms: one CONFIRMED, loser REUSE denial audit persists', async () => {
    const { termPrincipal, mobilePrincipal } = await provisionAndSessions();
    const created = await challenges.createChallenge(termPrincipal, {
      outletId: fx.outletId,
      terminalId,
    });
    const sessionsBefore = await countSessions();

    const results = await Promise.allSettled([
      challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken }),
      challenges.confirmChallenge(mobilePrincipal, { qrToken: created.qrToken }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const ch = await pool.query<{ status: string }>(
      `SELECT status FROM identity_login_challenge WHERE login_challenge_id = $1`,
      [created.loginChallengeId],
    );
    expect(ch.rows[0]!.status).toBe('CONFIRMED');
    expect(await denialAudits('REUSE')).toHaveLength(1);
    const confirmed = await pool.query(
      `SELECT count(*)::int AS c FROM identity_audit_event
       WHERE event_type = 'LOGIN_CHALLENGE_CONFIRMED' AND subject_ref = $1`,
      [created.loginChallengeId],
    );
    expect(confirmed.rows[0]!.c).toBe(1);
    expect(await countSessions()).toBe(sessionsBefore);
  });
});
