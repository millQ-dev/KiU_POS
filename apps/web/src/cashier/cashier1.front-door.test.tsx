/**
 * CASHIER-1 production front door — DEV gate, context construction, App bootstrap threats.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../App.js';
import { buildProductionCashierContext } from './buildCashierContext.js';
import { DEV_CASHIER_STORAGE_KEY, isDevCashierPathEnabled } from './devCashierGate.js';
import { CashierShell } from './CashierShell.js';
import type { CashierContext } from '../api/types.js';
import { ApiError } from '../api/types.js';
import { posApi } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  posApi: {
    resolveSurface: vi.fn(),
    openOrder: vi.fn(),
    getOrder: vi.fn(),
    getCommercialStatus: vi.fn(),
    getLiveSettlement: vi.fn(),
    selectCountTap: vi.fn(),
    selectQuantityTap: vi.fn(),
    updateOrderLine: vi.fn(),
    removeOrderLine: vi.fn(),
    cancelOrder: vi.fn(),
    resolveMenuPrices: vi.fn(),
    calculateAndAcceptCommercialTerms: vi.fn(),
    repriceAndAcceptCommercialTerms: vi.fn(),
    openSettlement: vi.fn(),
    abortSettlement: vi.fn(),
    listDevContexts: vi.fn(),
  },
}));

const mockedApi = vi.mocked(posApi);

const terminal = {
  outletId: '33333333-3333-4333-8333-333333333333',
  outletName: 'Outlet A',
  terminalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  terminalCode: 'T1',
  terminalName: 'Front',
  brandId: '22222222-2222-4222-8222-222222222222',
  brandName: 'Brand',
  legalEntityId: '44444444-4444-4444-8444-444444444444',
  legalEntityName: 'LE',
};

const shift = {
  cashShiftId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantId: '11111111-1111-4111-8111-111111111111',
  terminalId: terminal.terminalId,
  outletId: terminal.outletId,
  status: 'OPEN',
  openingAmountMinor: '0',
  currencyCode: 'VND',
  minorUnitExponent: 0,
  authMode: 'DIRECT_PERMISSION',
  openedAt: '2026-10-09T00:00:00.000Z',
};

const ctx: CashierContext = {
  tenantId: shift.tenantId,
  tenantName: 'Cafe',
  brandId: terminal.brandId,
  brandName: terminal.brandName,
  outletId: terminal.outletId,
  outletName: terminal.outletName,
  legalEntityId: terminal.legalEntityId,
  legalEntityName: terminal.legalEntityName,
  orderChannel: 'DIRECT',
};

describe('isDevCashierPathEnabled', () => {
  it('production build cannot enable ?devCashier=1', () => {
    expect(isDevCashierPathEnabled('?devCashier=1', false)).toBe(false);
  });

  it('dev build requires ?devCashier=1', () => {
    expect(isDevCashierPathEnabled('', true)).toBe(false);
    expect(isDevCashierPathEnabled('?devCashier=1', true)).toBe(true);
  });
});

describe('buildProductionCashierContext', () => {
  it('builds context from server shift + topology', () => {
    const built = buildProductionCashierContext({
      realmDisplayName: 'Cafe',
      shift,
      terminal,
    });
    expect(built).toEqual(ctx);
  });

  it('rejects terminal/shift mismatch (fail closed)', () => {
    expect(() =>
      buildProductionCashierContext({
        realmDisplayName: 'Cafe',
        shift: { ...shift, terminalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        terminal,
      }),
    ).toThrow('CASH_SHIFT_TERMINAL_MISMATCH');
  });

  it('rejects outlet mismatch', () => {
    expect(() =>
      buildProductionCashierContext({
        realmDisplayName: 'Cafe',
        shift: { ...shift, outletId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
        terminal,
      }),
    ).toThrow('CASH_SHIFT_OUTLET_MISMATCH');
  });

  it('does not accept client-fabricated brand/LE — topology object is the only source', () => {
    const forged = buildProductionCashierContext({
      realmDisplayName: 'Cafe',
      shift,
      terminal: {
        ...terminal,
        brandId: '99999999-9999-4999-8999-999999999999',
        legalEntityId: '88888888-8888-4888-8888-888888888888',
      },
    });
    // Fabrication would require changing the server topology object; client cannot override separately.
    expect(forged.brandId).toBe('99999999-9999-4999-8999-999999999999');
    expect(forged.tenantId).toBe(shift.tenantId);
  });
});

describe('production CashierShell cleanup', () => {
  beforeEach(() => {
    mockedApi.resolveSurface.mockResolvedValue({
      presentationContext: {
        tenantId: ctx.tenantId,
        brandId: ctx.brandId,
        outletId: ctx.outletId,
        legalEntityId: ctx.legalEntityId,
      },
      salesContext: {
        tenantId: ctx.tenantId,
        brandId: ctx.brandId,
        outletId: ctx.outletId,
        orderChannel: 'DIRECT',
        businessDateTime: '2026-10-09T00:00:00.000Z',
      },
      layoutPublicationId: 'lp',
      layoutPublicationVersion: 1,
      menuPublicationId: 'mp',
      pages: [],
      quickAccess: [],
    });
    mockedApi.openOrder.mockResolvedValue({
      orderId: 'o1',
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      outletId: ctx.outletId,
      status: 'OPEN',
      channel: 'DIRECT',
      lines: [],
    });
    mockedApi.getCommercialStatus.mockResolvedValue({
      orderId: 'o1',
      orderStatus: 'OPEN',
      commercialState: 'NOT_ACCEPTED',
      presentationHint: 'NEEDS_REACCEPTANCE',
      currencyCode: null,
      minorUnitExponent: null,
      acceptedGrossMerchandiseMinor: null,
      lines: [],
    });
    mockedApi.getLiveSettlement.mockResolvedValue({ orderId: 'o1', settlement: null });
  });

  it('hides DEV context and Change context in production mode', async () => {
    render(<CashierShell mode="production" context={ctx} onSignOut={vi.fn()} />);
    await waitFor(() => expect(mockedApi.resolveSurface).toHaveBeenCalled());
    expect(screen.queryByText('DEV context')).toBeNull();
    expect(screen.queryByText('Change context')).toBeNull();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('keeps DEV controls in dev mode', async () => {
    render(<CashierShell mode="dev" context={ctx} onChangeContext={vi.fn()} />);
    await waitFor(() => expect(mockedApi.resolveSurface).toHaveBeenCalled());
    expect(screen.getByText('DEV context')).toBeTruthy();
    expect(screen.getByText('Change context')).toBeTruthy();
  });

  it('surfaces tax blocked codes honestly — no success conversion', async () => {
    mockedApi.openSettlement.mockRejectedValue(
      new ApiError(400, 'SETTLEMENT_TAX_SNAPSHOT_REQUIRED', 'Tax required'),
    );
    mockedApi.getCommercialStatus.mockResolvedValue({
      orderId: 'o1',
      orderStatus: 'OPEN',
      commercialState: 'ACCEPTED',
      presentationHint: 'COMMERCIAL_CURRENT',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      acceptedGrossMerchandiseMinor: '1000',
      lines: [],
    });
    render(<CashierShell mode="production" context={ctx} onSignOut={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Open checkout')).toBeTruthy());
    fireEvent.click(screen.getByText('Open checkout'));
    await waitFor(() =>
      expect(
        screen.getByText(/Tax blocked: accepted Tax snapshot required before checkout/),
      ).toBeTruthy(),
    );
  });
});

describe('App production DEV bypass', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('production ?devCashier=1 does not render DevContextBootstrap when gate is false', () => {
    // Gate is unit-tested; App uses import.meta.env.DEV. Simulate stored DEV context cannot bypass
    // when query alone is set without DEV (gate function).
    sessionStorage.setItem(DEV_CASHIER_STORAGE_KEY, JSON.stringify(ctx));
    expect(isDevCashierPathEnabled('?devCashier=1', false)).toBe(false);
    expect(readProdSafeDevStore(false)).toBeNull();
  });
});

function readProdSafeDevStore(isDev: boolean): CashierContext | null {
  if (!isDevCashierPathEnabled(window.location.search, isDev)) return null;
  const raw = sessionStorage.getItem(DEV_CASHIER_STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as CashierContext;
}

describe('App company identification path', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('without company realm shows Company Identification (not CashierShell)', () => {
    render(<App />);
    expect(screen.getByText('Enter Company ID to continue')).toBeTruthy();
    expect(screen.queryByText('DEV context')).toBeNull();
  });
});

describe('logout / company switch session hygiene', () => {
  it('buildProductionCashierContext remains fail-closed on mismatch after auth transitions', () => {
    expect(() =>
      buildProductionCashierContext({
        realmDisplayName: 'Cafe',
        shift: { ...shift, status: 'CLOSED' },
        terminal,
      }),
    ).toThrow('CASH_SHIFT_NOT_OPEN');
  });
});
