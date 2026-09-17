import { useEffect, useState } from 'react';
import type { CashCheckoutResult, SettlementProjection } from '../api/types.js';
import { formatMoneyDisplay } from '../money/formatMoneyDisplay.js';
import { posCopy, type PosLanguage } from './posCopy.js';
import './CashPaymentPanel.css';

type Props = {
  settlement: SettlementProjection;
  busy: boolean;
  result: CashCheckoutResult | null;
  language?: PosLanguage;
  onPay: (tenderedMinor: string) => void;
};

export function CashPaymentPanel({ settlement, busy, result, language = 'ru', onPay }: Props) {
  const [tendered, setTendered] = useState(settlement.customerPayableMinor);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTendered(settlement.customerPayableMinor);
    setError(null);
  }, [settlement.customerPayableMinor]);

  if (result) {
    return (
      <section className="pos-cash-payment pos-cash-payment--success" aria-label={posCopy(language, 'paymentAccepted')}>
        <p className="pos-cash-payment__eyebrow">{posCopy(language, 'paymentAccepted')}</p>
        <h4>{posCopy(language, 'cash')} · {formatMoneyDisplay({ amountMinor: result.payment.amount_minor, currencyCode: result.payment.currency_code, minorUnitExponent: result.receipt.minorUnitExponent })}</h4>
        <dl>
          <div><dt>{posCopy(language, 'received')}</dt><dd>{result.payment.tendered_minor} {result.payment.currency_code}</dd></div>
          <div><dt>{posCopy(language, 'change')}</dt><dd>{result.payment.change_minor} {result.payment.currency_code}</dd></div>
          <div><dt>{posCopy(language, 'orderState')}</dt><dd>{result.order.status}</dd></div>
          <div><dt>{posCopy(language, 'kitchen')}</dt><dd>{result.productionTasks.length ? posCopy(language, 'inProgress') : posCopy(language, 'noProductionItems')}</dd></div>
        </dl>
        <details className="pos-cash-payment__receipt">
          <summary>{posCopy(language, 'receiptPreview')}</summary>
          <div className="pos-cash-payment__receipt-body">
            <div className="pos-cash-payment__receipt-meta">
              <strong>#{result.receipt.orderId.slice(0, 8)}</strong>
              <span>{new Date(result.receipt.issuedAt).toLocaleString()}</span>
            </div>
            <ul className="pos-cash-payment__receipt-lines">
              {result.receipt.lines.map((line) => (
                <li key={line.order_line_id}>
                  <div><span>{line.quantity} × {line.catalog_item_name}</span><strong>{formatMoneyDisplay({ amountMinor: line.gross_merchandise_minor, currencyCode: result.receipt.currencyCode, minorUnitExponent: result.receipt.minorUnitExponent })}</strong></div>
                  {line.modifiers.length > 0 && <small>{line.modifiers.map((modifier) => `${modifier.group}: ${modifier.option}`).join(' · ')}</small>}
                </li>
              ))}
            </ul>
            <dl className="pos-cash-payment__receipt-total">
              <div><dt>{posCopy(language, 'total')}</dt><dd>{formatMoneyDisplay({ amountMinor: result.receipt.totalMinor, currencyCode: result.receipt.currencyCode, minorUnitExponent: result.receipt.minorUnitExponent })}</dd></div>
              <div><dt>{posCopy(language, 'received')}</dt><dd>{formatMoneyDisplay({ amountMinor: result.receipt.cashTenderedMinor, currencyCode: result.receipt.currencyCode, minorUnitExponent: result.receipt.minorUnitExponent })}</dd></div>
              <div><dt>{posCopy(language, 'change')}</dt><dd>{formatMoneyDisplay({ amountMinor: result.receipt.changeMinor, currencyCode: result.receipt.currencyCode, minorUnitExponent: result.receipt.minorUnitExponent })}</dd></div>
            </dl>
          </div>
        </details>
      </section>
    );
  }

  const submit = () => {
    const value = tendered.trim();
    if (!/^\d+$/.test(value) || BigInt(value) < BigInt(settlement.customerPayableMinor)) {
      setError(posCopy(language, 'receivedMustCover'));
      return;
    }
    onPay(value);
  };

  return (
      <section className="pos-cash-payment" aria-label={posCopy(language, 'cash')}>
      <div className="pos-cash-payment__method"><strong>{posCopy(language, 'cash')}</strong><span>{posCopy(language, 'due')} {settlement.customerPayableMinor} {settlement.currencyCode}</span></div>
      <label>{posCopy(language, 'cashReceived')}
        <input value={tendered} inputMode="numeric" disabled={busy} onChange={(event) => { setTendered(event.target.value.replace(/\D/g, '')); setError(null); }} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} />
      </label>
      {error && <p className="pos-cash-payment__error" role="alert">{error}</p>}
      <button type="button" className="pos-cash-payment__pay" onClick={submit} disabled={busy}>{posCopy(language, 'takeCashAndSubmit')}</button>
      <p className="pos-cash-payment__note">{posCopy(language, 'paymentNote')}</p>
    </section>
  );
}
