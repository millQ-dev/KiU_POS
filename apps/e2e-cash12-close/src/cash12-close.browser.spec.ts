/**
 * C0-PAY1 / C0-FISC2 / CASH1.2 browser E2E on disposable PostgreSQL.
 * Real tender path: Product → Tax → Settlement → ReceiveCash → Fiscal → CompleteOrder → GI → Close.
 * No PCE/payment/fiscal evidence seed. Test adapter only via MILLQ_ALLOW_FISCAL_TEST_ADAPTER=1.
 * Stack started by run-with-stack.mjs.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type Fixture = {
  companyCode: string;
  cashierPin: string;
  managerPin: string;
  noReceivePin: string;
  foreignCompanyCode: string;
  foreignTerminalId: string;
  openingAmountMinor: string;
  eggCatalogItemId: string;
  eggPriceMinor: string;
  tenderDefinitionId: string;
  disabledTenderDefinitionId: string;
  overpayTenderedMinor: string;
  expectedChangeMinor: string;
  expectedCollectedMinor: string;
  expectedCloseMinor: string;
  terminalId: string;
};

const fixturePath = process.env.E2E_FIXTURE_PATH;
if (!fixturePath) throw new Error('E2E_FIXTURE_PATH required');
const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

async function companyLogin(page: Page, companyCode: string, pin: string) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  // Serial suite reuses disposable DB — prior OPEN CashShift may auto-bind after PIN.
  const signOut = page.getByRole('button', { name: /Sign out/i });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await page.goto('/');
  }
  if (await page.getByTestId('pin-input').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Change company/i }).click();
  }
  await expect(page.getByTestId('company-code-input')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('company-code-input').fill(companyCode);
  await page.getByTestId('company-continue').click();
  await expect(page.getByTestId('pin-input')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
}

/**
 * Synthetic guest answers the mandatory order-local allergy question in the
 * production dialog. Explicit NO_ALLERGIES_CONFIRMED only — not a product
 * default and not a bypass of allergen validation.
 */
async function confirmNoAllergies(page: Page) {
  const allergyDialog = page.getByRole('dialog', { name: /Ask guests about allergies/i });
  await expect(allergyDialog).toBeVisible();
  await allergyDialog.getByRole('radio', { name: /Guests confirmed: no allergies/i }).click();
  await allergyDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(allergyDialog).toBeHidden();
}

