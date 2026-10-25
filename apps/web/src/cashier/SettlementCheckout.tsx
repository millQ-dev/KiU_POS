import { useEffect, useMemo, useState } from 'react';
import { sessionFetch } from '../api/sessionClient.js';
import type { SettlementProjection } from '../api/types.js';
import './SettlementCheckout.css';

export type CashTenderOption = {
  tenderDefinitionId: string;
  code: string;
  displayName: string;
  instrumentFamily: string | null;
  enabled: boolean;
};

export type ReceiveCashSuccess = {
  payment: {
    paymentId: string;
    lifecycleState: string;
    requestedAmountMinor: string;
    currencyCode: string;
  };
  evidence: {
    paymentCashCollectionEvidenceId: string;
    amountDueMinor: string;
    amountTenderedMinor: string;
    changeMinor: string;
    currencyCode: string;
    acceptedAt: string;
  };
  collectionEvent: {
    paymentCollectionEventId: string;
    amountCollectedMinor: string;
    instrumentFamily: string;
    collectedAt: string;
  };
  duplicate: boolean;
};

type Props = {
  settlement: SettlementProjection | null;
  commercialAccepted: boolean;
  editableOrder: boolean;
  busy: boolean;
  /** Production terminal bound to OPEN CashShift — required for ReceiveCash. */
  terminalId?: string | null | undefined;
  legalEntityId?: string | null | undefined;
  /** Outlet scope for tender catalog (outlet-scoped pos.operate). */
  outletId?: string | null | undefined;
  onOpenCheckout: () => void;
  onAbortCheckout: () => void;
  /** Reload Settlement from server after ReceiveCash SUCCESS. */
  onSettlementRefresh: () => Promise<void>;
};

const IDEMPOTENCY_PREFIX = 'millq.receiveCashIdempotency.';

