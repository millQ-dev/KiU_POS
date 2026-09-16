import { useEffect, useState } from 'react';
import { posApi } from '../api/client.js';
import type { CashierContext } from '../api/types.js';
import './DevContextBootstrap.css';

type Props = {
  onSelect: (ctx: CashierContext) => void;
};

/**
 * Development context selector — NOT production authorization / Identity.
 */
export function DevContextBootstrap({ onSelect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [contexts, setContexts] = useState<CashierContext[]>([]);
  const [openingCashMinor, setOpeningCashMinor] = useState('0');
  const [startingShiftOutletId, setStartingShiftOutletId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await posApi.listDevContexts();
        if (cancelled) return;
        setWarning(res.warning);
        setContexts(res.contexts);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load contexts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dev-boot">
      <div className="dev-boot__card">
        <h1 className="dev-boot__title">KiU cashier</h1>
        <p className="dev-boot__badge">Development bootstrap — not production auth</p>
        {warning && <p className="dev-boot__warn">{warning}</p>}
        {loading && <p role="status">Loading outlet contexts…</p>}
        {error && (
          <p role="alert" className="dev-boot__error">
            {error}
          </p>
        )}
        {!loading && !error && contexts.length === 0 && (
          <p role="status">
            No outlets in database. Seed local data (e.g. run acceptance fixtures) then refresh.
          </p>
        )}
        {!loading && contexts.length > 0 && (
          <label className="dev-boot__cash">
            Opening cash (VND)
            <input
              value={openingCashMinor}
              inputMode="numeric"
              onChange={(event) => setOpeningCashMinor(event.target.value.replace(/\D/g, ''))}
            />
          </label>
        )}
        <ul className="dev-boot__list">
          {contexts.map((c) => (
            <li key={c.outletId}>
              <button
                type="button"
                className="dev-boot__btn"
                disabled={startingShiftOutletId !== null}
                onClick={() => {
                  setStartingShiftOutletId(c.outletId);
                  setError(null);
                  void posApi
                    .openDevCashShift({
                      tenantId: c.tenantId,
                      legalEntityId: c.legalEntityId,
                      outletId: c.outletId,
                      openingCashMinor,
                    })
                    .then((shift) => {
                      onSelect({
                        ...c,
                        cashShiftId: shift.cashShiftId,
                        cashierId: shift.cashierId,
                        deviceId: shift.deviceId,
                        openingCashMinor: shift.openingCashMinor,
                        shiftStatus: shift.status,
                      });
                    })
                    .catch((err) => {
                      setError(err instanceof Error ? err.message : 'Failed to open development shift');
                    })
                    .finally(() => setStartingShiftOutletId(null));
                }}
              >
                <strong>{c.outletName}</strong>
                <span>
                  {c.tenantName} · {c.brandName} · {startingShiftOutletId === c.outletId ? 'Opening shift…' : 'Start'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
