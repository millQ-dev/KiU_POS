import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  IdentityDomainError,
  PERMISSION_POS_OPERATE,
  rejectTenantAuthorityInjection,
  requireFinancialPrincipal,
  requireFinancialSession,
  type FinancialAuthOptions,
} from '../modules/identity/index.js';
import { DomainValidationError } from '../modules/orders/errors.js';
import { PaymentsService } from '../modules/payments/payments-service.js';
import type { NormalizedProviderOutcome } from '../modules/payments/payment-lifecycle.js';
import type { SettlementService } from '../modules/settlement/settlement-service.js';

export type PaymentRouteAuth = Omit<FinancialAuthOptions, 'permissionKey'> & {
  permissionKey?: string;
};

function mapPaymentError(err: unknown): { status: number; body: Record<string, unknown> } {
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
    const conflict = new Set([
      'IDEMPOTENCY_CONFLICT',
      'PROVIDER_REFERENCE_COLLISION',
      'PAYMENT_STATE_MONOTONICITY',
      'CHECK_OVERCOVERAGE',
      'ALLOCATION_EXCEEDS_PAYMENT',
      'TENDER_DISABLED',
      'CROSS_ENTITY',
      'CURRENCY_MISMATCH',
      'PAYMENT_NOT_QUALIFYING',
    ]);
    const status =
      err.code === 'NOT_FOUND' ? 404 : conflict.has(err.code) ? 409 : 400;
    return { status, body: { error: err.code, message: err.message } };
  }
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const code = String((err as { code: unknown }).code);
    if (/^[A-Z][A-Z0-9_]+$/.test(code)) {
      return {
        status: code === 'NOT_FOUND' ? 404 : 400,
        body: { error: code, message: String((err as { message: unknown }).message) },
      };
    }
  }
  throw err;
}

function authOpts(auth: PaymentRouteAuth): FinancialAuthOptions {
  return {
    identity: auth.identity,
    allowedOrigins: auth.allowedOrigins,
    isProduction: auth.isProduction,
    permissionKey: auth.permissionKey ?? PERMISSION_POS_OPERATE,
  };
}

export function createWiredPaymentsAndSettlement(
  pool: pg.Pool,
  settlementsFactory: (payments: PaymentsService) => SettlementService,
): { payments: PaymentsService; settlements: SettlementService } {
  let settlements!: SettlementService;
  const payments = new PaymentsService(pool, {
    onCoverageChanged: async (settlementGroupId) => {
      await settlements.reconcileSettlementCoverage(settlementGroupId);
    },
  });
  settlements = settlementsFactory(payments);
  return { payments, settlements };
}

