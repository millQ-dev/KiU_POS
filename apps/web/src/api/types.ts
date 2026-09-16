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
  modifierGroups?: ModifierGroup[];
};

export type ModifierOption = {
  modifierOptionId: string;
  label: string;
  priceDeltaMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  position: number;
  active: boolean;
};

export type ModifierGroup = {
  modifierGroupId: string;
  code: string;
  label: string;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
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
  modifiers?: Array<{
    modifierGroupId: string;
    modifierOptionId: string;
    groupLabel: string;
    optionLabel: string;
    priceDeltaMinor: string;
  }>;
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

/** Backend commercial acceptance read (D1.4B / C1.1). Absence after mutation = NEEDS_REACCEPTANCE. */
export type CommercialStatus = {
  orderId: string;
  orderStatus: string;
  commercialState: 'NOT_ACCEPTED' | 'ACCEPTED';
  presentationHint: 'NEEDS_REACCEPTANCE' | 'COMMERCIAL_CURRENT';
  currencyCode: string | null;
  minorUnitExponent: number | null;
  acceptedGrossMerchandiseMinor: string | null;
  /** Authoritative Σ rounded line gross when accepted (C1.1). */
  merchandiseGrossMinor?: string | null;
  commercialGrossPolicy?: string | null;
  roundingProvenance?: unknown;
  lines: Array<{
    orderLineId: string;
    resolvedUnitPriceMinor: string | null;
    grossMerchandiseMinor: string;
    exactUnroundedMinorBasis?: string | null;
    roundingDelta?: string | null;
    roundingPolicyId?: string | null;
    roundingPolicyVersion?: number | null;
  }>;
};

/** Unit-price resolution only — does not accept commercial terms. */
export type MenuPriceResolution = {
  orderId: string;
  note: string;
  commercialGrossPolicy: string;
  lines: Array<{
    orderLineId: string;
    catalogItemId: string;
    quantity: string;
    availabilityStatus: string;
    resolvedUnitPriceMinor: string | null;
    currencyCode: string | null;
    minorUnitExponent: number | null;
    menuPublicationId: string | null;
    priceRuleId: string | null;
  }>;
};

/** Backend Settlement projection (S1.1 / ADR-0032). */
export type SettlementProjection = {
  settlementGroupId: string;
  orderId: string;
  state: 'COLLECTING' | 'SATISFIED' | 'ABORTED';
  currencyCode: string;
  merchandiseGrossMinor: string;
  customerPayableMinor: string;
  allocatedAmountMinor: string;
  outstandingAmountMinor: string;
  version: number;
  checks: Array<{
    settlementCheckId: string;
    checkNumber: number;
    state: string;
    customerPayableMinor: string;
    allocatedAmountMinor: string;
    outstandingAmountMinor: string;
  }>;
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
  cashShiftId: string;
  cashierId: string;
  deviceId: string;
  openingCashMinor: string;
  shiftStatus: 'OPEN';
};

export type CashCheckoutResult = {
  order: OrderBasket;
  settlement: {
    settlement_group_id: string;
    settlement_state: string;
    customer_payable_minor: string;
    settlement_check_id: string;
    check_state: string;
    check_payable_minor: string;
  };
  payment: {
    payment_id: string;
    status: string;
    tender_kind: string;
    amount_minor: string;
    tendered_minor: string;
    change_minor: string;
    currency_code: string;
  };
  productionTasks: Array<{
    production_task_id: string;
    order_line_id: string;
    catalog_item_id: string;
    status: string;
    quantity: string;
    unit: string;
    label: string;
    modifier_snapshot_json: unknown;
  }>;
  receipt: {
    orderId: string;
    issuedAt: string;
    outletId: string;
    terminalId: string;
    cashierId: string;
    currencyCode: string;
    minorUnitExponent: number;
    lines: unknown[];
    subtotalMinor: string;
    totalMinor: string;
    paymentMethod: string;
    cashTenderedMinor: string;
    changeMinor: string;
  };
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
