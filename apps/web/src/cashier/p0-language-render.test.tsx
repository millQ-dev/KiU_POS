import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CashCheckoutResult, ResolvedPosSlot, SettlementProjection } from '../api/types.js';
import { CashPaymentPanel } from './CashPaymentPanel.js';
import { ModifierSelectionModal } from './ModifierSelectionModal.js';
import { OrderBasketPanel } from './OrderBasket.js';
import { posCopy, type PosLanguage } from './posCopy.js';

const orderLine = {
  orderLineId: '88888888-8888-4888-8888-888888888888',
  lineNumber: 1,
  catalogItemId: '66666666-6666-4666-8666-666666666666',
  catalogItemName: 'Cappuccino',
  quantity: '1',
  unit: 'ea',
  dimension: 'COUNT',
};

const order = {
  orderId: '77777777-7777-4777-8777-777777777777',
  tenantId: '11111111-1111-4111-8111-111111111111',
  legalEntityId: '44444444-4444-4444-8444-444444444444',
  outletId: '33333333-3333-4333-8333-333333333333',
  status: 'OPEN',
  channel: 'DIRECT',
  lines: [orderLine],
};

const settlement: SettlementProjection = {
  settlementGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orderId: order.orderId,
  state: 'COLLECTING',
  currencyCode: 'VND',
  merchandiseGrossMinor: '65000',
  customerPayableMinor: '65000',
  allocatedAmountMinor: '0',
  outstandingAmountMinor: '65000',
  version: 1,
  checks: [],
};

const cashResult: CashCheckoutResult = {
  order: { ...order, status: 'SUBMITTED' },
  settlement: {
    settlement_group_id: settlement.settlementGroupId,
    settlement_state: 'SATISFIED',
    customer_payable_minor: '65000',
    settlement_check_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    check_state: 'PAID',
    check_payable_minor: '65000',
  },
  payment: {
    payment_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'SUCCEEDED',
    tender_kind: 'CASH',
    amount_minor: '65000',
    tendered_minor: '70000',
    change_minor: '5000',
    currency_code: 'VND',
  },
  productionTasks: [{
    production_task_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    order_line_id: orderLine.orderLineId,
    catalog_item_id: orderLine.catalogItemId,
    status: 'IN_PROGRESS',
    quantity: '1',
    unit: 'ea',
    label: 'Cappuccino',
    modifier_snapshot_json: null,
  }],
  receipt: {
    orderId: order.orderId,
    issuedAt: '2026-09-17T10:00:00.000Z',
    outletId: order.outletId,
    terminalId: '99999999-9999-4999-8999-999999999999',
    cashierId: '88888888-8888-4888-8888-888888888888',
    currencyCode: 'VND',
    minorUnitExponent: 0,
    lines: [{
      order_line_id: orderLine.orderLineId,
      line_number: 1,
      quantity: '1',
      unit: 'ea',
      catalog_item_name: 'Cappuccino',
      resolved_unit_price_minor: '65000',
      gross_merchandise_minor: '65000',
      modifiers: [],
    }],
    subtotalMinor: '65000',
    totalMinor: '65000',
    paymentMethod: 'CASH',
    cashTenderedMinor: '70000',
    changeMinor: '5000',
  },
};

const modifierSlot: ResolvedPosSlot = {
  layoutPublicationSlotId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  catalogItemId: orderLine.catalogItemId,
  catalogItemName: 'Cappuccino',
  displayLabel: 'Cappuccino',
  baseUnit: 'ea',
  dimension: 'COUNT',
  quantityEntry: 'COUNT_ONE',
  zone: 'PAGE',
  position: 1,
  labelOverride: null,
  colorToken: null,
  state: 'ACTIVE',
  unitPrice: { amountMinor: '65000', currencyCode: 'VND', minorUnitExponent: 0 },
  modifierGroups: [{
    modifierGroupId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    code: 'SIZE',
    label: 'Size',
    minSelections: 1,
    maxSelections: 1,
    options: [{
      modifierOptionId: '12121212-1212-4121-8121-121212121212',
      label: 'Medium',
      priceDeltaMinor: '0',
      currencyCode: 'VND',
      minorUnitExponent: 0,
      position: 1,
      active: true,
    }],
  }],
};

describe('P0 cashier critical language render', () => {
  it.each(['ru', 'en', 'vi'] as PosLanguage[])('%s keeps the payment success surface readable', (language) => {
    render(<CashPaymentPanel settlement={settlement} busy={false} result={cashResult} language={language} onPay={vi.fn()} />);
    expect(screen.getByText(posCopy(language, 'paymentAccepted'))).toBeTruthy();
    expect(screen.getAllByText(posCopy(language, 'received')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(posCopy(language, 'change')).length).toBeGreaterThan(0);
    expect(screen.getByText(posCopy(language, 'receiptPreview'))).toBeTruthy();
    expect(screen.getAllByText('70000 VND').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5000 VND').length).toBeGreaterThan(0);
  });

  it.each(['ru', 'en', 'vi'] as PosLanguage[])('%s keeps modifier and Pay actions readable', (language) => {
    render(<ModifierSelectionModal slot={modifierSlot} busy={false} language={language} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(posCopy(language, 'customizeItem'))).toBeTruthy();
    expect(screen.getByText(posCopy(language, 'required'))).toBeTruthy();
    expect(screen.getByRole('button', { name: posCopy(language, 'addToOrder') })).toBeTruthy();
  });

  it.each(['ru', 'en', 'vi'] as PosLanguage[])('%s exposes the primary Pay action on the basket', (language) => {
    render(
      <OrderBasketPanel
        order={order}
        loading={false}
        selectedLineId={null}
        mutationBusy={false}
        editable
        commercial={null}
        priceResolution={null}
        refreshingPrices={false}
        acceptingCommercial={false}
        settlement={null}
        settlementBusy={false}
        onSelectLine={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onRemoveLine={vi.fn()}
        onRefreshPrices={vi.fn()}
        onAcceptCurrentPrices={vi.fn()}
        onOpenCheckout={vi.fn()}
        onAbortCheckout={vi.fn()}
        onCancelOrder={vi.fn()}
        onNewOrder={vi.fn()}
        language={language}
      />,
    );
    expect(screen.getByRole('button', { name: posCopy(language, 'pay') })).toBeTruthy();
  });
});
