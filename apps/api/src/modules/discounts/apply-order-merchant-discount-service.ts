/**
 * ADR-0051 ApplyOrderMerchantDiscount v1.
 *
 * Narrow command: a Manager/Owner with orders.merchant_discount.approve may apply directly;
 * a cashier with only pos.operate must supply a consumed ApprovalRequest (ADR-0036).
 * The discount re-accepts existing FINAL commercial terms (ADR-0028) in one transaction
 * before any Settlement. Callers never supply commercial terms — only mode + amount/percent
 * + reason + optional approval evidence.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  MAX_ORDER_MERCHANT_DISCOUNT_BASIS_POINTS,
  normalizeDiscountReason,
  resolveOrderMerchantDiscount,
  type OrderMerchantDiscountRequest,
  type ResolvedOrderMerchantDiscount,
} from '@millq/domain';
import { fingerprintDigest, fingerprintsMatch } from '../cash/open-fingerprint.js';
import {
  audit,
  ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE,
  PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE,
  PERMISSION_POS_OPERATE,
  type AuthenticatedPrincipal,
  type IdentityService,
} from '../identity/index.js';
import {
  buildCommercialStateFromCommand,
  loadBuiltCommercialState,
  persistOpenCommercialTerms,
  type BuiltCommercialState,
} from '../orders/commercial-terms.js';
import { DomainValidationError, IdempotencyConflictError, NotFoundError } from '../orders/errors.js';
import type { OrdersService } from '../orders/orders-service.js';
import { setOrderCommercialTermsSchema } from '../orders/types.js';
import { DiscountDomainError } from './errors.js';

const uuid = z.string().uuid();

const applyOrderMerchantDiscountSchema = z
  .object({
    orderId: uuid,
    terminalId: uuid,
    idempotencyKey: z.string().min(8).max(128),
    mode: z.enum(['FIXED_MINOR', 'PERCENT']),
    amountMinor: z.string().optional(),
    percent: z.union([z.string(), z.number()]).optional(),
    reason: z.string(),
    approvalRequestId: uuid.optional(),
    deviceId: uuid.optional(),
  })
  .strict();

export type ApplyOrderMerchantDiscountResult = {
  status: 'applied' | 'duplicate';
  orderId: string;
  mode: 'FIXED_MINOR' | 'PERCENT';
  discountMinor: string;
  percentBasisPoints: number | null;
  eligibleBasisMinor: string;
  reason: string;
  /** Null when a grant holder applied directly (ADR-0051 direct grant). */
  approvalRequestId: string | null;
  approverUserId: string;
  certainty: 'FINAL';
  netMerchandiseSalesMinor: string;
  semanticFingerprint: string;
  lines: Array<{
    orderLineId: string;
    lineNumber: number;
    allocatedOrderMerchantDiscountMinor: string;
    netMerchandiseSalesMinor: string;
  }>;
};

type StoredDiscountProvenance = {
  requestDigest: string;
  mode: 'FIXED_MINOR' | 'PERCENT';
  discountMinor: string;
  percentBasisPoints: number | null;
  eligibleBasisMinor: string;
  reason: string;
  approvalRequestId: string | null;
  approverUserId: string;
  authorizationPath: 'DIRECT_GRANT' | 'APPROVAL_REQUEST';
};

/**
 * Canonical ApprovalRequest fingerprint (ADR-0036 §10.2) the cashier must request.
 * ApprovalRequestService.createRequest adds operationType, tenantId, outletId, terminalId and
 * requesterUserId; callers supply the remaining keys exactly as built here.
 */
