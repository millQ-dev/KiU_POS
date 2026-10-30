import { afterEach, describe, expect, it, vi } from 'vitest';
import { posApi } from './client.js';
import { ApiError } from './types.js';

const orderId = '77777777-7777-4777-8777-777777777777';
const order = {
  orderId, tenantId: 'tenant', legalEntityId: 'legal', outletId: 'outlet',
  status: 'OPEN', channel: 'DIRECT', lines: [],
};
const payload = {
  orderId,
  layoutPublicationSlotId: 'slot',
  presentationContext: { tenantId: 'tenant', brandId: 'brand', outletId: 'outlet' },
  salesContext: {
    tenantId: 'tenant', brandId: 'brand', outletId: 'outlet',
    orderChannel: 'DIRECT', businessDateTime: '2026-10-30T00:00:00.000Z',
  },
};

afterEach(() => vi.restoreAllMocks());

describe('selection transport', () => {
  it.each(['count', 'quantity'] as const)(
    '%s: a lost response is not replayed and a subsequent GET uses session credentials',
    async (kind) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new TypeError('connection lost'))
        .mockResolvedValueOnce(new Response(JSON.stringify(order), { status: 200 }));
      const select = kind === 'count'
        ? () => posApi.selectCountTap(payload)
        : () => posApi.selectQuantityTap({ ...payload, quantity: '0.5' });

      await expect(select()).rejects.toThrow('connection lost');
      expect(await posApi.getOrder(orderId)).toEqual(order);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`/api/v1/pos/select-${kind}`);
      expect(fetchSpy.mock.calls[1]?.[0]).toBe(`/api/v1/orders/${orderId}`);
      for (const [, init] of fetchSpy.mock.calls) {
        expect(init?.credentials).toBe('include');
        expect(new Headers(init?.headers).has('Origin')).toBe(false);
      }
    },
  );

  it('passes through a successful selection and distinguishes HTTP absence from a failed read', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ order }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'missing' }), { status: 404 }))
      .mockRejectedValueOnce(new TypeError('offline'));
    expect((await posApi.selectCountTap(payload)).order).toEqual(order);
    await expect(posApi.getOrder(orderId)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' } satisfies Partial<ApiError>);
    await expect(posApi.getOrder(orderId)).rejects.toThrow('offline');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
