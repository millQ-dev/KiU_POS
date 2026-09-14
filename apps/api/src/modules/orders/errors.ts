export class DomainValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = code;
  }
}

export class OrderImmutableError extends Error {
  readonly code = 'ORDER_IMMUTABLE' as const;
  constructor(message = 'COMPLETED/CANCELLED order business content is immutable') {
    super(message);
    this.name = 'OrderImmutableError';
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  constructor(
    readonly idempotencyKey: string,
    message?: string,
  ) {
    super(message ?? `Idempotency conflict for key ${idempotencyKey}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
