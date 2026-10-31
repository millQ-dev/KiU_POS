import { useEffect, useRef, useState } from 'react';
import type { GuestMenuDto } from './types.js';
import './GuestMenuPage.css';

const LOCALES = [
  { code: 'vi', label: 'VI' },
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
] as const;

function formatPrice(amountMinor: string, currencyCode: string, exponent: number): string {
  const n = Number(amountMinor);
  if (!Number.isFinite(n)) return '—';
  const major = exponent === 0 ? String(n) : (n / 10 ** exponent).toFixed(exponent);
  return `${major} ${currencyCode}`;
}

export function GuestMenuPage({ opaqueToken }: { opaqueToken: string }) {
  const [lang, setLang] = useState('en');
  const [menuResult, setMenuResult] = useState<{ token: string; menu: GuestMenuDto } | null>(null);
  const menu = menuResult?.token === opaqueToken ? menuResult.menu : null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [retry, setRetry] = useState(0);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/v1/public/guest-menu/${encodeURIComponent(opaqueToken)}?lang=${lang}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Menu unavailable');
        const result = (await res.json()) as GuestMenuDto;
        if (requestGeneration.current === generation) setMenuResult({ token: opaqueToken, menu: result });
      } catch {
        if (requestGeneration.current === generation) setError('Menu unavailable');
      } finally {
        if (requestGeneration.current === generation) setLoading(false);
      }
    })();
    return () => {
      requestGeneration.current += 1;
      controller.abort();
    };
  }, [opaqueToken, lang, retry]);

  if ((loading || (!error && menuResult?.token !== opaqueToken)) && !menu) {
    return (
      <main className="gm-page">
        <p className="gm-muted">Loading menu…</p>
      </main>
    );
  }

  if (error || !menu) {
    return (
      <main className="gm-page">
        <p className="gm-error" role="alert">{error ?? 'Menu unavailable'}</p>
        <button type="button" onClick={() => setRetry((n) => n + 1)}>Try again</button>
      </main>
    );
  }

  return (
    <main className="gm-page">
      <header className="gm-header">
        <div>
          <p className="gm-brand">{menu.brand.name}</p>
          <h1 className="gm-outlet">{menu.outlet.name}</h1>
          {menu.tableLabel ? <p className="gm-table">Table {menu.tableLabel}</p> : null}
        </div>
        <div className="gm-langs" role="group" aria-label="Language">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              type="button"
              className={lang === l.code ? 'gm-lang gm-lang-active' : 'gm-lang'}
              onClick={() => {
                if (lang === l.code) return;
                requestGeneration.current += 1;
                setLoading(true);
                setLang(l.code);
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? <p className="gm-muted" role="status">Loading menu…</p> : menu.categories.map((cat) => (
        <section key={cat.publicCategoryRef} className="gm-section">
          <h2 className="gm-section-title">{cat.name}</h2>
          <ul className="gm-list">
            {cat.itemRefs.map((ref) => {
              const item = menu.items.find((i) => i.publicItemRef === ref);
              if (!item) return null;
              const unavailable = item.availability === 'UNAVAILABLE';
              return (
                <li
                  key={item.publicItemRef}
                  className={unavailable ? 'gm-card gm-card-unavailable' : 'gm-card'}
                >
                  {item.imageUrl ? (
                    <img className="gm-photo" src={item.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="gm-photo gm-photo-placeholder" aria-hidden />
                  )}
                  <div className="gm-card-body">
                    <div className="gm-card-top">
                      <h3 className="gm-dish">{item.name}</h3>
                      <p className="gm-price">
                        {item.price.status === 'AVAILABLE'
                          ? formatPrice(
                              item.price.amountMinor,
                              item.price.currencyCode,
                              item.price.minorUnitExponent,
                            )
                          : '—'}
                      </p>
                    </div>
                    {item.description ? <p className="gm-desc">{item.description}</p> : null}
                    {unavailable ? <p className="gm-badge">Unavailable</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
