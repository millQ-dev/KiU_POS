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

export type ModifierConfigurationSummary = {
  orderLineConfigurationId: string;
  additivePriceAdjustmentMinor: string;
  kitchenInstructions: unknown;
  configurationFingerprint: string;
};

export type CatalogModifierOption = {
  modifierOptionId: string;
  code: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  priceAdjustmentMinor: string;
  kitchenInstructionCode: string | null;
};

export type CatalogModifierGroup = {
  modifierGroupId: string;
  code: string;
  name: string;
  selectionMode: 'SINGLE' | 'MULTI';
  minSelect: number;
  maxSelect: number;
  askEveryTime: boolean;
  required: boolean;
  sortOrder: number;
  options: CatalogModifierOption[];
};

export type OrderLine = {
  orderLineId: string;
  lineNumber: number;
  catalogItemId: string;
  catalogItemName: string;
  quantity: string;
  unit: string;
  dimension: string;
  modifierConfiguration?: ModifierConfigurationSummary | null;
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
  roundingProvenance?: {
    orderProvenance?: {
      merchantDiscount?: {
        discountMinor?: string;
        netMerchandiseSalesMinor?: string;
        reason?: string;
        mode?: string;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  } | null;
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
