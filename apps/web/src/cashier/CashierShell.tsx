import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { posApi } from '../api/client.js';
import { ApiError } from '../api/types.js';
import type {
  CashierContext,
  CatalogModifierGroup,
  CommercialStatus,
  MenuPriceResolution,
  OrderBasket,
  OrderLine,
  ResolvedPosSlot,
  ResolvedPosSurface,
  SettlementProjection,
} from '../api/types.js';
import { AllergenPanel } from './AllergenPanel.js';
import { ModifierConfigurationModal } from './ModifierConfigurationModal.js';
import { OrderBasketPanel } from './OrderBasket.js';
import { PosPageNavigation } from './PosPageNavigation.js';
import { ProductGrid } from './ProductGrid.js';
import { QuantityEntryModal } from './QuantityEntryModal.js';
import { QuickAccess } from './QuickAccess.js';
import './CashierShell.css';

function nowIso(): string {
  return new Date().toISOString();
}

function salesPayload(ctx: CashierContext) {
  return {
    presentationContext: {
      tenantId: ctx.tenantId,
      brandId: ctx.brandId,
      outletId: ctx.outletId,
    },
    salesContext: {
      tenantId: ctx.tenantId,
      brandId: ctx.brandId,
      outletId: ctx.outletId,
      orderChannel: ctx.orderChannel || 'DIRECT',
      businessDateTime: nowIso(),
    },
  };
}

type Props = {
  context: CashierContext;
  /** `production` hides DEV bootstrap controls; default `dev` preserves prior tests. */
  mode?: 'dev' | 'production';
  onChangeContext?: () => void;
  onSignOut?: () => void;
  /** Production CASH1.2 — open CloseCashShift UI (POS-SHIFT surface). */
  onCloseCashShift?: () => void;
  /** OPEN CashShift terminal — required for ADR-0038 ReceiveCash. */
  terminalId?: string | null;
};

function feedbackForApiError(err: ApiError): string {
  switch (err.code) {
    case 'SETTLEMENT_TAX_APPLICABILITY_UNDECIDED':
      return 'Tax blocked: LegalEntity tax applicability undecided — cannot open checkout';
    case 'SETTLEMENT_TAX_SNAPSHOT_REQUIRED':
      return 'Tax blocked: accepted Tax snapshot required before checkout';
    case 'SETTLEMENT_TAX_SNAPSHOT_INVALID':
      return 'Tax blocked: Tax snapshot invalid for settlement';
    case 'TAX_CLASSIFICATION_REQUIRED':
    case 'TAX_CLASSIFICATION_AMBIGUOUS':
      return `Tax blocked: ${err.code}`;
    case 'FISCAL_CHECKOUT_UNAVAILABLE':
    case 'FISCAL_GATE_UNAVAILABLE':
      return 'Fiscal blocked: FiscalCheckoutGate UNAVAILABLE — cannot complete checkout';
    case 'NO_TENDER':
    case 'TENDER_UNAVAILABLE':
    case 'PAYMENT_UNAVAILABLE':
      return 'Payment blocked: no tender configured — cannot collect payment';
    case 'MODIFIER_CONFIGURATION_MISSING':
    case 'MODIFIER_REQUIRED':
      return `Modifiers required: ${err.message}`;
    default:
      return `${err.code}: ${err.message}`;
  }
}

function lineNeedsModifierPrompt(groups: CatalogModifierGroup[]): boolean {
  return groups.length > 0;
}

// An unreadable response is not evidence that the server did not commit the selection.
function isOrderFor(value: unknown, orderId: string): value is OrderBasket {
  if (!value || typeof value !== 'object') return false;
  const o = value as Partial<OrderBasket>;
  return o.orderId === orderId && typeof o.tenantId === 'string' &&
    typeof o.legalEntityId === 'string' && typeof o.outletId === 'string' &&
    typeof o.channel === 'string' && typeof o.status === 'string' && Array.isArray(o.lines) &&
    o.lines.every((line) => line && typeof line.orderLineId === 'string' &&
      typeof line.lineNumber === 'number' &&
      typeof line.catalogItemId === 'string' && typeof line.catalogItemName === 'string' &&
      typeof line.quantity === 'string' && typeof line.unit === 'string' &&
      typeof line.dimension === 'string');
}

