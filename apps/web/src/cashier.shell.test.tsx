import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { formatMoneyDisplay } from './money/formatMoneyDisplay.js';
import { ProductTile } from './cashier/ProductTile.js';
import { PosPageNavigation } from './cashier/PosPageNavigation.js';
import { QuickAccess } from './cashier/QuickAccess.js';
import { ProductGrid } from './cashier/ProductGrid.js';
import { OrderBasketPanel } from './cashier/OrderBasket.js';
import { OrderLineEditor } from './cashier/OrderLineEditor.js';
import { QuantityEntryModal } from './cashier/QuantityEntryModal.js';
import { CashierShell } from './cashier/CashierShell.js';
import {
  bumpCountQuantity,
  isValidCountQuantityString,
  isValidWeightedQuantityString,
} from './cashier/quantityInput.js';
import type {
  CashierContext,
  CommercialStatus,
  OrderBasket,
  OrderLine,
  ResolvedPosSlot,
  ResolvedPosSurface,
} from './api/types.js';
import { ApiError } from './api/types.js';
import { posApi } from './api/client.js';

vi.mock('./api/client.js', () => ({
  posApi: {
    listDevContexts: vi.fn(),
    resolveSurface: vi.fn(),
    openOrder: vi.fn(),
    getOrder: vi.fn(),
    selectCountTap: vi.fn(),
    selectQuantityTap: vi.fn(),
    updateOrderLine: vi.fn(),
    removeOrderLine: vi.fn(),
    cancelOrder: vi.fn(),
    getCommercialStatus: vi.fn(),
    resolveMenuPrices: vi.fn(),
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

function surfaceWith(...slots: ResolvedPosSlot[]): ResolvedPosSurface {
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
        slots,
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

const eggLine: OrderLine = {
  orderLineId: '88888888-8888-4888-8888-888888888888',
  lineNumber: 1,
  catalogItemId: '66666666-6666-4666-8666-666666666666',
  catalogItemName: 'Eggs',
  quantity: '2',
  unit: 'ea',
  dimension: 'COUNT',
};

const orderWithEgg: OrderBasket = { ...emptyOrder, lines: [eggLine] };

const needsReacceptance: CommercialStatus = {
  orderId: emptyOrder.orderId,
  orderStatus: 'OPEN',
  commercialState: 'NOT_ACCEPTED',
  presentationHint: 'NEEDS_REACCEPTANCE',
  currencyCode: null,
  minorUnitExponent: null,
  acceptedGrossMerchandiseMinor: null,
  lines: [],
};

const acceptedCommercial: CommercialStatus = {
  orderId: emptyOrder.orderId,
  orderStatus: 'OPEN',
  commercialState: 'ACCEPTED',
  presentationHint: 'COMMERCIAL_CURRENT',
  currencyCode: 'VND',
  minorUnitExponent: 0,
  acceptedGrossMerchandiseMinor: '10000',
  lines: [
    {
      orderLineId: eggLine.orderLineId,
      resolvedUnitPriceMinor: '5000',
      grossMerchandiseMinor: '10000',
    },
  ],
};

const basketProps = {
  loading: false,
  selectedLineId: null as string | null,
  mutationBusy: false,
  editable: true,
  commercial: needsReacceptance,
  priceResolution: null,
  refreshingPrices: false,
  onSelectLine: vi.fn(),
  onUpdateQuantity: vi.fn(),
  onRemoveLine: vi.fn(),
  onRefreshPrices: vi.fn(),
  onCancelOrder: vi.fn(),
  onNewOrder: vi.fn(),
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

describe('quantityInput helpers', () => {
  it('accepts COUNT integers and rejects fractional COUNT', () => {
    expect(isValidCountQuantityString('2')).toBe(true);
    expect(isValidCountQuantityString('1.5')).toBe(false);
    expect(isValidCountQuantityString('0')).toBe(false);
    expect(bumpCountQuantity('2', 1)).toBe('3');
    expect(bumpCountQuantity('1', -1)).toBeNull();
  });

  it('preserves weighted decimal strings without Number()', () => {
    expect(isValidWeightedQuantityString('0.25')).toBe(true);
    expect(isValidWeightedQuantityString('1.25')).toBe(true);
    expect(isValidWeightedQuantityString('-1')).toBe(false);
    expect(isValidWeightedQuantityString('0')).toBe(false);
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

  it('weighted ACTIVE opens quantity entry path via onSelect (no qty=1 assumption)', () => {
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
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
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
    render(<OrderBasketPanel order={null} {...basketProps} />);
    expect(screen.getByText(/Empty/i)).toBeTruthy();
    expect(screen.getByText(/No invented line/i)).toBeTruthy();
  });

  it('selects basket line and shows selected visual + editor', () => {
    const onSelectLine = vi.fn();
    render(
      <OrderBasketPanel
        order={orderWithEgg}
        {...basketProps}
        selectedLineId={eggLine.orderLineId}
        onSelectLine={onSelectLine}
      />,
    );
    const option = screen.getByRole('option', { name: /Eggs/i });
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Increase quantity')).toBeTruthy();
  });

  it('COUNT +/− editor delegates updates; remove from qty 1', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = render(
      <OrderLineEditor
        line={eggLine}
        busy={false}
        editable
        onUpdateQuantity={onUpdate}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(onUpdate).toHaveBeenCalledWith('3');
    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onUpdate).toHaveBeenCalledWith('1');
    rerender(
      <OrderLineEditor
        line={{ ...eggLine, quantity: '1' }}
        busy={false}
        editable
        onUpdateQuantity={onUpdate}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('rejects fractional COUNT in direct edit', () => {
    const onUpdate = vi.fn();
    render(
      <OrderLineEditor
        line={eggLine}
        busy={false}
        editable
        onUpdateQuantity={onUpdate}
        onRemove={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('COUNT quantity');
    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('weighted quantity modal preserves decimal and does not invent gross', () => {
    const onConfirm = vi.fn();
    render(
      <QuantityEntryModal
        slot={activeCount({
          dimension: 'MASS',
          quantityEntry: 'DEFERRED_WEIGHTED',
          displayLabel: 'Dough',
          baseUnit: 'kg',
        })}
        busy={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Weighted quantity'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to order/i }));
    expect(onConfirm).toHaveBeenCalledWith('0.25');
    expect(screen.getByText(/no commercial gross/i)).toBeTruthy();
  });

  it('renders commercial needs-reacceptance and current states', () => {
    const { rerender } = render(
      <OrderBasketPanel order={orderWithEgg} {...basketProps} commercial={needsReacceptance} />,
    );
    expect(screen.getByText(/Order changed — refresh/i)).toBeTruthy();
    rerender(
      <OrderBasketPanel order={orderWithEgg} {...basketProps} commercial={acceptedCommercial} />,
    );
    expect(screen.getByText(/Commercial terms accepted/i)).toBeTruthy();
    expect(screen.getByText(/Accepted order gross \(authoritative\)/i)).toBeTruthy();
    expect(screen.getByText(/No invented line \/ order totals/i)).toBeTruthy();
  });
});

describe('CashierShell integration (mocked API)', () => {
  beforeEach(() => {
    mockedApi.resolveSurface.mockReset();
    mockedApi.openOrder.mockReset();
    mockedApi.getOrder.mockReset();
    mockedApi.selectCountTap.mockReset();
    mockedApi.selectQuantityTap.mockReset();
    mockedApi.updateOrderLine.mockReset();
    mockedApi.removeOrderLine.mockReset();
    mockedApi.cancelOrder.mockReset();
    mockedApi.getCommercialStatus.mockReset();
    mockedApi.resolveMenuPrices.mockReset();
    mockedApi.getCommercialStatus.mockResolvedValue(needsReacceptance);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('loads surface, taps COUNT item, updates basket from server', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(emptyOrder);
    mockedApi.selectCountTap.mockResolvedValue({
      order: {
        ...emptyOrder,
        lines: [{ ...eggLine, quantity: '1' }],
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

  it('COUNT + updates quantity via backend and refreshes commercial status', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(orderWithEgg);
    mockedApi.getCommercialStatus
      .mockResolvedValueOnce(acceptedCommercial)
      .mockResolvedValue(needsReacceptance);
    mockedApi.updateOrderLine.mockResolvedValue({
      ...orderWithEgg,
      lines: [{ ...eggLine, quantity: '3' }],
    });

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText(/2 ea/);
    fireEvent.click(screen.getByRole('option', { name: /Eggs/i }));
    fireEvent.click(await screen.findByLabelText('Increase quantity'));
    await waitFor(() => expect(mockedApi.updateOrderLine).toHaveBeenCalledWith(
      orderWithEgg.orderId,
      eggLine.orderLineId,
      expect.objectContaining({ quantity: '3' }),
    ));
    expect(await screen.findByText(/Order changed — refresh/i)).toBeTruthy();
  });

  it('remove line clears selection and updates basket', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(orderWithEgg);
    mockedApi.removeOrderLine.mockResolvedValue(emptyOrder);

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText(/2 ea/);
    fireEvent.click(screen.getByRole('option', { name: /Eggs/i }));
    fireEvent.click(await screen.findByLabelText('Remove line'));
    await waitFor(() => expect(mockedApi.removeOrderLine).toHaveBeenCalled());
    expect(await screen.findByText(/Empty/i)).toBeTruthy();
  });

  it('prevents duplicate destructive remove while in flight', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(orderWithEgg);
    let resolveRemove!: (v: OrderBasket) => void;
    mockedApi.removeOrderLine.mockReturnValue(
      new Promise<OrderBasket>((r) => {
        resolveRemove = r;
      }),
    );

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText(/2 ea/);
    fireEvent.click(screen.getByRole('option', { name: /Eggs/i }));
    const removeBtn = await screen.findByLabelText('Remove line');
    fireEvent.click(removeBtn);
    fireEvent.click(removeBtn);
    expect(mockedApi.removeOrderLine).toHaveBeenCalledTimes(1);
    resolveRemove(emptyOrder);
    await waitFor(() => expect(screen.getByText(/Empty/i)).toBeTruthy());
  });

  it('shows backend validation error and reloads order', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(orderWithEgg);
    mockedApi.updateOrderLine.mockRejectedValue(new ApiError(400, 'INVALID_QUANTITY', 'bad'));
    mockedApi.getOrder.mockResolvedValue(orderWithEgg);

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText(/2 ea/);
    fireEvent.click(screen.getByRole('option', { name: /Eggs/i }));
    fireEvent.click(await screen.findByLabelText('Increase quantity'));
    await waitFor(() => expect(screen.getByText(/INVALID_QUANTITY/i)).toBeTruthy());
    expect(mockedApi.getOrder).toHaveBeenCalled();
  });

  it('cancelled Order disables editing; New Order still works', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder
      .mockResolvedValueOnce(orderWithEgg)
      .mockResolvedValueOnce(emptyOrder);
    mockedApi.cancelOrder.mockResolvedValue({ ...orderWithEgg, status: 'CANCELLED', lines: [eggLine] });

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText(/2 ea/);
    fireEvent.click(screen.getByRole('button', { name: /Cancel order/i }));
    await waitFor(() => expect(mockedApi.cancelOrder).toHaveBeenCalled());
    expect(await screen.findByText(/Order is CANCELLED/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New order/i }));
    await waitFor(() => expect(mockedApi.openOrder).toHaveBeenCalledTimes(2));
  });

  it('Refresh prices resolves unit prices without accepting terms', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(orderWithEgg);
    mockedApi.getCommercialStatus.mockResolvedValue(needsReacceptance);
    mockedApi.resolveMenuPrices.mockResolvedValue({
      orderId: orderWithEgg.orderId,
      note: 'UNIT_PRICE_RESOLUTION_ONLY',
      commercialGrossPolicy: 'EXPLICIT_GROSS_ONLY',
      lines: [
        {
          orderLineId: eggLine.orderLineId,
          catalogItemId: eggLine.catalogItemId,
          quantity: '2',
          availabilityStatus: 'AVAILABLE',
          resolvedUnitPriceMinor: '120000',
          currencyCode: 'VND',
          minorUnitExponent: 0,
          menuPublicationId: 'mp',
          priceRuleId: 'pr',
        },
      ],
    });

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText(/2 ea/);
    fireEvent.click(screen.getByRole('button', { name: /Refresh current unit prices/i }));
    await waitFor(() => expect(mockedApi.resolveMenuPrices).toHaveBeenCalled());
    expect(await screen.findByText(/Current unit price: 120000 VND/i)).toBeTruthy();
    expect(mockedApi.resolveMenuPrices.mock.calls[0]).toBeTruthy();
    expect(JSON.stringify(mockedApi)).not.toMatch(/setOrderCommercialTerms/);
  });

  it('weighted tile opens quantity modal and posts explicit quantity', async () => {
    const milk = activeCount({
      layoutPublicationSlotId: '99999999-9999-4999-8999-999999999999',
      catalogItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      displayLabel: 'Milk',
      dimension: 'VOLUME',
      quantityEntry: 'DEFERRED_WEIGHTED',
      baseUnit: 'L',
      unitPrice: { amountMinor: '20000', currencyCode: 'VND', minorUnitExponent: 0 },
    });
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(milk));
    mockedApi.openOrder.mockResolvedValue(emptyOrder);
    mockedApi.selectQuantityTap.mockResolvedValue({
      order: {
        ...emptyOrder,
        lines: [
          {
            orderLineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            lineNumber: 1,
            catalogItemId: milk.catalogItemId,
            catalogItemName: 'Milk',
            quantity: '0.5',
            unit: 'L',
            dimension: 'VOLUME',
          },
        ],
      },
    });

    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await screen.findByText('Main');
    fireEvent.click(await screen.findByRole('button', { name: /Milk,/i }));
    expect(await screen.findByText(/Enter quantity/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Weighted quantity'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to order/i }));
    await waitFor(() =>
      expect(mockedApi.selectQuantityTap).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: '0.5' }),
      ),
    );
    expect(await screen.findByText(/0.5 L/)).toBeTruthy();
  });

  it('tableless: no tableId in open/select payloads', async () => {
    const egg = activeCount();
    mockedApi.resolveSurface.mockResolvedValue(surfaceWith(egg));
    mockedApi.openOrder.mockResolvedValue(emptyOrder);
    render(<CashierShell context={ctx} onChangeContext={vi.fn()} />);
    await waitFor(() => expect(mockedApi.openOrder).toHaveBeenCalled());
    expect(JSON.stringify(mockedApi.openOrder.mock.calls)).not.toMatch(/tableId/);
  });
});