async function openCashShift(page: Page, opening: string) {
  // Disposable DB may already have OPEN CashShift — OpeningCashScreen auto-binds.
  const openingScreen = page.getByTestId('opening-cash-screen');
  const cashierReady = page.getByTestId('open-close-cash-shift');
  await expect(openingScreen.or(cashierReady)).toBeVisible({ timeout: 30_000 });
  if (!(await cashierReady.isVisible().catch(() => false))) {
    await page.getByTestId('opening-amount-input').fill(opening);
    await page.getByTestId('opening-submit').click();
    await expect(cashierReady).toBeVisible({ timeout: 30_000 });
  }
  // CashierShell auto-opens an editable order. The capture dialog covers the shell
  // until this guest answers, including close-shift paths that never sell.
  await confirmNoAllergies(page);
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

/** SessionStorage key written by SettlementCheckout when receive panel mounts. */
async function receiveKeyContext(page: Page): Promise<{ checkId: string; key: string }> {
  const ctx = await page.evaluate(() => {
    const storageKeys = Object.keys(sessionStorage).filter((k) =>
      k.startsWith('millq.receiveCashIdempotency.'),
    );
    if (storageKeys.length === 0) return null;
    const storageKey = storageKeys[0]!;
    return {
      checkId: storageKey.slice('millq.receiveCashIdempotency.'.length),
      key: sessionStorage.getItem(storageKey) ?? '',
    };
  });
  expect(ctx?.checkId).toBeTruthy();
  expect(ctx?.key.length).toBeGreaterThan(8);
  return ctx!;
}

async function sellEggAndOpenSettlement(page: Page) {
  // Prefer a fresh editable order — prior serial tests may leave SATISFIED basket.
  const abort = page.getByTestId('abort-checkout');
  if (await abort.isVisible().catch(() => false)) {
    await abort.click();
  }
  const newOrder = page.getByRole('button', { name: /New order/i });
  if (await newOrder.isVisible().catch(() => false) &&
      !(await page.getByText(/Empty — tap a product/i).isVisible().catch(() => false))) {
    await newOrder.click();
    await expect(page.getByText(/Empty — tap a product/i)).toBeVisible({ timeout: 15_000 });
    // A replacement order has no allergen context yet.
    await confirmNoAllergies(page);
  }
  // Egg is on both Quick Access and page grid — same catalogItemId testid.
  const slot = page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first();
  await expect(slot).toBeVisible({ timeout: 30_000 });
  await expect(slot).toBeEnabled();
  const eggLine = page.getByRole('listbox', { name: /Order lines/i }).getByRole('option', {
    name: /Eggs/i,
  });
  // COUNT tap uses /api/v1/pos/select-count (not select-quantity). Scope Eggs to basket listbox
  // so product-tile text cannot false-pass while the basket stays empty.
  if ((await eggLine.count()) === 0) {
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/pos/select-count') &&
          r.request().method() === 'POST' &&
          r.ok(),
        { timeout: 20_000 },
      ),
      slot.click(),
    ]);
  }
  await expect(eggLine).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Empty — tap a product/i)).toHaveCount(0);
  const accept = page.getByTestId('accept-commercial');
  await expect(accept).toBeEnabled({ timeout: 15_000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('calculate-and-accept-commercial-terms') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 20_000 },
    ),
    accept.click(),
  ]);
  await expect(page.getByText('Commercial terms accepted')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-checkout').click();
  await expect(page.getByTestId('settlement-state')).toContainText('COLLECTING', { timeout: 15_000 });
  await expect(page.getByTestId('receive-cash-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('receive-tender-select')).toBeVisible();
}

async function receiveCashUi(page: Page, tendered: string) {
  await page.getByTestId('receive-tendered-input').fill(tendered);
  await page.getByTestId('receive-human-confirm').check();
  await page.getByTestId('receive-cash-submit').click();
}

test.describe.configure({ mode: 'serial' });

test('C0-FISC2 full path: ReceiveCash → Fiscal SATISFIED → CompleteOrder → one GI → Close', async ({
  page,
}) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);
  await receiveCashUi(page, fx.eggPriceMinor);

  await expect(page.getByTestId('receive-cash-success')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('settlement-satisfied')).toBeVisible();
  await expect(page.getByTestId('fiscal-checkout-panel')).toBeVisible();
  await expect(page.getByTestId('fiscal-gate-blocked')).toBeVisible();
  await expect(page.getByTestId('complete-order-submit')).toHaveCount(0);

  await page.getByTestId('fiscal-issue-submit').click();
  await expect(page.getByTestId('fiscal-document-id')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('fiscal-gate-satisfied')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('complete-order-panel')).toBeVisible();

  const paymentId = await page.getByTestId('receive-payment-id').innerText();
  const pceId = await page.getByTestId('receive-pce-id').innerText();
  const fiscalDocId = await page.getByTestId('fiscal-document-id').innerText();

  await page.getByTestId('complete-order-submit').evaluate((el: HTMLButtonElement) => {
    el.click();
    el.click();
  });
  await expect(page.getByTestId('complete-order-success')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('complete-order-status')).toContainText(/COMPLETED/i);
  const completedOrderId = await page.getByTestId('complete-order-id').innerText();
  const goodsIssueId = await page.getByTestId('complete-goods-issue-id').innerText();

  expect(paymentId.length).toBeGreaterThan(8);
  expect(pceId.length).toBeGreaterThan(8);
  expect(fiscalDocId.length).toBeGreaterThan(8);
  expect(completedOrderId.length).toBeGreaterThan(8);
  expect(goodsIssueId.length).toBeGreaterThan(8);
  await expect(page.getByTestId('complete-goods-issue-id')).toHaveCount(1);

  const orderProof = await page.evaluate(async (orderId) => {
    const res = await fetch(`/api/v1/orders/${orderId}`, { credentials: 'include' });
    return { status: res.status, body: await res.json() };
  }, completedOrderId);
  expect(orderProof.status).toBe(200);
  expect(String(orderProof.body.status).toUpperCase()).toBe('COMPLETED');
  expect(orderProof.body.consumptionPlanId).toBeTruthy();

  // New-order transition after completion (feedback + locked basket both mention it).
  await expect(page.getByText(/Order COMPLETED/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/editing disabled/i)).toBeVisible();

  await page.getByTestId('open-close-cash-shift').click();
  await expect(page.getByTestId('closing-cash-count')).toBeVisible();
  await page.getByTestId('close-actual-input').fill(fx.expectedCloseMinor);
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('closing-cash-success')).toBeVisible();
  await expect(page.getByTestId('close-variance')).toHaveText('BALANCED');
  await page.getByTestId('close-done').click();
  await expect(page.getByTestId('opening-cash-screen')).toBeVisible();
});

