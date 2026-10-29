export class IdentityDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityDomainError';
  }
}

export class CompanyIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CompanyIdentityError';
  }
}

export const PERMISSION_CASH_SHIFT_OPEN = 'cash_shift.open' as const;
export const PERMISSION_CASH_SHIFT_OPEN_APPROVE = 'cash_shift.open.approve' as const;
/** Close CashShift when balanced or surplus (composed with pos.operate) — ADR-0046. */
export const PERMISSION_CASH_SHIFT_CLOSE = 'cash_shift.close' as const;
/** Close CashShift with shortage — Manager/Owner only; no cashier bypass — ADR-0046. */
export const PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE = 'cash_shift.close.shortage' as const;
/** POS / financial HTTP operations (Orders, Payments, Settlement) — SEC-0 / ADR-0036. */
export const PERMISSION_POS_OPERATE = 'pos.operate' as const;
/**
 * Dedicated ReceiveCash tender acceptance (ADR-0038 A3/A4).
 * Provisional key binding of Accepted dedicated-permission rule; manager role alone ≠ cash accept.
 */
export const PERMISSION_PAYMENTS_RECEIVE_CASH = 'payments.receive_cash' as const;
/** ADR-0048 R8 — Owner-issued scoped refund grants (job title alone ≠ permission). */
export const PERMISSION_PAYMENTS_REFUND_CASH = 'payments.refund_cash' as const;
export const PERMISSION_PAYMENTS_REFUND_VIETQR = 'payments.refund_vietqr' as const;
export const PERMISSION_PAYMENTS_REFUND_APPROVE = 'payments.refund.approve' as const;
export const PERMISSION_PAYMENTS_REFUND_RECONCILE = 'payments.refund.reconcile' as const;
/** Procurement Goods Receipt operational HTTP contour — C0.1 (tenant-wide grant). */
export const PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE =
  'procurement.goods_receipt.manage' as const;

/**
 * ADR-0051 D1 — Manager/Owner approves an order-level merchant discount requested by a cashier.
 * Held by the approver only; the requesting cashier needs pos.operate.
 */
export const PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE =
  'orders.merchant_discount.approve' as const;
/** ApprovalRequest operation_type for ApplyOrderMerchantDiscount (ADR-0051). */
export const ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE = 'orders.merchant_discount.apply' as const;

/** ADR-0052 M7 — cashier selects published modifier options on an OPEN OrderLine. */
export const PERMISSION_ORDERS_LINE_CONFIGURE = 'orders.line_configure' as const;

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;
export const SESSION_TTL_HOURS = 12;
export const CHALLENGE_TTL_SECONDS = 120;
export const APPROVAL_TTL_SECONDS = 300;

export const SESSION_COOKIE_NAME = 'millq_session';
