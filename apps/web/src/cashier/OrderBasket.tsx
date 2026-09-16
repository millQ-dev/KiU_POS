import type {
  CommercialStatus as CommercialStatusDto,
  MenuPriceResolution,
  OrderBasket,
  OrderLine,
} from '../api/types.js';
import { CommercialStatusPanel } from './CommercialStatus.js';
import { OrderLineEditor } from './OrderLineEditor.js';
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
  onSelectLine: (lineId: string | null) => void;
  onUpdateQuantity: (line: OrderLine, quantity: string) => void;
  onRemoveLine: (line: OrderLine) => void;
  onRefreshPrices: () => void;
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
  onSelectLine,
  onUpdateQuantity,
  onRemoveLine,
  onRefreshPrices,
  onCancelOrder,
  onNewOrder,
}: Props) {
  const selected = order?.lines.find((l) => l.orderLineId === selectedLineId) ?? null;

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
        editable={editable && !!order}
        onRefreshPrices={onRefreshPrices}
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
          No invented line / order totals. Commercial acceptance needs explicit gross (OPTION A;
          ADR-0030 reserved). No pay in this shell.
        </p>
      </footer>
    </aside>
  );
}
