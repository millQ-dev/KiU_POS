/**
 * CASH1.2 CloseCashShift UI — production Cashier front door (POS-SHIFT).
 * Not Mobile SH-02 PersonalShift.
 */
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClosingCashScreen } from './ClosingCashScreen.js';
import type { OpenCashShift, SessionUser } from '../api/sessionClient.js';
import type { TerminalTopology } from './buildCashierContext.js';
import type { CompanyRealm } from './CompanyIdentificationScreen.js';

const user: SessionUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  employeeId: null,
  displayName: 'Cashier',
};

const realm: CompanyRealm = {
  companyCode: 'CAFE',
  displayName: 'Cafe',
};

const tenantId = '22222222-2222-4222-8222-222222222222';

const terminal: TerminalTopology = {
  outletId: '33333333-3333-4333-8333-333333333333',
  outletName: 'Outlet A',
  terminalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  terminalCode: 'T1',
  terminalName: 'Front',
  brandId: '44444444-4444-4444-8444-444444444444',
  brandName: 'Brand',
  legalEntityId: '55555555-5555-4555-8555-555555555555',
  legalEntityName: 'LE',
};

const shift: OpenCashShift = {
  cashShiftId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantId,
  terminalId: terminal.terminalId,
  outletId: terminal.outletId,
  status: 'OPEN',
  openingAmountMinor: '100000',
  currencyCode: 'VND',
  minorUnitExponent: 0,
  authMode: 'DIRECT_PERMISSION',
  openedAt: '2026-10-25T00:00:00.000Z',
};

function closedBody(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...shift,
    status: 'CLOSED',
    expectedAmountMinor: '100000',
    actualAmountMinor: '100000',
    differenceMinor: '0',
    varianceKind: 'BALANCED',
    closedAt: '2026-10-25T01:00:00.000Z',
    closedByUserId: user.userId,
    closeReasonText: null,
    closeIdempotencyKey: 'k',
    expectedSourceRefs: [],
    ...overrides,
  };
}

function mockFetchSequence(
  responses: Array<{ status: number; body: unknown }>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    });
  }
  return fn;
}

function renderScreen(props: Partial<ComponentProps<typeof ClosingCashScreen>> = {}) {
  return render(
    <ClosingCashScreen
      user={user}
      realm={realm}
      shift={shift}
      terminal={terminal}
      onClosed={vi.fn()}
      onCancel={vi.fn()}
      onSignOutForManager={vi.fn()}
      {...props}
    />,
  );
}

