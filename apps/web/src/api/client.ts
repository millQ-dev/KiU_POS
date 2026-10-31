import type {
  ApiErrorBody,
  CashierContext,
  CatalogModifierGroup,
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

/**
 * Shared POS/financial client: Session cookie only (credentials include).
 * Browser supplies Origin/Referer for CSRF — do not invent caller-controlled Origin.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
  };
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

  selectCountTap(
    payload: PresentationSalesPayload & {
      orderId: string;
      layoutPublicationSlotId: string;
    },
  ): Promise<{ order: OrderBasket }> {
    return request('POST', '/api/v1/pos/select-count', payload);
  },

  selectQuantityTap(
    payload: PresentationSalesPayload & {
      orderId: string;
      layoutPublicationSlotId: string;
      quantity: string;
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

  getCatalogItemModifierGroups(catalogItemId: string): Promise<{
    catalogItemId: string;
    groups: CatalogModifierGroup[];
  }> {
    return request('GET', `/api/v1/catalog-items/${catalogItemId}/modifier-groups`);
  },

  configureOrderLineModifiers(
    orderId: string,
    lineId: string,
    body: {
      selections: Array<{ modifierGroupId: string; modifierOptionId: string }>;
      guestNote?: string | null;
    },
  ): Promise<{
    configuration: {
      orderLineConfigurationId: string;
      additivePriceAdjustmentMinor: string;
      configurationFingerprint: string;
      kitchenInstructions: {
        instructionCodes: string[];
        guestNote: string | null;
      };
    };
    order: OrderBasket;
  }> {
    return request('POST', `/api/v1/orders/${orderId}/lines/${lineId}/configure-modifiers`, body);
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

  acceptTaxSnapshot(
    orderId: string,
    payload: { idempotencyKey: string; businessDateTime?: string },
  ): Promise<{ taxOrderSnapshotId: string }> {
    return request('POST', `/api/v1/orders/${orderId}/accept-tax-snapshot`, payload);
  },

  getLiveSettlement(
    orderId: string,
  ): Promise<{ orderId: string; settlement: import('./types.js').SettlementProjection | null }> {
    return request('GET', `/api/v1/orders/${orderId}/settlement`);
  },

  getFiscalGate(
    settlementGroupId: string,
  ): Promise<{
    settlementGroupId: string;
    fiscalAdapterMode: 'unavailable' | 'test-satisfying';
    gate: { status: string; detail?: string };
  }> {
    return request('GET', `/api/v1/settlements/${settlementGroupId}/fiscal-gate`);
  },

  issueFiscalDocument(payload: {
    settlementGroupId: string;
    issueIdempotencyKey: string;
  }): Promise<{
    fiscalDocumentId: string;
    status: string;
    settlementGroupId: string;
    paymentId: string;
    paymentCollectionEventId: string;
    taxOrderSnapshotId: string;
  }> {
    return request('POST', '/api/v1/fiscal/documents/issue', payload);
  },

  reconcileFiscalDocument(fiscalDocumentId: string): Promise<{
    fiscalDocumentId: string;
    status: string;
  }> {
    return request('POST', `/api/v1/fiscal/documents/${fiscalDocumentId}/reconcile`, {});
  },

  advanceCheckout(
    settlementGroupId: string,
    payload: {
      completeIdempotencyKey: string;
      businessDate: string;
      businessOrder: number;
      businessTime?: string | null;
      deviceId?: string;
    },
  ): Promise<{
    settlement: import('./types.js').SettlementProjection;
    fiscal: { status: string; detail?: string };
    completion: { orderId: string; status: string };
  }> {
    return request(
      'POST',
      `/api/v1/settlements/${settlementGroupId}/advance-checkout`,
      payload,
    );
  },

  abortSettlement(
    settlementGroupId: string,
    payload?: { expectedVersion?: number },
  ): Promise<import('./types.js').SettlementProjection> {
    return request('POST', `/api/v1/settlements/${settlementGroupId}/abort`, payload ?? {});
  },

  /** ADR-0051 ApplyOrderMerchantDiscount — narrow command; may return APPROVAL_REQUIRED. */
  applyMerchantDiscount(
    orderId: string,
    payload: {
      terminalId: string;
      idempotencyKey: string;
      mode: 'FIXED_MINOR' | 'PERCENT';
      amountMinor?: string;
      percent?: string;
      reason: string;
      approvalRequestId?: string;
      deviceId?: string;
    },
  ): Promise<{
    status: 'applied' | 'duplicate';
    orderId: string;
    mode: 'FIXED_MINOR' | 'PERCENT';
    discountMinor: string;
    percentBasisPoints: number | null;
    eligibleBasisMinor: string;
    reason: string;
    approvalRequestId: string | null;
    approverUserId: string;
    certainty: 'FINAL';
    netMerchandiseSalesMinor: string;
    semanticFingerprint: string;
    lines: Array<{ orderLineId: string; lineNumber: number; allocatedOrderMerchantDiscountMinor: string; netMerchandiseSalesMinor: string }>;
  }> {
    return request('POST', `/api/v1/orders/${orderId}/apply-merchant-discount`, payload);
  },

  createApprovalRequest(payload: {
    outletId: string;
    terminalId: string;
    operationType: string;
    operationFingerprint: Record<string, unknown>;
  }): Promise<{ approvalRequestId: string; expiresAt: string }> {
    return request('POST', '/api/v1/identity/approval-requests', payload);
  },
};
