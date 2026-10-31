import { useMemo, useRef, useState } from 'react';
import {
  sessionFetch,
  type ClosedCashShift,
  type OpenCashShift,
  type SessionUser,
} from '../api/sessionClient.js';
import type { TerminalTopology } from './buildCashierContext.js';
import type { CompanyRealm } from './CompanyIdentificationScreen.js';
import './ClosingCashScreen.css';

type Props = {
  user: SessionUser;
  realm: CompanyRealm;
  shift: OpenCashShift;
  terminal: TerminalTopology;
  /** After successful close — leave cashier context; Session stays. */
  onClosed: (closed: ClosedCashShift) => void;
  /** Abort close UI back to cashier (shift still OPEN). */
  onCancel: () => void;
  /** Sign out so Manager/Owner can authenticate (shortage grant) — real Session, not role spoof. */
  onSignOutForManager: () => void;
};

type Phase = 'count' | 'success' | 'unknown';

const IDEMPOTENCY_PREFIX = 'millq.closeIdempotency.';

function loadOrCreateIdempotencyKey(cashShiftId: string): string {
  const storageKey = `${IDEMPOTENCY_PREFIX}${cashShiftId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && existing.length >= 8) return existing;
  } catch {
    /* ignore */
  }
  const next = `close-${cashShiftId}-${crypto.randomUUID()}`.slice(0, 128);
  try {
    sessionStorage.setItem(storageKey, next);
  } catch {
    /* ignore */
  }
  return next;
}

function clearIdempotencyKey(cashShiftId: string): void {
  try {
    sessionStorage.removeItem(`${IDEMPOTENCY_PREFIX}${cashShiftId}`);
  } catch {
    /* ignore */
  }
}

/**
 * CASH1.2 CloseCashShift on production Cashier front door (POS-SHIFT pilot surface).
 * Not Mobile SH-02 PersonalShift placement — that remains a separate Mobile accepted screen.
 * Client never computes authoritative expected / actor / grants.
 */
export function ClosingCashScreen({
  user,
  realm,
  shift,
  terminal,
  onClosed,
  onCancel,
  onSignOutForManager,
}: Props) {
  /** Empty until the operator consciously enters a count — never pre-fill opening float. */
  const [actualMinor, setActualMinor] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [needReason, setNeedReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('count');
  const [closed, setClosed] = useState<ClosedCashShift | null>(null);
  const [unknownHint, setUnknownHint] = useState<string | null>(null);
  const pendingPayload = useRef<Record<string, unknown> | null>(null);
  const sending = useRef(false);

  const closeIdempotencyKey = useMemo(
    () => loadOrCreateIdempotencyKey(shift.cashShiftId),
    [shift.cashShiftId],
  );

  const countReady = /^[0-9]+$/.test(actualMinor);

  async function submitClose() {
    if (sending.current || busy || !countReady) return;
    const wasUnknown = phase === 'unknown';
    sending.current = true;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setUnknownHint(null);
    try {
      const payload: Record<string, unknown> = pendingPayload.current ?? {
        cashShiftId: shift.cashShiftId,
        closeIdempotencyKey,
        actualAmountMinor: actualMinor,
        currencyCode: shift.currencyCode,
        minorUnitExponent: shift.minorUnitExponent,
      };
      if (!pendingPayload.current && (needReason || reasonText.trim().length > 0)) {
        payload.reasonText = reasonText.trim();
      }
      pendingPayload.current = payload;
      const res = await sessionFetch('/api/v1/cash/shifts/close', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      let body: ClosedCashShift & { error?: string; message?: string };
      try {
        body = (await res.json()) as ClosedCashShift & { error?: string; message?: string };
      } catch {
        setPhase('unknown');
        setUnknownHint('Response was not JSON — do not assume success. Retry with the same key.');
        return;
      }

      const expectedActual = String(payload.actualAmountMinor);
      const actualMatches = typeof body?.actualAmountMinor === 'string' && /^\d+$/.test(body.actualAmountMinor) &&
        /^\d+$/.test(expectedActual) && BigInt(body.actualAmountMinor) === BigInt(expectedActual);
      if (res.ok && body.status === 'CLOSED' && body.cashShiftId === shift.cashShiftId &&
          body.terminalId === shift.terminalId && body.closeIdempotencyKey === closeIdempotencyKey &&
          body.currencyCode === shift.currencyCode && body.minorUnitExponent === shift.minorUnitExponent && actualMatches &&
          typeof body.expectedAmountMinor === 'string' && /^\d+$/.test(body.expectedAmountMinor) &&
          typeof body.differenceMinor === 'string' && /^-?\d+$/.test(body.differenceMinor) &&
          ['BALANCED', 'SURPLUS', 'SHORTAGE'].includes(body.varianceKind ?? '') &&
          typeof body.closedAt === 'string' && typeof body.closedByUserId === 'string') {
        clearIdempotencyKey(shift.cashShiftId);
        pendingPayload.current = null;
        setClosed(body);
        setPhase('success');
        return;
      }

      const code = body.error ?? `HTTP_${res.status}`;
      if (wasUnknown || res.ok || res.status >= 500 || res.status === 0) {
        setPhase('unknown');
        setUnknownHint('The close outcome is still unconfirmed. Retry the same request or seek assistance');
        return;
      }
      pendingPayload.current = null;
      setErrorCode(code);
      if (code === 'REASON_REQUIRED') {
        setNeedReason(true);
        setError('A reason is required when the counted amount differs from server expected.');
        setPhase('count');
        return;
      }
      if (code === 'FORBIDDEN') {
        setError(
          body.message ??
            'Permission denied. Shortage close requires Manager/Owner grant cash_shift.close.shortage — sign out and authenticate as that user (no role spoofing).',
        );
        setPhase('count');
        return;
      }
      if (code === 'CASH_SHIFT_ALREADY_CLOSED') {
        setError('This cash shift is already closed. Leave cashier and resume from opening.');
        setPhase('count');
        return;
      }
      if (code === 'IDEMPOTENCY_CONFLICT') {
        setError(
          'Close idempotency conflict: this key was already used with a different count or reason. Do not change the amount or reason while retrying the same key — retry the identical request, or contact support if the prior outcome is unknown.',
        );
        setPhase('count');
        return;
      }
      if (res.status >= 500 || res.status === 0) {
        setPhase('unknown');
        setUnknownHint(body.message ?? code);
        return;
      }
      setError(body.message ?? code);
      setPhase('count');
    } catch {
      setPhase('unknown');
      setUnknownHint('Network or timeout — do not assume success. Retry uses the same idempotency key and the same count/reason.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (phase === 'success' && closed) {
    return (
      <main className="closing-cash-screen" data-testid="closing-cash-success">
        <h1>Cash shift closed</h1>
        <p>
          {user.displayName} · {realm.displayName} · {terminal.terminalCode}
        </p>
        <dl className="closing-cash-screen__facts">
          <dt>Variance</dt>
          <dd data-testid="close-variance">{closed.varianceKind ?? '—'}</dd>
          <dt>Expected (server)</dt>
          <dd data-testid="close-expected">
            {closed.expectedAmountMinor} {closed.currencyCode}
          </dd>
          <dt>Actual</dt>
          <dd data-testid="close-actual">
            {closed.actualAmountMinor} {closed.currencyCode}
          </dd>
          <dt>Difference</dt>
          <dd data-testid="close-difference">{closed.differenceMinor ?? '—'}</dd>
          {closed.closeReasonText ? (
            <>
              <dt>Reason</dt>
              <dd>{closed.closeReasonText}</dd>
            </>
          ) : null}
          <dt>Closed at</dt>
          <dd>{closed.closedAt ?? '—'}</dd>
        </dl>
        <button type="button" data-testid="close-done" onClick={() => onClosed(closed)}>
          Done
        </button>
      </main>
    );
  }

  return (
    <main className="closing-cash-screen" data-testid="closing-cash-count">
      <h1>Close cash shift</h1>
      <p>
        {user.displayName} · {realm.displayName}
      </p>
      <p className="closing-cash-screen__meta">
        Terminal {terminal.outletName} / {terminal.terminalCode} · Shift{' '}
        <code>{shift.cashShiftId.slice(0, 8)}…</code>
      </p>
      <p className="closing-cash-screen__hint" data-testid="close-opening-hint">
        Opening float (informational only — not a suggested count): {shift.openingAmountMinor}{' '}
        {shift.currencyCode}. Server computes expected at close — enter the cash you physically
        counted.
      </p>
      <label>
        Counted cash ({shift.currencyCode})
        <input
          name="actualCash"
          inputMode="numeric"
          autoComplete="off"
          data-testid="close-actual-input"
          placeholder="Enter counted amount"
          value={actualMinor}
          onChange={(ev) => setActualMinor(ev.target.value.replace(/\D/g, '').slice(0, 18))}
          disabled={busy || phase === 'unknown'}
        />
      </label>
      <label>
        Reason{needReason ? ' (required — count differs from server expected)' : ' (if count may differ)'}
        <textarea
          name="closeReason"
          data-testid="close-reason-input"
          rows={3}
          value={reasonText}
          onChange={(ev) => setReasonText(ev.target.value.slice(0, 2000))}
          disabled={busy || phase === 'unknown'}
          required={needReason}
        />
      </label>
      {error ? (
        <p role="alert" data-testid="close-error">
          {error}
        </p>
      ) : null}
      {phase === 'unknown' ? (
        <p role="status" data-testid="close-unknown">
          UNKNOWN — {unknownHint}. Safe to retry (same idempotency key and same count/reason).
        </p>
      ) : null}
      {errorCode === 'FORBIDDEN' ? (
        <button type="button" data-testid="close-manager-signout" onClick={onSignOutForManager}>
          Sign out for Manager / Owner
        </button>
      ) : null}
      <button
        type="button"
        data-testid="close-submit"
        disabled={busy || !countReady}
        onClick={() => void submitClose()}
      >
        {busy ? 'Closing…' : phase === 'unknown' ? 'Retry close' : 'Confirm close'}
      </button>
      <button type="button" disabled={busy || phase === 'unknown'} onClick={onCancel}>
        Back to cashier
      </button>
    </main>
  );
}
