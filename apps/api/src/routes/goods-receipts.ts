import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { GoodsReceiptService } from '../modules/procurement/goods-receipt-service.js';
import {
  DomainValidationError,
  IdempotencyConflictError,
  NotFoundError,
  PostedImmutableError,
} from '../modules/procurement/errors.js';
import {
  IdentityDomainError,
  IdentityService,
  PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
  rejectTenantAuthorityInjection,
  requireFinancialPrincipal,
  type AuthenticatedPrincipal,
  type FinancialAuthOptions,
} from '../modules/identity/index.js';

export type GoodsReceiptRouteOptions = {
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
  if (err instanceof DomainValidationError) {
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err instanceof PostedImmutableError) {
    return { status: 409, body: { error: err.code, message: err.message } };
  }
  if (err instanceof IdempotencyConflictError) {
    return { status: 409, body: { error: err.code, message: err.message } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: err.code, message: err.message } };
  }
  if (err && typeof err === 'object' && 'issues' in err) {
    return { status: 400, body: { error: 'VALIDATION', message: String(err) } };
  }
  throw err;
}

async function requireProcurementPrincipal(
  req: FastifyRequest,
  finAuth: FinancialAuthOptions,
): Promise<AuthenticatedPrincipal> {
  // Tenant-wide grant: outletId/terminalId null (AccessGrant has no warehouse/LE scope).
  return requireFinancialPrincipal(req, finAuth, { outletId: null, terminalId: null });
}

/**
 * C0.1 — SEC-0 Session + CSRF + procurement.goods_receipt.manage (tenant-wide).
 * Tenant authority always from Session. Does not expand AccessGrant scope model.
 */
export async function registerGoodsReceiptRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  routeOpts: GoodsReceiptRouteOptions,
): Promise<void> {
  const service = new GoodsReceiptService(pool);
  const identity = new IdentityService(pool, routeOpts.pepper);
  const finAuth: FinancialAuthOptions = {
    identity,
    allowedOrigins: routeOpts.allowedOrigins,
    isProduction: routeOpts.isProduction,
    permissionKey: PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
  };

  app.post('/api/v1/goods-receipts', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const body = (req.body ?? {}) as Record<string, unknown>;
      rejectTenantAuthorityInjection(
        principal,
        typeof body.tenantId === 'string' ? body.tenantId : undefined,
      );
      const doc = await service.createDraft({
        ...body,
        tenantId: principal.tenantId,
      });
      return reply.code(201).send(doc);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get<{ Params: { id: string } }>('/api/v1/goods-receipts/:id', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const doc = await service.get(req.params.id);
      if (!doc || doc.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return doc;
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/v1/goods-receipts/:id', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const existing = await service.get(req.params.id);
      if (!existing || existing.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      rejectTenantAuthorityInjection(
        principal,
        typeof body.tenantId === 'string' ? body.tenantId : undefined,
      );
      const doc = await service.updateDraft(req.params.id, body);
      return doc;
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/goods-receipts/:id/validate', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const existing = await service.get(req.params.id);
      if (!existing || existing.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return await service.validate(req.params.id);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/goods-receipts/:id/post', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const existing = await service.get(req.params.id);
      if (!existing || existing.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      const result = await service.post(req.params.id, req.body);
      return reply.code(200).send(result);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/goods-receipts/:id/reverse', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const existing = await service.get(req.params.id);
      if (!existing || existing.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      const body = (req.body ?? {}) as { idempotencyKey?: string; actorId?: string; reason?: string };
      if (!body.idempotencyKey) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'idempotencyKey required' });
      }
      // actorId semantics unchanged (Accepted domain contract) — not rewritten to principal here.
      return await service.reverse(req.params.id, {
        idempotencyKey: body.idempotencyKey,
        ...(body.actorId ? { actorId: body.actorId } : {}),
        ...(body.reason ? { reason: body.reason } : {}),
      });
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get<{
    Querystring: { legalEntityId?: string; warehouseId?: string; catalogItemId?: string };
  }>('/api/v1/inventory/balance', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const { legalEntityId, warehouseId, catalogItemId } = req.query;
      if (!legalEntityId || !warehouseId || !catalogItemId) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'legalEntityId, warehouseId, catalogItemId required',
        });
      }
      await service.assertInventoryReadScope(
        principal.tenantId,
        legalEntityId,
        warehouseId,
        catalogItemId,
      );
      return await service.getBalance(legalEntityId, warehouseId, catalogItemId);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get<{
    Querystring: { legalEntityId?: string; warehouseId?: string; catalogItemId?: string };
  }>('/api/v1/costing/quote', async (req, reply) => {
    try {
      const principal = await requireProcurementPrincipal(req, finAuth);
      const { legalEntityId, warehouseId, catalogItemId } = req.query;
      if (!legalEntityId || !warehouseId || !catalogItemId) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'legalEntityId, warehouseId, catalogItemId required',
        });
      }
      await service.assertInventoryReadScope(
        principal.tenantId,
        legalEntityId,
        warehouseId,
        catalogItemId,
      );
      const balance = await service.getBalance(legalEntityId, warehouseId, catalogItemId);
      return { costQuote: balance.costQuote, quantity: balance.quantity };
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
}
