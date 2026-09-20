import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyRealm } from './CompanyIdentificationScreen.js';

type AuthUser = {
  userId: string;
  employeeId: string | null;
  displayName: string;
};

type TerminalOption = {
  outletId: string;
  outletName: string;
  terminalId: string;
  terminalCode: string;
  terminalName: string;
};

type CashShift = {
  cashShiftId: string;
  terminalId: string;
  outletId: string;
  status: string;
  openingAmountMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  authMode: string;
  openedAt: string;
};

type Props = {
  user: AuthUser;
  realm: CompanyRealm;
  onOpened: (shift: CashShift) => void;
  onLogout: () => void;
};

const DEFAULT_CURRENCY = 'VND';
const DEFAULT_EXPONENT = 0;

function cashFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      origin: window.location.origin,
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Minimal opening-cash entry after Identity auth.
 * Direct open when grant allows; otherwise approval request + wait.
 */
export function OpeningCashScreen({ user, realm, onOpened, onLogout }: Props) {
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [terminalId, setTerminalId] = useState<string>('');
  const [amountMinor, setAmountMinor] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'entry' | 'awaiting_approval'>('entry');

  const selected = useMemo(
    () => terminals.find((t) => t.terminalId === terminalId) ?? null,
    [terminals, terminalId],
  );

  const idempotencyKey = useMemo(() => {
    const seed = `${user.userId}:${terminalId}:${amountMinor}:${DEFAULT_CURRENCY}:${DEFAULT_EXPONENT}`;
    return `cash-open-${seed}`.slice(0, 128);
  }, [user.userId, terminalId, amountMinor]);

  const loadTerminals = useCallback(async () => {
    const res = await cashFetch('/api/v1/cash/terminals');
    if (!res.ok) {
      setError('Unable to load terminals');
      return;
    }
    const body = (await res.json()) as { terminals: TerminalOption[] };
    setTerminals(body.terminals);
    if (body.terminals[0]) {
      setTerminalId(body.terminals[0].terminalId);
      const cur = await cashFetch(
        `/api/v1/cash/shifts/current?terminalId=${encodeURIComponent(body.terminals[0].terminalId)}`,
      );
      if (cur.ok) {
        const data = (await cur.json()) as { shift: CashShift | null };
        if (data.shift) onOpened(data.shift);
      }
    }
  }, [onOpened]);

  useEffect(() => {
    void loadTerminals();
  }, [loadTerminals]);

  async function tryOpen(approvalRequestId?: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cashFetch('/api/v1/cash/shifts/open', {
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
      const body = (await res.json()) as CashShift & { error?: string; message?: string };
      if (res.status === 201) {
        onOpened(body);
        return;
      }
      if (body.error === 'APPROVAL_REQUIRED') {
        const created = await cashFetch('/api/v1/identity/approval-requests', {
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
    await cashFetch('/api/v1/identity/session/logout', { method: 'POST' });
    onLogout();
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
          onChange={(ev) => setTerminalId(ev.target.value)}
          disabled={busy || terminals.length === 0}
        >
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
          disabled={busy}
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

type ReadyProps = {
  user: AuthUser;
  realm: CompanyRealm;
  shift: CashShift;
  onLogout: () => void;
};

/** Cashier-ready shell after CashShift OPEN — no POS redesign. */
export function CashierReadyShell({ user, realm, shift, onLogout }: ReadyProps) {
  async function logout() {
    await cashFetch('/api/v1/identity/session/logout', { method: 'POST' });
    onLogout();
  }

  return (
    <main className="cashier-ready-shell">
      <h1>Cashier ready</h1>
      <p>
        {user.displayName} · {realm.displayName}
      </p>
      <p>
        Cash shift open · {shift.openingAmountMinor} {shift.currencyCode} · {shift.authMode}
      </p>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </main>
  );
}
