export class ImprintPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImprintPersistenceError';
  }
}

export class ImprintServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImprintServiceError';
  }
}