test('Open → Product → ReceiveCash overpay → SATISFIED (fiscal pending) → Close without CompleteOrder', async ({
  page,
}) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);

  await page.getByTestId('receive-tendered-input').fill(fx.overpayTenderedMinor);
  await expect(page.getByTestId('receive-change-preview')).toContainText(fx.expectedChangeMinor);
  await page.getByTestId('receive-human-confirm').check();
  await page.getByTestId('receive-cash-submit').click();

  await expect(page.getByTestId('receive-cash-success')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('receive-money-facts')).toContainText(
    `${fx.eggPriceMinor} / ${fx.overpayTenderedMinor} / ${fx.expectedChangeMinor}`,
  );
  await expect(page.getByTestId('receive-pce-collected')).toContainText(fx.expectedCollectedMinor);
  await expect(page.getByTestId('settlement-satisfied')).toBeVisible();
  await expect(page.getByTestId('fiscal-gate-blocked')).toContainText(/CompleteOrder/i);
  await expect(page.getByTestId('complete-order-submit')).toHaveCount(0);

  await page.getByTestId('open-close-cash-shift').click();
  await expect(page.getByTestId('closing-cash-count')).toBeVisible();
  await page.getByTestId('close-actual-input').fill(fx.expectedCloseMinor);
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('closing-cash-success')).toBeVisible();
  await expect(page.getByTestId('close-variance')).toHaveText('BALANCED');
  await expect(page.getByTestId('close-expected')).toContainText(fx.expectedCloseMinor);
  await expect(page.getByTestId('close-difference')).toHaveText('0');
  await page.getByTestId('close-done').click();
  await expect(page.getByTestId('opening-cash-screen')).toBeVisible();
});

test('double-click Confirm does not double-collect', async ({ page }) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);

  await page.getByTestId('receive-tendered-input').fill(fx.eggPriceMinor);
  await page.getByTestId('receive-human-confirm').check();
  // Fire two clicks without waiting for disabled state — ReceiveCash must not double-collect.
  await page.getByTestId('receive-cash-submit').evaluate((el: HTMLButtonElement) => {
    el.click();
    el.click();
  });
  await expect(page.getByTestId('receive-cash-success')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('settlement-satisfied')).toBeVisible();
  await expect(page.getByTestId('receive-cash-success')).toHaveCount(1);
});

