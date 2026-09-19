import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  ApprovalRequestService,
  CompanyIdentityError,
  IdentityDomainError,
  IdentityService,
  LoginChallengeService,
  OutboxNotificationPort,
  SESSION_COOKIE_NAME,
  assertCsrf,
  readSessionToken,
} from '../modules/identity/index.js';
import { CompanyIdentityService } from '../modules/organization/index.js';

const COMPANY_RATE_WINDOW_MS = 60_000;
const COMPANY_RATE_MAX = 60;
const PIN_RATE_WINDOW_MS = 60_000;
const PIN_RATE_MAX = 20;
const RATE_MAP_MAX = 10_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let rateMutex: Promise<void> = Promise.resolve();

function withRateMutex<T>(fn: () => T): Promise<T> {
  const run = rateMutex.then(() => fn());
  rateMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Single-node in-memory rate limiter (mutex-serialized).
 * Durable lockout remains in DB (identity_auth_throttle / identity_network_throttle).
 * Multi-instance shared limiter is a documented follow-up.
 * Never clears the entire map (would reset active budgets).
 */
async function assertRateLimit(key: string, windowMs: number, max: number): Promise<void> {
  await withRateMutex(() => {
    const now = Date.now();
    for (const [k, v] of rateBuckets) {
      if (now >= v.resetAt) rateBuckets.delete(k);
    }
    if (rateBuckets.size > RATE_MAP_MAX) {
      const ordered = [...rateBuckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (const [k] of ordered) {
        if (rateBuckets.size <= RATE_MAP_MAX) break;
        rateBuckets.delete(k);
      }
    }
    let bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      throw new IdentityDomainError('RATE_LIMITED', 'Too many requests');
    }
  });
}

function applyPublicSecurityHeaders(reply: FastifyReply): void {
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Cache-Control', 'no-store, private');
  reply.header('Pragma', 'no-cache');
}

function networkKey(req: FastifyRequest): string {
  return req.ip || 'unknown';
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  opts: { secure: boolean; maxAgeSec: number },
): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'lax',
    maxAge: opts.maxAgeSec,
  });
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'lax',
  });
}

function mapError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof CompanyIdentityError) {
    if (err.code === 'COMPANY_NOT_FOUND') {
      return { status: 404, body: { error: 'COMPANY_NOT_FOUND', message: 'Company not found' } };
    }
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err instanceof IdentityDomainError) {
    if (err.code === 'RATE_LIMITED') {
      return { status: 429, body: { error: err.code, message: err.message } };
    }
    if (err.code === 'AUTH_FAILED' || err.code === 'SESSION_INVALID') {
      return { status: 401, body: { error: err.code, message: err.message } };
    }
    if (err.code === 'FORBIDDEN' || err.code === 'CSRF_REJECTED') {
      return { status: 403, body: { error: err.code, message: err.message } };
    }
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err && typeof err === 'object' && 'issues' in err) {
    return { status: 400, body: { error: 'VALIDATION', message: 'Invalid request' } };
  }
  throw err;
}

export type IdentityRouteOptions = {
  pepper: string;
  cookieSecure: boolean;
  allowedOrigins: string[];
  isProduction: boolean;
};

export async function registerCompanyIdentityRoutes(app: FastifyInstance, pool: pg.Pool) {
  const company = new CompanyIdentityService(pool);

  app.get<{ Params: { companyCode: string } }>(
    '/api/v1/public/company/:companyCode',
    async (req, reply) => {
      try {
        applyPublicSecurityHeaders(reply);
        await assertRateLimit(`company:${networkKey(req)}`, COMPANY_RATE_WINDOW_MS, COMPANY_RATE_MAX);
        const body = await company.resolvePublicByCompanyCode({
          companyCode: req.params.companyCode,
        });
        return body;
      } catch (err) {
        applyPublicSecurityHeaders(reply);
        if (err instanceof CompanyIdentityError && err.code === 'COMPANY_NOT_FOUND') {
          await assertRateLimit(`company:${networkKey(req)}`, COMPANY_RATE_WINDOW_MS, COMPANY_RATE_MAX);
        }
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}

export async function registerIdentityRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  opts: IdentityRouteOptions,
) {
  const identity = new IdentityService(pool, opts.pepper);
  const notifications = new OutboxNotificationPort(pool);
  const challenges = new LoginChallengeService(pool, identity);
  const approvals = new ApprovalRequestService(pool, identity, notifications);
  const maxAgeSec = 12 * 3600;

  async function requirePrincipal(req: FastifyRequest) {
    assertCsrf(req, opts.allowedOrigins, opts.isProduction);
    const token = readSessionToken(req);
    if (!token) throw new IdentityDomainError('SESSION_INVALID', 'Invalid session');
    return identity.resolveSession(token);
  }

  app.post('/api/v1/identity/pin/authenticate', async (req, reply) => {
    try {
      await assertRateLimit(`pin:${networkKey(req)}`, PIN_RATE_WINDOW_MS, PIN_RATE_MAX);
      const body = req.body as { companyCode?: string } | null;
      if (body?.companyCode) {
        await assertRateLimit(
          `pin-company:${String(body.companyCode).toUpperCase()}:${networkKey(req)}`,
          PIN_RATE_WINDOW_MS,
          PIN_RATE_MAX,
        );
      }
      // Ignore any pre-existing cookie — always issue a new session (anti-fixation).
      const result = await identity.authenticatePin(req.body, networkKey(req));
      setSessionCookie(reply, result.sessionToken, {
        secure: opts.cookieSecure,
        maxAgeSec,
      });
      return {
        userId: result.userId,
        employeeId: result.employeeId,
        displayName: result.displayName,
      };
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get('/api/v1/identity/session', async (req, reply) => {
    try {
      const token = readSessionToken(req);
      if (!token) throw new IdentityDomainError('SESSION_INVALID', 'Invalid session');
      const principal = await identity.resolveSession(token);
      return {
        userId: principal.userId,
        employeeId: principal.employeeId,
        displayName: principal.displayName,
        channel: principal.channel,
      };
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/identity/session/logout', async (req, reply) => {
    try {
      assertCsrf(req, opts.allowedOrigins, opts.isProduction);
      const token = readSessionToken(req);
      if (token) {
        try {
          const principal = await identity.resolveSession(token);
          await identity.revokeSession(principal);
        } catch {
          /* already invalid */
        }
      }
      clearSessionCookie(reply, opts.cookieSecure);
      return { ok: true };
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/identity/login-challenges', async (req, reply) => {
    try {
      const principal = await requirePrincipal(req);
      return await challenges.createChallenge(principal, req.body);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/identity/login-challenges/confirm', async (req, reply) => {
    try {
      const principal = await requirePrincipal(req);
      return await challenges.confirmChallenge(principal, req.body);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/identity/approval-requests', async (req, reply) => {
    try {
      const principal = await requirePrincipal(req);
      return await approvals.createRequest(principal, req.body);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post<{ Params: { approvalRequestId: string } }>(
    '/api/v1/identity/approval-requests/:approvalRequestId/decide',
    async (req, reply) => {
      try {
        const principal = await requirePrincipal(req);
        return await approvals.decide(principal, req.params.approvalRequestId, req.body);
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
