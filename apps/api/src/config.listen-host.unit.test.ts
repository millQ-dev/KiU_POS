import { afterEach, describe, expect, it } from 'vitest';
import { resolveListenHost, type Env } from './config.js';

function env(partial: Partial<Env> & Pick<Env, 'NODE_ENV'>): Env {
  return {
    PORT: 3000,
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://localhost:5432/millq_ci_pos_demo29_unit',
    CORS_ORIGINS: 'http://127.0.0.1:5173',
    ...partial,
  } as Env;
}

describe('resolveListenHost', () => {
  const prevAdapter = process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER;

  afterEach(() => {
    if (prevAdapter === undefined) delete process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER;
    else process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER = prevAdapter;
  });

  it('defaults development to loopback', () => {
    delete process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER;
    expect(resolveListenHost(env({ NODE_ENV: 'development' }))).toBe('127.0.0.1');
  });

  it('defaults production to 0.0.0.0', () => {
    delete process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER;
    expect(resolveListenHost(env({ NODE_ENV: 'production' }))).toBe('0.0.0.0');
  });

  it('fail-closed: fiscal test adapter rejects non-loopback', () => {
    process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER = '1';
    expect(() =>
      resolveListenHost(env({ NODE_ENV: 'development', MILLQ_LISTEN_HOST: '0.0.0.0' })),
    ).toThrow(/loopback/);
  });

  it('allows fiscal test adapter on 127.0.0.1', () => {
    process.env.MILLQ_ALLOW_FISCAL_TEST_ADAPTER = '1';
    expect(
      resolveListenHost(env({ NODE_ENV: 'development', MILLQ_LISTEN_HOST: '127.0.0.1' })),
    ).toBe('127.0.0.1');
  });
});
