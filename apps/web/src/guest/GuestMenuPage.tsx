import { useEffect, useRef, useState } from 'react';
import type { GuestMenuDto } from './types.js';
import { formatMoneyDisplay } from '../money/formatMoneyDisplay.js';
import './GuestMenuPage.css';

const LOCALES = [
  { code: 'vi', label: 'VI' },
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
] as const;

type Locale = typeof LOCALES[number]['code'];
const COPY: Record<Locale, { loading: string; unavailable: string; retry: string; language: string; table: string; soldOut: string; empty: string }> = {
  en: { loading: 'Loading menu…', unavailable: 'Menu unavailable', retry: 'Try again', language: 'Language', table: 'Table', soldOut: 'Unavailable', empty: 'No items are available to show.' },
  ru: { loading: 'Загружаем меню…', unavailable: 'Меню недоступно', retry: 'Повторить', language: 'Язык', table: 'Стол', soldOut: 'Недоступно', empty: 'В меню пока нет блюд.' },
  vi: { loading: 'Đang tải thực đơn…', unavailable: 'Không thể tải thực đơn', retry: 'Thử lại', language: 'Ngôn ngữ', table: 'Bàn', soldOut: 'Tạm hết', empty: 'Chưa có món để hiển thị.' },
};

function GuestPhoto({ src }: { src: string | null }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return src && failedSource !== src
    ? <img className="gm-photo" src={src} alt="" loading="lazy" onError={() => setFailedSource(src)} />
    : <div className="gm-photo gm-photo-placeholder" aria-hidden="true" />;
}

export function GuestMenuPage({ opaqueToken }: { opaqueToken: string }) {
  const [lang, setLang] = useState<Locale>('en');
  const copy = COPY[lang];
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

  const languages = (
    <div className="gm-langs" role="group" aria-label={copy.language}>
      {LOCALES.map((l) => <button key={l.code} type="button" aria-pressed={lang === l.code}
        className={lang === l.code ? 'gm-lang gm-lang-active' : 'gm-lang'} onClick={() => {
          if (lang === l.code) return;
          requestGeneration.current += 1;
          setError(null);
          setLoading(true);
          setLang(l.code);
        }}>{l.label}</button>)}
    </div>
  );

  if ((loading || (!error && menuResult?.token !== opaqueToken)) && !menu) {
    return (
      <main className="gm-page" lang={lang}>
        {languages}
        <p className="gm-muted" role="status">{copy.loading}</p>
      </main>
    );
  }

  if (error || !menu) {
    return (
      <main className="gm-page" lang={lang}>
        {languages}
        <p className="gm-error" role="alert">{copy.unavailable}</p>
        <button type="button" onClick={() => setRetry((n) => n + 1)}>{copy.retry}</button>
      </main>
    );
  }

  const visibleItems = new Set(menu.items.map((item) => item.publicItemRef));
  const hasVisibleItems = menu.categories.some((category) => category.itemRefs.some((ref) => visibleItems.has(ref)));

  return (
    <main className="gm-page" lang={lang}>
      <header className="gm-header">
        <div>
          <p className="gm-brand">{menu.brand.name}</p>
          <h1 className="gm-outlet">{menu.outlet.name}</h1>
          {menu.tableLabel ? <p className="gm-table">{copy.table} {menu.tableLabel}</p> : null}
        </div>
        {languages}
      </header>

      {loading ? <p className="gm-muted" role="status">{copy.loading}</p> : !hasVisibleItems ? <p className="gm-muted" role="status">{copy.empty}</p> : menu.categories.map((cat) => (
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
                  <GuestPhoto src={item.imageUrl} />
                  <div className="gm-card-body">
                    <div className="gm-card-top">
                      <h3 className="gm-dish">{item.name}</h3>
                      <p className="gm-price">
                        {item.price.status === 'AVAILABLE'
                          ? formatMoneyDisplay(item.price)
                          : '—'}
                      </p>
                    </div>
                    {item.description ? <p className="gm-desc">{item.description}</p> : null}
                    {unavailable ? <p className="gm-badge">{copy.soldOut}</p> : null}
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
