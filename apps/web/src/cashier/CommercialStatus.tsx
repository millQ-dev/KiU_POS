import type { CommercialStatus as CommercialStatusDto, MenuPriceResolution } from '../api/types.js';
import './CommercialStatus.css';

type Props = {
  status: CommercialStatusDto | null;
  priceResolution: MenuPriceResolution | null;
  refreshing: boolean;
  accepting: boolean;
  editable: boolean;
  onRefreshPrices: () => void;
  onAcceptCurrentPrices: () => void;
};

function statusCopy(status: CommercialStatusDto | null): { label: string; tone: string } {
  if (!status) {
    return { label: 'Commercial status unknown', tone: 'muted' };
  }
  if (status.commercialState === 'ACCEPTED') {
    return { label: 'Commercial terms accepted', tone: 'ok' };
  }
  return { label: 'Order changed — calculate & accept prices', tone: 'warn' };
}

export function CommercialStatusPanel({
  status,
  priceResolution,
  refreshing,
  accepting,
  editable,
  onRefreshPrices,
  onAcceptCurrentPrices,
}: Props) {
  const copy = statusCopy(status);
  const accepted =
    status?.commercialState === 'ACCEPTED' && status.merchandiseGrossMinor != null
      ? status.merchandiseGrossMinor
      : status?.commercialState === 'ACCEPTED' && status.acceptedGrossMerchandiseMinor != null
        ? status.acceptedGrossMerchandiseMinor
        : null;

  return (
    <section className="pos-commercial" aria-label="Commercial status">
      <div className={`pos-commercial__badge pos-commercial__badge--${copy.tone}`} role="status">
        {copy.label}
      </div>
      {accepted != null ? (
        <p className="pos-commercial__accepted">
          Merchandise gross (authoritative): {accepted} {status?.currencyCode ?? ''}
        </p>
      ) : (
        <p className="pos-commercial__hint">
          No authoritative merchandise gross until calculate &amp; accept.
        </p>
      )}

      {status?.commercialState === 'ACCEPTED' && status.lines.length > 0 && (
        <ul className="pos-commercial__lines" aria-label="Accepted line gross">
          {status.lines.map((line) => (
            <li key={line.orderLineId} className="pos-commercial__line-gross">
              Line gross (backend): {line.grossMerchandiseMinor} {status.currencyCode ?? ''}
            </li>
          ))}
        </ul>
      )}

      <div className="pos-commercial__actions">
        <button
          type="button"
          className="pos-commercial__refresh"
          disabled={!editable || refreshing || accepting}
          onClick={onRefreshPrices}
        >
          {refreshing ? 'Resolving…' : 'Refresh current unit prices'}
        </button>
        <button
          type="button"
          className="pos-commercial__accept"
          disabled={!editable || refreshing || accepting}
          onClick={onAcceptCurrentPrices}
        >
          {accepting
            ? 'Accepting…'
            : status?.commercialState === 'ACCEPTED'
              ? 'Reprice & accept current prices'
              : 'Calculate & accept current prices'}
        </button>
      </div>

      {priceResolution && (
        <ul className="pos-commercial__prices" aria-label="Current menu unit prices">
          {priceResolution.lines.map((line) => {
            const acceptedLine = status?.lines.find((l) => l.orderLineId === line.orderLineId);
            const changed =
              acceptedLine?.resolvedUnitPriceMinor != null &&
              line.resolvedUnitPriceMinor != null &&
              acceptedLine.resolvedUnitPriceMinor !== line.resolvedUnitPriceMinor;
            return (
              <li key={line.orderLineId} className="pos-commercial__price-row">
                <span>
                  Current unit price:{' '}
                  {line.resolvedUnitPriceMinor != null
                    ? `${line.resolvedUnitPriceMinor} ${line.currencyCode ?? ''}`
                    : '—'}
                  {line.availabilityStatus !== 'AVAILABLE' ? ` · ${line.availabilityStatus}` : ''}
                </span>
                {changed && (
                  <span className="pos-commercial__changed" role="status">
                    Price changed (was {acceptedLine!.resolvedUnitPriceMinor})
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="pos-commercial__note">
        Refresh resolves unit prices only. Calculate &amp; accept uses RoundingPolicy (no frontend
        arithmetic).
      </p>
    </section>
  );
}
