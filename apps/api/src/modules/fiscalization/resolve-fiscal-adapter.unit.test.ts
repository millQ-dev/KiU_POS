import { describe, expect, it } from 'vitest';
import { resolveFiscalProviderAdapter } from './resolve-fiscal-adapter.js';

describe('resolveFiscalProviderAdapter', () => {
  it('production always unavailable even with allow flag + disposable URL', () => {
    const r = resolveFiscalProviderAdapter({
      isProduction: true,
      allowFiscalTestAdapterEnv: '1',
      databaseUrl: 'postgresql://millq:millq@localhost:5432/millq_ci_pos_fisc1',
      nodeEnv: 'production',
    });
    expect(r.mode).toBe('unavailable');
    expect(r.adapter.adapterIdentity).toBe('millq.fiscal.unavailable');
  });

  it('NODE_ENV=production without isProduction still unavailable', () => {
    const r = resolveFiscalProviderAdapter({
      isProduction: false,
      allowFiscalTestAdapterEnv: '1',
      databaseUrl: 'postgresql://millq:millq@localhost:5432/millq_ci_pos_fisc1',
      nodeEnv: 'production',
    });
    expect(r.mode).toBe('unavailable');
  });

  it('test-satisfying only with allow=1 and disposable millq_ci_pos_*', () => {
    const r = resolveFiscalProviderAdapter({
      isProduction: false,
      allowFiscalTestAdapterEnv: '1',
      databaseUrl: 'postgresql://millq:millq@localhost:5432/millq_ci_pos_fisc1_e2e',
      nodeEnv: 'development',
    });
    expect(r.mode).toBe('test-satisfying');
    expect(r.adapter.adapterIdentity).toBe('millq.fiscal.test-satisfying');
  });

  it('refuse millq_dev even with allow=1', () => {
    const r = resolveFiscalProviderAdapter({
      isProduction: false,
      allowFiscalTestAdapterEnv: '1',
      databaseUrl: 'postgresql://millq:millq@localhost:5432/millq_dev',
      nodeEnv: 'development',
    });
    expect(r.mode).toBe('unavailable');
  });

  it('refuse disposable without allow flag', () => {
    const r = resolveFiscalProviderAdapter({
      isProduction: false,
      allowFiscalTestAdapterEnv: '0',
      databaseUrl: 'postgresql://millq:millq@localhost:5432/millq_ci_pos_fisc1',
      nodeEnv: 'test',
    });
    expect(r.mode).toBe('unavailable');
  });
});