function isCommercialFor(value: unknown, orderId: string): value is CommercialStatus {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<CommercialStatus>;
  return c.orderId === orderId && typeof c.orderStatus === 'string' &&
    (c.commercialState === 'ACCEPTED' || c.commercialState === 'NOT_ACCEPTED') &&
    (c.presentationHint === 'NEEDS_REACCEPTANCE' || c.presentationHint === 'COMMERCIAL_CURRENT') &&
    (c.currencyCode === null || typeof c.currencyCode === 'string') &&
    (c.minorUnitExponent === null || typeof c.minorUnitExponent === 'number') &&
    (c.acceptedGrossMerchandiseMinor === null || typeof c.acceptedGrossMerchandiseMinor === 'string') &&
    Array.isArray(c.lines) && c.lines.every((line) => line &&
      typeof line.orderLineId === 'string' && typeof line.grossMerchandiseMinor === 'string');
}

function isSettlementFor(value: unknown, orderId: string): value is SettlementProjection {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<SettlementProjection>;
  return s.orderId === orderId && typeof s.settlementGroupId === 'string' &&
    (s.state === 'COLLECTING' || s.state === 'SATISFIED' || s.state === 'ABORTED') &&
    typeof s.currencyCode === 'string' && typeof s.merchandiseGrossMinor === 'string' &&
    typeof s.customerPayableMinor === 'string' && typeof s.allocatedAmountMinor === 'string' &&
    typeof s.outstandingAmountMinor === 'string' && typeof s.version === 'number' &&
    Array.isArray(s.checks) && s.checks.every((check) => check &&
      typeof check.settlementCheckId === 'string' && typeof check.checkNumber === 'number' &&
      typeof check.state === 'string' && typeof check.customerPayableMinor === 'string' &&
      typeof check.allocatedAmountMinor === 'string' && typeof check.outstandingAmountMinor === 'string');
}

function selectionDefinitelyRejected(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  // These route errors occur before selection; other errors may occur while enriching a committed order.
  return (err.status === 401 || err.status === 403) || (err.status === 400 && [
    'POS_SLOT_UNAVAILABLE', 'POS_SLOT_PRICE_UNAVAILABLE', 'POS_SLOT_NOT_ACTIVE',
    'POS_QUANTITY_ENTRY_DEFERRED',
  ].includes(err.code));
}

type SelectionRecovery = { orderId: string; phase: 'loading' | 'failed' | 'review' };

