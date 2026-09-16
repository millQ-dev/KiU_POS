import type { CommercialStatus as CommercialStatusDto, MenuPriceResolution } from '../api/types.js';
import './CommercialStatus.css';

type Props = {
  status: CommercialStatusDto | null;
  priceResolution: MenuPriceResolution | null;
  refreshing: boolean;
  editable: boolean;
  onRefreshPrices: () => void;
};

function statusCopy(status: CommercialStatusDto | null): { label: string; tone: string } {
  if (!status) {
    return { label: 'Commercial status unknown', tone: 'muted' };
  }
  if (status.commercialState === 'ACCEPTED') {
    return { label: 'Commercial terms accepted', tone: 'ok' };
  }
  return { label: 'Order changed — refresh / confirm price', tone: 'warn' };
}

export function CommercialStatusPanel({
  status,
  priceResolution,
  refreshing,
  editable,
  onRefreshPrices,
}: Props) {
  const copy = statusCopy(status);

  return (
    <section className="pos-commercial" aria-label="Commercial status">
      <div className={`pos-commercial__badge pos-commercial__badge--${copy.tone}`} role="status">
        {copy.label}
      </div>
      {status?.commercialState === 'ACCEPTED' && status.acceptedGrossMerchandiseMinor != null ? (
        <p className="pos-commercial__accepted">
          Accepted order gross (authoritative): {status.acceptedGrossMerchandiseMinor}{' '}
          {status.currencyCode ?? ''}
        </p>
      ) : (
        <p className="pos-commercial__hint">
          Price needs confirmation. Unit×qty gross is blocked until ADR-0030.
        </p>
      )}

      <button
        type="button"
        className="pos-commercial__refresh"
        disabled={!editable || refreshing}
        onClick={onRefreshPrices}
      >
        {refreshing ? 'Resolving…' : 'Refresh current unit prices'}
      </button>

      {priceResolution && (
        <ul className="pos-commercial__prices" aria-label="Current menu unit prices">
          {priceResolution.lines.map((line) => {
            const accepted = status?.lines.find((l) => l.orderLineId === line.orderLineId);
            const changed =
              accepted?.resolvedUnitPriceMinor != null &&
              line.resolvedUnitPriceMinor != null &&
              accepted.resolvedUnitPriceMinor !== line.resolvedUnitPriceMinor;
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
                    Price changed (was {accepted!.resolvedUnitPriceMinor})
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="pos-commercial__note">
        Refresh resolves unit prices only — does not accept commercial terms.
      </p>
    </section>
  );
}
