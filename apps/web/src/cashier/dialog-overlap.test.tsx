import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AllergenPanel } from './AllergenPanel.js';
import { QuantityEntryModal } from './QuantityEntryModal.js';
import { allergenApi, type AllergenState } from '../api/allergenApi.js';
import type { ResolvedPosSlot } from '../api/types.js';

vi.mock('../api/allergenApi.js', () => ({ allergenApi: { getState: vi.fn(), resolve: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());

it('moves focus to a higher allergy dialog that opens after the quantity dialog', async () => {
  let finish!: (value: AllergenState) => void;
  vi.mocked(allergenApi.getState).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const realStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = realStyle(el, pseudo);
    if (el.classList.contains('pos-allergen-modal')) return new Proxy(style, { get: (obj, prop) => prop === 'zIndex' ? '50' : Reflect.get(obj, prop, obj) });
    if (el.classList.contains('pos-qty-modal')) return new Proxy(style, { get: (obj, prop) => prop === 'zIndex' ? '40' : Reflect.get(obj, prop, obj) });
    return style;
  });
  const cancelQuantity = vi.fn();
  render(<><AllergenPanel orderId="order" lines={[]} editable refreshKey="x" />
    <QuantityEntryModal slot={{ layoutPublicationSlotId: 's', displayLabel: 'Coffee', dimension: 'MASS', baseUnit: 'kg', unitPrice: null } as ResolvedPosSlot}
      busy={false} onCancel={cancelQuantity} onConfirm={vi.fn()} /></>);
  expect(document.activeElement).toBe(screen.getByLabelText('Weighted quantity'));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  finish({ context: null, lines: [] });
  const allergy = await screen.findByRole('dialog', { name: 'Ask guests about allergies' });
  await waitFor(() => expect(allergy.contains(document.activeElement)).toBe(true));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(cancelQuantity).not.toHaveBeenCalled();
  const first = screen.getByRole('radio', { name: 'Guests confirmed: no allergies' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  const second = screen.getByRole('radio', { name: 'Select allergens' });
  expect(second.getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement).toBe(second);
  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(allergy.contains(document.activeElement)).toBe(true);
});

it('focuses the allergy dialog when a failed load is retried', async () => {
  let finish!: (value: AllergenState) => void;
  vi.mocked(allergenApi.getState).mockReset().mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<AllergenPanel orderId="order" lines={[]} editable refreshKey="x" />);
  const retry = await screen.findByRole('button', { name: 'Retry' });
  retry.focus();
  fireEvent.click(retry);
  const allergy = await screen.findByRole('dialog', { name: 'Ask guests about allergies' });
  await waitFor(() => expect(allergy.contains(document.activeElement)).toBe(true));
  const first = screen.getByRole('radio', { name: 'Guests confirmed: no allergies' });
  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(allergy.contains(document.activeElement)).toBe(true);
  finish({ context: null, lines: [] });
});
