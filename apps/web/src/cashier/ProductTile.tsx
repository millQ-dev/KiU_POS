import type { CSSProperties } from 'react';
import { formatMoneyDisplay } from '../money/formatMoneyDisplay.js';
import type { ResolvedPosSlot } from '../api/types.js';
import './ProductTile.css';

type Props = {
  slot: ResolvedPosSlot;
  busy: boolean;
  onSelect: (slot: ResolvedPosSlot) => void;
};

function stateLabel(slot: ResolvedPosSlot): string {
  switch (slot.state) {
    case 'ACTIVE':
      return slot.quantityEntry === 'DEFERRED_WEIGHTED' ? 'Qty entry later' : 'Add';
    case 'DISABLED_UNAVAILABLE':
      return 'Unavailable';
    case 'DISABLED_PRICE_UNAVAILABLE':
      return 'No price';
    case 'CONFIGURATION_ERROR':
      return 'Config error';
    default:
      return '';
  }
}

export function ProductTile({ slot, busy, onSelect }: Props) {
  const isCountActive = slot.state === 'ACTIVE' && slot.quantityEntry === 'COUNT_ONE';
  const isWeightedActive = slot.state === 'ACTIVE' && slot.quantityEntry === 'DEFERRED_WEIGHTED';
  const disabled = !isCountActive || busy;
  const style: CSSProperties = {};
  if (slot.colorToken) {
    style.borderColor = `var(--pos-slot-${slot.colorToken}, var(--pos-border))`;
  }

  return (
    <button
      type="button"
      className={[
        'pos-tile',
        `pos-tile--${slot.state.toLowerCase()}`,
        isWeightedActive ? 'pos-tile--weighted' : '',
        busy ? 'pos-tile--busy' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      disabled={disabled}
      aria-label={`${slot.displayLabel}${slot.unitPrice ? `, ${formatMoneyDisplay(slot.unitPrice)}` : ''}, ${stateLabel(slot)}`}
      aria-disabled={disabled}
      onClick={() => {
        if (isCountActive) onSelect(slot);
      }}
    >
      <span className="pos-tile__label">{slot.displayLabel}</span>
      {slot.unitPrice ? (
        <span className="pos-tile__price">{formatMoneyDisplay(slot.unitPrice)}</span>
      ) : (
        <span className="pos-tile__price pos-tile__price--muted">—</span>
      )}
      <span className="pos-tile__meta">{stateLabel(slot)}</span>
    </button>
  );
}