export async function registerPaymentRoutes(
  app: FastifyInstance,
  payments: PaymentsService,
  auth: PaymentRouteAuth,
): Promise<void> {
  const opts = authOpts(auth);

  app.post('/api/v1/payments/tenders', async (req, reply) => {
    try {
      const principal = await requireFinancialPrincipal(req, opts);
      const body = (req.body ?? {}) as {
        tenantId?: string;
        legalEntityId?: string;
        code?: string;
        displayName?: string;
        enabled?: boolean;
        providerIdentity?: string | null;
        railIdentity?: string | null;
        instrumentFamily?: string | null;
        presentationCapability?: string | null;
        externalConfigRef?: string | null;
        status?: unknown;
        providerVerified?: unknown;
      };
      // Authoritative tenant from Session — reject mismatch; never trust body as authority.
      rejectTenantAuthorityInjection(principal, body.tenantId);
      if (
        body.status !== undefined ||
        body.providerVerified !== undefined
      ) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'Authoritative fields are not caller-settable',
        });
      }
      if (!body.legalEntityId || !body.code || !body.displayName) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'legalEntityId, code, displayName required',
        });
      }
      return await payments.createTenderDefinition({
        tenantId: principal.tenantId,
        legalEntityId: body.legalEntityId,
        code: body.code,
        displayName: body.displayName,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.providerIdentity !== undefined ? { providerIdentity: body.providerIdentity } : {}),
        ...(body.railIdentity !== undefined ? { railIdentity: body.railIdentity } : {}),
        ...(body.instrumentFamily !== undefined ? { instrumentFamily: body.instrumentFamily } : {}),
        ...(body.presentationCapability !== undefined
          ? { presentationCapability: body.presentationCapability }
          : {}),
        ...(body.externalConfigRef !== undefined ? { externalConfigRef: body.externalConfigRef } : {}),
      });
    } catch (err) {
      const mapped = mapPaymentError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post('/api/v1/payments', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as {
        tenderDefinitionId?: string;
        createIdempotencyKey?: string;
        merchantPaymentReference?: string;
        requestedAmountMinor?: string;
        currencyCode?: string;
        minorUnitExponent?: number;
        settlementCheckId?: string;
        tenantId?: string;
        status?: unknown;
        lifecycleState?: unknown;
        providerVerified?: unknown;
        coveredMinor?: unknown;
      };
      // Resolve outlet from intended Check when present so AccessGrant outlet scope binds.
      let outletId: string | null = null;
      if (body.settlementCheckId) {
        const checkOutlet = await payments.resolveOutletForSettlementCheck(body.settlementCheckId);
        outletId = checkOutlet?.outletId ?? null;
      }
      const principal = await requireFinancialPrincipal(req, opts, { outletId });
      rejectTenantAuthorityInjection(principal, body.tenantId);
      if (
        body.status !== undefined ||
        body.lifecycleState !== undefined ||
        body.providerVerified !== undefined ||
        body.coveredMinor !== undefined
      ) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'Authoritative fields are not caller-settable',
        });
      }
      if (
        !body.tenderDefinitionId ||
        !body.createIdempotencyKey ||
        !body.requestedAmountMinor ||
        !body.currencyCode ||
        body.minorUnitExponent == null
      ) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message:
            'tenderDefinitionId, createIdempotencyKey, requestedAmountMinor, currencyCode, minorUnitExponent required',
        });
      }
      // Pre-authorize tenant on tender BEFORE create (no cross-tenant write then 403).
      const tender = await payments.getTenderDefinition(body.tenderDefinitionId);
      if (!tender || tender.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'TenderDefinition not found' });
      }
      if (body.settlementCheckId) {
        const checkTenant = await payments.resolveOutletForSettlementCheck(body.settlementCheckId);
        if (!checkTenant || checkTenant.tenantId !== principal.tenantId) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'SettlementCheck not found' });
        }
      }
      return await payments.createPayment({
        tenderDefinitionId: body.tenderDefinitionId,
        createIdempotencyKey: body.createIdempotencyKey,
        ...(body.merchantPaymentReference !== undefined
          ? { merchantPaymentReference: body.merchantPaymentReference }
          : {}),
        requestedAmountMinor: body.requestedAmountMinor,
        currencyCode: body.currencyCode,
        minorUnitExponent: body.minorUnitExponent,
        ...(body.settlementCheckId !== undefined ? { settlementCheckId: body.settlementCheckId } : {}),
      });
    } catch (err) {
      const mapped = mapPaymentError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get<{ Params: { paymentId: string } }>('/api/v1/payments/:paymentId', async (req, reply) => {
    try {
      const principal = await requireFinancialSession(req, opts);
      const p = await payments.getPayment(req.params.paymentId);
      if (!p || p.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payment not found' });
      }
      const scope = await payments.resolveOutletForPayment(p.paymentId);
      await opts.identity.assertPosOperate(
        principal,
        opts.permissionKey,
        scope?.outletId ?? null,
      );
      return p;
    } catch (err) {
      const mapped = mapPaymentError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post<{ Params: { paymentId: string } }>(
    '/api/v1/payments/:paymentId/client-redirect-signal',
    async (req, reply) => {
      try {
        const principal = await requireFinancialSession(req, opts);
        const existing = await payments.getPayment(req.params.paymentId);
        if (!existing || existing.tenantId !== principal.tenantId) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payment not found' });
        }
        const scope = await payments.resolveOutletForPayment(existing.paymentId);
        await opts.identity.assertPosOperate(
          principal,
          opts.permissionKey,
          scope?.outletId ?? null,
        );
        // Hard invariant: redirect ≠ payment truth. Never qualifies.
        return await payments.recordClientRedirectSignal(req.params.paymentId);
      } catch (err) {
        const mapped = mapPaymentError(err);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post('/api/v1/payments/allocations', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as {
        paymentId?: string;
        settlementCheckId?: string;
        amountMinor?: string;
        allocationIdempotencyKey?: string;
        tenantId?: string;
        covered?: unknown;
        coveredMinor?: unknown;
        settlementStatus?: unknown;
      };
      let outletId: string | null = null;
      if (body.settlementCheckId) {
        const checkScope = await payments.resolveOutletForSettlementCheck(body.settlementCheckId);
        outletId = checkScope?.outletId ?? null;
      } else if (body.paymentId) {
        const payScope = await payments.resolveOutletForPayment(body.paymentId);
        outletId = payScope?.outletId ?? null;
      }
      const principal = await requireFinancialPrincipal(req, opts, { outletId });
      rejectTenantAuthorityInjection(principal, body.tenantId);
      if (
        body.covered !== undefined ||
        body.coveredMinor !== undefined ||
        body.settlementStatus !== undefined
      ) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'Authoritative coverage/settlement fields are not caller-settable',
        });
      }
      if (
        !body.paymentId ||
        !body.settlementCheckId ||
        !body.amountMinor ||
        !body.allocationIdempotencyKey
      ) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'paymentId, settlementCheckId, amountMinor, allocationIdempotencyKey required',
        });
      }
      const pay = await payments.getPayment(body.paymentId);
      if (!pay || pay.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payment not found' });
      }
      const checkScope = await payments.resolveOutletForSettlementCheck(body.settlementCheckId);
      if (!checkScope || checkScope.tenantId !== principal.tenantId) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'SettlementCheck not found' });
      }
      return await payments.allocatePaymentToCheck({
        paymentId: body.paymentId,
        settlementCheckId: body.settlementCheckId,
        amountMinor: body.amountMinor,
        allocationIdempotencyKey: body.allocationIdempotencyKey,
      });
    } catch (err) {
      const mapped = mapPaymentError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
}

