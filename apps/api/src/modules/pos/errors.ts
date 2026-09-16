export class DomainValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = code;
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class PublishedImmutableError extends Error {
  readonly code = 'PUBLISHED_IMMUTABLE' as const;
  constructor(message = 'Published LayoutPublication cannot be mutated') {
    super(message);
    this.name = 'PublishedImmutableError';
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}
