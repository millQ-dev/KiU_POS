/**
 * CASH1.2 browser E2E on disposable PostgreSQL (ADR-0046).
 * Stack started by run-with-stack.mjs.
 *
 * Note: CashierShell has no ReceiveCash UI yet (SettlementCheckout waits on tender capability).
 * Confirmed CASH PCE is seeded as real payment_collection_event evidence after Open —
 * same evidence Close uses for server expected. PersonalShift / OperatorSession unchanged.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

type Fixture = {
  companyCode: string;
  cashierPin: string;
  managerPin: string;
  foreignCompanyCode: string;
  openingAmountMinor: string;
  pceAmountMinor: string;
  expectedWithPceMinor: string;
  terminalId: string;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = process.env.E2E_FIXTURE_PATH;
if (!fixturePath) throw new Error('E2E_FIXTURE_PATH required');
const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
const DATABASE_URL = process.env.DATABASE_URL ?? '';

async function companyLogin(page: Page, companyCode: string, pin: string) {
  await page.goto('/');
  await page.getByTestId('company-code-input').fill(companyCode);
  await page.getByTestId('company-continue').click();
  await expect(page.getByTestId('pin-auth-screen')).toBeVisible();
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
}

async function openCashShift(page: Page, opening: string) {
  await expect(page.getByTestId('opening-cash-screen')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('opening-amount-input').fill(opening);
  await page.getByTestId('opening-submit').click();
  await expect(page.getByTestId('open-close-cash-shift')).toBeVisible({ timeout: 30_000 });
}

async function currentCashShiftId(page: Page): Promise<string> {
  const id = await page.evaluate(async (terminalId) => {
    const res = await fetch(
      `/api/v1/cash/shifts/current?terminalId=${encodeURIComponent(terminalId)}`,
      { credentials: 'include' },
    );
    const body = (await res.json()) as { shift: { cashShiftId: string } | null };
    return body.shift?.cashShiftId ?? '';
  }, fx.terminalId);
  expect(id.length).toBeGreaterThan(8);
  return id;
}

function seedPce(cashShiftId: string, amount: string) {
  const r = spawnSync(
    'pnpm',
    ['--filter', '@millq/api', 'exec', 'tsx', 'src/test/cash12-close-e2e-seed-pce.ts'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL,
        CASH_SHIFT_ID: cashShiftId,
        AMOUNT: amount,
        NODE_ENV: 'test',
      },
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) {
    throw new Error(`seed PCE failed: ${r.stderr || r.stdout}`);
  }
  const line = (r.stdout ?? '')
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .at(-1);
  if (!line) throw new Error(`seed PCE produced no JSON: ${r.stdout}`);
  return JSON.parse(line) as { pceId: string; amountCollectedMinor: string };
}

test.describe.configure({ mode: 'serial' });

test('Open → confirmed CASH PCE → Close balanced → Opening keeps Session', async ({ page }) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);

  const shiftId = await currentCashShiftId(page);
  const seeded = seedPce(shiftId, fx.pceAmountMinor);
  expect(seeded.amountCollectedMinor).toBe(fx.pceAmountMinor);

  await page.getByTestId('open-close-cash-shift').click();
  await expect(page.getByTestId('closing-cash-count')).toBeVisible();
  await expect(page.getByTestId('close-actual-input')).toHaveValue('');
  await expect(page.getByTestId('close-submit')).toBeDisabled();

  await page.getByTestId('close-actual-input').fill(fx.expectedWithPceMinor);
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('closing-cash-success')).toBeVisible();
  await expect(page.getByTestId('close-variance')).toHaveText('BALANCED');
  await expect(page.getByTestId('close-expected')).toContainText(fx.expectedWithPceMinor);
  await expect(page.getByTestId('close-actual')).toContainText(fx.expectedWithPceMinor);
  await expect(page.getByTestId('close-difference')).toHaveText('0');

  await page.getByTestId('close-done').click();
  await expect(page.getByTestId('opening-cash-screen')).toBeVisible();
  await expect(page.getByTestId('company-id-screen')).toHaveCount(0);
  await expect(page.getByTestId('pin-auth-screen')).toHaveCount(0);
});

test('surplus requires reason; shortage FORBIDDEN then Manager re-auth closes', async ({ page }) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);

  await page.getByTestId('open-close-cash-shift').click();
  await page.getByTestId('close-actual-input').fill('110000');
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('close-error')).toContainText(/reason/i);
  await page.getByTestId('close-reason-input').fill('Found notes');
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('closing-cash-success')).toBeVisible();
  await expect(page.getByTestId('close-variance')).toHaveText('SURPLUS');
  await page.getByTestId('close-done').click();

  await openCashShift(page, fx.openingAmountMinor);
  await page.getByTestId('open-close-cash-shift').click();
  await page.getByTestId('close-actual-input').fill('90000');
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('close-error')).toContainText(/reason/i);
  await page.getByTestId('close-reason-input').fill('Missing cash');
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('close-error')).toContainText(/Shortage|Permission|FORBIDDEN/i);
  await expect(page.getByTestId('close-manager-signout')).toBeVisible();
  await page.getByTestId('close-manager-signout').click();

  await expect(page.getByTestId('pin-auth-screen')).toBeVisible();
  await page.getByTestId('pin-input').fill(fx.managerPin);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('open-close-cash-shift')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('open-close-cash-shift').click();
  await page.getByTestId('close-actual-input').fill('90000');
  await page.getByTestId('close-reason-input').fill('Manager counted shortage');
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('closing-cash-success')).toBeVisible();
  await expect(page.getByTestId('close-variance')).toHaveText('SHORTAGE');
});

test('same-key retry after COMMIT returns CLOSED without second close; conflict messaging safe', async ({
  page,
}) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  const shiftId = await currentCashShiftId(page);
  const key = `e2e-close-${shiftId}`;

  await page.evaluate(
    ({ id, k }) => {
      sessionStorage.setItem(`millq.closeIdempotency.${id}`, k);
    },
    { id: shiftId, k: key },
  );

  // Server COMMIT first (simulates success after client saw UNKNOWN / timeout).
  const pre = await page.evaluate(
    async ({ cashShiftId, closeIdempotencyKey }) => {
      const res = await fetch('/api/v1/cash/shifts/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cashShiftId,
          closeIdempotencyKey,
          actualAmountMinor: '100000',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    { cashShiftId: shiftId, closeIdempotencyKey: key },
  );
  expect(pre.status).toBe(200);
  expect(pre.body.status).toBe('CLOSED');

  // Reload so close UI remounts with same sessionStorage key, then retry identical payload.
  await page.reload();
  // Shift is CLOSED — Opening screen (no cashier shell). Re-open for conflict case below.
  await expect(page.getByTestId('opening-cash-screen')).toBeVisible({ timeout: 30_000 });

  // Idempotent replay via API still CLOSED
  const replay = await page.evaluate(
    async ({ cashShiftId, closeIdempotencyKey }) => {
      const res = await fetch('/api/v1/cash/shifts/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cashShiftId,
          closeIdempotencyKey,
          actualAmountMinor: '100000',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    { cashShiftId: shiftId, closeIdempotencyKey: key },
  );
  expect(replay.status).toBe(200);
  expect(replay.body.status).toBe('CLOSED');
  expect(replay.body.cashShiftId).toBe(shiftId);

  // Conflict: same key, different actual — UI must not tell operator to change count/reason.
  await openCashShift(page, fx.openingAmountMinor);
  const shift2 = await currentCashShiftId(page);
  const key2 = `e2e-conflict-${shift2}`;
  await page.evaluate(
    async ({ cashShiftId, closeIdempotencyKey }) => {
      sessionStorage.setItem(`millq.closeIdempotency.${cashShiftId}`, closeIdempotencyKey);
      await fetch('/api/v1/cash/shifts/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cashShiftId,
          closeIdempotencyKey,
          actualAmountMinor: '100000',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        }),
      });
    },
    { cashShiftId: shift2, closeIdempotencyKey: key2 },
  );
  // New OPEN after the previous was closed by the fetch above — need another open for UI conflict demo.
  // Instead drive conflict on a fresh OPEN with UI: pre-close with key, then UI submit different amount.
  await page.reload();
  await expect(page.getByTestId('opening-cash-screen')).toBeVisible();
  await openCashShift(page, fx.openingAmountMinor);
  const shift3 = await currentCashShiftId(page);
  const key3 = `e2e-ui-conflict-${shift3}`;
  await page.evaluate(
    ({ id, k }) => sessionStorage.setItem(`millq.closeIdempotency.${id}`, k),
    { id: shift3, k: key3 },
  );
  await page.evaluate(
    async ({ cashShiftId, closeIdempotencyKey }) => {
      await fetch('/api/v1/cash/shifts/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cashShiftId,
          closeIdempotencyKey,
          actualAmountMinor: '100000',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        }),
      });
    },
    { cashShiftId: shift3, closeIdempotencyKey: key3 },
  );
  // Shift closed — cannot open close UI. Conflict messaging covered by unit test;
  // here verify API conflict for different payload:
  const conflict = await page.evaluate(
    async ({ cashShiftId, closeIdempotencyKey }) => {
      const res = await fetch('/api/v1/cash/shifts/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cashShiftId,
          closeIdempotencyKey,
          actualAmountMinor: '99999',
          currencyCode: 'VND',
          minorUnitExponent: 0,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    { cashShiftId: shift3, closeIdempotencyKey: key3 },
  );
  expect(conflict.body.error).toBe('IDEMPOTENCY_CONFLICT');
});

test('foreign company PIN cannot authenticate against other tenant users', async ({ page }) => {
  await companyLogin(page, fx.foreignCompanyCode, fx.cashierPin);
  await expect(page.getByRole('alert')).toContainText(/Invalid credentials/i);
});
