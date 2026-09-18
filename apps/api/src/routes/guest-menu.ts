import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  GuestMenuDomainError,
  GuestMenuProjectionService,
  PublicMenuLinkService,
} from '../modules/guest-menu/index.js';

/** Fixed-window rate limit for public guest-menu reads (fail closed when exceeded). */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const RATE_MAP_MAX = 10_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const PUBLIC_UNAVAILABLE = {
  error: 'PUBLIC_MENU_UNAVAILABLE',
  message: 'Menu unavailable',
} as const;

function assertRateLimit(key: string): void {
  const now = Date.now();
  if (rateBuckets.size > RATE_MAP_MAX) {
    for (const [k, v] of rateBuckets) {
      if (now >= v.resetAt) rateBuckets.delete(k);
    }
    if (rateBuckets.size > RATE_MAP_MAX) {
      rateBuckets.clear();
    }
  }
  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    throw new GuestMenuDomainError('RATE_LIMITED', 'Too many requests');
  }
}

function applyPublicSecurityHeaders(reply: {
  header: (k: string, v: string) => unknown;
}): void {
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Cache-Control', 'no-store, private');
  reply.header('Pragma', 'no-cache');
}

function mapGuestError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof GuestMenuDomainError) {
    if (err.code === 'RATE_LIMITED') {
      return { status: 429, body: { error: err.code, message: err.message } };
    }
    const publicOpaque = new Set([
      'PUBLIC_MENU_TOKEN_INVALID',
      'PUBLIC_MENU_TOKEN_REVOKED',
      'PUBLIC_MENU_TOKEN_NOT_YET_VALID',
      'PUBLIC_MENU_TOKEN_EXPIRED',
      'GUEST_MENU_CAPABILITY_DISABLED',
      'PUBLIC_MENU_LINK_NOT_FOUND',
      'OUTLET_NOT_FOUND',
    ]);
    if (publicOpaque.has(err.code)) {
      return { status: 404, body: { ...PUBLIC_UNAVAILABLE } };
    }
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const code = String((err as { code: unknown }).code);
    const message = String((err as { message: unknown }).message);
    if (/^[A-Z][A-Z0-9_]+$/.test(code)) {
      if (
        code === 'MENU_NOT_ASSIGNED' ||
        code === 'AMBIGUOUS_MENU_ASSIGNMENT' ||
        code === 'INVALID_SALES_CONTEXT' ||
        code === 'OUTLET_TIMEZONE_REQUIRED'
      ) {
        return { status: 404, body: { ...PUBLIC_UNAVAILABLE } };
      }
      return { status: 400, body: { error: code, message } };
    }
  }
  if (err && typeof err === 'object' && 'issues' in err) {
    return { status: 400, body: { error: 'VALIDATION', message: 'Invalid request' } };
  }
  throw err;
}

/**
 * Rate key uses Fastify `req.ip` only (not spoofable X-Forwarded-For unless trustProxy is set).
 * Token tip is truncated — never store full opaque token in the map key.
 */
function rateKeyForToken(req: FastifyRequest, opaqueToken: string): string {
  const tip = opaqueToken.length >= 4 ? opaqueToken.slice(0, 4) : 'xxxx';
  return `gm:${req.ip || 'unknown'}:${opaqueToken.length}:${tip}`;
}

/**
 * Dev Guest Menu admin may register only outside production.
 * PO rule: NODE_ENV === 'production' → routes MUST NOT be registered,
 * regardless of ANY env override flag (ALLOW_* ignored / deleted).
 */
export function isDevGuestMenuAdminRegistrationAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** Public read-only Guest QR surface. Always registered. */
export async function registerGuestMenuRoutes(app: FastifyInstance, pool: pg.Pool) {
  const projection = new GuestMenuProjectionService(pool);

  app.get<{
    Params: { opaqueToken: string };
    Querystring: { lang?: string; businessDateTime?: string; tenantId?: string; outletId?: string };
  }>('/api/v1/public/guest-menu/:opaqueToken', async (req, reply) => {
    applyPublicSecurityHeaders(reply);
    try {
      if (
        req.query.businessDateTime != null ||
        req.query.tenantId != null ||
        req.query.outletId != null
      ) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid request' });
      }
      assertRateLimit(rateKeyForToken(req, req.params.opaqueToken));
      const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;

      // Correctness-first: no response body cache.
      const dto = await projection.resolveGuestMenu({
        opaqueToken: req.params.opaqueToken,
        ...(lang ? { language: lang } : {}),
      });
      return dto;
    } catch (err) {
      const mapped = mapGuestError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
}

/**
 * Development/test-only link + capability management.
 * NOT production authorization. Future production management is a separate authenticated vertical.
 *
 * Binding: when NODE_ENV === 'production', this function registers ZERO routes
 * (ALLOW_DEV_GUEST_MENU_ADMIN and similar flags have no effect).
 */
export async function registerDevGuestMenuAdminRoutes(app: FastifyInstance, pool: pg.Pool) {
  if (!isDevGuestMenuAdminRegistrationAllowed()) {
    return;
  }

  const links = new PublicMenuLinkService(pool);

  app.post('/api/v1/dev/guest-menu/links', async (req, reply) => {
    try {
      const created = await links.createLink(req.body);
      return reply.code(201).send(created);
    } catch (err) {
      const mapped = mapGuestError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/dev/guest-menu/capabilities', async (req, reply) => {
    try {
      const body = req.body as {
        tenantId?: string;
        outletId?: string;
        capabilityKey?: string;
        enabled?: boolean;
        entitled?: boolean;
        scope?: 'OUTLET' | 'PACKAGE';
      };
      if (!body.tenantId || !body.capabilityKey) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid capability payload' });
      }
      if (body.scope === 'PACKAGE' || (body.entitled !== undefined && body.enabled === undefined)) {
        if (typeof body.entitled !== 'boolean') {
          return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid package entitlement payload' });
        }
        await links.setPackageEntitlement({
          tenantId: body.tenantId,
          capabilityKey: body.capabilityKey,
          entitled: body.entitled,
        });
        return { ok: true, mode: 'DEVELOPMENT_BOOTSTRAP' };
      }
      if (!body.outletId || typeof body.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid outlet capability payload' });
      }
      await links.setOutletCapability({
        tenantId: body.tenantId,
        outletId: body.outletId,
        capabilityKey: body.capabilityKey,
        enabled: body.enabled,
      });
      return { ok: true, mode: 'DEVELOPMENT_BOOTSTRAP' };
    } catch (err) {
      const mapped = mapGuestError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post<{ Params: { publicMenuLinkId: string } }>(
    '/api/v1/dev/guest-menu/links/:publicMenuLinkId/revoke',
    async (req, reply) => {
      try {
        await links.revokeLink(req.params.publicMenuLinkId);
        return { ok: true, mode: 'DEVELOPMENT_BOOTSTRAP' };
      } catch (err) {
        const mapped = mapGuestError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: { publicMenuLinkId: string } }>(
    '/api/v1/dev/guest-menu/links/:publicMenuLinkId/rotate',
    async (req, reply) => {
      try {
        const created = await links.rotateLink(req.params.publicMenuLinkId);
        return { ...created, mode: 'DEVELOPMENT_BOOTSTRAP' };
      } catch (err) {
        const mapped = mapGuestError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
