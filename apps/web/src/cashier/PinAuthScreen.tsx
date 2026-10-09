import { useState } from 'react';
import type { CompanyRealm } from './CompanyIdentificationScreen.js';

type AuthUser = {
  userId: string;
  employeeId: string | null;
  displayName: string;
};

type Props = {
  realm: CompanyRealm;
  onAuthenticated: (user: AuthUser) => void;
  onChangeCompany: () => void;
};

/**
 * PIN entry — session is established via HttpOnly cookie (not JS-readable bearer).
 * CashShift open is handled by OpeningCashScreen (CASH1.1).
 */
export function PinAuthScreen({ realm, onAuthenticated, onChangeCompany }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Browser supplies Origin/Referer for CSRF — do not set a caller-controlled Origin header.
      const res = await fetch('/api/v1/identity/pin/authenticate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          companyCode: realm.companyCode,
          pin,
          channel: 'TERMINAL',
        }),
      });
      if (!res.ok) {
        setError('Invalid credentials');
        setPin('');
        return;
      }
      const body = (await res.json()) as AuthUser & { sessionToken?: string; tenantId?: string };
      if (body.sessionToken || body.tenantId) {
        setError('Invalid credentials');
        return;
      }
      onAuthenticated({
        userId: body.userId,
        employeeId: body.employeeId,
        displayName: body.displayName,
      });
    } catch {
      setError('Invalid credentials');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pin-auth-screen">
      <h1>{realm.displayName}</h1>
      <p>Company ID: {realm.companyCode}</p>
      <form onSubmit={submit}>
        <label>
          Employee PIN
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(ev) => setPin(ev.target.value.replace(/\D/g, '').slice(0, 12))}
            disabled={busy}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || pin.length < 4}>
          Sign in
        </button>
      </form>
        <button type="button" onClick={onChangeCompany}>
        Change company
      </button>
    </main>
  );
}
