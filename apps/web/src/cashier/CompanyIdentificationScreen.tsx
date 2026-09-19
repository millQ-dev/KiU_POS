import { useState } from 'react';

export type CompanyRealm = {
  companyCode: string;
  displayName: string;
};

const REALM_KEY = 'millq.companyRealm.v1';

/** Presentation-only login realm. Never stores tenantId or session secrets. */
export function readCompanyRealm(): CompanyRealm | null {
  try {
    const raw = sessionStorage.getItem(REALM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompanyRealm;
    if (!parsed?.companyCode || !parsed?.displayName) return null;
    if ('tenantId' in (parsed as object)) return null;
    return { companyCode: parsed.companyCode, displayName: parsed.displayName };
  } catch {
    return null;
  }
}

export function writeCompanyRealm(realm: CompanyRealm): void {
  sessionStorage.setItem(
    REALM_KEY,
    JSON.stringify({ companyCode: realm.companyCode, displayName: realm.displayName }),
  );
}

export function clearCompanyRealm(): void {
  sessionStorage.removeItem(REALM_KEY);
}

type Props = {
  onResolved: (realm: CompanyRealm) => void;
};

export function CompanyIdentificationScreen({ onResolved }: Props) {
  const [companyCode, setCompanyCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/public/company/${encodeURIComponent(companyCode.trim())}`,
        { method: 'GET', credentials: 'same-origin' },
      );
      if (!res.ok) {
        setError('Company not found');
        return;
      }
      const body = (await res.json()) as { companyCode?: string; displayName?: string; tenantId?: string };
      if (!body.companyCode || !body.displayName || body.tenantId) {
        setError('Company not found');
        return;
      }
      const realm = { companyCode: body.companyCode, displayName: body.displayName };
      writeCompanyRealm(realm);
      onResolved(realm);
    } catch {
      setError('Company not found');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="company-id-screen">
      <h1>MillQ</h1>
      <p>Enter Company ID to continue</p>
      <form onSubmit={submit}>
        <label>
          Company ID
          <input
            name="companyCode"
            autoComplete="organization"
            value={companyCode}
            onChange={(ev) => setCompanyCode(ev.target.value)}
            disabled={busy}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || companyCode.trim().length < 3}>
          Continue
        </button>
      </form>
    </main>
  );
}
