import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { formatMoneyDisplay } from './money/formatMoneyDisplay.js';
import { ProductTile } from './cashier/ProductTile.js';
import { PosPageNavigation } from './cashier/PosPageNavigation.js';
import { QuickAccess } from './cashier/QuickAccess.js';
import { ProductGrid } from './cashier/ProductGrid.js';
import { OrderBasketPanel } from './cashier/OrderBasket.js';
import { CashierShell } from './cashier/CashierShell.js';
import type { CashierContext, ResolvedPosSlot, ResolvedPosSurface, OrderBasket } from './api/types.js';
import { ApiError } from './api/types.js';
import { posApi } from './api/client.js';

vi.mock('./api/client.js', () => ({
  posApi: {
    listDevContexts: vi.fn(),
    resolveSurface: vi.fn(),
    openOrder: vi.fn(),
    getOrder: vi.fn(),
    selectCountTap: vi.fn(),
  },
}));

const mockedApi = vi.mocked(posApi);

const ctx: CashierContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  tenantName: 'T',
  brandId: '22222222-2222-4222-8222-222222222222',
  brandName: 'B',
  outletId: '33333333-3333-4333-8333-333333333333',
  outletName: 'Outlet A',
  legalEntityId: '44444444-4444-4444-8444-444444444444',
  legalEntityName: 'LE',
  orderChannel: 'DIRECT',
};

function activeCount(overrides: Partial<ResolvedPosSlot> = {}): ResolvedPosSlot {
  return {
    layoutPublicationSlotId: '55555555-5555-4555-8555-555555555555',
    catalogItemId: '66666666-6666-4666-8666-666666666666',
    catalogItemName: 'Eggs',
    displayLabel: 'Eggs',
    baseUnit: 'ea',
    dimension: 'COUNT',
    quantityEntry: 'COUNT_ONE',
    zone: 'PAGE',
    position: 1,
    labelOverride: null,
    colorToken: null,
    state: 'ACTIVE',
    unitPrice: { amountMinor: '5000', currencyCode: 'VND', minorUnitExponent: 0 },
    ...overrides,
  };
}

function surfaceWith(egg: ResolvedPosSlot): ResolvedPosSurface {
  return {
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
      businessDateTime: '2026-09-16T17:30:00.000Z',
    },
    layoutPublicationId: 'lp',
    layoutPublicationVersion: 1,
    menuPublicationId: 'mp',
    pages: [
      {
        layoutPublicationPageId: 'page-1',
        pageCode: 'main',
        label: 'Main',
        sortOrder: 0,
        colorToken: null,
        slots: [egg],
      },
    ],
    quickAccess: [],
  };
}

const emptyOrder: OrderBasket = {
  orderId: '77777777-7777-4777-8777-777777777777',
  tenantId: ctx.tenantId,
  legalEntityId: ctx.legalEntityId,
  outletId: ctx.outletId,
  status: 'OPEN',
  channel: 'DIRECT',
  lines: [],
};

describe('formatMoneyDisplay', () => {
  it('formats integer and fractional minors without float math', () => {
    expect(formatMoneyDisplay({ amountMinor: '100000', currencyCode: 'VND', minorUnitExponent: 0 })).toBe(
      '100000 VND',
    );
    expect(formatMoneyDisplay({ amountMinor: '12345', currencyCode: 'USD', minorUnitExponent: 2 })).toBe(
      '123.45 USD',
    );
  });
});

