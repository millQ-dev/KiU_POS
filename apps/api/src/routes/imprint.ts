import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  IdentityDomainError,
  IdentityService,
  PERMISSION_IMPRINT_PROVENANCE_READ,
  PERMISSION_IMPRINT_READ,
  rejectTenantAuthorityInjection,
  requireFinancialSession,
  type FinancialAuthOptions,
} from '../modules/identity/index.js';
import { ImprintServiceError } from '../modules/restaurant-imprint/errors.js';
import { ImprintHttpReadService } from '../modules/restaurant-imprint/imprint-http-read.js';

export type ImprintRouteOptions = {
  pepper: string;
  allowedOrigins: string[];
  isProduction: boolean;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof IdentityDomainError) {
    if (err.code === 'SESSION_INVALID' || err.code === 'AUTH_FAILED') {
      return { status: 401, body: { error: err.code, message: err.message } };
    }
    if (err.code === 'FORBIDDEN' || err.code === 'CSRF_REJECTED') {
      return { status: 403, body: { error: err.code, message: err.message } };
    }
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err instanceof ImprintServiceError) {
    if (err.code === 'IMPRINT_SCOPE_DENIED') {
      return { status: 403, body: { error: err.code, message: err.message } };
    }
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  throw err;
}

/**
 * ADR-0054 I-07 — read-only Restaurant Imprint HTTP API.
 * Tenant from session. outletId is a selector. Outlet-scoped imprint.read required.
 */
export async function registerImprintRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  routeOpts: ImprintRouteOptions,
): Promise<void> {
  const identity = new IdentityService(pool, routeOpts.pepper);
  const finAuth: FinancialAuthOptions = {
    identity,
    allowedOrigins: routeOpts.allowedOrigins,
    isProduction: routeOpts.isProduction,
    permissionKey: PERMISSION_IMPRINT_READ,
  };
  const reader = new ImprintHttpReadService(pool);

  app.get<{
    Params: { outletId: string };
    Querystring: { includeProvenance?: string; tenantId?: string };
  }>('/api/v1/outlets/:outletId/imprint', async (req, reply) => {
    try {
      if (!UUID.test(req.params.outletId)) {
        return reply.code(400).send({
          error: 'IMPRINT_OUTLET_INVALID',
          message: 'outletId must be a UUID',
        });
      }
      const principal = await requireFinancialSession(req, finAuth);
      rejectTenantAuthorityInjection(principal, req.query.tenantId);
      if (principal.channel !== 'TERMINAL' && principal.channel !== 'MOBILE') {
        throw new IdentityDomainError('FORBIDDEN', 'Permission denied');
      }

      await identity.assertOutletScopedPermission(
        principal,
        PERMISSION_IMPRINT_READ,
        req.params.outletId,
        null,
      );

      const wantProvenance =
        req.query.includeProvenance === '1' ||
        req.query.includeProvenance === 'true';
      if (wantProvenance) {
        await identity.assertOutletScopedPermission(
          principal,
          PERMISSION_IMPRINT_PROVENANCE_READ,
          req.params.outletId,
          null,
        );
      }

      const summary = await reader.readOutletSummary(principal, req.params.outletId, {
        includeProvenance: wantProvenance,
      });
      return reply.code(200).send(summary);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
}
