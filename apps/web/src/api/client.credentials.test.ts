import { describe, expect, it, vi } from 'vitest';
import { posApi } from './client.js';

describe('posApi Session cookie transport', () => {
  it('includes credentials: include on authenticated POS requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ orderId: 'x', settlement: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await posApi.getLiveSettlement('11111111-1111-4111-8111-111111111111');
    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('include');
    // Never invent caller-controlled Origin — browser supplies CSRF signal.
    const headers = init.headers as Record<string, string> | undefined;
    if (headers) {
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('origin');
    }
    fetchSpy.mockRestore();
  });
});
