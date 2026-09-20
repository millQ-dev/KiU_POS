export class CashDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CashDomainError';
  }
}

export const CASH_SHIFT_OPERATION_TYPE = 'cash_shift.open' as const;
