import { useEffect, useId, useMemo, useState } from 'react';
import type { CatalogModifierGroup, OrderLine } from '../api/types.js';
import './ModifierConfigurationModal.css';

type Props = {
  line: OrderLine;
  groups: CatalogModifierGroup[];
  busy: boolean;
  onConfirm: (payload: {
    selections: Array<{ modifierGroupId: string; modifierOptionId: string }>;
    guestNote: string | null;
  }) => void;
  onCancel: () => void;
};

function initialSelections(groups: CatalogModifierGroup[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of groups) {
    if (g.askEveryTime) {
      out[g.modifierGroupId] = [];
      continue;
    }
    const defaults = g.options.filter((o) => o.isDefault).map((o) => o.modifierOptionId);
    out[g.modifierGroupId] = defaults;
  }
  return out;
}

export function ModifierConfigurationModal({ line, groups, busy, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const [byGroup, setByGroup] = useState<Record<string, string[]>>(() => initialSelections(groups));
  const [guestNote, setGuestNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setByGroup(initialSelections(groups));
    setGuestNote('');
    setError(null);
  }, [line.orderLineId, groups]);

  const needsExplicit = useMemo(
    () => groups.some((g) => g.askEveryTime),
    [groups],
  );

  const toggle = (group: CatalogModifierGroup, optionId: string) => {
    setByGroup((prev) => {
      const cur = prev[group.modifierGroupId] ?? [];
      if (group.selectionMode === 'SINGLE') {
        return { ...prev, [group.modifierGroupId]: [optionId] };
      }
      const has = cur.includes(optionId);
      const next = has ? cur.filter((id) => id !== optionId) : [...cur, optionId];
      return { ...prev, [group.modifierGroupId]: next };
    });
    setError(null);
  };

  const submit = () => {
    for (const g of groups) {
      const chosen = byGroup[g.modifierGroupId] ?? [];
      const min = g.required || g.askEveryTime ? Math.max(1, g.minSelect) : g.minSelect;
      if (chosen.length < min || chosen.length > g.maxSelect) {
        setError(`Select ${min}–${g.maxSelect} option(s) for ${g.name}`);
        return;
      }
    }
    const selections = groups.flatMap((g) =>
      (byGroup[g.modifierGroupId] ?? []).map((modifierOptionId) => ({
        modifierGroupId: g.modifierGroupId,
        modifierOptionId,
      })),
    );
    onConfirm({
      selections,
      guestNote: guestNote.trim() ? guestNote.trim() : null,
    });
  };

  return (
    <div className="pos-mod-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="pos-mod-modal__panel">
        <h3 id={titleId} className="pos-mod-modal__title">
          Configure — {line.catalogItemName}
        </h3>
        <p className="pos-mod-modal__meta">
          {needsExplicit
            ? 'Ask-every-time groups need an explicit choice before accept.'
            : 'Defaults are preselected where available. Check required groups before saving.'}
        </p>
        {groups.map((g) => (
          <fieldset key={g.modifierGroupId} className="pos-mod-modal__group">
            <legend className="pos-mod-modal__legend">
              {g.name}
              {g.required || g.askEveryTime ? ' *' : ''}
              <span className="pos-mod-modal__hint">
                {' '}
                ({g.selectionMode.toLowerCase()}, {g.minSelect}–{g.maxSelect})
              </span>
            </legend>
            <div className="pos-mod-modal__options">
              {g.options.map((o) => {
                const selected = (byGroup[g.modifierGroupId] ?? []).includes(o.modifierOptionId);
                return (
                  <label key={o.modifierOptionId} className="pos-mod-modal__option">
                    <input
                      type={g.selectionMode === 'SINGLE' ? 'radio' : 'checkbox'}
                      name={g.modifierGroupId}
                      checked={selected}
                      disabled={busy}
                      onChange={() => toggle(g, o.modifierOptionId)}
                    />
                    <span>
                      {o.name}
                      {o.priceAdjustmentMinor !== '0'
                        ? ` (+${o.priceAdjustmentMinor})`
                        : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <label className="pos-mod-modal__label">
          Guest note (non-authoritative kitchen hint)
          <input
            className="pos-mod-modal__input"
            value={guestNote}
            disabled={busy}
            maxLength={200}
            aria-label="Guest note"
            onChange={(e) => setGuestNote(e.target.value)}
          />
        </label>
        {error && (
          <p className="pos-mod-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="pos-mod-modal__actions">
          <button type="button" className="pos-mod-modal__btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="pos-mod-modal__btn pos-mod-modal__btn--primary"
            disabled={busy}
            onClick={submit}
          >
            Save modifiers
          </button>
        </div>
      </div>
    </div>
  );
}