export function buildOrderMerchantDiscountFingerprint(input: {
  tenantId: string;
  outletId: string;
  terminalId: string;
  requesterUserId: string;
  orderId: string;
  request: OrderMerchantDiscountRequest;
  percentBasisPoints: number | null;
  reason: string;
}): Record<string, unknown> {
  return {
    operationType: ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE,
    tenantId: input.tenantId,
    outletId: input.outletId,
    terminalId: input.terminalId,
    requesterUserId: input.requesterUserId,
    orderId: input.orderId,
    mode: input.request.mode,
    ...(input.request.mode === 'FIXED_MINOR'
      ? { amountMinor: input.request.amountMinor }
      : { percentBasisPoints: input.percentBasisPoints }),
    // Always store the normalized reason so ApprovalRequest create/consume cannot diverge on whitespace.
    reason: normalizeDiscountReason(input.reason),
  };
}

function readStoredDiscount(provenance: unknown): StoredDiscountProvenance | null {
  if (!provenance || typeof provenance !== 'object') return null;
  const md = (provenance as Record<string, unknown>).merchantDiscount;
  if (!md || typeof md !== 'object') return null;
  const raw = md as Record<string, unknown>;
  const approvalRequestId =
    typeof raw.approvalRequestId === 'string' ? raw.approvalRequestId : null;
  return {
    ...(raw as Omit<StoredDiscountProvenance, 'approvalRequestId' | 'authorizationPath'>),
    approvalRequestId,
    authorizationPath:
      raw.authorizationPath === 'DIRECT_GRANT' || raw.authorizationPath === 'APPROVAL_REQUEST'
        ? raw.authorizationPath
        : approvalRequestId
          ? 'APPROVAL_REQUEST'
          : 'DIRECT_GRANT',
  };
}

function eligibleBasisMinor(state: BuiltCommercialState): string {
  let basis = 0n;
  for (const l of state.lines) {
    if (l.eligibleForOrderDiscount) {
      basis += BigInt(l.grossMerchandiseMinor) - BigInt(l.lineMerchantFundedDiscountMinor);
    }
  }
  return basis.toString();
}

function toResult(
  status: 'applied' | 'duplicate',
  orderId: string,
  state: BuiltCommercialState,
  stored: StoredDiscountProvenance,
): ApplyOrderMerchantDiscountResult {
  return {
    status,
    orderId,
    mode: stored.mode,
    discountMinor: stored.discountMinor,
    percentBasisPoints: stored.percentBasisPoints,
    eligibleBasisMinor: stored.eligibleBasisMinor,
    reason: stored.reason,
    approvalRequestId: stored.approvalRequestId,
    approverUserId: stored.approverUserId,
    certainty: 'FINAL',
    netMerchandiseSalesMinor: state.netMerchandiseSalesMinor!,
    semanticFingerprint: state.semanticFingerprint,
    lines: state.lines.map((l) => ({
      orderLineId: l.orderLineId,
      lineNumber: l.lineNumber,
      allocatedOrderMerchantDiscountMinor: l.allocatedOrderMerchantDiscountMinor,
      netMerchandiseSalesMinor: l.netMerchandiseSalesMinor!,
    })),
  };
}

function toRequest(cmd: z.infer<typeof applyOrderMerchantDiscountSchema>): OrderMerchantDiscountRequest {
  if (cmd.mode === 'FIXED_MINOR') {
    if (cmd.amountMinor === undefined || cmd.percent !== undefined) {
      throw new DomainValidationError(
        'VALIDATION',
        'FIXED_MINOR requires amountMinor and forbids percent',
      );
    }
    return { mode: 'FIXED_MINOR', amountMinor: cmd.amountMinor };
  }
  if (cmd.percent === undefined || cmd.amountMinor !== undefined) {
    throw new DomainValidationError('VALIDATION', 'PERCENT requires percent and forbids amountMinor');
  }
  return { mode: 'PERCENT', percent: String(cmd.percent) };
}

export class ApplyOrderMerchantDiscountService {
  constructor(
    private readonly orders: OrdersService,
    private readonly identity: IdentityService,
  ) {}

