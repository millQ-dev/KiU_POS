import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App.js';

const realm = { companyCode: 'CAFE', displayName: 'Cafe' };
const terminal = { outletId: 'outlet', outletName: 'Outlet', terminalId: 'terminal', terminalCode: 'T1', terminalName: 'Front', brandId: 'brand', brandName: 'Brand', legalEntityId: 'legal', legalEntityName: 'Legal' };
const shift = { cashShiftId: 'shift', tenantId: 'tenant', terminalId: 'terminal', outletId: 'outlet', status: 'OPEN', openingAmountMinor: '0', currencyCode: 'VND', minorUnitExponent: 0, authMode: 'PIN', openedAt: '2026-01-01' };

vi.mock('./cashier/CompanyIdentificationScreen.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./cashier/CompanyIdentificationScreen.js')>();
  return { ...original, CompanyIdentificationScreen: ({ onResolved }: { onResolved: (r: typeof realm) => void }) => <button onClick={() => onResolved(realm)}>Choose company</button> };
});
vi.mock('./cashier/OpeningCashScreen.js', () => ({ OpeningCashScreen: ({ onOpened }: { onOpened: (s: typeof shift, t: typeof terminal) => void }) => <button onClick={() => onOpened(shift, terminal)}>Enter cashier</button> }));
vi.mock('./cashier/CashierShell.js', () => ({ CashierShell: ({ onSignOut }: { onSignOut: () => void }) => <button onClick={onSignOut}>Sign out</button> }));
vi.mock('./cashier/PinAuthScreen.js', () => ({ PinAuthScreen: () => <p>PIN screen</p> }));

function reply(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('production session recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('offers retry for a network failure and shows PIN only after an authoritative 401', async () => {
    sessionStorage.setItem('millq.companyRealm.v1', JSON.stringify(realm));
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(reply(401));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByText(/Could not check the session/i)).toBeTruthy();
    expect(screen.queryByText('PIN screen')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry session check/i }));
    expect(await screen.findByText('PIN screen')).toBeTruthy();
  });

});