export function CashierShell({
  context,
  mode = 'dev',
  onChangeContext,
  onSignOut,
  onCloseCashShift,
  terminalId = null,
}: Props) {
  const production = mode === 'production';
  const [surface, setSurface] = useState<ResolvedPosSurface | null>(null);
  const [surfaceLoading, setSurfaceLoading] = useState(true);
  const [surfaceError, setSurfaceError] = useState<{ code: string; message: string } | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderBasket | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [selectingSlotId, setSelectingSlotId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [commercial, setCommercial] = useState<CommercialStatus | null>(null);
  const [priceResolution, setPriceResolution] = useState<MenuPriceResolution | null>(null);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [acceptingCommercial, setAcceptingCommercial] = useState(false);
  const [quantitySlot, setQuantitySlot] = useState<ResolvedPosSlot | null>(null);
  const [modifierPrompt, setModifierPrompt] = useState<{
    line: OrderLine;
    groups: CatalogModifierGroup[];
  } | null>(null);
  const [settlement, setSettlement] = useState<SettlementProjection | null>(null);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [modifierSaves, setModifierSaves] = useState(0);
  const inFlightRef = useRef(false);
  const recoveryRef = useRef<SelectionRecovery | null>(null);
  const [recovery, setRecovery] = useState<SelectionRecovery | null>(null);
  const orderIdRef = useRef<string | null>(null);

  const updateRecovery = (next: SelectionRecovery | null) => {
    recoveryRef.current = next;
    setRecovery(next);
  };

  useEffect(() => () => {
    orderIdRef.current = null;
    recoveryRef.current = null;
  }, []);

  const liveSettlement =
    settlement && (settlement.state === 'COLLECTING' || settlement.state === 'SATISFIED')
      ? settlement
      : null;
  const editable = order?.status === 'OPEN' && !liveSettlement && !recovery;

  const applyOrder = useCallback((next: OrderBasket, preferLineId?: string | null) => {
    orderIdRef.current = next.orderId;
    setOrder(next);
    setPriceResolution(null);
    setSelectedLineId((prev) => {
      const prefer = preferLineId === undefined ? prev : preferLineId;
      if (prefer && next.lines.some((l) => l.orderLineId === prefer)) return prefer;
      return null;
    });
  }, []);

  const reloadCommercial = useCallback(async (orderId: string) => {
    try {
      const status = await posApi.getCommercialStatus(orderId);
      setCommercial(status);
    } catch {
      setCommercial(null);
    }
  }, []);

  const reloadSettlement = useCallback(async (orderId: string) => {
    try {
      const res = await posApi.getLiveSettlement(orderId);
      setSettlement(res.settlement);
    } catch {
      setSettlement(null);
    }
  }, []);

  const reloadAuthoritativeOrder = useCallback(
    async (orderId: string, preferLineId?: string | null) => {
      const next = await posApi.getOrder(orderId);
      applyOrder(next, preferLineId);
      await reloadCommercial(orderId);
      await reloadSettlement(orderId);
      return next;
    },
    [applyOrder, reloadCommercial, reloadSettlement],
  );

  const loadSurface = useCallback(async () => {
    setSurfaceLoading(true);
    setSurfaceError(null);
    try {
      const next = await posApi.resolveSurface(salesPayload(context));
      setSurface(next);
      setSelectedPageId((prev) => {
        if (prev && next.pages.some((p) => p.layoutPublicationPageId === prev)) return prev;
        return next.pages[0]?.layoutPublicationPageId ?? null;
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      const message = err instanceof Error ? err.message : 'Failed to load POS surface';
      setSurface(null);
      setSurfaceError({ code, message });
    } finally {
      setSurfaceLoading(false);
    }
  }, [context]);

  const openOrder = useCallback(async () => {
    setOrderLoading(true);
    setFeedback(null);
    setSelectedLineId(null);
    setCommercial(null);
    setPriceResolution(null);
    setSettlement(null);
    try {
      const created = await posApi.openOrder({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        outletId: context.outletId,
        channel: context.orderChannel || 'DIRECT',
      });
      applyOrder(created, null);
      await reloadCommercial(created.orderId);
      await reloadSettlement(created.orderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open order';
      setFeedback(message);
    } finally {
      setOrderLoading(false);
    }
  }, [context, applyOrder, reloadCommercial, reloadSettlement]);

  useEffect(() => {
    void loadSurface();
  }, [loadSurface]);

  useEffect(() => {
    if (!order) void openOrder();
  }, [order, openOrder]);

  const selectedPage = useMemo(() => {
    if (!surface) return null;
    if (selectedPageId) {
      const found = surface.pages.find((p) => p.layoutPublicationPageId === selectedPageId);
      if (found) return found;
    }
    return surface.pages[0] ?? null;
  }, [surface, selectedPageId]);

  const withMutationGuard = async (fn: () => Promise<void>) => {
    if (inFlightRef.current || recoveryRef.current) return;
    inFlightRef.current = true;
    setMutationBusy(true);
    setFeedback(null);
    try {
      await fn();
    } finally {
      inFlightRef.current = false;
      setMutationBusy(false);
    }
  };

  const reconcileSelection = async (orderId: string) => {
    if (orderIdRef.current !== orderId || recoveryRef.current?.phase === 'loading') return;
    updateRecovery({ orderId, phase: 'loading' });
    try {
      // Read all three independently; a failed settlement read must never mean "no settlement".
      const [next, commercialStatus, live] = await Promise.all([
        posApi.getOrder(orderId),
        posApi.getCommercialStatus(orderId),
        posApi.getLiveSettlement(orderId),
      ]);
      if (!isOrderFor(next, orderId) || !isCommercialFor(commercialStatus, orderId) ||
          !live || live.orderId !== orderId || !('settlement' in live) ||
          (live.settlement !== null && !isSettlementFor(live.settlement, orderId))) {
        throw new Error('Invalid recovery response');
      }
      if (orderIdRef.current !== orderId || recoveryRef.current?.orderId !== orderId) return;
      applyOrder(next, null);
      setCommercial(commercialStatus);
      setSettlement(live.settlement);
      updateRecovery({ orderId, phase: 'review' });
    } catch {
      if (orderIdRef.current === orderId && recoveryRef.current?.orderId === orderId) {
        updateRecovery({ orderId, phase: 'failed' });
      }
    }
  };

  const startSelectionRecovery = async (orderId: string) => {
    // Set the synchronous lock before starting any reads or allowing another event.
    updateRecovery({ orderId, phase: 'failed' });
    setFeedback(null);
    setQuantitySlot(null);
    setModifierPrompt(null);
    await reconcileSelection(orderId);
  };

  const handleMutationError = async (err: unknown, orderId: string | undefined) => {
    if (err instanceof ApiError) {
      setFeedback(feedbackForApiError(err));
    } else {
      const message = err instanceof Error ? err.message : 'Mutation failed';
      setFeedback(`NETWORK: ${message}`);
    }
    if (!orderId) return;
    try {
      await reloadAuthoritativeOrder(orderId, selectedLineId);
    } catch {
      /* keep prior UI; feedback already shown */
    }
  };

  const maybePromptModifiers = async (basket: OrderBasket, catalogItemId: string) => {
    try {
      const { groups } = await posApi.getCatalogItemModifierGroups(catalogItemId);
      if (!lineNeedsModifierPrompt(groups)) return;
      const priorIds = new Set((order?.lines ?? []).map((l) => l.orderLineId));
      const newLine =
        basket.lines.find((l) => !priorIds.has(l.orderLineId) && l.catalogItemId === catalogItemId) ??
        [...basket.lines].reverse().find((l) => l.catalogItemId === catalogItemId);
      if (!newLine) return;
      if (newLine.modifierConfiguration) return;
      setModifierPrompt({ line: newLine, groups });
      setSelectedLineId(newLine.orderLineId);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      const message = err instanceof Error ? err.message : 'Modifier groups failed';
      setFeedback(`${code}: ${message}`);
    }
  };

  const onSelectSlot = async (slot: ResolvedPosSlot) => {
    if (recoveryRef.current || inFlightRef.current) return;
    if (!order || order.status !== 'OPEN') {
      setFeedback('Open an order first');
      return;
    }
    if (liveSettlement) {
      setFeedback('Checkout active — abort checkout to edit the order');
      return;
    }
    if (slot.state !== 'ACTIVE') return;
    if (slot.quantityEntry === 'DEFERRED_WEIGHTED') {
      setQuantitySlot(slot);
      return;
    }
    await withMutationGuard(async () => {
      setSelectingSlotId(slot.layoutPublicationSlotId);
      try {
        const result = await posApi.selectCountTap({
          ...salesPayload(context),
          orderId: order.orderId,
          layoutPublicationSlotId: slot.layoutPublicationSlotId,
        });
        if (!isOrderFor(result?.order, order.orderId)) throw new Error('Invalid selection response');
        applyOrder(result.order, selectedLineId);
        await reloadCommercial(result.order.orderId);
        await maybePromptModifiers(result.order, slot.catalogItemId);
      } catch (err) {
        if (!selectionDefinitelyRejected(err)) {
          await startSelectionRecovery(order.orderId);
          return;
        }
        const code = err instanceof ApiError ? err.code : 'NETWORK';
        const message = err instanceof Error ? err.message : 'Selection failed';
        setFeedback(`${code}: ${message}`);
        const stale =
          code === 'POS_SLOT_UNAVAILABLE' ||
          code === 'POS_SLOT_PRICE_UNAVAILABLE' ||
          code === 'POS_SLOT_NOT_ACTIVE' ||
          code === 'POS_QUANTITY_ENTRY_DEFERRED';
        if (stale) await loadSurface();
        if (code === 'ORDER_IMMUTABLE') {
          await reloadAuthoritativeOrder(order.orderId, null);
        }
      } finally {
        setSelectingSlotId(null);
      }
    });
  };

  const onConfirmWeighted = async (quantity: string) => {
    if (!order || !quantitySlot || recoveryRef.current) return;
    const slot = quantitySlot;
    await withMutationGuard(async () => {
      setSelectingSlotId(slot.layoutPublicationSlotId);
      try {
        const result = await posApi.selectQuantityTap({
          ...salesPayload(context),
          orderId: order.orderId,
          layoutPublicationSlotId: slot.layoutPublicationSlotId,
          quantity,
        });
        if (!isOrderFor(result?.order, order.orderId)) throw new Error('Invalid selection response');
        applyOrder(result.order, selectedLineId);
        await reloadCommercial(result.order.orderId);
        setQuantitySlot(null);
        await maybePromptModifiers(result.order, slot.catalogItemId);
      } catch (err) {
        if (!selectionDefinitelyRejected(err)) {
          await startSelectionRecovery(order.orderId);
          return;
        }
        const code = err instanceof ApiError ? err.code : 'NETWORK';
        const message = err instanceof Error ? err.message : 'Selection failed';
        setFeedback(`${code}: ${message}`);
        if (
          code === 'POS_SLOT_UNAVAILABLE' ||
          code === 'POS_SLOT_PRICE_UNAVAILABLE' ||
          code === 'POS_SLOT_NOT_ACTIVE'
        ) {
          await loadSurface();
          setQuantitySlot(null);
        }
      } finally {
        setSelectingSlotId(null);
      }
    });
  };

  const onUpdateQuantity = (line: OrderLine, quantity: string) => {
    if (!order || !editable) return;
    void withMutationGuard(async () => {
      try {
        const next = await posApi.updateOrderLine(order.orderId, line.orderLineId, {
          quantity,
          unit: line.unit,
          dimension: line.dimension,
        });
        applyOrder(next, line.orderLineId);
        await reloadCommercial(next.orderId);
      } catch (err) {
        await handleMutationError(err, order.orderId);
      }
    });
  };

  const onRemoveLine = (line: OrderLine) => {
    if (!order || !editable) return;
    if (!window.confirm(`Remove “${line.catalogItemName}”?`)) return;
    void withMutationGuard(async () => {
      try {
        const next = await posApi.removeOrderLine(order.orderId, line.orderLineId);
        applyOrder(next, null);
        await reloadCommercial(next.orderId);
      } catch (err) {
        await handleMutationError(err, order.orderId);
      }
    });
  };

  const onCancelOrder = () => {
    if (!order || !editable) return;
    if (!window.confirm('Cancel this open order? This cannot be undone from the cashier.')) return;
    void withMutationGuard(async () => {
      try {
        const next = await posApi.cancelOrder(order.orderId, { reason: 'cashier_cancel' });
        applyOrder(next, null);
        setCommercial(null);
        setPriceResolution(null);
        setFeedback('Order cancelled');
      } catch (err) {
        await handleMutationError(err, order.orderId);
      }
    });
  };

  const onRefreshPrices = () => {
    if (!order || !editable) return;
    void withMutationGuard(async () => {
      setRefreshingPrices(true);
      try {
        const resolved = await posApi.resolveMenuPrices(order.orderId, {
          salesContext: salesPayload(context).salesContext,
        });
        setPriceResolution(resolved);
        await reloadCommercial(order.orderId);
      } catch (err) {
        await handleMutationError(err, order.orderId);
      } finally {
        setRefreshingPrices(false);
      }
    });
  };

  const onAcceptCurrentPrices = () => {
    if (!order || !editable) return;
    void withMutationGuard(async () => {
      setAcceptingCommercial(true);
      try {
        const salesContext = salesPayload(context).salesContext;
        const key = `c11-accept:${order.orderId}:${Date.now()}`;
        const result =
          commercial?.commercialState === 'ACCEPTED'
            ? await posApi.repriceAndAcceptCommercialTerms(order.orderId, {
                salesContext,
                idempotencyKey: key,
              })
            : await posApi.calculateAndAcceptCommercialTerms(order.orderId, {
                salesContext,
                idempotencyKey: key,
              });
        setCommercial(result.commercialStatus);
        setFeedback(
          commercial?.commercialState === 'ACCEPTED'
            ? 'Repriced and accepted merchandise gross'
            : 'Calculated and accepted merchandise gross',
        );
      } catch (err) {
        await handleMutationError(err, order.orderId);
      } finally {
        setAcceptingCommercial(false);
      }
    });
  };

  const onOpenCheckout = () => {
    if (!order || !editable) return;
    void withMutationGuard(async () => {
      setSettlementBusy(true);
      try {
        // ADR-0037: attempt Tax snapshot before OpenSettlement. When tax_required=FALSE and
        // no TaxPolicy exists, accept may fail — OpenSettlement remains the fail-closed gate.
        const commercialKey =
          commercial?.merchandiseGrossMinor ??
          commercial?.acceptedGrossMerchandiseMinor ??
          'na';
        try {
          await posApi.acceptTaxSnapshot(order.orderId, {
            idempotencyKey: `accept-tax:${order.orderId}:${commercialKey}`,
            businessDateTime: salesPayload(context).salesContext.businessDateTime,
          });
        } catch (taxErr) {
          if (!(taxErr instanceof ApiError) || !String(taxErr.code).startsWith('TAX')) {
            throw taxErr;
          }
        }
        const next = await posApi.openSettlement(order.orderId, {
          idempotencyKey: `open-settlement:${order.orderId}:${commercialKey}`,
        });
        setSettlement(next);
        setFeedback('Checkout opened — Customer Payable frozen');
      } catch (err) {
        await handleMutationError(err, order.orderId);
      } finally {
        setSettlementBusy(false);
      }
    });
  };

  const onAbortCheckout = () => {
    if (!order || !liveSettlement) return;
    void withMutationGuard(async () => {
      setSettlementBusy(true);
      try {
        const next = await posApi.abortSettlement(liveSettlement.settlementGroupId, {
          expectedVersion: liveSettlement.version,
        });
        setSettlement(next.state === 'ABORTED' ? null : next);
        setFeedback('Checkout aborted — order editable again');
        await reloadCommercial(order.orderId);
      } catch (err) {
        await handleMutationError(err, order.orderId);
      } finally {
        setSettlementBusy(false);
      }
    });
  };

  const onSettlementRefresh = async () => {
    if (!order) return;
    try {
      const res = await posApi.getLiveSettlement(order.orderId);
      setSettlement(res.settlement);
      if (res.settlement?.state === 'SATISFIED') {
        setFeedback(
          'Settlement SATISFIED — cash collection recorded. Issue fiscal evidence before CompleteOrder.',
        );
      }
    } catch (err) {
      await handleMutationError(err, order.orderId);
    }
  };

  const onOrderCompleted = (result: {
    orderId: string;
    status: string;
    businessDate: string;
    businessOrder: number;
    goodsIssueId?: string | null;
  }) => {
    // Keep completion result mounted until cashier starts a new order (immutable COMPLETED).
    setFeedback(
      `Order ${result.status} · chronology ${result.businessDate}#${result.businessOrder}${
        result.goodsIssueId ? ` · GI ${result.goodsIssueId.slice(0, 8)}` : ''
      } — start a new order`,
    );
    setSelectedLineId(null);
    setOrder((prev) =>
      prev && prev.orderId === result.orderId
        ? { ...prev, status: result.status as typeof prev.status }
        : prev,
    );
  };

  return (
    <div className="pos-shell">
      <header className="pos-shell__header">
        <div className="pos-shell__brand">
          <span className="pos-shell__kiu">KiU</span>
          <span className="pos-shell__outlet">{context.outletName}</span>
          {!production ? (
            <span
              className="pos-shell__dev"
              title="Development context bootstrap — not production auth"
            >
              DEV context
            </span>
          ) : null}
        </div>
        <div className="pos-shell__actions">
          <button
            type="button"
            className="pos-shell__btn"
            onClick={() => void loadSurface()}
            disabled={surfaceLoading || !!recovery}
          >
            Refresh surface
          </button>
          {!production && onChangeContext ? (
            <button type="button" className="pos-shell__btn" disabled={!!recovery} onClick={onChangeContext}>
              Change context
            </button>
          ) : null}
          {production && onCloseCashShift ? (
            <button
              type="button"
              className="pos-shell__btn"
              data-testid="open-close-cash-shift"
              disabled={!!recovery}
              onClick={onCloseCashShift}
            >
              Close cash shift
            </button>
          ) : null}
          {production && onSignOut ? (
            <button type="button" className="pos-shell__btn" disabled={!!recovery} onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      {feedback && (
        <div className="pos-shell__feedback" role="status">
          {feedback}
        </div>
      )}

      {recovery && (
        <div className="pos-shell__feedback" role="alert" aria-live="polite">
          {recovery.phase === 'loading' && 'Selection response was not confirmed. Checking the server order…'}
          {recovery.phase === 'failed' && (
            <>
              Server order or checkout state could not be read. The basket is locked; retry the check.
              <button type="button" className="pos-shell__btn" onClick={() => void reconcileSelection(recovery.orderId)}>
                Retry order check
              </button>
            </>
          )}
          {recovery.phase === 'review' && (
            <>
              Server state was read. Check the basket and modifiers before continuing. The original request
              may still be processing; this check cannot confirm its final outcome. Do not add the product
              again unless you have confirmed what happened.
              <button type="button" className="pos-shell__btn" onClick={() => void reconcileSelection(recovery.orderId)}>
                Check again
              </button>
              <button type="button" className="pos-shell__btn" onClick={() => {
                if (recoveryRef.current?.phase === 'review') updateRecovery(null);
              }}>
                I checked the order
              </button>
            </>
          )}
        </div>
      )}

      <fieldset disabled={!!recovery} className="pos-shell__workarea">

      {!editable && order && order.status === 'OPEN' && liveSettlement && (
        <div className="pos-shell__feedback" role="status">
          Checkout active ({liveSettlement.state}) — basket editing locked until abort.
        </div>
      )}

      {!editable && order && order.status !== 'OPEN' && (
        <div className="pos-shell__feedback" role="status">
          Order is {order.status} — editing disabled. Start a new order to continue.
        </div>
      )}

      {order && (
        <AllergenPanel
          orderId={order.orderId}
          lines={order.lines}
          editable={!!editable}
          refreshKey={`${modifierSaves}:${order.lines.map((l) => `${l.orderLineId}:${l.quantity}`).join('|')}`}
        />
      )}

      {surfaceLoading && !surface ? (
        <div className="pos-shell__loading" role="status">
          Loading POS surface…
        </div>
      ) : surfaceError ? (
        <div className="pos-shell__error" role="alert">
          <strong>{surfaceError.code}</strong>
          <p>{surfaceError.message}</p>
          <button type="button" className="pos-shell__btn" onClick={() => void loadSurface()}>
            Retry
          </button>
        </div>
      ) : surface ? (
        <div className="pos-shell__body">
          <PosPageNavigation
            pages={surface.pages}
            selectedPageId={selectedPage?.layoutPublicationPageId ?? null}
            onSelect={setSelectedPageId}
          />
          <main className="pos-shell__main">
            <QuickAccess
              slots={surface.quickAccess}
              selectingSlotId={selectingSlotId}
              onSelect={(s) => void onSelectSlot(s)}
            />
            <ProductGrid
              slots={selectedPage?.slots ?? []}
              selectingSlotId={selectingSlotId}
              onSelect={(s) => void onSelectSlot(s)}
            />
          </main>
          <OrderBasketPanel
            order={order}
            loading={orderLoading}
            selectedLineId={selectedLineId}
            mutationBusy={mutationBusy}
            editable={!!editable}
            commercial={commercial}
            priceResolution={priceResolution}
            refreshingPrices={refreshingPrices}
            acceptingCommercial={acceptingCommercial}
            settlement={liveSettlement}
            settlementBusy={settlementBusy}
            terminalId={terminalId}
            legalEntityId={context.legalEntityId}
            outletId={context.outletId}
            outletTimeZone="Asia/Ho_Chi_Minh"
            onSelectLine={setSelectedLineId}
            onUpdateQuantity={onUpdateQuantity}
            onRemoveLine={onRemoveLine}
            onRefreshPrices={onRefreshPrices}
            onAcceptCurrentPrices={onAcceptCurrentPrices}
            onOpenCheckout={onOpenCheckout}
            onAbortCheckout={onAbortCheckout}
            onSettlementRefresh={onSettlementRefresh}
            onOrderCompleted={onOrderCompleted}
            onCancelOrder={onCancelOrder}
            onNewOrder={() => {
              if (recoveryRef.current || inFlightRef.current) return;
              orderIdRef.current = null;
              setOrder(null);
              setSettlement(null);
              setCommercial(null);
            }}
          />
        </div>
      ) : null}

      {quantitySlot && (
        <QuantityEntryModal
          slot={quantitySlot}
          busy={mutationBusy}
          onCancel={() => setQuantitySlot(null)}
          onConfirm={(q) => void onConfirmWeighted(q)}
        />
      )}

      {modifierPrompt && order && (
        <ModifierConfigurationModal
          line={modifierPrompt.line}
          groups={modifierPrompt.groups}
          busy={mutationBusy}
          onCancel={() => setModifierPrompt(null)}
          onConfirm={(payload) => {
            void withMutationGuard(async () => {
              try {
                const result = await posApi.configureOrderLineModifiers(
                  order.orderId,
                  modifierPrompt.line.orderLineId,
                  payload,
                );
                applyOrder(result.order, modifierPrompt.line.orderLineId);
                await reloadCommercial(result.order.orderId);
                setModifierPrompt(null);
                setModifierSaves((n) => n + 1);
                setFeedback(
                  `Modifiers saved (+${result.configuration.additivePriceAdjustmentMinor} VND)`,
                );
              } catch (err) {
                await handleMutationError(err, order.orderId);
              }
            });
          }}
        />
      )}
      </fieldset>
    </div>
  );
}
