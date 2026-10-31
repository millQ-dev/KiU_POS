import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OrderLineEditor } from './OrderLineEditor.js';
import type { OrderLine } from '../api/types.js';

const line: OrderLine = { orderLineId: 'line', lineNumber: 1, catalogItemId: 'item', catalogItemName: 'Item', quantity: '1', unit: 'pcs', dimension: 'COUNT' };

it('explains invalid COUNT values and submits a corrected quantity', () => {
  const onUpdateQuantity = vi.fn();
  render(<OrderLineEditor line={line} busy={false} editable onUpdateQuantity={onUpdateQuantity} onRemove={vi.fn()} />);
  const input = screen.getByLabelText('COUNT quantity');
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.blur(input);
  expect(screen.getByRole('alert').textContent).toContain('whole number');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(onUpdateQuantity).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '2' } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onUpdateQuantity).toHaveBeenCalledWith('2');
});

it('explains invalid weighted quantities with units and preserves decimal input', () => {
  const onUpdateQuantity = vi.fn();
  render(<OrderLineEditor line={{ ...line, dimension: 'MASS', unit: 'kg' }} busy={false} editable onUpdateQuantity={onUpdateQuantity} onRemove={vi.fn()} />);
  const input = screen.getByLabelText('MASS quantity');
  fireEvent.change(input, { target: { value: 'abc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set' }));
  expect(screen.getByRole('alert').textContent).toContain('kg');
  expect(onUpdateQuantity).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '0.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set' }));
  expect(onUpdateQuantity).toHaveBeenCalledWith('0.5');
});
