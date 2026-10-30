import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MerchantDiscountPanel } from './MerchantDiscountPanel.js';
import { posApi } from '../api/client.js';
import { ApiError } from '../api/types.js';
import type { CommercialStatus } from '../api/types.js';

vi.mock('../api/client.js', () => ({
  posApi: {
    applyMerchantDiscount: vi.fn(),
    createApprovalRequest: vi.fn(),
    getCommercialStatus: vi.fn(),
  },
}));

const mockedApi = vi.mocked(posApi);

const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const outletId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const terminalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function acceptedCommercial(overrides: Partial<CommercialStatus> = {}): CommercialStatus {
  return {
    orderId,
    orderStatus: 'OPEN',
    commercialState: 'ACCEPTED',
    presentationHint: 'COMMERCIAL_CURRENT',
    currencyCode: 'VND',
    minorUnitExponent: 0,
    acceptedGrossMerchandiseMinor: '100000',
    merchandiseGrossMinor: '100000',
    commercialGrossPolicy: 'BASE_LIST_LINE_GROSS_ROUNDED',
    roundingProvenance: null,
    lines: [],
    ...overrides,
  };
}

describe('MerchantDiscountPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('requires reason and blocks apply when settlement is live', () => {
    render(
      <MerchantDiscountPanel
        orderId={orderId}
        outletId={outletId}
        terminalId={terminalId}
        commercial={acceptedCommercial()}
        settlementLive
        editable
        busy={false}
        onApplied={vi.fn()}
      />,
    );
    expect(screen.getByText(/Settlement has started/i)).toBeTruthy();
    expect(screen.queryByTestId('merchant-discount-apply')).toBeNull();
  });

  it('applies FIXED_MINOR and shows server net merchandise', async () => {
    mockedApi.applyMerchantDiscount.mockResolvedValueOnce({
      status: 'applied',
      orderId,
      mode: 'FIXED_MINOR',
      discountMinor: '10000',
      percentBasisPoints: null,
      eligibleBasisMinor: '100000',
      reason: 'Regular guest',
      approvalRequestId: null,
      certainty: 'FINAL',
      netMerchandiseSalesMinor: '90000',
    });
    const onApplied = vi.fn();
    render(
      <MerchantDiscountPanel
        orderId={orderId}
        outletId={outletId}
        terminalId={terminalId}
        commercial={acceptedCommercial()}
        settlementLive={false}
        editable
        busy={false}
        onApplied={onApplied}
      />,
    );
    fireEvent.change(screen.getByTestId('merchant-discount-amount'), {
      target: { value: '10000' },
    });
    fireEvent.change(screen.getByTestId('merchant-discount-reason'), {
      target: { value: 'Regular guest' },
    });
    fireEvent.click(screen.getByTestId('merchant-discount-apply'));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(mockedApi.applyMerchantDiscount).toHaveBeenCalledTimes(1);
    expect(mockedApi.applyMerchantDiscount.mock.calls[0]![1]).toMatchObject({
      mode: 'FIXED_MINOR',
      amountMinor: '10000',
      reason: 'Regular guest',
      terminalId,
    });
    expect(screen.getByTestId('merchant-discount-result').textContent).toMatch(/90000/);
    expect(screen.getByTestId('merchant-discount-result').textContent).toMatch(/10000/);
  });

  it('requests ApprovalRequest when cashier lacks direct grant, then applies with id', async () => {
    mockedApi.applyMerchantDiscount
      .mockRejectedValueOnce(
        new ApiError(409, 'APPROVAL_REQUIRED', 'Manager/Owner approval is required'),
      )
      .mockResolvedValueOnce({
        status: 'applied',
        orderId,
        mode: 'PERCENT',
        discountMinor: '10000',
        percentBasisPoints: 1000,
        eligibleBasisMinor: '100000',
        reason: 'promo',
        approvalRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        certainty: 'FINAL',
        netMerchandiseSalesMinor: '90000',
      });
    mockedApi.createApprovalRequest.mockResolvedValueOnce({
      approvalRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      expiresAt: new Date().toISOString(),
    });

    render(
      <MerchantDiscountPanel
        orderId={orderId}
        outletId={outletId}
        terminalId={terminalId}
        commercial={acceptedCommercial()}
        settlementLive={false}
        editable
        busy={false}
        onApplied={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('merchant-discount-mode'), {
      target: { value: 'PERCENT' },
    });
    fireEvent.change(screen.getByTestId('merchant-discount-percent'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByTestId('merchant-discount-reason'), {
      target: { value: 'promo' },
    });
    fireEvent.click(screen.getByTestId('merchant-discount-apply'));

    await waitFor(() =>
      expect(screen.getByTestId('merchant-discount-continue-approval')).toBeTruthy(),
    );
    expect(mockedApi.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'orders.merchant_discount.apply',
        operationFingerprint: expect.objectContaining({
          mode: 'PERCENT',
          percentBasisPoints: 1000,
          reason: 'promo',
        }),
      }),
    );

    fireEvent.click(screen.getByTestId('merchant-discount-continue-approval'));
    await waitFor(() => expect(screen.getByTestId('merchant-discount-result')).toBeTruthy());
    expect(mockedApi.applyMerchantDiscount.mock.calls[1]![1]).toMatchObject({
      approvalRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      percent: '10',
    });
    const keys = mockedApi.applyMerchantDiscount.mock.calls.map((c) => c[1]!.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('does not auto-replay with a new key after lost response; Check order reconciles', async () => {
    mockedApi.applyMerchantDiscount.mockRejectedValueOnce(new TypeError('network'));
    mockedApi.getCommercialStatus.mockResolvedValueOnce(
      acceptedCommercial({
        roundingProvenance: {
          orderProvenance: {
            merchantDiscount: {
              discountMinor: '7000',
              reason: 'guest',
              mode: 'FIXED_MINOR',
            },
          },
        },
      }),
    );
    const onApplied = vi.fn();
    render(
      <MerchantDiscountPanel
        orderId={orderId}
        outletId={outletId}
        terminalId={terminalId}
        commercial={acceptedCommercial()}
        settlementLive={false}
        editable
        busy={false}
        onApplied={onApplied}
      />,
    );
    fireEvent.change(screen.getByTestId('merchant-discount-amount'), {
      target: { value: '7000' },
    });
    fireEvent.change(screen.getByTestId('merchant-discount-reason'), {
      target: { value: 'guest' },
    });
    fireEvent.click(screen.getByTestId('merchant-discount-apply'));
    await waitFor(() => expect(screen.getByTestId('merchant-discount-check-order')).toBeTruthy());
    expect(mockedApi.applyMerchantDiscount).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('merchant-discount-check-order'));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(mockedApi.applyMerchantDiscount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('merchant-discount-result').textContent).toMatch(/7000/);
  });

  it('retry same attempt reuses the durable idempotency key', async () => {
    mockedApi.applyMerchantDiscount
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'))
      .mockResolvedValueOnce({
        status: 'applied',
        orderId,
        mode: 'FIXED_MINOR',
        discountMinor: '5000',
        percentBasisPoints: null,
        eligibleBasisMinor: '100000',
        reason: 'comp',
        approvalRequestId: null,
        certainty: 'FINAL',
        netMerchandiseSalesMinor: '95000',
      });
    mockedApi.getCommercialStatus.mockResolvedValueOnce(acceptedCommercial());

    render(
      <MerchantDiscountPanel
        orderId={orderId}
        outletId={outletId}
        terminalId={terminalId}
        commercial={acceptedCommercial()}
        settlementLive={false}
        editable
        busy={false}
        onApplied={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('merchant-discount-amount'), {
      target: { value: '5000' },
    });
    fireEvent.change(screen.getByTestId('merchant-discount-reason'), {
      target: { value: 'comp' },
    });
    fireEvent.click(screen.getByTestId('merchant-discount-apply'));
    await waitFor(() => expect(screen.getByTestId('merchant-discount-retry-same')).toBeTruthy());
    fireEvent.click(screen.getByTestId('merchant-discount-retry-same'));
    await waitFor(() => expect(screen.getByTestId('merchant-discount-result')).toBeTruthy());
    const keys = mockedApi.applyMerchantDiscount.mock.calls.map((c) => c[1]!.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows already-applied discount from commercial provenance and hides apply', () => {
    render(
      <MerchantDiscountPanel
        orderId={orderId}
        outletId={outletId}
        terminalId={terminalId}
        commercial={acceptedCommercial({
          roundingProvenance: {
            orderProvenance: {
              merchantDiscount: {
                discountMinor: '3000',
                reason: 'vip',
                mode: 'FIXED_MINOR',
              },
            },
          },
        })}
        settlementLive={false}
        editable
        busy={false}
        onApplied={vi.fn()}
      />,
    );
    expect(screen.getByTestId('merchant-discount-result').textContent).toMatch(/3000/);
    expect(screen.queryByTestId('merchant-discount-apply')).toBeNull();
  });
});
