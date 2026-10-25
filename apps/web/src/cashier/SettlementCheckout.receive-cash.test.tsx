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

const collecting: SettlementProjection = {
  settlementGroupId: 'sg-1',
  orderId: 'ord-1',
  state: 'COLLECTING',
  currencyCode: 'VND',
  merchandiseGrossMinor: '5000',
  customerPayableMinor: '5000',
  outstandingAmountMinor: '5000',
  allocatedAmountMinor: '0',
  version: 1,
  checks: [
    {
      settlementCheckId: 'check-1',
      checkNumber: 1,
      state: 'OPEN',
      customerPayableMinor: '5000',
      outstandingAmountMinor: '5000',
      allocatedAmountMinor: '0',
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

describe('SettlementCheckoutPanel ReceiveCash', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionFetch.mockReset();
  });
  afterEach(() => cleanup());

  it('lists CASH tender, previews change, posts receive-cash, refreshes settlement', async () => {
    const onSettlementRefresh = vi.fn(async () => undefined);
    sessionFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/payments/tenders')) {
        return jsonResponse(200, {
          tenders: [
            {
              tenderDefinitionId: 'tender-cash',
              code: 'CASH',
              displayName: 'Cash',
              instrumentFamily: 'CASH',
              enabled: true,
            },
          ],
        });
      }
      if (String(url).includes('/payments/receive-cash') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.settlementCheckId).toBe('check-1');
        expect(body.tenderDefinitionId).toBe('tender-cash');
        expect(body.terminalId).toBe('term-1');
        expect(body.amountTenderedMinor).toBe('10000');
        expect(body.humanConfirmation).toBe(true);
        expect(body).not.toHaveProperty('amountCollected');
        expect(body).not.toHaveProperty('collectedAt');
        expect(body).not.toHaveProperty('actorId');
        return jsonResponse(200, {
          payment: {
            paymentId: 'pay-1',
            lifecycleState: 'SUCCEEDED',
            requestedAmountMinor: '5000',
            currencyCode: 'VND',
          },
          evidence: {
            paymentCashCollectionEvidenceId: 'ev-1',
            amountDueMinor: '5000',
            amountTenderedMinor: '10000',
            changeMinor: '5000',
            currencyCode: 'VND',
            acceptedAt: '2026-10-25T00:00:00.000Z',
          },
          collectionEvent: {
            paymentCollectionEventId: 'pce-1',
            amountCollectedMinor: '5000',
            instrumentFamily: 'CASH',
            collectedAt: '2026-10-25T00:00:00.000Z',
          },
          duplicate: false,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(
      <SettlementCheckoutPanel
        settlement={collecting}
        commercialAccepted
        editableOrder={false}
        busy={false}
        terminalId="term-1"
        legalEntityId="le-1"
        outletId="outlet-1"
        onOpenCheckout={vi.fn()}
        onAbortCheckout={vi.fn()}
        onSettlementRefresh={onSettlementRefresh}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('receive-tender-select')).toBeTruthy());
    expect(String(sessionFetch.mock.calls[0]?.[0])).toMatch(/outletId=outlet-1/);
    fireEvent.change(screen.getByTestId('receive-tendered-input'), { target: { value: '10000' } });
    expect(screen.getByTestId('receive-change-preview').textContent).toMatch(/5000/);
    fireEvent.click(screen.getByTestId('receive-human-confirm'));
    fireEvent.click(screen.getByTestId('receive-cash-submit'));

    await waitFor(() => expect(screen.getByTestId('receive-cash-success')).toBeTruthy());
    expect(screen.getByTestId('receive-pce-collected').textContent).toMatch(/5000/);
    expect(onSettlementRefresh).toHaveBeenCalled();
  });

  it('locks amount after UNKNOWN and rejects changed tendered retry', async () => {
    sessionFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/payments/tenders')) {
        return jsonResponse(200, {
          tenders: [
            {
              tenderDefinitionId: 'tender-cash',
              code: 'CASH',
              displayName: 'Cash',
              instrumentFamily: 'CASH',
              enabled: true,
            },
          ],
        });
      }
      if (String(url).includes('/payments/receive-cash')) {
        throw new TypeError('network');
      }
      throw new Error(`unexpected ${url} ${init?.method}`);
    });

    render(
      <SettlementCheckoutPanel
        settlement={collecting}
        commercialAccepted
        editableOrder={false}
        busy={false}
        terminalId="term-1"
        legalEntityId="le-1"
        outletId="outlet-1"
        onOpenCheckout={vi.fn()}
        onAbortCheckout={vi.fn()}
        onSettlementRefresh={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('receive-tender-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('receive-tendered-input'), { target: { value: '5000' } });
    fireEvent.click(screen.getByTestId('receive-human-confirm'));
    fireEvent.click(screen.getByTestId('receive-cash-submit'));
    await waitFor(() => expect(screen.getByTestId('receive-unknown')).toBeTruthy());

    fireEvent.change(screen.getByTestId('receive-tendered-input'), { target: { value: '6000' } });
    // Input is disabled while UNKNOWN lock holds
    expect((screen.getByTestId('receive-tendered-input') as HTMLInputElement).value).toBe('5000');
  });

  it('shows fiscal gate blocked while COLLECTING', async () => {
    sessionFetch.mockResolvedValue(
      jsonResponse(200, {
        tenders: [
          {
            tenderDefinitionId: 'tender-cash',
            code: 'CASH',
            displayName: 'Cash',
            instrumentFamily: 'CASH',
            enabled: true,
          },
        ],
      }),
    );
    render(
      <SettlementCheckoutPanel
        settlement={collecting}
        commercialAccepted
        editableOrder={false}
        busy={false}
        terminalId="term-1"
        legalEntityId="le-1"
        outletId="outlet-1"
        onOpenCheckout={vi.fn()}
        onAbortCheckout={vi.fn()}
        onSettlementRefresh={vi.fn(async () => undefined)}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('fiscal-gate-blocked')).toBeTruthy());
  });
});
