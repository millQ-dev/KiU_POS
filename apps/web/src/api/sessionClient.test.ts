import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentSession } from './sessionClient.js';

describe('session transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('distinguishes a 401 from server failure and malformed success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchCurrentSession()).toBeNull();
    await expect(fetchCurrentSession()).rejects.toThrow('SESSION_UNAVAILABLE');
    await expect(fetchCurrentSession()).rejects.toThrow('SESSION_INVALID_RESPONSE');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

});
