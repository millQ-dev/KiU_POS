import type { FastifyRequest } from 'fastify';
import { IdentityDomainError, SESSION_COOKIE_NAME } from './errors.js';
import type { AuthenticatedPrincipal, IdentityService } from './identity-service.js';

export function readSessionToken(req: FastifyRequest): string | null {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[SESSION_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.length >= 20) return fromCookie;
  return null;
}

/**
 * CSRF strategy (cookie session):
 * - Session cookie: HttpOnly + SameSite=Lax + Path=/ (+ Secure in production)
 * - State-changing authenticated routes require Origin (or Referer) matching
 *   an allowed origin when Origin is present; missing both is rejected in production.
 */
export function assertCsrf(
  req: FastifyRequest,
  allowedOrigins: string[],
  isProd: boolean,
): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (typeof origin === 'string' && origin.length > 0) {
    if (!allowedOrigins.includes(origin)) {
      throw new IdentityDomainError('CSRF_REJECTED', 'Invalid origin');
    }
    return;
  }
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!allowedOrigins.includes(refOrigin)) {
        throw new IdentityDomainError('CSRF_REJECTED', 'Invalid origin');
      }
      return;
    } catch {
      throw new IdentityDomainError('CSRF_REJECTED', 'Invalid origin');
    }
  }
  if (isProd) {
    throw new IdentityDomainError('CSRF_REJECTED', 'Invalid origin');
  }
}

export type FinancialAuthOptions = {
  identity: IdentityService;
  allowedOrigins: string[];
  isProduction: boolean;
  /** Permission key required for financial/POS routes (default pos.operate). */
  permissionKey: string;
};

/**
 * Resolve authenticated principal for financial / POS HTTP routes.
 * Tenant authority is always derived from the server Session — never from body/query/header.
 */
export async function requireFinancialPrincipal(
  req: FastifyRequest,
  opts: FinancialAuthOptions,
  scope: { outletId?: string | null; terminalId?: string | null } = {},
): Promise<AuthenticatedPrincipal> {
  const principal = await requireFinancialSession(req, opts);
  await opts.identity.assertPosOperate(
    principal,
    opts.permissionKey,
    scope.outletId ?? null,
    scope.terminalId ?? null,
  );
  return principal;
}

/** Session + CSRF only — use when AccessGrant outlet must be asserted after tenant-scoped load. */
export async function requireFinancialSession(
  req: FastifyRequest,
  opts: FinancialAuthOptions,
): Promise<AuthenticatedPrincipal> {
  assertCsrf(req, opts.allowedOrigins, opts.isProduction);
  const token = readSessionToken(req);
  if (!token) {
    throw new IdentityDomainError('SESSION_INVALID', 'Invalid session');
  }
  return opts.identity.resolveSession(token);
}

/** Reject caller attempts to switch tenant via body/query/header. */
export function rejectTenantAuthorityInjection(
  principal: AuthenticatedPrincipal,
  claimedTenantId: string | null | undefined,
): void {
  if (claimedTenantId == null || claimedTenantId === '') return;
  if (claimedTenantId !== principal.tenantId) {
    throw new IdentityDomainError('FORBIDDEN', 'tenantId does not match session authority');
  }
}
