import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  GuestMenuDomainError,
  GuestMenuProjectionService,
  PublicMenuLinkService,
} from '../modules/guest-menu/index.js';

/** Simple fixed-window rate limit for public guest-menu reads (fail closed when exceeded). */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const cache = new Map<string, { expiresAt: number; body: unknown; etag: string }>();
const CACHE_TTL_MS = 15_000;

function clientKey(req: FastifyRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0]!.trim();
  return req.ip || 'unknown';
}

function assertRateLimit(key: string): void {
  const now = Date.now();
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

function mapGuestError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof GuestMenuDomainError) {
    if (err.code === 'RATE_LIMITED') {
      return { status: 429, body: { error: err.code, message: err.message } };
    }
    if (
      err.code === 'PUBLIC_MENU_TOKEN_INVALID' ||
      err.code === 'PUBLIC_MENU_TOKEN_REVOKED' ||
      err.code === 'PUBLIC_MENU_TOKEN_NOT_YET_VALID' ||
      err.code === 'PUBLIC_MENU_TOKEN_EXPIRED' ||
      err.code === 'GUEST_MENU_CAPABILITY_DISABLED' ||
      err.code === 'PUBLIC_MENU_LINK_NOT_FOUND' ||
      err.code === 'OUTLET_NOT_FOUND'
    ) {
      // Fail closed: do not distinguish token existence vs revoke for anonymous callers on GET.
      const publicGetCodes = new Set([
        'PUBLIC_MENU_TOKEN_INVALID',
        'PUBLIC_MENU_TOKEN_REVOKED',
        'PUBLIC_MENU_TOKEN_NOT_YET_VALID',
        'PUBLIC_MENU_TOKEN_EXPIRED',
        'GUEST_MENU_CAPABILITY_DISABLED',
      ]);
      if (publicGetCodes.has(err.code)) {
        return { status: 404, body: { error: 'PUBLIC_MENU_UNAVAILABLE', message: 'Menu unavailable' } };
      }
      return { status: 400, body: { error: err.code, message: err.message } };
    }
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const code = String((err as { code: unknown }).code);
    const message = String((err as { message: unknown }).message);
    if (/^[A-Z][A-Z0-9_]+$/.test(code)) {
      // MenuResolver domain errors for public surface → unavailable
      if (
        code === 'MENU_NOT_ASSIGNED' ||
        code === 'AMBIGUOUS_MENU_ASSIGNMENT' ||
        code === 'INVALID_SALES_CONTEXT' ||
        code === 'OUTLET_TIMEZONE_REQUIRED'
      ) {
        return { status: 404, body: { error: 'PUBLIC_MENU_UNAVAILABLE', message: 'Menu unavailable' } };
      }
      return { status: 400, body: { error: code, message } };
    }
  }
  if (err && typeof err === 'object' && 'issues' in err) {
    return { status: 400, body: { error: 'VALIDATION', message: String(err) } };
  }
  throw err;
}

export async function registerGuestMenuRoutes(app: FastifyInstance, pool: pg.Pool) {
  const projection = new GuestMenuProjectionService(pool);
  const links = new PublicMenuLinkService(pool);

  app.get<{
    Params: { opaqueToken: string };
    Querystring: { lang?: string };
  }>('/api/v1/public/guest-menu/:opaqueToken', async (req, reply) => {
    try {
      assertRateLimit(`gm:${clientKey(req)}:${req.params.opaqueToken}`);
      const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
      const cacheKey = `${req.params.opaqueToken}|${lang ?? 'en'}`;
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        reply.header('ETag', cached.etag);
        reply.header('Cache-Control', 'private, max-age=15');
        if (req.headers['if-none-match'] === cached.etag) {
          return reply.code(304).send();
        }
        return cached.body;
      }

      const dto = await projection.resolveGuestMenu({
        opaqueToken: req.params.opaqueToken,
        ...(lang ? { language: lang } : {}),
      });
      const etag = `"gm-v${dto.menuPublicationVersion}-${dto.language}"`;
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, body: dto, etag });
      reply.header('ETag', etag);
      reply.header('Cache-Control', 'private, max-age=15');
      return dto;
    } catch (err) {
      const mapped = mapGuestError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  // Operator/dev management (no employee auth layer yet — same posture as other /api/v1 routes).
  app.post('/api/v1/guest-menu/links', async (req, reply) => {
    try {
      const created = await links.createLink(req.body);
      return reply.code(201).send(created);
    } catch (err) {
      const mapped = mapGuestError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/guest-menu/capabilities', async (req, reply) => {
    try {
      const body = req.body as {
        tenantId?: string;
        outletId?: string;
        capabilityKey?: string;
        enabled?: boolean;
      };
      if (!body.tenantId || !body.outletId || !body.capabilityKey || typeof body.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid capability payload' });
      }
      await links.setOutletCapability({
        tenantId: body.tenantId,
        outletId: body.outletId,
        capabilityKey: body.capabilityKey,
        enabled: body.enabled,
      });
      return { ok: true };
    } catch (err) {
      const mapped = mapGuestError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post<{ Params: { publicMenuLinkId: string } }>(
    '/api/v1/guest-menu/links/:publicMenuLinkId/revoke',
    async (req, reply) => {
      try {
        await links.revokeLink(req.params.publicMenuLinkId);
        return { ok: true };
      } catch (err) {
        const mapped = mapGuestError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: { publicMenuLinkId: string } }>(
    '/api/v1/guest-menu/links/:publicMenuLinkId/rotate',
    async (req, reply) => {
      try {
        const created = await links.rotateLink(req.params.publicMenuLinkId);
        return created;
      } catch (err) {
        const mapped = mapGuestError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
