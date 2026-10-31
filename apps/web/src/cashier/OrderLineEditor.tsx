import { useEffect, useId, useState } from 'react';
import type { OrderLine } from '../api/types.js';
import {
  bumpCountQuantity,
  isValidCountQuantityString,
  isValidWeightedQuantityString,
} from './quantityInput.js';
import './OrderLineEditor.css';

type Props = {
  line: OrderLine;
  busy: boolean;
  editable: boolean;
  onUpdateQuantity: (quantity: string) => void;
  onRemove: () => void;
};

export function OrderLineEditor({ line, busy, editable, onUpdateQuantity, onRemove }: Props) {
  const isCount = line.dimension === 'COUNT';
  const [draft, setDraft] = useState(line.quantity);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  useEffect(() => {
    setDraft(line.quantity);
    setError(null);
  }, [line.quantity, line.orderLineId]);

  const applyDraft = () => {
    const next = draft.trim();
    if (next === line.quantity) { setError(null); return; }
    const valid = isCount ? isValidCountQuantityString(next) : isValidWeightedQuantityString(next);
    if (!valid) {
      setError(isCount ? 'Enter a whole number greater than zero.' : `Enter a quantity greater than zero in ${line.unit}, using a decimal point.`);
      return;
    }
    setError(null);
    onUpdateQuantity(next);
  };

  const onMinus = () => {
    if (!isCount) return;
    if (line.quantity === '1') {
      onRemove();
      return;
    }
    const next = bumpCountQuantity(line.quantity, -1);
    if (next) onUpdateQuantity(next);
  };

  const onPlus = () => {
    if (!isCount) return;
    const next = bumpCountQuantity(line.quantity, 1);
    if (next) onUpdateQuantity(next);
  };

  if (!editable) {
    return (
      <div className="pos-line-editor pos-line-editor--readonly" aria-label="Line quantity">
        <span className="pos-line-editor__qty">
          {line.quantity} {line.unit}
        </span>
      </div>
    );
  }

  return (
    <div className="pos-line-editor" aria-label="Edit line quantity">
      {isCount ? (
        <div className="pos-line-editor__stepper">
          <button
            type="button"
            className="pos-line-editor__btn"
            disabled={busy}
            aria-label="Decrease quantity"
            onClick={onMinus}
          >
            −
          </button>
          <input
            className="pos-line-editor__input"
            inputMode="numeric"
            pattern="[1-9][0-9]*"
            aria-label="COUNT quantity"
            disabled={busy}
            value={draft}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onBlur={applyDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyDraft();
              }
            }}
          />
          <button
            type="button"
            className="pos-line-editor__btn"
            disabled={busy}
            aria-label="Increase quantity"
            onClick={onPlus}
          >
            +
          </button>
        </div>
      ) : (
        <div className="pos-line-editor__weighted">
          <input
            className="pos-line-editor__input pos-line-editor__input--wide"
            inputMode="decimal"
            aria-label={`${line.dimension} quantity`}
            disabled={busy}
            value={draft}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onBlur={applyDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyDraft();
              }
            }}
          />
          <span className="pos-line-editor__unit">{line.unit}</span>
          <button
            type="button"
            className="pos-line-editor__apply"
            disabled={busy || draft.trim() === line.quantity}
            onClick={applyDraft}
          >
            Set
          </button>
        </div>
      )}
      {error && <p id={errorId} className="pos-line-editor__error" role="alert">{error}</p>}
      <button
        type="button"
        className="pos-line-editor__remove"
        disabled={busy}
        aria-label="Remove line"
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}
