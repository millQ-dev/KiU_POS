/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettlementCheckoutPanel } from './SettlementCheckout.js';
import type { SettlementProjection } from '../api/types.js';

const sessionFetch = vi.fn();

vi.mock('../api/sessionClient.js', () => ({
  sessionFetch: (...args: unknown[]) => sessionFetch(...args),
}));

const satisfied: SettlementProjection = {
  settlementGroupId: 'sg-fisc',
  orderId: 'ord-fisc',
  state: 'SATISFIED',
  currencyCode: 'VND',
  merchandiseGrossMinor: '5000',
  customerPayableMinor: '5000',
  outstandingAmountMinor: '0',
  allocatedAmountMinor: '5000',
  version: 2,
  checks: [
    {
      settlementCheckId: 'check-fisc',
      checkNumber: 1,
      state: 'CLOSED',
      customerPayableMinor: '5000',
      outstandingAmountMinor: '0',
      allocatedAmountMinor: '5000',
    },
  ],
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('SettlementCheckoutPanel fiscal → CompleteOrder', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    sessionFetch.mockReset();
    // jsdom has no Web Locks — production requires them; tests inject a serial exclusive lock.
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, _opts: unknown, callback: () => unknown) => callback(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('issues fiscal, unlocks CompleteOrder only after gate SATISFIED, posts advance-checkout', async () => {
    const onOrderCompleted = vi.fn();
    sessionFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/fiscal-gate') && (!init || init.method === undefined || init.method === 'GET')) {
        const issued = sessionFetch.mock.calls.some(
          (c) => String(c[0]).includes('/fiscal/documents/issue') && c[1]?.method === 'POST',
        );
        return jsonResponse(200, {
          fiscalAdapterMode: 'test-satisfying',
          gate: {
            status: issued ? 'SATISFIED' : 'REQUIRED_NOT_SATISFIED',
            detail: issued ? undefined : 'FiscalDocument required',
          },
        });
      }
      if (u.includes('/fiscal/documents/issue') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).not.toHaveProperty('satisfied');
        expect(body).not.toHaveProperty('fiscalStatus');
        return jsonResponse(200, {
          fiscalDocumentId: 'fd-1',
          status: 'SATISFIED',
          settlementGroupId: 'sg-fisc',
          paymentId: 'pay-1',
          paymentCollectionEventId: 'pce-1',
          taxOrderSnapshotId: 'tax-1',
        });
      }
      if (u.includes('/advance-checkout') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).not.toHaveProperty('fiscalAccepted');
        expect(body).not.toHaveProperty('paid');
        expect(typeof body.businessDate).toBe('string');
        expect(typeof body.businessOrder).toBe('number');
        expect(body.businessOrder).not.toBe(Date.now());
        return jsonResponse(200, {
          fiscal: { status: 'SATISFIED' },
          completion: {
            status: 'completed',
            goodsIssueId: 'gi-1',
            order: { orderId: 'ord-fisc', status: 'COMPLETED' },
          },
        });
      }
      return jsonResponse(500, { error: 'UNEXPECTED', message: u });
    });

    render(
      <SettlementCheckoutPanel
        settlement={satisfied}
        commercialAccepted
        editableOrder={false}
        busy={false}
        terminalId="term-1"
        legalEntityId="le-1"
        outletId="out-1"
        outletTimeZone="UTC"
        onOpenCheckout={() => undefined}
        onAbortCheckout={() => undefined}
        onSettlementRefresh={async () => undefined}
        onOrderCompleted={onOrderCompleted}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('fiscal-gate-blocked')).toBeTruthy());
    expect(screen.queryByTestId('complete-order-submit')).toBeNull();

    fireEvent.click(screen.getByTestId('fiscal-issue-submit'));
    await waitFor(() => expect(screen.getByTestId('fiscal-gate-satisfied')).toBeTruthy());
    await waitFor(() => {
      const btn = screen.getByTestId('complete-order-submit') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('complete-order-submit'));
    await waitFor(() => expect(screen.getByTestId('complete-order-success')).toBeTruthy());
    expect(screen.getByTestId('complete-goods-issue-id').textContent).toBe('gi-1');
    expect(onOrderCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-fisc',
        status: 'COMPLETED',
        goodsIssueId: 'gi-1',
      }),
    );
  });

  it('rejects client-forged complete while gate not SATISFIED', async () => {
    sessionFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/fiscal-gate')) {
        return jsonResponse(200, {
          fiscalAdapterMode: 'unavailable',
          gate: { status: 'UNAVAILABLE', detail: 'fail closed' },
        });
      }
      return jsonResponse(500, { error: 'UNEXPECTED' });
    });

    render(
      <SettlementCheckoutPanel
        settlement={satisfied}
        commercialAccepted
        editableOrder={false}
        busy={false}
        terminalId="term-1"
        legalEntityId="le-1"
        outletId="out-1"
        onOpenCheckout={() => undefined}
        onAbortCheckout={() => undefined}
        onSettlementRefresh={async () => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('fiscal-gate-blocked')).toBeTruthy());
    expect(screen.queryByTestId('complete-order-submit')).toBeNull();
  });
});
