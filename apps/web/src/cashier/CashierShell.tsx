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
} from '../api/types.js';
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
  const [quantitySlot, setQuantitySlot] = useState<ResolvedPosSlot | null>(null);
  const inFlightRef = useRef(false);

  const editable = order?.status === 'OPEN';

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

  const reloadAuthoritativeOrder = useCallback(
    async (orderId: string, preferLineId?: string | null) => {
      const next = await posApi.getOrder(orderId);
      applyOrder(next, preferLineId);
      await reloadCommercial(orderId);
      return next;
    },
    [applyOrder, reloadCommercial],
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
    try {
      const created = await posApi.openOrder({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        outletId: context.outletId,
        channel: context.orderChannel || 'DIRECT',
      });
      applyOrder(created, null);
      await reloadCommercial(created.orderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open order';
      setFeedback(message);
    } finally {
      setOrderLoading(false);
    }
  }, [context, applyOrder, reloadCommercial]);

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
        });
        applyOrder(result.order, selectedLineId);
        await reloadCommercial(result.order.orderId);
        setQuantitySlot(null);
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

      {!editable && order && (
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
            onSelectLine={setSelectedLineId}
            onUpdateQuantity={onUpdateQuantity}
            onRemoveLine={onRemoveLine}
            onRefreshPrices={onRefreshPrices}
            onCancelOrder={onCancelOrder}
            onNewOrder={() => {
              setOrder(null);
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
    </div>
  );
}
