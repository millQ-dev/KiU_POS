import { useCallback, useEffect, useMemo, useState } from 'react';
import { sessionFetch } from '../api/sessionClient.js';
import type { SettlementProjection } from '../api/types.js';
import {
  allocateTerminalBusinessChronology,
  clearLockedCompleteChronology,
  loadLockedCompleteChronology,
  loadOrCreateDurableCompleteIdempotencyKey,
  persistLockedCompleteChronology,
  TerminalChronologyError,
} from './terminalBusinessChronology.js';
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

type FiscalGateView = {
  status: string;
  detail?: string | undefined;
  fiscalAdapterMode?: string | undefined;
};

type FiscalDocView = {
  fiscalDocumentId: string;
  status: string;
  paymentId: string;
  paymentCollectionEventId: string;
  taxOrderSnapshotId: string;
};

type CompleteResultView = {
  orderId: string;
  status: string;
  businessDate: string;
  businessOrder: number;
  goodsIssueId: string | null;
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
  /** IANA timezone for terminal businessDate (ADR-0003 device chronology). */
  outletTimeZone?: string | null | undefined;
  onOpenCheckout: () => void;
  onAbortCheckout: () => void;
  /** Reload Settlement from server after ReceiveCash SUCCESS. */
  onSettlementRefresh: () => Promise<void>;
  /** After CompleteOrder SUCCESS — parent starts a new editable basket. */
  onOrderCompleted?: ((result: CompleteResultView) => void) | undefined;
};

const IDEMPOTENCY_PREFIX = 'millq.receiveCashIdempotency.';
const ISSUE_KEY_PREFIX = 'millq.fiscalIssueIdempotency.';
const COMPLETE_KEY_PREFIX = 'millq.completeOrderIdempotency.';

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

