import { useEffect, useId, useState } from 'react';
import type { ResolvedPosSlot } from '../api/types.js';
import { formatMoneyDisplay } from '../money/formatMoneyDisplay.js';
import { isValidWeightedQuantityString } from './quantityInput.js';
import './QuantityEntryModal.css';

type Props = {
  slot: ResolvedPosSlot;
  busy: boolean;
  onConfirm: (quantity: string) => void;
  onCancel: () => void;
};

export function QuantityEntryModal({ slot, busy, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQty('');
    setError(null);
  }, [slot.layoutPublicationSlotId]);

  const submit = () => {
    const next = qty.trim();
    if (!isValidWeightedQuantityString(next)) {
      setError('Enter a positive decimal quantity (e.g. 0.25)');
      return;
    }
    onConfirm(next);
  };

  return (
    <div className="pos-qty-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="pos-qty-modal__panel">
        <h3 id={titleId} className="pos-qty-modal__title">
          Enter quantity — {slot.displayLabel}
        </h3>
        <p className="pos-qty-modal__meta">
          {slot.dimension} · {slot.baseUnit}
          {slot.unitPrice ? ` · ${formatMoneyDisplay(slot.unitPrice)} / ${slot.baseUnit}` : ''}
        </p>
        <label className="pos-qty-modal__label">
          Quantity ({slot.baseUnit})
          <input
            className="pos-qty-modal__input"
            autoFocus
            inputMode="decimal"
            value={qty}
            disabled={busy}
            aria-label="Weighted quantity"
            onChange={(e) => {
              setQty(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') onCancel();
            }}
          />
        </label>
        {error && (
          <p className="pos-qty-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="pos-qty-modal__actions">
          <button type="button" className="pos-qty-modal__btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="pos-qty-modal__btn pos-qty-modal__btn--primary"
            disabled={busy}
            onClick={submit}
          >
            Add to order
          </button>
        </div>
        <p className="pos-qty-modal__note">Quantity only — no commercial gross calculated.</p>
      </div>
    </div>
  );
}