  async apply(
    principal: AuthenticatedPrincipal,
    raw: unknown,
  ): Promise<ApplyOrderMerchantDiscountResult> {
    const cmd = applyOrderMerchantDiscountSchema.parse(raw);
    const request = toRequest(cmd);
    const reason = normalizeDiscountReason(cmd.reason);

    return this.orders.withOpenOrderCommercialLock(cmd.orderId, async (client, order) => {
      if (order.tenantId !== principal.tenantId) {
        throw new NotFoundError('Order not found');
      }
      await this.assertTerminal(client, principal, order.outletId, cmd.terminalId);

      const prior = await client.query<{ idempotency_key: string; provenance_json: unknown }>(
        `SELECT idempotency_key, provenance_json FROM sales_order_commercial_terms WHERE order_id = $1`,
        [cmd.orderId],
      );
      const head = prior.rows[0];
      if (!head) {
        throw new DomainValidationError(
          'COMMERCIAL_TERMS_NOT_ACCEPTED',
          'Order commercial terms must be accepted before applying a merchant discount',
        );
      }
      const state = await loadBuiltCommercialState(client, cmd.orderId);
      if (!state || state.certainty !== 'FINAL') {
        throw new DomainValidationError(
          'COMMERCIAL_TERMS_NOT_FINAL',
          'Merchant discount requires FINAL accepted commercial terms',
        );
      }
      if (state.customerPayableMinor !== null) {
        throw new DomainValidationError(
          'COMMERCIAL_TERMS_PAYABLE_FIXED',
          'Accepted commercial terms carry an explicit customerPayable; re-accept base terms first',
        );
      }

      const resolved = resolveOrderMerchantDiscount({
        request,
        eligibleBasisMinor: eligibleBasisMinor(state),
        reason,
      });
      const fingerprint = buildOrderMerchantDiscountFingerprint({
        tenantId: principal.tenantId,
        outletId: order.outletId,
        terminalId: cmd.terminalId,
        requesterUserId: principal.userId,
        orderId: cmd.orderId,
        request,
        percentBasisPoints: resolved.percentBasisPoints,
        reason: resolved.reason,
      });
      const requestDigest = fingerprintDigest(fingerprint);

      if (head.idempotency_key === cmd.idempotencyKey) {
        const stored = readStoredDiscount(head.provenance_json);
        if (stored?.requestDigest === requestDigest) {
          return toResult('duplicate', cmd.orderId, state, stored);
        }
        throw new IdempotencyConflictError(
          cmd.idempotencyKey,
          'ApplyOrderMerchantDiscount idempotency key already used with different semantics',
        );
      }

      await this.assertRequesterMayOperate(client, principal, order.outletId, cmd.terminalId);

      let approvalRequestId: string | null = cmd.approvalRequestId ?? null;
      let approverUserId: string;
      let authorizationPath: 'DIRECT_GRANT' | 'APPROVAL_REQUEST';
      if (approvalRequestId == null) {
        // ADR-0051: Manager/Owner with approve grant applies on that grant (no universal 2-person rule).
        const mayDirect = await this.identity.hasPermission(
          client,
          principal.tenantId,
          principal.userId,
          PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE,
          order.outletId,
          cmd.terminalId,
        );
        if (!mayDirect) {
          throw new DiscountDomainError(
            'APPROVAL_REQUIRED',
            'Manager/Owner approval is required to apply a merchant discount',
          );
        }
        approverUserId = principal.userId;
        authorizationPath = 'DIRECT_GRANT';
      } else {
        approverUserId = await this.consumeApproval(client, {
          principal,
          approvalRequestId,
          fingerprint,
          outletId: order.outletId,
          terminalId: cmd.terminalId,
        });
        authorizationPath = 'APPROVAL_REQUEST';
      }

      const stored: StoredDiscountProvenance = {
        requestDigest,
        mode: resolved.mode,
        discountMinor: resolved.discountMinor,
        percentBasisPoints: resolved.percentBasisPoints,
        eligibleBasisMinor: resolved.eligibleBasisMinor,
        reason: resolved.reason,
        approvalRequestId,
        approverUserId,
        authorizationPath,
      };
      const next = this.buildDiscountedState(cmd, state, resolved, stored, principal.userId);
      await persistOpenCommercialTerms(client, {
        orderId: cmd.orderId,
        tenantId: order.tenantId,
        idempotencyKey: cmd.idempotencyKey,
        actorId: principal.userId,
        deviceId: cmd.deviceId ?? null,
        state: next,
      });
      await audit(client, {
        tenantId: principal.tenantId,
        eventType: 'ORDER_MERCHANT_DISCOUNT_APPLIED',
        actorUserId: principal.userId,
        subjectRef: cmd.orderId,
        payload: {
          outletId: order.outletId,
          terminalId: cmd.terminalId,
          idempotencyKey: cmd.idempotencyKey,
          priorOrderDiscountMinor: state.orderMerchantFundedDiscountMinor,
          ...stored,
        },
      });
      return toResult('applied', cmd.orderId, next, stored);
    });
  }

