import type {
  CommercialStatus as CommercialStatusDto,
  MenuPriceResolution,
  OrderBasket,
  OrderLine,
  SettlementProjection,
} from '../api/types.js';
import { CommercialStatusPanel } from './CommercialStatus.js';
import { OrderLineEditor } from './OrderLineEditor.js';
import { SettlementCheckoutPanel } from './SettlementCheckout.js';
import './OrderBasket.css';

type Props = {
  order: OrderBasket | null;
  loading: boolean;
  selectedLineId: string | null;
  mutationBusy: boolean;
  editable: boolean;
  commercial: CommercialStatusDto | null;
  priceResolution: MenuPriceResolution | null;
  refreshingPrices: boolean;
  acceptingCommercial: boolean;
  settlement: SettlementProjection | null;
  settlementBusy: boolean;
  onSelectLine: (lineId: string | null) => void;
  onUpdateQuantity: (line: OrderLine, quantity: string) => void;
  onRemoveLine: (line: OrderLine) => void;
  onRefreshPrices: () => void;
  onAcceptCurrentPrices: () => void;
  onOpenCheckout: () => void;
  onAbortCheckout: () => void;
  onCancelOrder: () => void;
  onNewOrder: () => void;
};

function formatQty(line: OrderLine): string {
  return `${line.quantity} ${line.unit}`;
}

export function OrderBasketPanel({
  order,
  loading,
  selectedLineId,
  mutationBusy,
  editable,
  commercial,
  priceResolution,
  refreshingPrices,
  acceptingCommercial,
  settlement,
  settlementBusy,
  onSelectLine,
  onUpdateQuantity,
  onRemoveLine,
  onRefreshPrices,
  onAcceptCurrentPrices,
  onOpenCheckout,
  onAbortCheckout,
  onCancelOrder,
  onNewOrder,
}: Props) {
  const selected = order?.lines.find((l) => l.orderLineId === selectedLineId) ?? null;
  const commercialAccepted = commercial?.commercialState === 'ACCEPTED';

  return (
    <aside className="pos-basket" aria-label="Order basket">
      <header className="pos-basket__header">
        <div>
          <h2 className="pos-basket__title">Basket</h2>
          {order ? (
            <p className="pos-basket__meta">
              {order.status} · {order.orderId.slice(0, 8)}
            </p>
          ) : (
            <p className="pos-basket__meta">No open order</p>
          )}
        </div>
        <button type="button" className="pos-basket__new" onClick={onNewOrder} disabled={loading}>
          New order
        </button>
      </header>

      {!order || order.lines.length === 0 ? (
        <p className="pos-basket__empty" role="status">
          Empty — tap a product to add
        </p>
      ) : (
        <ul className="pos-basket__lines" role="listbox" aria-label="Order lines">
          {order.lines.map((line) => {
            const selectedHere = line.orderLineId === selectedLineId;
            const acceptedLine =
              commercial?.commercialState === 'ACCEPTED'
                ? commercial.lines.find((l) => l.orderLineId === line.orderLineId)
                : undefined;
            return (
              <li key={line.orderLineId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedHere}
                  className={[
                    'pos-basket__line',
                    selectedHere ? 'pos-basket__line--selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelectLine(selectedHere ? null : line.orderLineId)}
                >
                  <span className="pos-basket__name">{line.catalogItemName}</span>
                  <span className="pos-basket__qty">{formatQty(line)}</span>
                  {acceptedLine ? (
                    <span className="pos-basket__gross">
                      {acceptedLine.grossMerchandiseMinor} {commercial?.currencyCode ?? ''}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="pos-basket__editor">
          <OrderLineEditor
            line={selected}
            busy={mutationBusy}
            editable={editable}
            onUpdateQuantity={(q) => onUpdateQuantity(selected, q)}
            onRemove={() => onRemoveLine(selected)}
          />
        </div>
      )}

      <CommercialStatusPanel
        status={commercial}
        priceResolution={priceResolution}
        refreshing={refreshingPrices}
        accepting={acceptingCommercial}
        editable={editable && !!order}
        onRefreshPrices={onRefreshPrices}
        onAcceptCurrentPrices={onAcceptCurrentPrices}
      />

      <SettlementCheckoutPanel
        settlement={settlement}
        commercialAccepted={!!commercialAccepted}
        editableOrder={editable && !!order}
        busy={mutationBusy || settlementBusy || loading}
        onOpenCheckout={onOpenCheckout}
        onAbortCheckout={onAbortCheckout}
      />

      <footer className="pos-basket__footer">
        {editable && order && (
          <button
            type="button"
            className="pos-basket__cancel"
            disabled={mutationBusy || loading}
            onClick={onCancelOrder}
          >
            Cancel order
          </button>
        )}
        <p className="pos-basket__note">
          Authoritative merchandise gross and Customer Payable come from backend. No frontend Money
          arithmetic. No Cash/Card/QR in this shell.
        </p>
      </footer>
    </aside>
  );
}
