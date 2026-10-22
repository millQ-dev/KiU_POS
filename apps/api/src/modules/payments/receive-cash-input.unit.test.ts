import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ReceiveCashService } from './receive-cash-service.js';
import { DomainValidationError } from '../orders/errors.js';
import type { AuthenticatedPrincipal } from '../identity/index.js';

/**
 * Safe unit tests: early ReceiveCash input gates only.
 * Mock pool must never be contacted for these cases (no migrate/TRUNCATE/DB).
 */
const unreachablePool = {
  connect: async () => {
    throw new Error('DB must not be reached for early input validation');
  },
} as unknown as Pool;

const principal: AuthenticatedPrincipal = {
  sessionId: '00000000-0000-4000-8000-000000000099',
  tenantId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  employeeId: null,
  displayName: 'unit-test',
  channel: 'TERMINAL',
};

const base = {
  principal,
  terminalId: '00000000-0000-4000-8000-000000000010',
  settlementCheckId: '00000000-0000-4000-8000-000000000020',
  tenderDefinitionId: '00000000-0000-4000-8000-000000000030',
  receiveIdempotencyKey: 'recv-key-1',
  amountTenderedMinor: '10000',
  humanConfirmation: true as const,
};

describe('ReceiveCash early input gates (F06 invariant preservation)', () => {
  const svc = new ReceiveCashService(unreachablePool);

  it('rejects unsupported tipAmountMinor without touching DB', async () => {
    await expect(svc.receiveCash({ ...base, tipAmountMinor: '1000' })).rejects.toMatchObject({
      code: 'TIPS_NOT_SUPPORTED',
    });
    await expect(svc.receiveCash({ ...base, tipAmountMinor: '1000' })).rejects.toBeInstanceOf(
      DomainValidationError,
    );
  });

  it('rejects client collectedAt without touching DB', async () => {
    await expect(
      svc.receiveCash({ ...base, collectedAt: '2020-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({
      code: 'CLIENT_COLLECTED_AT_FORBIDDEN',
    });
  });

  it('treats omitted tipAmountMinor/collectedAt as absent (reaches connect, not tip/time gates)', async () => {
    // Both fields omitted: tip/collectedAt gates must not fire; next step is DB connect.
    await expect(svc.receiveCash({ ...base })).rejects.toThrow(
      /DB must not be reached for early input validation/,
    );
  });

  it('allows explicit null tipAmountMinor/collectedAt through tip/time gates to connect', async () => {
    await expect(
      svc.receiveCash({ ...base, tipAmountMinor: null, collectedAt: null }),
    ).rejects.toThrow(/DB must not be reached for early input validation/);
  });
});
