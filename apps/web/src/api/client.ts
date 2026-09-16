import type {
  ApiErrorBody,
  CashierContext,
  CashCheckoutResult,
  CommercialStatus,
  MenuPriceResolution,
  OrderBasket,
  ResolvedPosSurface,
} from './types.js';
import { ApiError } from './types.js';

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: 'INVALID_JSON', message: text };
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const data = await parseJson(res);
  if (!res.ok) {
    const err = (data ?? {}) as ApiErrorBody;
    throw new ApiError(res.status, err.error ?? 'UNKNOWN', err.message ?? res.statusText);
  }
  return data as T;
}

export type PresentationSalesPayload = {
  presentationContext: {
    tenantId: string;
    brandId: string;
    outletId: string;
  };
  salesContext: {
    tenantId: string;
    brandId: string;
    outletId: string;
    orderChannel: string;
    businessDateTime: string;
  };
};

export const posApi = {
  listDevContexts(): Promise<{
    mode: string;
    warning: string;
    contexts: CashierContext[];
  }> {
    return request('GET', '/api/v1/dev/cashier-contexts');
  },

  openDevCashShift(payload: {
    tenantId: string;
    legalEntityId: string;
    outletId: string;
    openingCashMinor?: string;
    cashierId?: string;
    deviceId?: string;
  }): Promise<{
    cashShiftId: string;
    cashierId: string;
    deviceId: string;
    status: 'OPEN';
    openingCashMinor: string;
    currencyCode: string;
    minorUnitExponent: number;
  }> {
    return request('POST', '/api/v1/dev/cash-shifts', payload);
  },

  resolveSurface(payload: PresentationSalesPayload): Promise<ResolvedPosSurface> {
    return request('POST', '/api/v1/pos/surface/resolve', payload);
  },

  openOrder(payload: {
    tenantId: string;
    legalEntityId: string;
    outletId: string;
    channel?: string;
  }): Promise<OrderBasket> {
    return request('POST', '/api/v1/orders', payload);
  },

  getOrder(orderId: string): Promise<OrderBasket> {
    return request('GET', `/api/v1/orders/${orderId}`);
  },

  selectCountTap(
    payload: PresentationSalesPayload & {
      orderId: string;
      layoutPublicationSlotId: string;
      modifierSelections?: Array<{ groupId: string; optionIds: string[] }>;
    },
  ): Promise<{ order: OrderBasket }> {
    return request('POST', '/api/v1/pos/select-count', payload);
  },

  selectQuantityTap(
    payload: PresentationSalesPayload & {
      orderId: string;
      layoutPublicationSlotId: string;
      quantity: string;
      modifierSelections?: Array<{ groupId: string; optionIds: string[] }>;
    },
  ): Promise<{ order: OrderBasket }> {
    return request('POST', '/api/v1/pos/select-quantity', payload);
  },

  updateOrderLine(
    orderId: string,
    lineId: string,
    body: { quantity: string; unit?: string; dimension?: string },
  ): Promise<OrderBasket> {
    return request('PATCH', `/api/v1/orders/${orderId}/lines/${lineId}`, body);
  },

  removeOrderLine(orderId: string, lineId: string): Promise<OrderBasket> {
    return request('DELETE', `/api/v1/orders/${orderId}/lines/${lineId}`);
  },

  cancelOrder(orderId: string, body: { reason: string; actorId?: string }): Promise<OrderBasket> {
    return request('POST', `/api/v1/orders/${orderId}/cancel`, body);
  },

  getCommercialStatus(orderId: string): Promise<CommercialStatus> {
    return request('GET', `/api/v1/orders/${orderId}/commercial-status`);
  },

  resolveMenuPrices(
    orderId: string,
    payload: { salesContext: PresentationSalesPayload['salesContext'] },
  ): Promise<MenuPriceResolution> {
    return request('POST', `/api/v1/orders/${orderId}/resolve-menu-prices`, payload);
  },

  calculateAndAcceptCommercialTerms(
    orderId: string,
    payload: {
      salesContext: PresentationSalesPayload['salesContext'];
      idempotencyKey: string;
    },
  ): Promise<{ commercialStatus: CommercialStatus }> {
    return request(
      'POST',
      `/api/v1/orders/${orderId}/calculate-and-accept-commercial-terms`,
      payload,
    );
  },

  repriceAndAcceptCommercialTerms(
    orderId: string,
    payload: {
      salesContext: PresentationSalesPayload['salesContext'];
      idempotencyKey: string;
    },
  ): Promise<{ commercialStatus: CommercialStatus }> {
    return request(
      'POST',
      `/api/v1/orders/${orderId}/reprice-and-accept-commercial-terms`,
      payload,
    );
  },

  openSettlement(
    orderId: string,
    payload: { idempotencyKey: string },
  ): Promise<import('./types.js').SettlementProjection> {
    return request('POST', `/api/v1/orders/${orderId}/open-settlement`, payload);
  },

  getLiveSettlement(
    orderId: string,
  ): Promise<{ orderId: string; settlement: import('./types.js').SettlementProjection | null }> {
    return request('GET', `/api/v1/orders/${orderId}/settlement`);
  },

  abortSettlement(
    settlementGroupId: string,
    payload?: { expectedVersion?: number },
  ): Promise<import('./types.js').SettlementProjection> {
    return request('POST', `/api/v1/settlements/${settlementGroupId}/abort`, payload ?? {});
  },

  checkoutCash(
    orderId: string,
    payload: {
      cashShiftId: string;
      tenderedMinor: string;
      idempotencyKey: string;
      actorId?: string;
      deviceId?: string;
    },
  ): Promise<CashCheckoutResult> {
    return request('POST', `/api/v1/orders/${orderId}/checkout/cash`, payload);
  },
};
