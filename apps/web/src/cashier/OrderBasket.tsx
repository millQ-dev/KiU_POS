import type { OrderBasket } from '../api/types.js';
import './OrderBasket.css';

type Props = {
  order: OrderBasket | null;
  loading: boolean;
  onNewOrder: () => void;
};

export function OrderBasketPanel({ order, loading, onNewOrder }: Props) {
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
          Empty — tap a COUNT item to add
        </p>
      ) : (
        <ul className="pos-basket__lines">
          {order.lines.map((line) => (
            <li key={line.orderLineId} className="pos-basket__line">
              <span className="pos-basket__name">{line.catalogItemName}</span>
              <span className="pos-basket__qty">
                {line.quantity} {line.unit}
              </span>
            </li>
          ))}
        </ul>
      )}

      <footer className="pos-basket__footer">
        <p className="pos-basket__note">
          Unit prices shown on tiles. No line gross / pay in this shell (OPTION A; ADR-0030
          reserved).
        </p>
      </footer>
    </aside>
  );
}