/**
 * DEV/TEST Payment Simulator — visibly non-production.
 * Uses the SAME Payments Core commands. No direct Settlement/Order mutation.
 *
 * PO / SEC-0: when NODE_ENV === 'production', registers ZERO routes.
 * ALLOW_DEV_* overrides have no effect.
 */
export async function registerDevPaymentSimulatorRoutes(
  app: FastifyInstance,
  payments: PaymentsService,
): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  app.post('/api/v1/dev/payment-simulator/outcome', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as {
        paymentId?: string;
        scenario?: string;
        providerEventIdentity?: string;
        allocateToCheckId?: string;
        allocationIdempotencyKey?: string;
        evidenceAmountMinor?: string;
        evidenceCurrencyCode?: string;
        providerTransactionReference?: string;
      };
      if (!body.paymentId || !body.scenario) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'paymentId and scenario required',
          simulator: 'DEV_PAYMENT_SIMULATOR',
        });
      }

      const payment = await payments.getPayment(body.paymentId);
      if (!payment) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payment not found' });
      }

      const eventId =
        body.providerEventIdentity ??
        `dev_sim:${body.scenario}:${body.paymentId}:${Date.now()}`;

      const scenario = body.scenario.toUpperCase();
      let normalizedOutcome: NormalizedProviderOutcome = 'PENDING';
      let verificationStatus: 'VERIFIED' | 'UNVERIFIED' = 'VERIFIED';
      let raw = scenario;
      let evidenceAmount = body.evidenceAmountMinor ?? payment.requestedAmountMinor;
      let evidenceCurrency = body.evidenceCurrencyCode ?? payment.currencyCode;

      switch (scenario) {
        case 'PENDING':
          normalizedOutcome = 'PENDING';
          break;
        case 'SUCCESS':
        case 'LATE_SUCCESS':
          normalizedOutcome = 'SUCCEEDED';
          break;
        case 'FAILED':
          normalizedOutcome = 'FAILED';
          break;
        case 'EXPIRED':
          normalizedOutcome = 'EXPIRED';
          break;
        case 'DUPLICATE_SUCCESS_EVENT':
          normalizedOutcome = 'SUCCEEDED';
          break;
        case 'OUT_OF_ORDER_PENDING_AFTER_SUCCESS':
          normalizedOutcome = 'PENDING';
          break;
        case 'UNVERIFIED_SUCCESS':
          normalizedOutcome = 'SUCCEEDED';
          verificationStatus = 'UNVERIFIED';
          raw = 'UNVERIFIED_SUCCESS_CLAIM';
          break;
        case 'AMOUNT_MISMATCH':
          normalizedOutcome = 'SUCCEEDED';
          evidenceAmount = body.evidenceAmountMinor ?? '1';
          break;
        case 'CURRENCY_MISMATCH':
          normalizedOutcome = 'SUCCEEDED';
          evidenceCurrency = body.evidenceCurrencyCode ?? 'USD';
          break;
        case 'INQUIRY_SUCCESS':
          normalizedOutcome = 'SUCCEEDED';
          break;
        default:
          return reply.code(400).send({
            error: 'VALIDATION',
            message: `Unknown DEV simulator scenario: ${body.scenario}`,
            simulator: 'DEV_PAYMENT_SIMULATOR',
          });
      }

      const origin =
        scenario === 'INQUIRY_SUCCESS' ? ('INQUIRY' as const) : ('DEV_SIMULATOR' as const);

      const result = await payments.recordVerifiedProviderOutcome({
        paymentId: body.paymentId,
        providerEventIdentity: eventId,
        rawProviderStatus: raw,
        normalizedOutcome,
        verificationStatus,
        reconciliationOrigin: origin,
        evidenceAmountMinor: evidenceAmount,
        evidenceCurrencyCode: evidenceCurrency,
        providerTransactionReference:
          body.providerTransactionReference ?? `dev_tx_${body.paymentId.slice(0, 8)}`,
        ...(body.allocateToCheckId !== undefined
          ? { allocateToCheckId: body.allocateToCheckId }
          : {}),
        ...(body.allocationIdempotencyKey !== undefined
          ? { allocationIdempotencyKey: body.allocationIdempotencyKey }
          : {}),
        diagnosticMetadata: {
          simulator: 'DEV_PAYMENT_SIMULATOR',
          scenario,
          warning: 'Not a production provider. Uses Payments Core only.',
        },
      });

      return {
        simulator: 'DEV_PAYMENT_SIMULATOR',
        warning: 'DEV/TEST only — not a production acquiring provider',
        ...result,
      };
    } catch (err) {
      const mapped = mapPaymentError(err);
      return reply.code(mapped.status).send({ ...mapped.body, simulator: 'DEV_PAYMENT_SIMULATOR' });
    }
  });
}
