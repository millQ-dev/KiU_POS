import { describe, expect, it } from 'vitest';
import { ImprintContractError } from '@millq/contracts';
import { ImprintPersistenceError } from './errors.js';
import { toImprintServiceError } from './imprint-claim-service.js';

describe('imprint claim service errors', () => {
  it('replaces a contract message that contains a payload', () => {
    const secret = 'guest-phone-0901234567';
    const mapped = toImprintServiceError(
      new ImprintContractError('IMPRINT_VALUE_REJECTED', `value ${secret} is wrong`),
    );
    expect(mapped.code).toBe('IMPRINT_VALUE_REJECTED');
    expect(mapped.message).not.toContain(secret);
  });

  it('maps a lineage failure to a lifecycle error without the database text', () => {
    const mapped = toImprintServiceError(
      new ImprintPersistenceError('IMPRINT_LINEAGE_REJECTED', 'claim 00000000 leaked'),
    );
    expect(mapped.code).toBe('IMPRINT_LIFECYCLE_REJECTED');
    expect(mapped.message).not.toContain('00000000');
  });

  it('hides an unexpected failure behind a rollback code', () => {
    const mapped = toImprintServiceError(new Error('duplicate key value violates unique constraint'));
    expect(mapped.code).toBe('IMPRINT_TRANSACTION_ROLLED_BACK');
    expect(mapped.message).not.toContain('duplicate key');
  });
});
