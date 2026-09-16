import type { SettlementProjection } from '../api/types.js';
import './SettlementCheckout.css';

type Props = {
  settlement: SettlementProjection | null;
  commercialAccepted: boolean;
  editableOrder: boolean;
  busy: boolean;
  onOpenCheckout: () => void;
  onAbortCheckout: () => void;
};

export function SettlementCheckoutPanel({
  settlement,
  commercialAccepted,
  editableOrder,
  busy,
  onOpenCheckout,
  onAbortCheckout,
}: Props) {
  const live =
    settlement && (settlement.state === 'COLLECTING' || settlement.state === 'SATISFIED')
      ? settlement
      : null;

  return (
    <section className="pos-settlement" aria-label="Checkout settlement">
      <h3 className="pos-settlement__title">Checkout</h3>
      {!live ? (
        <>
          <p className="pos-settlement__hint">
            Open checkout freezes Customer Payable from accepted merchandise terms. Cash is available
            for this first counter-service slice.
          </p>
          <button
            type="button"
            className="pos-settlement__open"
            disabled={!commercialAccepted || !editableOrder || busy}
            onClick={onOpenCheckout}
          >
            Open checkout
          </button>
        </>
      ) : (
        <>
          <p className="pos-settlement__state" role="status">
            Settlement {live.state}
          </p>
          <dl className="pos-settlement__facts">
            <div>
              <dt>Merchandise gross</dt>
              <dd>
                {live.merchandiseGrossMinor} {live.currencyCode}
              </dd>
            </div>
            <div>
              <dt>Customer payable</dt>
              <dd>
                {live.customerPayableMinor} {live.currencyCode}
              </dd>
            </div>
            <div>
              <dt>Settlement outstanding</dt>
              <dd>
                {live.outstandingAmountMinor} {live.currencyCode}
              </dd>
            </div>
            <div>
              <dt>Allocated</dt>
              <dd>
                {live.allocatedAmountMinor} {live.currencyCode}
              </dd>
            </div>
          </dl>
          <ul className="pos-settlement__checks" aria-label="Checks">
            {live.checks.map((c) => (
              <li key={c.settlementCheckId}>
                Check {c.checkNumber}: payable {c.customerPayableMinor} {live.currencyCode} ·
                outstanding {c.outstandingAmountMinor}
              </li>
            ))}
          </ul>
          {live.state === 'COLLECTING' && live.customerPayableMinor !== '0' ? (
            <p className="pos-settlement__waiting">Waiting for payment collection capability</p>
          ) : null}
          {live.state === 'SATISFIED' && live.customerPayableMinor === '0' ? (
            <p className="pos-settlement__zero">Zero payable — no fake Payment required</p>
          ) : null}
          {live.state === 'COLLECTING' ? (
            <button
              type="button"
              className="pos-settlement__abort"
              disabled={busy}
              onClick={onAbortCheckout}
            >
              Abort checkout / Back to edit
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