describe('ClosingCashScreen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('balanced close shows server expected/actual/difference and Done leaves', async () => {
    const onClosed = vi.fn();
    global.fetch = mockFetchSequence([
      { status: 200, body: closedBody({}) },
    ]) as unknown as typeof fetch;

    renderScreen({ onClosed });

    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() => expect(screen.getByTestId('closing-cash-success')).toBeTruthy());
    expect(screen.getByTestId('close-variance').textContent).toBe('BALANCED');
    expect(screen.getByTestId('close-expected').textContent).toMatch(/100000/);
    expect(screen.getByTestId('close-difference').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('surplus requires reason then succeeds with same idempotency key', async () => {
    const keys: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as { closeIdempotencyKey: string };
      keys.push(payload.closeIdempotencyKey);
      if (keys.length === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'REASON_REQUIRED', message: 'reason required' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          closedBody({
            actualAmountMinor: '110000',
            differenceMinor: '10000',
            varianceKind: 'SURPLUS',
            closeReasonText: 'Found notes',
            closeIdempotencyKey: payload.closeIdempotencyKey,
          }),
      };
    }) as unknown as typeof fetch;

    renderScreen();

    fireEvent.change(screen.getByTestId('close-actual-input'), { target: { value: '110000' } });
    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() => expect(screen.getByTestId('close-error')).toBeTruthy());
    fireEvent.change(screen.getByTestId('close-reason-input'), {
      target: { value: 'Found notes' },
    });
    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('close-variance').textContent).toBe('SURPLUS'),
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it('shortage without grant shows FORBIDDEN and manager sign-out path', async () => {
    const onSignOut = vi.fn();
    global.fetch = mockFetchSequence([
      {
        status: 400,
        body: { error: 'REASON_REQUIRED', message: 'reason required' },
      },
      {
        status: 403,
        body: { error: 'FORBIDDEN', message: 'Shortage close requires cash_shift.close.shortage' },
      },
    ]) as unknown as typeof fetch;

    renderScreen({ onSignOutForManager: onSignOut });

    fireEvent.change(screen.getByTestId('close-actual-input'), { target: { value: '90000' } });
    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() => expect(screen.getByTestId('close-reason-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('close-reason-input'), {
      target: { value: 'Missing cash' },
    });
    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('close-error').textContent).toMatch(/Shortage|FORBIDDEN|Permission/i),
    );
    expect(screen.getByTestId('close-manager-signout')).toBeTruthy();
    fireEvent.click(screen.getByTestId('close-manager-signout'));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('manager shortage grant succeeds', async () => {
    global.fetch = mockFetchSequence([
      {
        status: 200,
        body: closedBody({
          actualAmountMinor: '90000',
          differenceMinor: '-10000',
          varianceKind: 'SHORTAGE',
          closeReasonText: 'Manager counted',
        }),
      },
    ]) as unknown as typeof fetch;

    renderScreen({ user: { ...user, displayName: 'Manager' } });

    fireEvent.change(screen.getByTestId('close-actual-input'), { target: { value: '90000' } });
    fireEvent.change(screen.getByTestId('close-reason-input'), {
      target: { value: 'Manager counted' },
    });
    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('close-variance').textContent).toBe('SHORTAGE'),
    );
  });

  it('double-click / timeout retry reuses same idempotency key', async () => {
    const keys: string[] = [];
    let resolveFirst!: (v: unknown) => void;
    const first = new Promise((r) => {
      resolveFirst = r;
    });
    global.fetch = vi.fn().mockImplementation(async (_u: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as { closeIdempotencyKey: string };
      keys.push(payload.closeIdempotencyKey);
      if (keys.length === 1) {
        await first;
        throw new Error('network');
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          closedBody({ closeIdempotencyKey: payload.closeIdempotencyKey }),
      };
    }) as unknown as typeof fetch;

    renderScreen();

    fireEvent.click(screen.getByTestId('close-submit'));
    fireEvent.click(screen.getByTestId('close-submit')); // while busy — no second request
    resolveFirst(undefined);
    await waitFor(() => expect(screen.getByTestId('close-unknown')).toBeTruthy());
    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() => expect(screen.getByTestId('closing-cash-success')).toBeTruthy());
    expect(new Set(keys).size).toBe(1);
    expect(keys.length).toBe(2);
  });

  it('already closed surfaces error without SUCCESS', async () => {
    global.fetch = mockFetchSequence([
      {
        status: 409,
        body: { error: 'CASH_SHIFT_ALREADY_CLOSED', message: 'already closed' },
      },
    ]) as unknown as typeof fetch;

    renderScreen();

    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('close-error').textContent).toMatch(/already closed/i),
    );
    expect(screen.queryByTestId('closing-cash-success')).toBeNull();
  });

  it('does not send client expected/actor/difference fields', async () => {
    let body: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => closedBody({ closeIdempotencyKey: body.closeIdempotencyKey }),
      };
    }) as unknown as typeof fetch;

    renderScreen();
    fireEvent.click(screen.getByTestId('close-submit'));
    await waitFor(() => expect(screen.getByTestId('closing-cash-success')).toBeTruthy());
    expect(body.expectedAmountMinor).toBeUndefined();
    expect(body.differenceMinor).toBeUndefined();
    expect(body.actorUserId).toBeUndefined();
    expect(body.closedByUserId).toBeUndefined();
    expect(body.cashShiftId).toBe(shift.cashShiftId);
  });

  it('reload restores the same close idempotency key for the shift', () => {
    const first = renderScreen();
    const keyBefore = sessionStorage.getItem(`millq.closeIdempotency.${shift.cashShiftId}`);
    expect(keyBefore).toBeTruthy();
    first.unmount();
    renderScreen();
    expect(sessionStorage.getItem(`millq.closeIdempotency.${shift.cashShiftId}`)).toBe(keyBefore);
  });
});
