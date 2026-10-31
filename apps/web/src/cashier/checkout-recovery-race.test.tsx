import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CashierShell } from './CashierShell.js';
import { posApi } from '../api/client.js';
import type { SettlementProjection } from '../api/types.js';

vi.mock('../api/client.js', () => ({ posApi: {
  resolveSurface: vi.fn(), openOrder: vi.fn(), getOrder: vi.fn(),
  getCommercialStatus: vi.fn(), getLiveSettlement: vi.fn(),
  abortSettlement: vi.fn(), openSettlement: vi.fn(), acceptTaxSnapshot: vi.fn(),
} }));
vi.mock('../api/allergenApi.js', () => ({ allergenApi: {
  getState: vi.fn().mockResolvedValue({ context: null, lines: [] }),
  resolve: vi.fn().mockResolvedValue([]),
} }));
// Expose the existing callbacks so the test can control their completion order.
vi.mock('./SettlementCheckout.js', () => ({ SettlementCheckoutPanel: (props: {
  settlement: SettlementProjection | null;
  onSettlementRefresh: () => Promise<void>;
  onOpenCheckout: () => void;
  onAbortCheckout: () => void;
}) => <section>
  <span data-testid="settlement-id">{props.settlement?.settlementGroupId ?? 'none'}</span>
  <button onClick={() => void props.onSettlementRefresh()}>Read settlement</button>
  <button onClick={props.onAbortCheckout}>Abort settlement</button>
  <button onClick={props.onOpenCheckout}>Open settlement</button>
</section> }));

const context = { tenantId: 't', tenantName: 'T', brandId: 'b', brandName: 'B', outletId: 'o', outletName: 'O', legalEntityId: 'l', legalEntityName: 'L', orderChannel: 'DIRECT' };
const order = { orderId: 'order', tenantId: 't', legalEntityId: 'l', outletId: 'o', status: 'OPEN', channel: 'DIRECT', lines: [] };
const commercial = { orderId: 'order', orderStatus: 'OPEN', commercialState: 'ACCEPTED' as const, presentationHint: 'COMMERCIAL_CURRENT' as const, currencyCode: 'VND', minorUnitExponent: 0, acceptedGrossMerchandiseMinor: '100', lines: [] };
const settlement: SettlementProjection = { orderId: 'order', settlementGroupId: 'old', state: 'COLLECTING', currencyCode: 'VND', merchandiseGrossMinor: '100', customerPayableMinor: '100', allocatedAmountMinor: '0', outstandingAmountMinor: '100', version: 1, checks: [] };

describe('checkout read concurrency', () => {
  it('ignores an old settlement GET that completes after abort and reopen', async () => {
    const api = vi.mocked(posApi);
    api.resolveSurface.mockResolvedValue({ presentationContext: { tenantId: 't', brandId: 'b', outletId: 'o', legalEntityId: 'l' }, salesContext: { tenantId: 't', brandId: 'b', outletId: 'o', orderChannel: 'DIRECT', businessDateTime: '2026-01-01' }, layoutPublicationId: 'p', layoutPublicationVersion: 1, menuPublicationId: 'm', pages: [], quickAccess: [] });
    api.openOrder.mockResolvedValue(order);
    api.getCommercialStatus.mockResolvedValue(commercial);
    let finishRead!: (value: { orderId: string; settlement: null }) => void;
    api.getLiveSettlement
      .mockResolvedValueOnce({ orderId: 'order', settlement })
      .mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
    api.abortSettlement.mockResolvedValue({ ...settlement, state: 'ABORTED', version: 2 });
    api.acceptTaxSnapshot.mockResolvedValue({ taxOrderSnapshotId: 'tax' } as never);
    api.openSettlement.mockResolvedValue({ ...settlement, settlementGroupId: 'new' });
    render(<CashierShell context={context} />);
    await waitFor(() => expect(screen.getByTestId('settlement-id').textContent).toBe('old'));
    await waitFor(() => expect(screen.getByText('Read settlement').closest('fieldset')?.disabled).toBe(false));
    fireEvent.click(screen.getByText('Read settlement'));
    fireEvent.click(screen.getByText('Abort settlement'));
    await waitFor(() => expect(screen.getByTestId('settlement-id').textContent).toBe('none'));
    fireEvent.click(screen.getByText('Open settlement'));
    await waitFor(() => expect(screen.getByTestId('settlement-id').textContent).toBe('new'));
    await act(async () => { finishRead({ orderId: 'order', settlement: null }); });
    expect(screen.getByTestId('settlement-id').textContent).toBe('new');
    expect(api.abortSettlement).toHaveBeenCalledTimes(1);
    expect(api.openSettlement).toHaveBeenCalledTimes(1);
  });
});
