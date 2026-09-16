import type {
  ApiErrorBody,
  CashierContext,
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

  selectCountTap(payload: PresentationSalesPayload & {
    orderId: string;
    layoutPublicationSlotId: string;
  }): Promise<{ order: OrderBasket }> {
    return request('POST', '/api/v1/pos/select-count', payload);
  },
};
