import { useEffect, useState } from 'react';
import type { CashCheckoutResult, SettlementProjection } from '../api/types.js';
import { formatMoneyDisplay } from '../money/formatMoneyDisplay.js';
import './CashPaymentPanel.css';

type Props = {
  settlement: SettlementProjection;
  busy: boolean;
  result: CashCheckoutResult | null;
  onPay: (tenderedMinor: string) => void;
};

export function CashPaymentPanel({ settlement, busy, result, onPay }: Props) {
  const [tendered, setTendered] = useState(settlement.customerPayableMinor);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTendered(settlement.customerPayableMinor);
    setError(null);
  }, [settlement.customerPayableMinor]);

  if (result) {
    return (
      <section className="pos-cash-payment pos-cash-payment--success" aria-label="Cash payment result">
        <p className="pos-cash-payment__eyebrow">Payment accepted</p>
        <h4>Cash · {formatMoneyDisplay({ amountMinor: result.payment.amount_minor, currencyCode: result.payment.currency_code, minorUnitExponent: result.receipt.minorUnitExponent })}</h4>
        <dl>
          <div><dt>Received</dt><dd>{result.payment.tendered_minor} {result.payment.currency_code}</dd></div>
          <div><dt>Change</dt><dd>{result.payment.change_minor} {result.payment.currency_code}</dd></div>
          <div><dt>Order state</dt><dd>{result.order.status}</dd></div>
          <div><dt>Kitchen</dt><dd>{result.productionTasks.length ? 'In progress' : 'No production items'}</dd></div>
        </dl>
        <details className="pos-cash-payment__receipt">
          <summary>Receipt preview</summary>
          <pre>{JSON.stringify(result.receipt, null, 2)}</pre>
        </details>
      </section>
    );
  }

  const submit = () => {
    const value = tendered.trim();
    if (!/^\d+$/.test(value) || BigInt(value) < BigInt(settlement.customerPayableMinor)) {
      setError('Received cash must cover the Customer Payable.');
      return;
    }
    onPay(value);
  };

  return (
    <section className="pos-cash-payment" aria-label="Cash payment">
      <div className="pos-cash-payment__method"><strong>Cash</strong><span>Due {settlement.customerPayableMinor} {settlement.currencyCode}</span></div>
      <label>Cash received (VND)
        <input value={tendered} inputMode="numeric" disabled={busy} onChange={(event) => { setTendered(event.target.value.replace(/\D/g, '')); setError(null); }} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} />
      </label>
      {error && <p className="pos-cash-payment__error" role="alert">{error}</p>}
      <button type="button" className="pos-cash-payment__pay" onClick={submit} disabled={busy}>Take cash and submit order</button>
      <p className="pos-cash-payment__note">Payment is recorded separately. The order is submitted after successful cash acceptance; kitchen tasks are created from Order Submitted.</p>
    </section>
  );
}
