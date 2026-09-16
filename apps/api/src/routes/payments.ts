import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { DomainValidationError } from '../modules/orders/errors.js';
import { PaymentsService } from '../modules/payments/payments-service.js';
import type { NormalizedProviderOutcome } from '../modules/payments/payment-lifecycle.js';
import type { SettlementService } from '../modules/settlement/settlement-service.js';

function mapPaymentError(err: unknown): { status: number; body: Record<string, unknown> } {
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
): Promise<void> {
  app.post('/api/v1/payments/tenders', async (req, reply) => {
    try {
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
      };
      if (!body.tenantId || !body.legalEntityId || !body.code || !body.displayName) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'tenantId, legalEntityId, code, displayName required',
        });
      }
      return await payments.createTenderDefinition({
        tenantId: body.tenantId,
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
      };
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
      const p = await payments.getPayment(req.params.paymentId);
      if (!p) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payment not found' });
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
      };
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
 */
export async function registerDevPaymentSimulatorRoutes(
  app: FastifyInstance,
  payments: PaymentsService,
): Promise<void> {
  const allowed = process.env.NODE_ENV !== 'production';

  app.post('/api/v1/dev/payment-simulator/outcome', async (req, reply) => {
    if (!allowed) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'DEV PAYMENT SIMULATOR is unavailable in production',
      });
    }
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