function loadOrCreateKeyed(prefix: string, id: string): string {
  const storageKey = `${prefix}${id}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && existing.length >= 8) return existing;
  } catch {
    /* ignore */
  }
  const next = `${prefix.slice(6, 10)}-${id}-${crypto.randomUUID()}`.slice(0, 128);
  try {
    sessionStorage.setItem(storageKey, next);
  } catch {
    /* ignore */
  }
  return next;
}

function clearKeyed(prefix: string, id: string): void {
  try {
    sessionStorage.removeItem(`${prefix}${id}`);
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
  outletTimeZone = 'Asia/Ho_Chi_Minh',
  onOpenCheckout,
  onAbortCheckout,
  onSettlementRefresh,
  onOrderCompleted,
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
  const paymentSatisfied = !!live && live.state === 'SATISFIED';

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

  const [fiscalGate, setFiscalGate] = useState<FiscalGateView | null>(null);
  const [fiscalDoc, setFiscalDoc] = useState<FiscalDocView | null>(null);
  const [fiscalBusy, setFiscalBusy] = useState(false);
  const [fiscalError, setFiscalError] = useState<string | null>(null);
  const [fiscalUnknown, setFiscalUnknown] = useState<string | null>(null);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completeUnknown, setCompleteUnknown] = useState<string | null>(null);
  const [completeResult, setCompleteResult] = useState<CompleteResultView | null>(null);
  /** Chronology locked after first Complete attempt — UNKNOWN/reload retry must reuse it. */
  const [lockedChronology, setLockedChronology] = useState<{
    businessDate: string;
    businessOrder: number;
  } | null>(() =>
    live ? loadLockedCompleteChronology(live.settlementGroupId) : null,
  );

  const receiveKey = useMemo(
    () => (primaryCheck ? loadOrCreateReceiveKey(primaryCheck.settlementCheckId) : ''),
    [primaryCheck?.settlementCheckId],
  );

  const issueKey = useMemo(
    () => (live ? loadOrCreateKeyed(ISSUE_KEY_PREFIX, live.settlementGroupId) : ''),
    [live?.settlementGroupId],
  );

  const [completeKey, setCompleteKey] = useState('');
  const [completeKeyError, setCompleteKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      setCompleteKey('');
      setCompleteKeyError(null);
      return;
    }
    try {
      setCompleteKey(loadOrCreateDurableCompleteIdempotencyKey(live.settlementGroupId));
      setCompleteKeyError(null);
    } catch (err) {
      setCompleteKey('');
      setCompleteKeyError(
        err instanceof TerminalChronologyError
          ? err.message
          : 'sessionStorage unavailable for CompleteOrder idempotency',
      );
    }
  }, [live?.settlementGroupId]);

  useEffect(() => {
    if (!live) {
      setLockedChronology(null);
      return;
    }
    const persisted = loadLockedCompleteChronology(live.settlementGroupId);
    if (persisted) setLockedChronology(persisted);
  }, [live?.settlementGroupId]);

  const refreshFiscalGate = useCallback(async () => {
    if (!live) {
      setFiscalGate(null);
      return;
    }
    try {
      const res = await sessionFetch(
        `/api/v1/settlements/${encodeURIComponent(live.settlementGroupId)}/fiscal-gate`,
      );
      const body = (await res.json()) as {
        gate?: FiscalGateView;
        fiscalAdapterMode?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setFiscalGate({
          status: 'UNAVAILABLE',
          detail: body.message ?? body.error ?? `HTTP_${res.status}`,
        });
        return;
      }
      setFiscalGate({
        status: body.gate?.status ?? 'UNAVAILABLE',
        ...(body.gate?.detail != null ? { detail: body.gate.detail } : {}),
        ...(body.fiscalAdapterMode != null
          ? { fiscalAdapterMode: body.fiscalAdapterMode }
          : {}),
      });
    } catch {
      setFiscalGate({
        status: 'UNAVAILABLE',
        detail: 'Fiscal gate observation failed — do not assume SATISFIED',
      });
    }
  }, [live?.settlementGroupId]);

  useEffect(() => {
    if (!paymentSatisfied || completeResult) return;
    void refreshFiscalGate();
  }, [paymentSatisfied, live?.settlementGroupId, live?.version, completeResult, refreshFiscalGate]);

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

  async function submitIssueFiscal() {
    if (!live || !paymentSatisfied || fiscalBusy || completeResult) return;
    setFiscalBusy(true);
    setFiscalError(null);
    setFiscalUnknown(null);
    try {
      const res = await sessionFetch('/api/v1/fiscal/documents/issue', {
        method: 'POST',
        body: JSON.stringify({
          settlementGroupId: live.settlementGroupId,
          issueIdempotencyKey: issueKey,
        }),
      });
      let body: FiscalDocView & { error?: string; message?: string };
      try {
        body = (await res.json()) as FiscalDocView & { error?: string; message?: string };
      } catch {
        setFiscalUnknown('Issue response was not JSON — do not assume SATISFIED. Retry same key.');
        return;
      }
      if (res.ok && body.fiscalDocumentId) {
        setFiscalDoc({
          fiscalDocumentId: body.fiscalDocumentId,
          status: body.status,
          paymentId: body.paymentId,
          paymentCollectionEventId: body.paymentCollectionEventId,
          taxOrderSnapshotId: body.taxOrderSnapshotId,
        });
        await refreshFiscalGate();
        return;
      }
      const code = body.error ?? `HTTP_${res.status}`;
      if (res.status >= 500 || res.status === 0) {
        setFiscalUnknown(body.message ?? code);
        return;
      }
      setFiscalError(body.message ?? code);
    } catch {
      setFiscalUnknown(
        'Network or timeout on fiscal issue — do not assume SATISFIED. Retry same idempotency key.',
      );
    } finally {
      setFiscalBusy(false);
    }
  }

  async function submitReconcileFiscal() {
    if (!fiscalDoc || fiscalBusy) return;
    setFiscalBusy(true);
    setFiscalError(null);
    setFiscalUnknown(null);
    try {
      const res = await sessionFetch(
        `/api/v1/fiscal/documents/${encodeURIComponent(fiscalDoc.fiscalDocumentId)}/reconcile`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      let body: { status?: string; error?: string; message?: string };
      try {
        body = (await res.json()) as { status?: string; error?: string; message?: string };
      } catch {
        setFiscalUnknown('Reconcile response was not JSON — retry same document.');
        return;
      }
      if (res.ok && body.status) {
        setFiscalDoc({ ...fiscalDoc, status: body.status });
        await refreshFiscalGate();
        return;
      }
      if (res.status >= 500) {
        setFiscalUnknown(body.message ?? body.error ?? `HTTP_${res.status}`);
        return;
      }
      setFiscalError(body.message ?? body.error ?? `HTTP_${res.status}`);
    } catch {
      setFiscalUnknown('Network on reconcile — retry; never forge SATISFIED.');
    } finally {
      setFiscalBusy(false);
    }
  }

  async function submitCompleteOrder() {
    if (!live || !terminalId || completeBusy || completeResult) return;
    if (fiscalGate?.status !== 'SATISFIED' && fiscalGate?.status !== 'NOT_REQUIRED') {
      setCompleteError('CompleteOrder requires server FiscalCheckoutGate SATISFIED (or NOT_REQUIRED).');
      return;
    }
    if (!completeKey || completeKeyError) {
      setCompleteError(
        completeKeyError ??
          'CompleteOrder idempotency key unavailable; refuse unsafe retry without durable sessionStorage',
      );
      return;
    }
    setCompleteBusy(true);
    setCompleteError(null);
    setCompleteUnknown(null);
    let chrono = lockedChronology ?? loadLockedCompleteChronology(live.settlementGroupId);
    try {
      if (!chrono) {
        chrono = await allocateTerminalBusinessChronology({
          terminalId,
          timeZone: outletTimeZone || 'Asia/Ho_Chi_Minh',
        });
      }
      // Persist before network — if sessionStorage fails, do not call CompleteOrder
      // (reload would otherwise mint a new key/chronology while a prior attempt may exist).
      persistLockedCompleteChronology(live.settlementGroupId, chrono);
      setLockedChronology(chrono);
    } catch (err) {
      const msg =
        err instanceof TerminalChronologyError
          ? err.message
          : 'Could not allocate terminal businessOrder';
      setCompleteError(msg);
      setCompleteBusy(false);
      return;
    }
    try {
      const res = await sessionFetch(
        `/api/v1/settlements/${encodeURIComponent(live.settlementGroupId)}/advance-checkout`,
        {
          method: 'POST',
          body: JSON.stringify({
            completeIdempotencyKey: completeKey,
            businessDate: chrono.businessDate,
            businessOrder: chrono.businessOrder,
            deviceId: terminalId,
          }),
        },
      );
      let body: {
        completion?: {
          orderId?: string;
          status?: string;
          goodsIssueId?: string;
          order?: { orderId: string; status: string };
        };
        fiscal?: { status: string };
        error?: string;
        message?: string;
      };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        setCompleteUnknown(
          'Complete response was not JSON — do not assume GoodsIssue. Retry same key and chronology.',
        );
        return;
      }
      const orderId = body.completion?.order?.orderId ?? body.completion?.orderId;
      const orderStatus = body.completion?.order?.status ?? body.completion?.status;
      if (res.ok && orderId && orderStatus) {
        clearKeyed(ISSUE_KEY_PREFIX, live.settlementGroupId);
        clearKeyed(COMPLETE_KEY_PREFIX, live.settlementGroupId);
        clearLockedCompleteChronology(live.settlementGroupId);
        const result: CompleteResultView = {
          orderId,
          status: orderStatus,
          businessDate: chrono.businessDate,
          businessOrder: chrono.businessOrder,
          goodsIssueId: body.completion?.goodsIssueId ?? null,
        };
        setCompleteResult(result);
        setLockedChronology(null);
        onOrderCompleted?.(result);
        return;
      }
      const code = body.error ?? `HTTP_${res.status}`;
      if (
        code === 'CHECKOUT_FISCAL_PREREQUISITE_PENDING' ||
        code === 'CHECKOUT_FISCAL_PREREQUISITE_UNAVAILABLE'
      ) {
        setCompleteError(body.message ?? code);
        await refreshFiscalGate();
        return;
      }
      if (res.status >= 500 || res.status === 0) {
        setCompleteUnknown(body.message ?? code);
        return;
      }
      setCompleteError(body.message ?? code);
      // Non-unknown validation failures unlock chronology for a corrected retry.
      if (code !== 'IDEMPOTENCY_CONFLICT') {
        setLockedChronology(null);
        clearLockedCompleteChronology(live.settlementGroupId);
      }
    } catch {
      setCompleteUnknown(
        'Network or timeout on CompleteOrder — do not assume GoodsIssue. Retry same key and chronology.',
      );
    } finally {
      setCompleteBusy(false);
    }
  }

  const fiscalSatisfied =
    fiscalGate?.status === 'SATISFIED' || fiscalGate?.status === 'NOT_REQUIRED';
  const canComplete =
    paymentSatisfied &&
    fiscalSatisfied &&
    !!terminalId &&
    !!completeKey &&
    !completeKeyError &&
    !completeBusy &&
    !fiscalBusy &&
    !busy &&
    !completeResult;

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

          {live.state === 'SATISFIED' ? (
            <p className="pos-settlement__zero" data-testid="settlement-satisfied">
              Settlement SATISFIED — payment coverage complete. Fiscal evidence required before
              CompleteOrder.
            </p>
          ) : null}

          {paymentSatisfied && !completeResult ? (
            <div className="pos-settlement__fiscal" data-testid="fiscal-checkout-panel">
              <h4 className="pos-settlement__receive-title">Fiscal document</h4>
              <p className="pos-settlement__hint">
                Payment confirmed. Fiscal SUCCESS is only authoritative when the server
                FiscalCheckoutGate returns SATISFIED — the client never forges fiscal state.
              </p>
              {fiscalGate ? (
                <p role="status" data-testid="fiscal-gate-status">
                  Gate: {fiscalGate.status}
                  {fiscalGate.fiscalAdapterMode
                    ? ` · adapter ${fiscalGate.fiscalAdapterMode}`
                    : ''}
                  {fiscalGate.detail ? ` — ${fiscalGate.detail}` : ''}
                </p>
              ) : (
                <p role="status" data-testid="fiscal-gate-loading">
                  Observing FiscalCheckoutGate…
                </p>
              )}
              {fiscalGate &&
              (fiscalGate.status === 'UNAVAILABLE' ||
                fiscalGate.status === 'REQUIRED_NOT_SATISFIED' ||
                fiscalGate.status === 'PENDING') &&
              !fiscalSatisfied ? (
                <p
                  className="pos-settlement__waiting"
                  role="status"
                  data-testid="fiscal-gate-blocked"
                >
                  Fiscal not SATISFIED — CompleteOrder remains fail-closed.
                </p>
              ) : null}
              {fiscalDoc ? (
                <dl className="pos-settlement__facts" data-testid="fiscal-document-facts">
                  <div>
                    <dt>FiscalDocument</dt>
                    <dd data-testid="fiscal-document-id">{fiscalDoc.fiscalDocumentId}</dd>
                  </div>
                  <div>
                    <dt>Doc status</dt>
                    <dd data-testid="fiscal-document-status">{fiscalDoc.status}</dd>
                  </div>
                  <div>
                    <dt>Payment / PCE</dt>
                    <dd>
                      {fiscalDoc.paymentId} / {fiscalDoc.paymentCollectionEventId}
                    </dd>
                  </div>
                  <div>
                    <dt>Tax snapshot</dt>
                    <dd>{fiscalDoc.taxOrderSnapshotId}</dd>
                  </div>
                </dl>
              ) : null}
              {fiscalError ? (
                <p role="alert" data-testid="fiscal-error">
                  {fiscalError}
                </p>
              ) : null}
              {fiscalUnknown ? (
                <p role="status" data-testid="fiscal-unknown">
                  UNKNOWN — {fiscalUnknown}
                </p>
              ) : null}
              {!fiscalSatisfied ? (
                <button
                  type="button"
                  className="pos-settlement__open"
                  data-testid="fiscal-issue-submit"
                  disabled={fiscalBusy || busy || !!completeResult}
                  onClick={() => void submitIssueFiscal()}
                >
                  {fiscalBusy
                    ? 'Issuing…'
                    : fiscalUnknown
                      ? 'Retry issue fiscal'
                      : fiscalDoc
                        ? 'Re-issue / resume fiscal'
                        : 'Issue fiscal document'}
                </button>
              ) : null}
              {fiscalDoc &&
              (fiscalDoc.status === 'PENDING_ISSUE' ||
                fiscalDoc.status === 'ISSUED_PENDING_EVIDENCE' ||
                fiscalUnknown) ? (
                <button
                  type="button"
                  className="pos-settlement__abort"
                  data-testid="fiscal-reconcile-submit"
                  disabled={fiscalBusy || busy}
                  onClick={() => void submitReconcileFiscal()}
                >
                  Reconcile fiscal evidence
                </button>
              ) : null}
              {fiscalSatisfied ? (
                <p role="status" data-testid="fiscal-gate-satisfied">
                  FiscalCheckoutGate {fiscalGate?.status} — CompleteOrder unlocked by server.
                </p>
              ) : null}
            </div>
          ) : null}

          {paymentSatisfied && fiscalSatisfied && !completeResult ? (
            <div className="pos-settlement__complete" data-testid="complete-order-panel">
              <h4 className="pos-settlement__receive-title">Complete order</h4>
              <p className="pos-settlement__hint">
                Advances via CheckoutOrchestrator after fiscal gate. Inventory GoodsIssue is
                server-owned — double-click must not create a second issue.
              </p>
              {lockedChronology ? (
                <p className="pos-settlement__hint" data-testid="complete-chronology-locked">
                  Chronology locked for retry: {lockedChronology.businessDate} #
                  {lockedChronology.businessOrder}
                </p>
              ) : null}
              {completeKeyError ? (
                <p role="alert" data-testid="complete-storage-error">
                  {completeKeyError}
                </p>
              ) : null}
              {completeError ? (
                <p role="alert" data-testid="complete-error">
                  {completeError}
                </p>
              ) : null}
              {completeUnknown ? (
                <p role="status" data-testid="complete-unknown">
                  UNKNOWN — {completeUnknown}
                </p>
              ) : null}
              <button
                type="button"
                className="pos-settlement__open"
                data-testid="complete-order-submit"
                disabled={!canComplete}
                onClick={() => void submitCompleteOrder()}
              >
                {completeBusy
                  ? 'Completing…'
                  : completeUnknown
                    ? 'Retry complete order'
                    : 'Complete order'}
              </button>
            </div>
          ) : null}

          {completeResult ? (
            <div className="pos-settlement__success" data-testid="complete-order-success">
              <h4>Order completed (server)</h4>
              <dl className="pos-settlement__facts">
                <div>
                  <dt>Order</dt>
                  <dd data-testid="complete-order-id">{completeResult.orderId}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd data-testid="complete-order-status">{completeResult.status}</dd>
                </div>
                <div>
                  <dt>Business chronology</dt>
                  <dd data-testid="complete-business-chronology">
                    {completeResult.businessDate} #{completeResult.businessOrder}
                  </dd>
                </div>
                {completeResult.goodsIssueId ? (
                  <div>
                    <dt>GoodsIssue</dt>
                    <dd data-testid="complete-goods-issue-id">{completeResult.goodsIssueId}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          {live.state === 'COLLECTING' ? (
            <button
              type="button"
              className="pos-settlement__abort"
              data-testid="abort-checkout"
              disabled={busy || receiveBusy || fiscalBusy || completeBusy}
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
