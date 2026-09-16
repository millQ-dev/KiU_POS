import { useCallback, useEffect, useMemo, useState } from 'react';
import { posApi } from '../api/client.js';
import { ApiError } from '../api/types.js';
import type { CashierContext, OrderBasket, ResolvedPosSlot, ResolvedPosSurface } from '../api/types.js';
import { OrderBasketPanel } from './OrderBasket.js';
import { PosPageNavigation } from './PosPageNavigation.js';
import { ProductGrid } from './ProductGrid.js';
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
  const [feedback, setFeedback] = useState<string | null>(null);

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
    try {
      const created = await posApi.openOrder({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        outletId: context.outletId,
        channel: context.orderChannel || 'DIRECT',
      });
      setOrder(created);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open order';
      setFeedback(message);
    } finally {
      setOrderLoading(false);
    }
  }, [context]);

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

  const onSelectSlot = async (slot: ResolvedPosSlot) => {
    if (!order || order.status !== 'OPEN') {
      setFeedback('Open an order first');
      return;
    }
    if (slot.state !== 'ACTIVE' || slot.quantityEntry !== 'COUNT_ONE') return;
    setSelectingSlotId(slot.layoutPublicationSlotId);
    setFeedback(null);
    try {
      const result = await posApi.selectCountTap({
        ...salesPayload(context),
        orderId: order.orderId,
        layoutPublicationSlotId: slot.layoutPublicationSlotId,
      });
      setOrder(result.order);
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
    } finally {
      setSelectingSlotId(null);
    }
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
            onNewOrder={() => {
              setOrder(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