describe('cashier components', () => {
  it('renders ACTIVE tile with unit price and enables click', () => {
    const onSelect = vi.fn();
    render(<ProductTile slot={activeCount()} busy={false} onSelect={onSelect} />);
    expect(screen.getByText('Eggs')).toBeTruthy();
    expect(screen.getByText('5000 VND')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Eggs/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('disables unavailable, price-unavailable, and config-error tiles', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ProductTile
        slot={activeCount({ state: 'DISABLED_UNAVAILABLE', unitPrice: null })}
        busy={false}
        onSelect={onSelect}
      />,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <ProductTile
        slot={activeCount({ state: 'DISABLED_PRICE_UNAVAILABLE', unitPrice: null })}
        busy={false}
        onSelect={onSelect}
      />,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No price')).toBeTruthy();
    rerender(
      <ProductTile
        slot={activeCount({ state: 'CONFIGURATION_ERROR', unitPrice: null })}
        busy={false}
        onSelect={onSelect}
      />,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Config error')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not select weighted ACTIVE via COUNT path', () => {
    const onSelect = vi.fn();
    render(
      <ProductTile
        slot={activeCount({
          dimension: 'VOLUME',
          quantityEntry: 'DEFERRED_WEIGHTED',
          displayLabel: 'Milk',
          baseUnit: 'L',
        })}
        busy={false}
        onSelect={onSelect}
      />,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders pages in given order and switches selection', () => {
    const onSelect = vi.fn();
    render(
      <PosPageNavigation
        pages={[
          {
            layoutPublicationPageId: 'p1',
            pageCode: 'a',
            label: 'Coffee',
            sortOrder: 0,
            colorToken: null,
            slots: [],
          },
          {
            layoutPublicationPageId: 'p2',
            pageCode: 'b',
            label: 'Food',
            sortOrder: 1,
            colorToken: null,
            slots: [],
          },
        ]}
        selectedPageId="p1"
        onSelect={onSelect}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Coffee', 'Food']);
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('Quick Access empty and ordered slots; empty page', () => {
    render(<QuickAccess slots={[]} selectingSlotId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/No quick access/i)).toBeTruthy();
    const onSelect = vi.fn();
    render(
      <QuickAccess
        slots={[
          activeCount({ layoutPublicationSlotId: 'qa1', position: 1, displayLabel: 'QA1' }),
          activeCount({ layoutPublicationSlotId: 'qa2', position: 2, displayLabel: 'QA2' }),
        ]}
        selectingSlotId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /QA1/i }));
    expect(onSelect).toHaveBeenCalled();
    render(<ProductGrid slots={[]} selectingSlotId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/No items on this page/i)).toBeTruthy();
  });

  it('empty basket state and no line-gross math in panel', () => {
    render(<OrderBasketPanel order={null} loading={false} onNewOrder={vi.fn()} />);
    expect(screen.getByText(/Empty/i)).toBeTruthy();
    expect(screen.getByText(/No line gross/i)).toBeTruthy();
  });
});

describe('CashierShell integration (mocked API)', () => {
  beforeEach(() => {
    mockedApi.resolveSurface.mockReset();
    mockedApi.openOrder.mockReset();
    mockedApi.selectCountTap.mockReset();
  });

  it('loads surface, taps COUNT item, updates basket from server', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(emptyOrder);
    mockedApi.selectCountTap.mockResolvedValue({
      order: {
        ...emptyOrder,
        lines: [
          {
            orderLineId: '88888888-8888-4888-8888-888888888888',
            lineNumber: 1,
            catalogItemId: egg.catalogItemId,
            catalogItemName: 'Eggs',
            quantity: '1',
            unit: 'ea',
            dimension: 'COUNT',
          },
        ],
      },
    });

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText('Main');
    await waitFor(() => expect(mockedApi.openOrder).toHaveBeenCalled());
    const tile = await screen.findByRole('button', { name: /Eggs,/i });
    fireEvent.click(tile);
    await waitFor(() => expect(mockedApi.selectCountTap).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/1 ea/)).toBeTruthy();
    expect(JSON.stringify(mockedApi.selectCountTap.mock.calls)).not.toMatch(
      /setOrderCommercialTerms|completeOrder|grossMerchandise/,
    );
  });

  it('stale-slot error refreshes surface and does not invent a local line', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(emptyOrder);
    mockedApi.selectCountTap.mockRejectedValue(new ApiError(400, 'POS_SLOT_UNAVAILABLE', 'gone'));

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText('Main');
    await waitFor(() => expect(mockedApi.openOrder).toHaveBeenCalled());
    const tile = await screen.findByRole('button', { name: /Eggs,/i });
    fireEvent.click(tile);
    await waitFor(() => expect(mockedApi.resolveSurface.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(/1 ea/)).toBeNull();
  });
});
