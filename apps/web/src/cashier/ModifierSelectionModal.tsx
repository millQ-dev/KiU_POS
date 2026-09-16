import { useEffect, useId, useMemo, useState } from 'react';
import type { ModifierGroup, ResolvedPosSlot } from '../api/types.js';
import { formatMoneyDisplay } from '../money/formatMoneyDisplay.js';
import './ModifierSelectionModal.css';

type Props = {
  slot: ResolvedPosSlot;
  busy: boolean;
  onConfirm: (selections: Array<{ groupId: string; optionIds: string[] }>) => void;
  onCancel: () => void;
};

function initialSelections(groups: ModifierGroup[]) {
  return Object.fromEntries(
    groups.map((group) => [
      group.modifierGroupId,
      group.minSelections === 1 && group.maxSelections === 1 && group.options[0]
        ? [group.options[0].modifierOptionId]
        : [],
    ]),
  ) as Record<string, string[]>;
}

export function ModifierSelectionModal({ slot, busy, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const groups = slot.modifierGroups ?? [];
  const [selected, setSelected] = useState<Record<string, string[]>>(() => initialSelections(groups));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(initialSelections(groups));
    setError(null);
  }, [slot.layoutPublicationSlotId, groups]);

  const canSubmit = useMemo(
    () => groups.every((group) => {
      const count = selected[group.modifierGroupId]?.length ?? 0;
      return count >= group.minSelections && count <= group.maxSelections;
    }),
    [groups, selected],
  );

  const toggle = (group: ModifierGroup, optionId: string) => {
    setSelected((current) => {
      const values = current[group.modifierGroupId] ?? [];
      if (values.includes(optionId)) {
        return { ...current, [group.modifierGroupId]: values.filter((id) => id !== optionId) };
      }
      if (group.maxSelections === 1) return { ...current, [group.modifierGroupId]: [optionId] };
      if (values.length >= group.maxSelections) return current;
      return { ...current, [group.modifierGroupId]: [...values, optionId] };
    });
    setError(null);
  };

  const submit = () => {
    if (!canSubmit) {
      setError('Choose the required options before adding the item.');
      return;
    }
    onConfirm(Object.entries(selected).map(([groupId, optionIds]) => ({ groupId, optionIds })));
  };

  return (
    <div className="pos-modifiers" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="pos-modifiers__panel">
        <header className="pos-modifiers__header">
          <div>
            <p className="pos-modifiers__eyebrow">Customize item</p>
            <h2 id={titleId}>{slot.displayLabel}</h2>
          </div>
          <button type="button" className="pos-modifiers__close" onClick={onCancel} disabled={busy} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pos-modifiers__content">
          {groups.map((group) => (
            <fieldset key={group.modifierGroupId} className="pos-modifiers__group">
              <legend>
                {group.label}
                <span>{group.minSelections > 0 ? 'Required' : 'Optional'}</span>
              </legend>
              <div className="pos-modifiers__options">
                {group.options.filter((option) => option.active).map((option) => {
                  const checked = selected[group.modifierGroupId]?.includes(option.modifierOptionId) ?? false;
                  const inputType = group.maxSelections === 1 ? 'radio' : 'checkbox';
                  const delta = option.priceDeltaMinor === '0' ? '' : ` · +${formatMoneyDisplay({ amountMinor: option.priceDeltaMinor, currencyCode: option.currencyCode, minorUnitExponent: option.minorUnitExponent })}`;
                  return (
                    <label key={option.modifierOptionId} className={checked ? 'pos-modifiers__option pos-modifiers__option--selected' : 'pos-modifiers__option'}>
                      <input
                        type={inputType}
                        name={group.modifierGroupId}
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggle(group, option.modifierOptionId)}
                      />
                      <span>{option.label}</span>
                      <small>{delta}</small>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {error && <p className="pos-modifiers__error" role="alert">{error}</p>}
        </div>
        <footer className="pos-modifiers__actions">
          <button type="button" className="pos-modifiers__button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="pos-modifiers__button pos-modifiers__button--primary" onClick={submit} disabled={busy}>Add to order</button>
        </footer>
      </div>
    </div>
  );
}
