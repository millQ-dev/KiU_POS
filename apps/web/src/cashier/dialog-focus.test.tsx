import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuantityEntryModal } from './QuantityEntryModal.js';
import { ModifierConfigurationModal } from './ModifierConfigurationModal.js';
import type { OrderLine, ResolvedPosSlot } from '../api/types.js';

const slot = { layoutPublicationSlotId: 's', displayLabel: 'Coffee', dimension: 'MASS', baseUnit: 'kg', unitPrice: null } as ResolvedPosSlot;
const line = { orderLineId: 'line', catalogItemName: 'Coffee' } as OrderLine;

it('keeps quantity focus within the dialog and restores the opener on Escape', () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open quantity</button>{open &&
      <QuantityEntryModal slot={slot} busy={false} onConfirm={vi.fn()} onCancel={() => setOpen(false)} />}</>;
  }
  render(<Example />);
  const opener = screen.getByRole('button', { name: 'Open quantity' });
  opener.focus();
  fireEvent.click(opener);
  const input = screen.getByLabelText('Weighted quantity');
  const last = screen.getByRole('button', { name: 'Add to order' });
  expect(document.activeElement).toBe(input);
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it('does not close a busy modifier dialog on Escape', () => {
  const cancel = vi.fn();
  render(<ModifierConfigurationModal line={line} groups={[]} busy onCancel={cancel} onConfirm={vi.fn()} />);
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(cancel).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(dialog);
});


it('wraps from the dialog container after controls become enabled', () => {
  const props = { line, groups: [], onCancel: vi.fn(), onConfirm: vi.fn() };
  const view = render(<ModifierConfigurationModal {...props} busy />);
  const dialog = screen.getByRole('dialog');
  expect(document.activeElement).toBe(dialog);
  view.rerender(<ModifierConfigurationModal {...props} busy={false} />);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save modifiers' }));
});

it('wraps Shift+Tab from the selected second radio in a single-choice group', () => {
  const groups = [{ modifierGroupId: 'g', code: 'milk', name: 'Milk', selectionMode: 'SINGLE',
    minSelect: 1, maxSelect: 1, askEveryTime: false, required: true, sortOrder: 1,
    options: [
      { modifierOptionId: 'a', code: 'a', name: 'First', sortOrder: 1, isDefault: false, priceAdjustmentMinor: '0', kitchenInstructionCode: null },
      { modifierOptionId: 'b', code: 'b', name: 'Second', sortOrder: 2, isDefault: true, priceAdjustmentMinor: '0', kitchenInstructionCode: null },
    ] }] as const;
  render(<ModifierConfigurationModal line={line} groups={groups as never} busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
  const selected = screen.getByLabelText('Second');
  selected.focus();
  fireEvent.keyDown(selected, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save modifiers' }));
});
