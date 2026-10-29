export { CompanyIdentityError, IdentityDomainError } from './errors.js';
export {
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_CASH_SHIFT_OPEN_APPROVE,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE,
  PERMISSION_POS_OPERATE,
  PERMISSION_ORDERS_MERCHANT_DISCOUNT_APPROVE,
  ORDER_MERCHANT_DISCOUNT_OPERATION_TYPE,
  PERMISSION_PAYMENTS_RECEIVE_CASH,
  PERMISSION_PAYMENTS_REFUND_CASH,
  PERMISSION_PAYMENTS_REFUND_VIETQR,
  PERMISSION_PAYMENTS_REFUND_APPROVE,
  PERMISSION_PAYMENTS_REFUND_RECONCILE,
  PERMISSION_PROCUREMENT_GOODS_RECEIPT_MANAGE,
  SESSION_COOKIE_NAME,
  PIN_MAX_ATTEMPTS,
  PIN_LOCK_MINUTES,
} from './errors.js';
export {
  readSessionToken,
  assertCsrf,
  requireFinancialPrincipal,
  requireFinancialSession,
  rejectTenantAuthorityInjection,
  type FinancialAuthOptions,
} from './http-auth.js';
export {
  hashPin,
  verifyPin,
  pinLookupHash,
  isValidPinFormat,
  requirePepper,
  sha256Hex,
  generateOpaqueToken,
} from './crypto.js';
export { IdentityService, type AuthenticatedPrincipal, type PinAuthResult, audit } from './identity-service.js';
export { LoginChallengeService, ApprovalRequestService } from './login-challenge-service.js';
export { OutboxNotificationPort, type NotificationPort } from './notification-port.js';
