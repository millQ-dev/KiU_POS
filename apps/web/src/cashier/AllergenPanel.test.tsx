import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AllergenPanel, parseAllergenCodes } from './AllergenPanel.js';
import { allergenApi, type AllergenState } from '../api/allergenApi.js';
import type { OrderLine } from '../api/types.js';

vi.mock('../api/allergenApi.js', () => ({
  allergenApi: {
    getState: vi.fn(),
    capture: vi.fn(),
    resolve: vi.fn(),
    acknowledge: vi.fn(),
  },
}));

const api = vi.mocked(allergenApi);

const line: OrderLine = {
  orderLineId: 'line-1',
  lineNumber: 1,
  catalogItemId: 'item-1',
  catalogItemName: 'Latte',
  quantity: '1',
  unit: 'ea',
  dimension: 'COUNT',
};

function stateWith(
  captureChoice: 'NO_ALLERGIES_CONFIRMED' | 'SELECT_ALLERGENS' | 'UNABLE_TO_CLARIFY',
  lines: AllergenState['lines'] = [],
  allergenCodes: string[] = [],
): AllergenState {
  return {
    context: { orderId: 'o1', captureChoice, allergenCodes, revision: 1, frozen: false },
    lines,
  };
}

function renderPanel(editable = true) {
  return render(<AllergenPanel orderId="o1" lines={[line]} editable={editable} refreshKey="k1" />);
}

describe('parseAllergenCodes', () => {
  it('normalizes, dedupes and validates codes', () => {
    expect(parseAllergenCodes('milk, egg milk')).toEqual(['EGG', 'MILK']);
    expect(parseAllergenCodes('')).toBeNull();
    expect(parseAllergenCodes('MILK; DROP')).toBeNull();
    expect(parseAllergenCodes('1X')).toBeNull();
  });
});

describe('AllergenPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.resolve.mockResolvedValue([]);
  });

  it('prompts at order start when no context exists and keeps Confirm disabled until a choice', async () => {
    api.getState.mockResolvedValue({ context: null, lines: [] });
    renderPanel();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Confirm').hasAttribute('disabled')).toBe(true);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it('captures NO_ALLERGIES_CONFIRMED', async () => {
    api.getState.mockResolvedValue({ context: null, lines: [] });
    api.capture.mockResolvedValue(stateWith('NO_ALLERGIES_CONFIRMED'));
    renderPanel();
    fireEvent.click(await screen.findByText('Guests confirmed: no allergies'));
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() =>
      expect(api.capture).toHaveBeenCalledWith('o1', {
        captureChoice: 'NO_ALLERGIES_CONFIRMED',
        allergenCodes: [],
      }),
    );
    expect(await screen.findByTestId('allergen-banner')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rejects malformed allergen codes client-side and submits normalized codes', async () => {
    api.getState.mockResolvedValue({ context: null, lines: [] });
    api.capture.mockResolvedValue(stateWith('SELECT_ALLERGENS', [], ['EGG', 'MILK']));
    renderPanel();
    fireEvent.click(await screen.findByText('Select allergens'));
    const input = screen.getByLabelText('Allergen codes');
    fireEvent.change(input, { target: { value: 'milk; drop' } });
    fireEvent.click(screen.getByText('Confirm'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/allergen codes/i);
    expect(api.capture).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'milk, egg' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() =>
      expect(api.capture).toHaveBeenCalledWith('o1', {
        captureChoice: 'SELECT_ALLERGENS',
        allergenCodes: ['EGG', 'MILK'],
      }),
    );
  });

  it('UNABLE_TO_CLARIFY explains that status stays unknown', async () => {
    api.getState.mockResolvedValue({ context: null, lines: [] });
    renderPanel();
    fireEvent.click(await screen.findByText('Unable to clarify'));
    expect(screen.getByText(/stays unknown/i)).toBeTruthy();
  });

  it('shows line results honestly and lets the cashier record guest-informed', async () => {
    api.getState.mockResolvedValue(
      stateWith('UNABLE_TO_CLARIFY', [
        {
          orderLineId: 'line-1',
          catalogItemId: 'item-1',
          result: 'REQUIRES_CONFIRMATION',
          requiredAcknowledgements: [{ kind: 'CASHIER_GUEST_INFORMED' }, { kind: 'KITCHEN_ACKNOWLEDGED' }],
          acknowledgedKinds: [],
        },
      ]),
    );
    api.resolve.mockResolvedValue(
      (await api.getState('o1')).lines,
    );
    api.acknowledge.mockResolvedValue({});
    renderPanel();
    expect(await screen.findByText(/Latte: Uncertain/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kitchen acknowledgement' })).toBeTruthy();
    fireEvent.click(screen.getByText('Guest informed'));
    await waitFor(() => expect(api.acknowledge).toHaveBeenCalledWith('o1', 'line-1', 'CASHIER_GUEST_INFORMED'));
  });

  it('flags BLOCKED lines and never labels any result as safe', async () => {
    const blocked = {
      orderLineId: 'line-1',
      catalogItemId: 'item-1',
      result: 'BLOCKED' as const,
      requiredAcknowledgements: [],
      acknowledgedKinds: [],
    };
    api.getState.mockResolvedValue(stateWith('SELECT_ALLERGENS', [blocked], ['MILK']));
    api.resolve.mockResolvedValue([blocked]);
    renderPanel();
    expect(await screen.findByText(/Blocked — contains allergen/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/\bsafe\b/i);
  });

  it('fails closed when the context cannot be loaded', async () => {
    api.getState.mockRejectedValue(new Error('network down'));
    renderPanel();
    expect((await screen.findByTestId('allergen-load-error')).textContent).toMatch(/Do not send to kitchen/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not prompt or revalidate when the order is not editable', async () => {
    api.getState.mockResolvedValue({ context: null, lines: [] });
    renderPanel(false);
    await waitFor(() => expect(api.getState).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
