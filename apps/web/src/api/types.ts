export type MoneyDto = {
  amountMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
};

export type PosSlotState =
  | 'ACTIVE'
  | 'DISABLED_UNAVAILABLE'
  | 'DISABLED_PRICE_UNAVAILABLE'
  | 'CONFIGURATION_ERROR';

export type ResolvedPosSlot = {
  layoutPublicationSlotId: string;
  catalogItemId: string;
  catalogItemName: string;
  displayLabel: string;
  baseUnit: string;
  dimension: 'MASS' | 'VOLUME' | 'COUNT';
  quantityEntry: 'COUNT_ONE' | 'DEFERRED_WEIGHTED';
  zone: 'PAGE' | 'QUICK_ACCESS';
  position: number;
  labelOverride: string | null;
  colorToken: string | null;
  state: PosSlotState;
  unitPrice: MoneyDto | null;
};

export type ResolvedPosPage = {
  layoutPublicationPageId: string;
  pageCode: string;
  label: string;
  sortOrder: number;
  colorToken: string | null;
  slots: ResolvedPosSlot[];
};

export type ResolvedPosSurface = {
  presentationContext: {
    tenantId: string;
    brandId: string;
    outletId: string;
    legalEntityId: string;
  };
  salesContext: {
    tenantId: string;
    brandId: string;
    outletId: string;
    orderChannel: string;
    businessDateTime: string;
  };
  layoutPublicationId: string;
  layoutPublicationVersion: number;
  menuPublicationId: string;
  pages: ResolvedPosPage[];
  quickAccess: ResolvedPosSlot[];
};

export type OrderLine = {
  orderLineId: string;
  lineNumber: number;
  catalogItemId: string;
  catalogItemName: string;
  quantity: string;
  unit: string;
  dimension: string;
};

export type OrderBasket = {
  orderId: string;
  tenantId: string;
  legalEntityId: string;
  outletId: string;
  status: string;
  channel: string;
  lines: OrderLine[];
};

export type CashierContext = {
  tenantId: string;
  tenantName: string;
  brandId: string;
  brandName: string;
  outletId: string;
  outletName: string;
  legalEntityId: string;
  legalEntityName: string;
  orderChannel: string;
};

export type ApiErrorBody = {
  error: string;
  message?: string;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
