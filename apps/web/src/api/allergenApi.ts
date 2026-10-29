import { ApiError } from './types.js';
import type { ApiErrorBody } from './types.js';

export type AllergenCaptureChoice = 'NO_ALLERGIES_CONFIRMED' | 'SELECT_ALLERGENS' | 'UNABLE_TO_CLARIFY';
export type AllergenOfferResult =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_MODIFICATION'
  | 'BLOCKED'
  | 'REQUIRES_CONFIRMATION';
export type AllergenAckKind = 'CASHIER_GUEST_INFORMED' | 'KITCHEN_ACKNOWLEDGED';

export type OrderAllergenContext = {
  orderId: string;
  captureChoice: AllergenCaptureChoice;
  allergenCodes: string[];
  revision: number;
  frozen: boolean;
};

export type LineAllergenResolution = {
  orderLineId: string;
  catalogItemId: string;
  result: AllergenOfferResult;
  requiredAcknowledgements: Array<{ kind: AllergenAckKind }>;
  acknowledgedKinds: AllergenAckKind[];
};

export type AllergenState = {
  context: OrderAllergenContext | null;
  lines: LineAllergenResolution[];
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data ?? {}) as ApiErrorBody;
    throw new ApiError(res.status, err.error ?? 'UNKNOWN', err.message ?? res.statusText);
  }
  return data as T;
}

export const allergenApi = {
  getState(orderId: string): Promise<AllergenState> {
    return request('GET', `/api/v1/orders/${orderId}/allergen-context`);
  },

  capture(
    orderId: string,
    body: { captureChoice: AllergenCaptureChoice; allergenCodes?: string[] },
  ): Promise<AllergenState> {
    return request('PUT', `/api/v1/orders/${orderId}/allergen-context`, body);
  },

  async resolve(orderId: string): Promise<LineAllergenResolution[]> {
    const res = await request<{ lines: LineAllergenResolution[] }>(
      'POST',
      `/api/v1/orders/${orderId}/allergen-resolution`,
      {},
    );
    return res.lines;
  },

  acknowledge(orderId: string, lineId: string, kind: AllergenAckKind): Promise<unknown> {
    return request('POST', `/api/v1/orders/${orderId}/lines/${lineId}/allergen-acknowledgements`, {
      kind,
    });
  },
};