function loadOrCreateReceiveKey(checkId: string): string {
  const storageKey = `${IDEMPOTENCY_PREFIX}${checkId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && existing.length >= 8) return existing;
  } catch {
    /* ignore */
  }
  const next = `rcv-${checkId}-${crypto.randomUUID()}`.slice(0, 128);
  try {
    sessionStorage.setItem(storageKey, next);
  } catch {
    /* ignore */
  }
  return next;
}

function clearReceiveKey(checkId: string): void {
  try {
    sessionStorage.removeItem(`${IDEMPOTENCY_PREFIX}${checkId}`);
  } catch {
    /* ignore */
  }
}

/**
 * Settlement checkout + C0 ReceiveCash (ADR-0038) on production CashierShell.
 * Client never authors actor, collectedAt, amountCollected, payment/fiscal SUCCESS.
 */
export function SettlementCheckoutPanel({
  settlement,
  commercialAccepted,
  editableOrder,
  busy,
  terminalId,
  legalEntityId,
  outletId,
  onOpenCheckout,
  onAbortCheckout,
  onSettlementRefresh,
}: Props) {
  const live =
    settlement && (settlement.state === 'COLLECTING' || settlement.state === 'SATISFIED')
      ? settlement
      : null;

  const primaryCheck = live?.checks[0] ?? null;
  const dueMinor = primaryCheck?.outstandingAmountMinor ?? live?.outstandingAmountMinor ?? '0';
  const canCollect =
    !!live &&
    live.state === 'COLLECTING' &&
    dueMinor !== '0' &&
    !!terminalId &&
    !!legalEntityId &&
    !!outletId &&
    !!primaryCheck;

  const [tenders, setTenders] = useState<CashTenderOption[]>([]);
  const [tendersError, setTendersError] = useState<string | null>(null);
  const [tenderId, setTenderId] = useState<string>('');
  const [tenderedMinor, setTenderedMinor] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receiveErrorCode, setReceiveErrorCode] = useState<string | null>(null);
  const [unknownHint, setUnknownHint] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<ReceiveCashSuccess | null>(null);
  /** Locked payload after first submit — UNKNOWN retries must not change amount. */
  const [lockedTendered, setLockedTendered] = useState<string | null>(null);

  const receiveKey = useMemo(
    () => (primaryCheck ? loadOrCreateReceiveKey(primaryCheck.settlementCheckId) : ''),
    [primaryCheck?.settlementCheckId],
  );

  useEffect(() => {
    if (!canCollect || !legalEntityId || !outletId) {
      setTenders([]);
      setTenderId('');
      return;
    }
    let cancelled = false;
    void (async () => {
      setTendersError(null);
      try {
        const res = await sessionFetch(
          `/api/v1/payments/tenders?legalEntityId=${encodeURIComponent(legalEntityId)}&outletId=${encodeURIComponent(outletId)}&instrumentFamily=CASH`,
        );
        const body = (await res.json()) as { tenders?: CashTenderOption[]; error?: string; message?: string };
        if (!res.ok) {
          if (!cancelled) {
            setTenders([]);
            setTendersError(body.message ?? body.error ?? 'Tenders unavailable');
          }
          return;
        }
        const list = (body.tenders ?? []).filter((t) => t.enabled);
        if (!cancelled) {
          setTenders(list);
          setTenderId(list[0]?.tenderDefinitionId ?? '');
          if (list.length === 0) {
            setTendersError('No enabled CASH tender for this LegalEntity');
          }
        }
      } catch {
        if (!cancelled) {
          setTenders([]);
          setTendersError('Tenders unavailable');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canCollect, legalEntityId, outletId, live?.settlementGroupId]);

  const previewChange = useMemo(() => {
    if (!/^[0-9]+$/.test(tenderedMinor) || !/^[0-9]+$/.test(dueMinor)) return null;
    const t = BigInt(tenderedMinor);
    const d = BigInt(dueMinor);
    if (t < d) return null;
    return (t - d).toString();
  }, [tenderedMinor, dueMinor]);

  const amountForSubmit = lockedTendered ?? tenderedMinor;
  const tenderedCoversDue =
    /^[0-9]+$/.test(amountForSubmit) &&
    /^[0-9]+$/.test(dueMinor) &&
    BigInt(amountForSubmit) >= BigInt(dueMinor);
  const canSubmit =
    canCollect &&
    !!tenderId &&
    tenderedCoversDue &&
    confirmed &&
    !receiveBusy &&
    !busy &&
    (lockedTendered == null || lockedTendered === tenderedMinor);

  async function submitReceiveCash() {
    if (!canSubmit || !primaryCheck || !terminalId) return;
    if (lockedTendered != null && tenderedMinor !== lockedTendered) {
      setReceiveError(
        'Amount locked after UNKNOWN — retry the identical tendered amount with the same key, or resolve the prior attempt first.',
      );
      setReceiveErrorCode('AMOUNT_LOCKED');
      return;
    }
    setReceiveBusy(true);
    setReceiveError(null);
    setReceiveErrorCode(null);
    setUnknownHint(null);
    setLockedTendered(amountForSubmit);
    try {
      const res = await sessionFetch('/api/v1/payments/receive-cash', {
        method: 'POST',
        body: JSON.stringify({
          settlementCheckId: primaryCheck.settlementCheckId,
          tenderDefinitionId: tenderId,
          terminalId,
          receiveIdempotencyKey: receiveKey,
          amountTenderedMinor: amountForSubmit,
          humanConfirmation: true,
        }),
      });
      let body: ReceiveCashSuccess & { error?: string; message?: string };
      try {
        body = (await res.json()) as ReceiveCashSuccess & { error?: string; message?: string };
      } catch {
        setUnknownHint('Response was not JSON — do not assume success. Retry same key and amount.');
        return;
      }
      if (res.ok && body.payment?.paymentId && body.collectionEvent?.paymentCollectionEventId) {
        clearReceiveKey(primaryCheck.settlementCheckId);
        setLastSuccess(body);
        setLockedTendered(null);
        setTenderedMinor('');
        setConfirmed(false);
        await onSettlementRefresh();
        return;
      }
      const code = body.error ?? `HTTP_${res.status}`;
      setReceiveErrorCode(code);
      if (code === 'IDEMPOTENCY_CONFLICT') {
        setReceiveError(
          'ReceiveCash idempotency conflict: this key was used with different parameters. Do not change the tendered amount while retrying the same key.',
        );
        return;
      }
      if (res.status >= 500 || res.status === 0) {
        setUnknownHint(body.message ?? code);
        return;
      }
      setReceiveError(body.message ?? code);
      // Client validation failures unlock amount for correction (not after unknown commit).
      if (code !== 'IDEMPOTENCY_CONFLICT') {
        setLockedTendered(null);
      }
    } catch {
      setUnknownHint(
        'Network or timeout — do not assume success. Retry uses the same idempotency key and the same tendered amount.',
      );
    } finally {
      setReceiveBusy(false);
    }
  }

  return (
    <section className="pos-settlement" aria-label="Checkout settlement" data-testid="settlement-checkout">
      <h3 className="pos-settlement__title">Checkout</h3>
      {!live ? (
        <>
          <p className="pos-settlement__hint">
            Open checkout freezes Customer Payable from accepted merchandise terms.
          </p>
          <button
            type="button"
            className="pos-settlement__open"
            data-testid="open-checkout"
            disabled={!commercialAccepted || !editableOrder || busy}
            onClick={onOpenCheckout}
          >
            Open checkout
          </button>
        </>
      ) : (
        <>
          <p className="pos-settlement__state" role="status" data-testid="settlement-state">
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
              <dd data-testid="settlement-payable">
                {live.customerPayableMinor} {live.currencyCode}
              </dd>
            </div>
            <div>
              <dt>Settlement outstanding</dt>
              <dd data-testid="settlement-outstanding">
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
              <li key={c.settlementCheckId} data-testid={`settlement-check-${c.checkNumber}`}>
                Check {c.checkNumber}: payable {c.customerPayableMinor} {live.currencyCode} ·
                outstanding {c.outstandingAmountMinor}
              </li>
            ))}
          </ul>

          {canCollect ? (
            <div className="pos-settlement__receive" data-testid="receive-cash-panel">
              <h4 className="pos-settlement__receive-title">Receive cash</h4>
              <p className="pos-settlement__hint">
                Amount due (server): {dueMinor} {live.currencyCode}. Change is server-computed at
                confirm — preview below is informational only.
              </p>
              {tendersError ? (
                <p role="alert" data-testid="receive-tenders-error">
                  {tendersError}
                </p>
              ) : null}
              {tenders.length > 0 ? (
                <label>
                  CASH tender
                  <select
                    data-testid="receive-tender-select"
                    value={tenderId}
                    disabled={receiveBusy || lockedTendered != null}
                    onChange={(ev) => setTenderId(ev.target.value)}
                  >
                    {tenders.map((t) => (
                      <option key={t.tenderDefinitionId} value={t.tenderDefinitionId}>
                        {t.displayName} ({t.code})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Cash received from guest ({live.currencyCode})
                <input
                  data-testid="receive-tendered-input"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Enter amount received"
                  value={tenderedMinor}
                  disabled={receiveBusy || (lockedTendered != null && unknownHint != null)}
                  onChange={(ev) => {
                    if (lockedTendered != null && unknownHint != null) return;
                    setTenderedMinor(ev.target.value.replace(/\D/g, '').slice(0, 18));
                  }}
                />
              </label>
              {previewChange != null ? (
                <p className="pos-settlement__hint" data-testid="receive-change-preview">
                  Estimated change (UX only): {previewChange} {live.currencyCode}
                </p>
              ) : /^[0-9]+$/.test(tenderedMinor) && BigInt(tenderedMinor) < BigInt(dueMinor) ? (
                <p className="pos-settlement__waiting" role="status">
                  Tendered amount is less than due — partial tender not accepted in FISC1.1.
                </p>
              ) : null}
              <label className="pos-settlement__confirm">
                <input
                  type="checkbox"
                  data-testid="receive-human-confirm"
                  checked={confirmed}
                  disabled={receiveBusy}
                  onChange={(ev) => setConfirmed(ev.target.checked)}
                />
                I confirm cash was received and change (if any) was returned
              </label>
              {receiveError ? (
                <p role="alert" data-testid="receive-error">
                  {receiveError}
                </p>
              ) : null}
              {unknownHint ? (
                <p role="status" data-testid="receive-unknown">
                  UNKNOWN — {unknownHint}
                </p>
              ) : null}
              {receiveErrorCode === 'FORBIDDEN' ? (
                <p role="alert" data-testid="receive-forbidden">
                  Missing payments.receive_cash grant — sign in as an authorized operator.
                </p>
              ) : null}
              <button
                type="button"
                className="pos-settlement__open"
                data-testid="receive-cash-submit"
                disabled={!canSubmit}
                onClick={() => void submitReceiveCash()}
              >
                {receiveBusy
                  ? 'Receiving…'
                  : unknownHint
                    ? 'Retry receive cash'
                    : 'Confirm receive cash'}
              </button>
            </div>
          ) : null}

          {lastSuccess ? (
            <div className="pos-settlement__success" data-testid="receive-cash-success">
              <h4>Cash received (server)</h4>
              <dl className="pos-settlement__facts">
                <div>
                  <dt>Payment</dt>
                  <dd data-testid="receive-payment-id">{lastSuccess.payment.paymentId}</dd>
                </div>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{lastSuccess.payment.lifecycleState}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd data-testid="receive-evidence-id">
                    {lastSuccess.evidence.paymentCashCollectionEvidenceId}
                  </dd>
                </div>
                <div>
                  <dt>Due / Tendered / Change</dt>
                  <dd data-testid="receive-money-facts">
                    {lastSuccess.evidence.amountDueMinor} / {lastSuccess.evidence.amountTenderedMinor}{' '}
                    / {lastSuccess.evidence.changeMinor} {lastSuccess.evidence.currencyCode}
                  </dd>
                </div>
                <div>
                  <dt>PCE collected</dt>
                  <dd data-testid="receive-pce-collected">
                    {lastSuccess.collectionEvent.amountCollectedMinor}{' '}
                    {lastSuccess.collectionEvent.instrumentFamily}
                  </dd>
                </div>
                <div>
                  <dt>PCE id</dt>
                  <dd data-testid="receive-pce-id">
                    {lastSuccess.collectionEvent.paymentCollectionEventId}
                  </dd>
                </div>
              </dl>
              {lastSuccess.duplicate ? (
                <p className="pos-settlement__hint">Idempotent replay (duplicate=true)</p>
              ) : null}
            </div>
          ) : null}

          {live.state === 'COLLECTING' && dueMinor !== '0' && !terminalId ? (
            <p className="pos-settlement__waiting" role="status">
              ReceiveCash requires an OPEN CashShift terminal binding.
            </p>
          ) : null}

          {live.state === 'COLLECTING' || live.state === 'SATISFIED' ? (
            <p className="pos-settlement__fiscal" role="status" data-testid="fiscal-gate-blocked">
              Fiscal blocked: FiscalCheckoutGate UNAVAILABLE — CompleteOrder remains fail-closed. No
              fiscal success fabrication. Payment may be confirmed without unlocking CompleteOrder.
            </p>
          ) : null}
          {live.state === 'SATISFIED' ? (
            <p className="pos-settlement__zero" data-testid="settlement-satisfied">
              Settlement SATISFIED — payment coverage complete. CompleteOrder still blocked until
              fiscal evidence exists.
            </p>
          ) : null}
          {live.state === 'COLLECTING' ? (
            <button
              type="button"
              className="pos-settlement__abort"
              data-testid="abort-checkout"
              disabled={busy || receiveBusy}
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
