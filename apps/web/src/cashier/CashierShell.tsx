import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { posApi } from '../api/client.js';
import { ApiError } from '../api/types.js';
import type {
  CashierContext,
  CommercialStatus,
  MenuPriceResolution,
  OrderBasket,
  OrderLine,
  ResolvedPosSlot,
  ResolvedPosSurface,
  SettlementProjection,
  CashCheckoutResult,
} from '../api/types.js';
import { OrderBasketPanel } from './OrderBasket.js';
import { PosPageNavigation } from './PosPageNavigation.js';
import { ProductGrid } from './ProductGrid.js';
import { QuantityEntryModal } from './QuantityEntryModal.js';
import { ModifierSelectionModal } from './ModifierSelectionModal.js';
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
  onChangeContext: () => void;
};

export function CashierShell({ context, onChangeContext }: Props) {
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
  const [quantityModifierSelections, setQuantityModifierSelections] = useState<Array<{ groupId: string; optionIds: string[] }>>([]);
  const [modifierSlot, setModifierSlot] = useState<ResolvedPosSlot | null>(null);
  const [cashResult, setCashResult] = useState<CashCheckoutResult | null>(null);
  const [settlement, setSettlement] = useState<SettlementProjection | null>(null);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const inFlightRef = useRef(false);

  const liveSettlement =
    settlement && (settlement.state === 'COLLECTING' || settlement.state === 'SATISFIED')
      ? settlement
      : null;
  const editable = order?.status === 'OPEN' && !liveSettlement;

  const applyOrder = useCallback((next: OrderBasket, preferLineId?: string | null) => {
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
    setCashResult(null);
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
    if (inFlightRef.current) return;
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

  const handleMutationError = async (err: unknown, orderId: string | undefined) => {
    const code = err instanceof ApiError ? err.code : 'NETWORK';
    const message = err instanceof Error ? err.message : 'Mutation failed';
    setFeedback(`${code}: ${message}`);
    if (!orderId) return;
    try {
      await reloadAuthoritativeOrder(orderId, selectedLineId);
    } catch {
      /* keep prior UI; feedback already shown */
    }
  };

  const onSelectSlot = async (slot: ResolvedPosSlot) => {
    if (!order || order.status !== 'OPEN') {
      setFeedback('Open an order first');
      return;
    }
    if (liveSettlement) {
      setFeedback('Checkout active — abort checkout to edit the order');
      return;
    }
    if (slot.state !== 'ACTIVE') return;
    if ((slot.modifierGroups?.length ?? 0) > 0) {
      setModifierSlot(slot);
      return;
    }
    if (slot.quantityEntry === 'DEFERRED_WEIGHTED') {
      setQuantityModifierSelections([]);
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
        applyOrder(result.order, selectedLineId);
        await reloadCommercial(result.order.orderId);
      } catch (err) {
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

  const addSlotWithModifiers = async (
    slot: ResolvedPosSlot,
    modifierSelections: Array<{ groupId: string; optionIds: string[] }>,
  ) => {
    if (!order) return;
    await withMutationGuard(async () => {
      setSelectingSlotId(slot.layoutPublicationSlotId);
      try {
        if (slot.quantityEntry === 'DEFERRED_WEIGHTED') {
          setQuantityModifierSelections(modifierSelections);
          setModifierSlot(null);
          setQuantitySlot(slot);
          return;
        }
        const result = await posApi.selectCountTap({
          ...salesPayload(context),
          orderId: order.orderId,
          layoutPublicationSlotId: slot.layoutPublicationSlotId,
          modifierSelections,
        });
        applyOrder(result.order, selectedLineId);
        await reloadCommercial(result.order.orderId);
        setModifierSlot(null);
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'NETWORK';
        const message = err instanceof Error ? err.message : 'Modifier selection failed';
        setFeedback(`${code}: ${message}`);
      } finally {
        setSelectingSlotId(null);
      }
    });
  };

  const onConfirmWeighted = async (quantity: string) => {
    if (!order || !quantitySlot) return;
    const slot = quantitySlot;
    await withMutationGuard(async () => {
      setSelectingSlotId(slot.layoutPublicationSlotId);
      try {
        const result = await posApi.selectQuantityTap({
          ...salesPayload(context),
          orderId: order.orderId,
          layoutPublicationSlotId: slot.layoutPublicationSlotId,
          quantity,
          ...(quantityModifierSelections.length > 0 ? { modifierSelections: quantityModifierSelections } : {}),
        });
        applyOrder(result.order, selectedLineId);
        await reloadCommercial(result.order.orderId);
        setQuantitySlot(null);
        setQuantityModifierSelections([]);
      } catch (err) {
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
        const next = await posApi.openSettlement(order.orderId, {
          idempotencyKey: `open-settlement:${order.orderId}:${Date.now()}`,
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

  const onCashPay = (tenderedMinor: string) => {
    if (!order || !settlement) return;
    void withMutationGuard(async () => {
      try {
        const result = await posApi.checkoutCash(order.orderId, {
          cashShiftId: context.cashShiftId,
          tenderedMinor,
          idempotencyKey: `cash-checkout:${order.orderId}`,
          actorId: context.cashierId,
          deviceId: context.deviceId,
        });
        setCashResult(result);
        applyOrder(result.order, null);
        setSettlement(settlement);
        setFeedback('Cash accepted. Order submitted; production tasks created.');
      } catch (err) {
        await handleMutationError(err, order.orderId);
      }
    });
  };

  return (
    <div className="pos-shell">
      <header className="pos-shell__header">
        <div className="pos-shell__brand">
          <span className="pos-shell__kiu">KiU</span>
          <span className="pos-shell__outlet">{context.outletName}</span>
          <span className="pos-shell__dev" title="Development context bootstrap — not production auth">
            DEV context
          </span>
        </div>
        <div className="pos-shell__actions">
          <button type="button" className="pos-shell__btn" onClick={() => void loadSurface()} disabled={surfaceLoading}>
            Refresh surface
          </button>
          <button type="button" className="pos-shell__btn" onClick={onChangeContext}>
            Change context
          </button>
        </div>
      </header>

      {feedback && (
        <div className="pos-shell__feedback" role="status">
          {feedback}
        </div>
      )}

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
            onSelectLine={setSelectedLineId}
            onUpdateQuantity={onUpdateQuantity}
            onRemoveLine={onRemoveLine}
            onRefreshPrices={onRefreshPrices}
            onAcceptCurrentPrices={onAcceptCurrentPrices}
            onOpenCheckout={onOpenCheckout}
            onAbortCheckout={onAbortCheckout}
            cashResult={cashResult}
            onCashPay={onCashPay}
            onCancelOrder={onCancelOrder}
            onNewOrder={() => {
              setOrder(null);
              setSettlement(null);
            }}
          />
        </div>
      ) : null}

      {quantitySlot && (
        <QuantityEntryModal
          slot={quantitySlot}
          busy={mutationBusy}
          onCancel={() => { setQuantitySlot(null); setQuantityModifierSelections([]); }}
          onConfirm={(q) => void onConfirmWeighted(q)}
        />
      )}
      {modifierSlot && (
        <ModifierSelectionModal
          slot={modifierSlot}
          busy={mutationBusy}
          onCancel={() => setModifierSlot(null)}
          onConfirm={(selections) => void addSlotWithModifiers(modifierSlot, selections)}
        />
      )}
    </div>
  );
}
