export class DomainValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = code;
  }
}

export class PostedImmutableError extends Error {
  readonly code = 'POSTED_IMMUTABLE' as const;
  constructor(message = 'POSTED goods receipt cannot be silently mutated') {
    super(message);
    this.name = 'PostedImmutableError';
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

/** Controlled conflict for reverse races / inconsistent reverse state (HTTP 409). */
export class ReverseConflictError extends Error {
  readonly code = 'REVERSE_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ReverseConflictError';
  }
}