  /** Re-accepts the existing terms with the new order-level discount via the shared C1.1 builder. */
  private buildDiscountedState(
    cmd: z.infer<typeof applyOrderMerchantDiscountSchema>,
    state: BuiltCommercialState,
    resolved: ResolvedOrderMerchantDiscount,
    stored: StoredDiscountProvenance,
    actorId: string,
  ): BuiltCommercialState {
    const baseProvenance =
      state.provenance && typeof state.provenance === 'object'
        ? (state.provenance as Record<string, unknown>)
        : {};
    const command = setOrderCommercialTermsSchema.parse({
      orderId: cmd.orderId,
      idempotencyKey: cmd.idempotencyKey,
      currencyCode: state.currencyCode,
      minorUnitExponent: state.minorUnitExponent,
      certainty: 'FINAL',
      orderMerchantFundedDiscountMinor: resolved.discountMinor,
      taxMinor: state.taxMinor,
      nonMerchandiseChargesMinor: state.nonMerchandiseChargesMinor,
      tipMinor: state.tipMinor,
      customerPayableMinor: null,
      commercialResolution: state.commercialResolution,
      provenance: {
        ...baseProvenance,
        merchantDiscount: {
          ...stored,
          priorOrderDiscountMinor: state.orderMerchantFundedDiscountMinor,
          maxBasisPoints: MAX_ORDER_MERCHANT_DISCOUNT_BASIS_POINTS,
        },
      },
      actorId,
      lineTerms: state.lines.map((l) => ({
        orderLineId: l.orderLineId,
        resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
        grossMerchandiseMinor: l.grossMerchandiseMinor,
        lineMerchantFundedDiscountMinor: l.lineMerchantFundedDiscountMinor,
        eligibleForOrderDiscount: l.eligibleForOrderDiscount,
        thirdPartyMerchandiseFundingMinor: l.thirdPartyMerchandiseFundingMinor,
        taxMinor: l.taxMinor,
        certainty: l.certainty,
        fundingProvenance: l.fundingProvenance,
        provenance: l.provenance,
        ...(l.exactUnroundedMinorBasis != null
          ? { exactUnroundedMinorBasis: l.exactUnroundedMinorBasis }
          : {}),
        ...(l.roundingDelta != null ? { roundingDelta: l.roundingDelta } : {}),
        ...(l.roundingPolicyId != null ? { roundingPolicyId: l.roundingPolicyId } : {}),
        ...(l.roundingPolicyVersion != null ? { roundingPolicyVersion: l.roundingPolicyVersion } : {}),
        ...(l.roundingMode != null ? { roundingMode: l.roundingMode } : {}),
        ...(l.quantumMinor != null ? { quantumMinor: l.quantumMinor } : {}),
        ...(l.calculationContext != null ? { calculationContext: l.calculationContext } : {}),
      })),
    });
    return buildCommercialStateFromCommand(
      command,
      state.lines.map((l) => ({
        order_line_id: l.orderLineId,
        order_id: cmd.orderId,
        line_number: l.lineNumber,
        catalog_item_id: l.soldCatalogItemId,
        quantity: l.quantity,
      })),
    );
  }

