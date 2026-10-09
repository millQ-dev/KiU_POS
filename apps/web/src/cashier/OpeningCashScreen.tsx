import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCurrentCashShift,
  listCashTerminals,
  logoutSession,
  sessionFetch,
  type OpenCashShift,
  type SessionUser,
} from '../api/sessionClient.js';
import type { TerminalTopology } from './buildCashierContext.js';
import type { CompanyRealm } from './CompanyIdentificationScreen.js';

type Props = {
  user: SessionUser;
  realm: CompanyRealm;
  /** When set, prefer this terminal (single-terminal resume path). */
  preferredTerminalId?: string | null;
  onOpened: (shift: OpenCashShift, terminal: TerminalTopology) => void;
  onLogout: () => void;
};

const DEFAULT_CURRENCY = 'VND';
const DEFAULT_EXPONENT = 0;

/**
 * Minimal opening-cash entry after Identity auth (CASH1.1).
 * Direct open when grant allows; otherwise approval request + wait.
 * Does not auto-open a second shift; resumes existing OPEN when present.
 */
export function OpeningCashScreen({
  user,
  realm,
  preferredTerminalId,
  onOpened,
  onLogout,
}: Props) {
  const [terminals, setTerminals] = useState<TerminalTopology[]>([]);
  const [terminalId, setTerminalId] = useState<string>('');
  const [amountMinor, setAmountMinor] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'entry' | 'awaiting_approval'>('entry');
  const [bootstrapped, setBootstrapped] = useState(false);

  const selected = useMemo(
    () => terminals.find((t) => t.terminalId === terminalId) ?? null,
    [terminals, terminalId],
  );

  const idempotencyKey = useMemo(() => {
    const seed = `${user.userId}:${terminalId}:${amountMinor}:${DEFAULT_CURRENCY}:${DEFAULT_EXPONENT}`;
    return `cash-open-${seed}`.slice(0, 128);
  }, [user.userId, terminalId, amountMinor]);

  const tryResumeOpen = useCallback(
    async (terminal: TerminalTopology): Promise<boolean> => {
      const shift = await getCurrentCashShift(terminal.terminalId);
      if (shift && shift.status === 'OPEN') {
        onOpened(shift, terminal);
        return true;
      }
      return false;
    },
    [onOpened],
  );

  const loadTerminals = useCallback(async () => {
    setError(null);
    try {
      const list = await listCashTerminals();
      setTerminals(list);
      if (list.length === 0) {
        setError('No authorized terminals');
        setBootstrapped(true);
        return;
      }
      const preferred =
        (preferredTerminalId && list.find((t) => t.terminalId === preferredTerminalId)) ||
        (list.length === 1 ? list[0]! : null);
      if (preferred) {
        setTerminalId(preferred.terminalId);
        await tryResumeOpen(preferred);
        // If parent accepted OPEN shift it unmounts this screen; otherwise show open form.
      } else {
        setTerminalId('');
      }
      setBootstrapped(true);
    } catch {
      setError('Unable to load terminals');
      setBootstrapped(true);
    }
  }, [preferredTerminalId, tryResumeOpen]);

  useEffect(() => {
    void loadTerminals();
  }, [loadTerminals]);

  async function onTerminalSelected(nextId: string) {
    setTerminalId(nextId);
    setError(null);
    const terminal = terminals.find((t) => t.terminalId === nextId);
    if (!terminal) return;
    try {
      await tryResumeOpen(terminal);
    } catch {
      setError('Unable to check cash shift');
    }
  }

  async function tryOpen(approvalRequestId?: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sessionFetch('/api/v1/cash/shifts/open', {
        method: 'POST',
        body: JSON.stringify({
          outletId: selected.outletId,
          terminalId: selected.terminalId,
          openIdempotencyKey: idempotencyKey,
          openingCash: {
            amountMinor,
            currencyCode: DEFAULT_CURRENCY,
            minorUnitExponent: DEFAULT_EXPONENT,
          },
          ...(approvalRequestId ? { approvalRequestId } : {}),
        }),
      });
      const body = (await res.json()) as OpenCashShift & { error?: string; message?: string };
      if (res.status === 201) {
        onOpened(body, selected);
        return;
      }
      if (body.error === 'APPROVAL_REQUIRED') {
        const created = await sessionFetch('/api/v1/identity/approval-requests', {
          method: 'POST',
          body: JSON.stringify({
            outletId: selected.outletId,
            terminalId: selected.terminalId,
            operationType: 'cash_shift.open',
            operationFingerprint: {
              openingCash: {
                amountMinor,
                currencyCode: DEFAULT_CURRENCY,
                minorUnitExponent: DEFAULT_EXPONENT,
              },
            },
          }),
        });
        if (!created.ok) {
          setError('Approval request failed');
          return;
        }
        const apr = (await created.json()) as { approvalRequestId: string };
        setApprovalId(apr.approvalRequestId);
        setPhase('awaiting_approval');
        return;
      }
      setError(body.message ?? body.error ?? 'Open failed');
    } catch {
      setError('Open failed');
    } finally {
      setBusy(false);
    }
  }

  async function retryAfterApproval() {
    if (!approvalId) return;
    await tryOpen(approvalId);
  }

  async function logout() {
    await logoutSession();
    onLogout();
  }

  if (!bootstrapped && !error) {
    return (
      <main className="opening-cash-screen">
        <h1>Opening cash</h1>
        <p role="status">Loading terminals…</p>
      </main>
    );
  }

  if (phase === 'awaiting_approval') {
    return (
      <main className="opening-cash-screen">
        <h1>Approval required</h1>
        <p>
          {user.displayName} · {realm.displayName}
        </p>
        <p>Waiting for manager approval to open the cash shift.</p>
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" disabled={busy} onClick={() => void retryAfterApproval()}>
          Continue after approval
        </button>
        <button type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </main>
    );
  }

  return (
    <main className="opening-cash-screen">
      <h1>Opening cash</h1>
      <p>
        {user.displayName} · {realm.displayName}
      </p>
      <label>
        Terminal
        <select
          value={terminalId}
          onChange={(ev) => void onTerminalSelected(ev.target.value)}
          disabled={busy || terminals.length === 0}
        >
          {terminals.length > 1 ? <option value="">Select terminal…</option> : null}
          {terminals.map((t) => (
            <option key={t.terminalId} value={t.terminalId}>
              {t.outletName} / {t.terminalCode} — {t.terminalName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Opening float ({DEFAULT_CURRENCY})
        <input
          name="openingCash"
          inputMode="numeric"
          autoComplete="off"
          value={amountMinor}
          onChange={(ev) => setAmountMinor(ev.target.value.replace(/\D/g, '').slice(0, 18) || '0')}
          disabled={busy || !selected}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !selected || !/^[0-9]+$/.test(amountMinor)}
        onClick={() => void tryOpen()}
      >
        Open cash shift
      </button>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </main>
  );
}