test('loss of response after COMMIT: same-key replay duplicate; amount change conflicts', async ({
  page,
}) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);
  const { checkId, key } = await receiveKeyContext(page);

  const first = await page.evaluate(
    async ({ checkId, key, tenderDefinitionId, terminalId, amountTenderedMinor }) => {
      const res = await fetch('/api/v1/payments/receive-cash', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settlementCheckId: checkId,
          tenderDefinitionId,
          terminalId,
          receiveIdempotencyKey: key,
          amountTenderedMinor,
          humanConfirmation: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      checkId,
      key,
      tenderDefinitionId: fx.tenderDefinitionId,
      terminalId: fx.terminalId,
      amountTenderedMinor: fx.eggPriceMinor,
    },
  );
  expect(first.status).toBe(200);
  expect(first.body.payment?.paymentId).toBeTruthy();

  const replay = await page.evaluate(
    async ({ checkId, key, tenderDefinitionId, terminalId, amountTenderedMinor }) => {
      const res = await fetch('/api/v1/payments/receive-cash', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settlementCheckId: checkId,
          tenderDefinitionId,
          terminalId,
          receiveIdempotencyKey: key,
          amountTenderedMinor,
          humanConfirmation: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      checkId,
      key,
      tenderDefinitionId: fx.tenderDefinitionId,
      terminalId: fx.terminalId,
      amountTenderedMinor: fx.eggPriceMinor,
    },
  );
  expect(replay.status).toBe(200);
  expect(replay.body.duplicate).toBe(true);
  expect(replay.body.payment?.paymentId).toBe(first.body.payment.paymentId);
  expect(replay.body.collectionEvent?.paymentCollectionEventId).toBe(
    first.body.collectionEvent.paymentCollectionEventId,
  );

  const conflict = await page.evaluate(
    async ({ checkId, key, tenderDefinitionId, terminalId }) => {
      const res = await fetch('/api/v1/payments/receive-cash', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settlementCheckId: checkId,
          tenderDefinitionId,
          terminalId,
          receiveIdempotencyKey: key,
          amountTenderedMinor: '99999',
          humanConfirmation: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      checkId,
      key,
      tenderDefinitionId: fx.tenderDefinitionId,
      terminalId: fx.terminalId,
    },
  );
  expect(conflict.body.error).toBe('IDEMPOTENCY_CONFLICT');
});

test('missing payments.receive_cash grant → FORBIDDEN', async ({ page }) => {
  await companyLogin(page, fx.companyCode, fx.noReceivePin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);
  await receiveCashUi(page, fx.eggPriceMinor);
  await expect(page.getByTestId('receive-forbidden')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('settlement-satisfied')).toHaveCount(0);
});

test('disabled tender fail-closed; closed shift reject', async ({ page }) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);
  const { checkId } = await receiveKeyContext(page);

  const disabledAttempt = await page.evaluate(
    async ({ checkId, disabledTenderDefinitionId, terminalId, amountTenderedMinor }) => {
      const res = await fetch('/api/v1/payments/receive-cash', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settlementCheckId: checkId,
          tenderDefinitionId: disabledTenderDefinitionId,
          terminalId,
          receiveIdempotencyKey: `disabled-${crypto.randomUUID()}`,
          amountTenderedMinor,
          humanConfirmation: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      checkId,
      disabledTenderDefinitionId: fx.disabledTenderDefinitionId,
      terminalId: fx.terminalId,
      amountTenderedMinor: fx.eggPriceMinor,
    },
  );
  expect(disabledAttempt.status).toBeGreaterThanOrEqual(400);
  expect(['TENDER_DISABLED', 'VALIDATION', 'NOT_FOUND']).toContain(disabledAttempt.body.error);

  const shiftId = await currentCashShiftId(page);
  // Prior serial tests may have CASH PCE on this OPEN shift — surplus+reason closes reliably.
  const closedOk = await page.evaluate(
    async ({ cashShiftId }) => {
      const res = await fetch('/api/v1/cash/shifts/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cashShiftId,
          closeIdempotencyKey: `e2e-close-before-rcv-${cashShiftId}`,
          actualAmountMinor: '500000',
          currencyCode: 'VND',
          minorUnitExponent: 0,
          reasonText: 'e2e force close before receive reject',
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    { cashShiftId: shiftId },
  );
  expect(closedOk.status).toBe(200);
  expect(closedOk.body.status).toBe('CLOSED');

  const closedAttempt = await page.evaluate(
    async ({ checkId, tenderDefinitionId, terminalId, amountTenderedMinor }) => {
      const res = await fetch('/api/v1/payments/receive-cash', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settlementCheckId: checkId,
          tenderDefinitionId,
          terminalId,
          receiveIdempotencyKey: `closed-${crypto.randomUUID()}`,
          amountTenderedMinor,
          humanConfirmation: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      checkId,
      tenderDefinitionId: fx.tenderDefinitionId,
      terminalId: fx.terminalId,
      amountTenderedMinor: fx.eggPriceMinor,
    },
  );
  expect(closedAttempt.status).toBeGreaterThanOrEqual(400);
  expect(String(closedAttempt.body.error ?? closedAttempt.body.message)).toMatch(
    /SHIFT|CLOSED|OPEN|VALIDATION|FORBIDDEN|NOT_FOUND/i,
  );
});

test('foreign company PIN cannot authenticate; foreign terminal isolation', async ({ page }) => {
  await companyLogin(page, fx.foreignCompanyCode, fx.cashierPin);
  await expect(page.getByRole('alert')).toContainText(/Invalid credentials/i);

  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);
  const { checkId } = await receiveKeyContext(page);

  const iso = await page.evaluate(
    async ({ checkId, tenderDefinitionId, foreignTerminalId, amountTenderedMinor }) => {
      const res = await fetch('/api/v1/payments/receive-cash', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settlementCheckId: checkId,
          tenderDefinitionId,
          terminalId: foreignTerminalId,
          receiveIdempotencyKey: `iso-${crypto.randomUUID()}`,
          amountTenderedMinor,
          humanConfirmation: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      checkId,
      tenderDefinitionId: fx.tenderDefinitionId,
      foreignTerminalId: fx.foreignTerminalId,
      amountTenderedMinor: fx.eggPriceMinor,
    },
  );
  expect(iso.status).toBeGreaterThanOrEqual(400);
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
  // Re-auth remounts CashierShell, which opens a new order and asks again.
  await confirmNoAllergies(page);
  await page.getByTestId('open-close-cash-shift').click();
  await page.getByTestId('close-actual-input').fill('90000');
  await page.getByTestId('close-reason-input').fill('Manager counted shortage');
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('closing-cash-success')).toBeVisible();
  await expect(page.getByTestId('close-variance')).toHaveText('SHORTAGE');
});

test('tendered less than due stays rejected in UI', async ({ page }) => {
  await companyLogin(page, fx.companyCode, fx.cashierPin);
  await openCashShift(page, fx.openingAmountMinor);
  await sellEggAndOpenSettlement(page);
  await page.getByTestId('receive-tendered-input').fill('1');
  await expect(page.getByText(/less than due|partial tender/i)).toBeVisible();
  await page.getByTestId('receive-human-confirm').check();
  await expect(page.getByTestId('receive-cash-submit')).toBeDisabled();
});

/**
 * C0-CHRONO1.1: two same-origin windows must not silently share businessOrder.
 * Calls the production helper via window.__millqTerminalChronology (installed in DEV App).
 */
test('two parallel windows allocate distinct terminal businessOrders via production helper', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await pageA.goto('/');
  await pageB.goto('/');
  await expect
    .poll(async () =>
      pageA.evaluate(() => Boolean(window.__millqTerminalChronology?.allocateTerminalBusinessChronology)),
    )
    .toBe(true);
  await pageA.evaluate(() => localStorage.clear());

  const allocateInPage = (page: Page, terminalId: string, n: number) =>
    page.evaluate(
      async ({ terminalId, n }) => {
        const hooks = window.__millqTerminalChronology;
        if (!hooks?.allocateTerminalBusinessChronology) {
          throw new Error('production chronology hooks missing');
        }
        const now = new Date('2026-10-27T04:00:00.000Z');
        const out: number[] = [];
        for (let i = 0; i < n; i++) {
          const chrono = await hooks.allocateTerminalBusinessChronology({
            terminalId,
            timeZone: 'UTC',
            now,
          });
          out.push(chrono.businessOrder);
        }
        return out;
      },
      { terminalId, n },
    );

  const [a, b] = await Promise.all([
    allocateInPage(pageA, fx.terminalId, 8),
    allocateInPage(pageB, fx.terminalId, 8),
  ]);
  const all = [...a, ...b].sort((x, y) => x - y);
  expect(all).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  expect(new Set(all).size).toBe(16);

  await context.close();
});