  private async assertTerminal(
    client: PoolClient,
    principal: AuthenticatedPrincipal,
    outletId: string,
    terminalId: string,
  ): Promise<void> {
    const terminal = await client.query(
      `SELECT 1 FROM terminal
       WHERE terminal_id = $1 AND tenant_id = $2 AND outlet_id = $3
       FOR SHARE`,
      [terminalId, principal.tenantId, outletId],
    );
    if (terminal.rowCount !== 1) {
      throw new NotFoundError('Terminal not found for order outlet');
    }
  }

  private async assertRequesterMayOperate(
    client: PoolClient,
    principal: AuthenticatedPrincipal,
    outletId: string,
    terminalId: string,
  ): Promise<void> {
    const ok = await this.identity.hasPermission(
      client,
      principal.tenantId,
      principal.userId,
      PERMISSION_POS_OPERATE,
      outletId,
      terminalId,
    );
    if (!ok) {
      throw new DiscountDomainError('FORBIDDEN', 'Permission denied');
    }
  }

  /** ADR-0036 consume: single-use APPROVED request bound to requester, terminal and exact operation. */
  private async consumeApproval(
    client: PoolClient,
    input: {
      principal: AuthenticatedPrincipal;
      approvalRequestId: string;
      fingerprint: Record<string, unknown>;
      outletId: string;
      terminalId: string;
    },
  ): Promise<string> {
    const res = await client.query<{
      tenant_id: string;
      outlet_id: string;
      terminal_id: string;
      requester_user_id: string;
      operation_type: string;
      operation_fingerprint: Record<string, unknown> | string;
      status: string;
      expires_at: Date;
      decided_by_user_id: string | null;
    }>(`SELECT * FROM identity_approval_request WHERE approval_request_id = $1 FOR UPDATE`, [
      input.approvalRequestId,
    ]);
    const row = res.rows[0];
    if (!row || row.tenant_id !== input.principal.tenantId) {
      throw new DiscountDomainError('NOT_FOUND', 'Approval request not found');
    }
    if (
      row.requester_user_id !== input.principal.userId ||
      row.outlet_id !== input.outletId ||
      row.terminal_id !== input.terminalId ||
      row.operation_type !== ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE ||
      row.status !== 'APPROVED' ||
      row.expires_at <= new Date() ||
      !row.decided_by_user_id
    ) {
      throw new DiscountDomainError('AUTH_EVIDENCE_INVALID', 'Approval request invalid');
    }
    const stored =
      typeof row.operation_fingerprint === 'string'
        ? (JSON.parse(row.operation_fingerprint) as Record<string, unknown>)
        : row.operation_fingerprint;
    if (!fingerprintsMatch(stored, input.fingerprint)) {
      throw new DiscountDomainError('AUTH_EVIDENCE_INVALID', 'Approval fingerprint mismatch');
    }
    const approverStillAuthorized = await this.identity.hasPermission(
      client,
      input.principal.tenantId,
      row.decided_by_user_id,
      PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE,
      input.outletId,
      input.terminalId,
    );
    if (!approverStillAuthorized) {
      throw new DiscountDomainError('AUTH_EVIDENCE_INVALID', 'Approver is no longer authorized');
    }
    const upd = await client.query(
      `UPDATE identity_approval_request
       SET status = 'CONSUMED', consumed_at = NOW()
       WHERE approval_request_id = $1 AND status = 'APPROVED'`,
      [input.approvalRequestId],
    );
    if (upd.rowCount !== 1) {
      throw new DiscountDomainError('AUTH_EVIDENCE_INVALID', 'Approval already consumed');
    }
    return row.decided_by_user_id;
  }
}
