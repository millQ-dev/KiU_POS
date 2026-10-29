import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AllergenDomainError, AllergensService } from '../modules/allergens/index.js';
import {
  IdentityDomainError,
  IdentityService,
  PERMISSION_POS_OPERATE,
  requireFinancialSession,
  type AuthenticatedPrincipal,
  type FinancialAuthOptions,
} from '../modules/identity/index.js';
import { NotFoundError } from '../modules/pos/index.js';

export type AllergenRouteOptions = {
  pepper: string;
  allowedOrigins: string[];
  isProduction: boolean;
};

const NOT_FOUND_CODES = new Set(['ORDER_NOT_FOUND', 'CATALOG_ITEM_NOT_FOUND']);
const CONFLICT_CODES = new Set([
  'ORDER_NOT_OPEN',
  'ALLERGEN_CONTEXT_MISSING',
  'ALLERGEN_CONTEXT_FROZEN',
  'ALLERGEN_RESOLUTION_MISSING',
  'ALLERGEN_RESOLUTION_FROZEN',
  'ALLERGEN_REVALIDATION_REQUIRED',
  'ALLERGEN_LINE_BLOCKED',
  'ALLERGEN_ACK_NOT_REQUIRED',
  'SETTLEMENT_EDIT_LOCKED',
]);

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
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: err.code, message: err.message } };
  }
  if (err instanceof AllergenDomainError) {
    const status = NOT_FOUND_CODES.has(err.code) ? 404 : CONFLICT_CODES.has(err.code) ? 409 : 400;
    return { status, body: { error: err.code, message: err.message } };
  }
  throw err;
}

export async function registerAllergenRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  routeOpts: AllergenRouteOptions,
): Promise<void> {
  const identity = new IdentityService(pool, routeOpts.pepper);
  const finAuth: FinancialAuthOptions = {
    identity,
    allowedOrigins: routeOpts.allowedOrigins,
    isProduction: routeOpts.isProduction,
    permissionKey: PERMISSION_POS_OPERATE,
  };
  const allergens = new AllergensService(pool);

  async function requireOrderPrincipal(
    req: Parameters<typeof requireFinancialSession>[0],
    orderId: string,
  ): Promise<AuthenticatedPrincipal> {
    const principal = await requireFinancialSession(req, finAuth);
    const res = await pool.query<{ tenant_id: string; outlet_id: string }>(
      `SELECT tenant_id, outlet_id FROM sales_order WHERE order_id = $1`,
      [orderId],
    );
    const row = res.rows[0];
    if (!row || row.tenant_id !== principal.tenantId) {
      throw new NotFoundError('Order not found');
    }
    await identity.assertPosOperate(principal, finAuth.permissionKey, row.outlet_id);
    return principal;
  }

  app.put<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/allergen-context',
    async (req, reply) => {
      try {
        const principal = await requireOrderPrincipal(req, req.params.orderId);
        const body = (req.body ?? {}) as { captureChoice?: unknown; allergenCodes?: unknown };
        if (typeof body.captureChoice !== 'string') {
          return reply
            .code(400)
            .send({ error: 'ALLERGEN_CAPTURE_CHOICE_INVALID', message: 'captureChoice required' });
        }
        if (
          body.allergenCodes !== undefined &&
          !(Array.isArray(body.allergenCodes) && body.allergenCodes.every((c) => typeof c === 'string'))
        ) {
          return reply
            .code(400)
            .send({ error: 'ALLERGEN_CODES_INVALID', message: 'allergenCodes must be string[]' });
        }
        const context = await allergens.captureContext({
          orderId: req.params.orderId,
          captureChoice: body.captureChoice,
          allergenCodes: (body.allergenCodes as string[] | undefined) ?? [],
          actorId: principal.userId,
        });
        const lines = await allergens.resolveOrderLines(req.params.orderId);
        return { context, lines };
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/allergen-context',
    async (req, reply) => {
      try {
        await requireOrderPrincipal(req, req.params.orderId);
        const [context, lines] = await Promise.all([
          allergens.getContext(req.params.orderId),
          allergens.getLineResolutions(req.params.orderId),
        ]);
        return { context, lines };
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/allergen-resolution',
    async (req, reply) => {
      try {
        await requireOrderPrincipal(req, req.params.orderId);
        return { lines: await allergens.resolveOrderLines(req.params.orderId) };
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/allergen-offers',
    async (req, reply) => {
      try {
        await requireOrderPrincipal(req, req.params.orderId);
        const body = (req.body ?? {}) as { catalogItemIds?: unknown };
        if (
          !Array.isArray(body.catalogItemIds) ||
          body.catalogItemIds.length === 0 ||
          !body.catalogItemIds.every((c) => typeof c === 'string')
        ) {
          return reply
            .code(400)
            .send({ error: 'VALIDATION', message: 'catalogItemIds must be a non-empty string[]' });
        }
        return {
          offers: await allergens.resolveOffers({
            orderId: req.params.orderId,
            catalogItemIds: body.catalogItemIds as string[],
          }),
        };
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: { orderId: string; lineId: string } }>(
    '/api/v1/orders/:orderId/lines/:lineId/allergen-acknowledgements',
    async (req, reply) => {
      try {
        const principal = await requireOrderPrincipal(req, req.params.orderId);
        const body = (req.body ?? {}) as { kind?: unknown };
        if (typeof body.kind !== 'string') {
          return reply.code(400).send({ error: 'ALLERGEN_ACK_KIND_INVALID', message: 'kind required' });
        }
        return await allergens.recordAcknowledgement({
          orderId: req.params.orderId,
          orderLineId: req.params.lineId,
          kind: body.kind,
          actorId: principal.userId,
        });
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/kitchen-allergen-ticket',
    async (req, reply) => {
      try {
        await requireOrderPrincipal(req, req.params.orderId);
        return await allergens.getKitchenTicket(req.params.orderId);
      } catch (err) {
        const mapped = mapError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
