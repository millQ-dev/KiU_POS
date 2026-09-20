import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  CashDomainError,
  CashShiftService,
} from '../modules/cash/index.js';
import {
  IdentityDomainError,
  IdentityService,
  PERMISSION_POS_OPERATE,
  rejectTenantAuthorityInjection,
  requireFinancialPrincipal,
  requireFinancialSession,
  type FinancialAuthOptions,
} from '../modules/identity/index.js';

export type CashRouteOptions = {
  pepper: string;
  allowedOrigins: string[];
  isProduction: boolean;
};

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
  if (err instanceof CashDomainError) {
    const conflict = new Set([
      'CASH_SHIFT_ALREADY_OPEN',
      'IDEMPOTENCY_CONFLICT',
      'APPROVAL_REQUIRED',
    ]);
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'FORBIDDEN'
          ? 403
          : conflict.has(err.code)
            ? 409
            : 400;
    return { status, body: { error: err.code, message: err.message } };
  }
  if (err && typeof err === 'object' && 'issues' in err) {
    return { status: 400, body: { error: 'VALIDATION', message: 'Invalid request' } };
  }
  throw err;
}

export async function registerCashRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  routeOpts: CashRouteOptions,
): Promise<void> {
  const identity = new IdentityService(pool, routeOpts.pepper);
  const cash = new CashShiftService(pool, identity);
  const finAuth: FinancialAuthOptions = {
    identity,
    allowedOrigins: routeOpts.allowedOrigins,
    isProduction: routeOpts.isProduction,
    permissionKey: PERMISSION_POS_OPERATE,
  };

  app.get('/api/v1/cash/terminals', async (req, reply) => {
    try {
      const principal = await requireFinancialSession(req, finAuth);
      return { terminals: await cash.listTerminalsForOpen(principal) };
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get<{ Querystring: { terminalId?: string } }>(
    '/api/v1/cash/shifts/current',
    async (req, reply) => {
      try {
        const principal = await requireFinancialSession(req, finAuth);
        const terminalId = req.query.terminalId;
        if (!terminalId) {
          return reply.code(400).send({ error: 'VALIDATION', message: 'terminalId required' });
        }
        const open = await cash.getOpenShiftForTerminal(principal, terminalId);
        if (open) {
          await finAuth.identity.assertPosOperate(
            principal,
            PERMISSION_POS_OPERATE,
            open.outletId,
            open.terminalId,
          );
        }
        return { shift: open };
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post('/api/v1/cash/shifts/open', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as {
        outletId?: string;
        terminalId?: string;
        tenantId?: string;
        status?: unknown;
        openedByUserId?: unknown;
        openedAt?: unknown;
        authMode?: unknown;
        deviceId?: unknown;
        coveredMinor?: unknown;
      };
      const principal = await requireFinancialPrincipal(req, finAuth, {
        outletId: body.outletId ?? null,
        terminalId: body.terminalId ?? null,
      });
      rejectTenantAuthorityInjection(principal, body.tenantId);
      if (
        body.status !== undefined ||
        body.openedByUserId !== undefined ||
        body.openedAt !== undefined ||
        body.authMode !== undefined ||
        body.deviceId !== undefined ||
        body.coveredMinor !== undefined
      ) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'Authoritative fields are not caller-settable',
        });
      }
      const shift = await cash.openShift(principal, req.body);
      return reply.code(201).send(shift);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
}
