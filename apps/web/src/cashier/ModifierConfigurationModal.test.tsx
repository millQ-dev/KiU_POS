import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModifierConfigurationModal } from './ModifierConfigurationModal.js';
import type { CatalogModifierGroup, OrderLine } from '../api/types.js';

const line: OrderLine = {
  orderLineId: '11111111-1111-1111-1111-111111111111',
  lineNumber: 1,
  catalogItemId: '22222222-2222-2222-2222-222222222222',
  catalogItemName: 'Cappuccino',
  quantity: '1',
  unit: 'pcs',
  dimension: 'COUNT',
};

const groups: CatalogModifierGroup[] = [
  {
    modifierGroupId: '33333333-3333-3333-3333-333333333333',
    code: 'milk',
    name: 'Milk',
    selectionMode: 'SINGLE',
    minSelect: 0,
    maxSelect: 1,
    askEveryTime: true,
    required: false,
    sortOrder: 1,
    options: [
      {
        modifierOptionId: '44444444-4444-4444-4444-444444444444',
        code: 'oat',
        name: 'Oat',
        sortOrder: 1,
        isDefault: true,
        priceAdjustmentMinor: '5000',
        kitchenInstructionCode: 'MILK_OAT',
      },
    ],
  },
];

describe('ModifierConfigurationModal', () => {
  it('uses a valid default for a required group when ask-every-time is off', () => {
    const onConfirm = vi.fn();
    const requiredGroups = [{ ...groups[0]!, required: true, askEveryTime: false, minSelect: 1 }];
    render(<ModifierConfigurationModal line={line} groups={requiredGroups} busy={false}
      onCancel={() => undefined} onConfirm={onConfirm} />);
    expect((screen.getByLabelText(/Oat/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save modifiers' }));
    expect(onConfirm).toHaveBeenCalledWith({ selections: [{
      modifierGroupId: requiredGroups[0]!.modifierGroupId,
      modifierOptionId: requiredGroups[0]!.options[0]!.modifierOptionId,
    }], guestNote: null });
  });

  it('rejects a required group without an available default', () => {
    const onConfirm = vi.fn();
    const requiredGroups = [{ ...groups[0]!, required: true, askEveryTime: false, minSelect: 1,
      options: groups[0]!.options.map((option) => ({ ...option, isDefault: false })) }];
    render(<ModifierConfigurationModal line={line} groups={requiredGroups} busy={false}
      onCancel={() => undefined} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save modifiers' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('requires explicit ask-every-time selection before confirm', () => {
    const onConfirm = vi.fn();
    render(
      <ModifierConfigurationModal
        line={line}
        groups={groups}
        busy={false}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save modifiers' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Oat/));
    fireEvent.click(screen.getByRole('button', { name: 'Save modifiers' }));
    expect(onConfirm).toHaveBeenCalledWith({
      selections: [
        {
          modifierGroupId: groups[0]!.modifierGroupId,
          modifierOptionId: groups[0]!.options[0]!.modifierOptionId,
        },
      ],
      guestNote: null,
    });
  });
});
