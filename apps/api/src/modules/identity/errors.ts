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
/** POS / financial HTTP operations (Orders, Payments, Settlement) — SEC-0 / ADR-0036. */
export const PERMISSION_POS_OPERATE = 'pos.operate' as const;

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;
export const SESSION_TTL_HOURS = 12;
export const CHALLENGE_TTL_SECONDS = 120;
export const APPROVAL_TTL_SECONDS = 300;

export const SESSION_COOKIE_NAME = 'millq_session';
