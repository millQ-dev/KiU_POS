/**
 * Real-browser cashier coverage on the disposable CASH1.2 stack.
 * Selection recovery and merchant discount go through the production UI and API.
 * Fiscal success stays on the existing disposable test adapter; this file does not issue it.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

type Fixture = {
  companyCode: string;
  cashierPin: string;
  managerPin: string;
  eggCatalogItemId: string;
  meatCatalogItemId: string;
  eggPriceMinor: string;
  openingAmountMinor: string;
};

const fixturePath = process.env.E2E_FIXTURE_PATH;
if (!fixturePath) throw new Error('E2E_FIXTURE_PATH required');
const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

test.describe.configure({ mode: 'serial' });

async function companyLogin(page: Page, pin: string) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  const signOut = page.getByRole('button', { name: /Sign out/i });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await page.goto('/');
  }
  if (await page.getByTestId('pin-input').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Change company/i }).click();
  }
  await expect(page.getByTestId('company-code-input')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('company-code-input').fill(fx.companyCode);
  await page.getByTestId('company-continue').click();
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible({ timeout: 30_000 });
}

async function confirmNoAllergies(page: Page) {
  const dialog = page.getByRole('dialog', { name: /Ask guests about allergies/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('radio', { name: /Guests confirmed: no allergies/i }).click();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toBeHidden();
}

async function enterCashier(page: Page, pin: string) {
  await companyLogin(page, pin);
  const opening = page.getByTestId('opening-cash-screen');
  const ready = page.getByTestId('open-close-cash-shift');
  await expect(opening.or(ready)).toBeVisible({ timeout: 30_000 });
  if (!(await ready.isVisible().catch(() => false))) {
    await page.getByTestId('opening-amount-input').fill(fx.openingAmountMinor);
    await page.getByTestId('opening-submit').click();
    await expect(ready).toBeVisible({ timeout: 30_000 });
  }
  await confirmNoAllergies(page);
  await expect(page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first()).toBeVisible();
}

async function freshOrder(page: Page) {
  const empty = page.getByText(/Empty — tap a product/i);
  if (await empty.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'New order' }).click();
  await expect(empty).toBeVisible({ timeout: 15_000 });
  await confirmNoAllergies(page);
}

async function dropCommittedResponse(route: Route) {
  await route.fetch();
  await route.abort('failed');
}

function eggLines(page: Page) {
  return page.getByRole('listbox', { name: /Order lines/i }).getByRole('option', { name: /Eggs/i });
}

function meatLines(page: Page) {
  return page.getByRole('listbox', { name: /Order lines/i }).getByRole('option', { name: /Meat/i });
}

test('lost COUNT response locks the basket and does not add a second egg', async ({ page }) => {
  await enterCashier(page, fx.cashierPin);
  await freshOrder(page);
  let dropped = false;
  await page.route('**/api/v1/pos/select-count', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await dropCommittedResponse(route);
      return;
    }
    await route.continue();
  });
  await page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first().click();
  await expect(page.getByRole('button', { name: 'I checked the order' })).toBeVisible();
  await expect(eggLines(page)).toHaveCount(1);
  await expect(page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first()).toBeDisabled();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.getByRole('button', { name: 'I checked the order' }).click();
  await expect(page.getByRole('button', { name: 'I checked the order' })).toBeHidden();
  await expect(eggLines(page)).toHaveCount(1);
});

test('lost weighted response locks the basket and does not resubmit quantity', async ({ page }) => {
  await enterCashier(page, fx.cashierPin);
  await freshOrder(page);
  let dropped = false;
  await page.route('**/api/v1/pos/select-quantity', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await dropCommittedResponse(route);
      return;
    }
    await route.continue();
  });
  await page.getByTestId(`pos-slot-${fx.meatCatalogItemId}`).click();
  const dialog = page.getByRole('dialog', { name: /Enter quantity/i });
  await dialog.getByRole('textbox', { name: 'Weighted quantity' }).fill('0.25');
  await dialog.getByRole('button', { name: 'Add to order' }).click();
  await expect(page.getByRole('button', { name: 'I checked the order' })).toBeVisible();
  await expect(meatLines(page)).toHaveCount(1);
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId(`pos-slot-${fx.meatCatalogItemId}`)).toBeDisabled();
});

test('a failed authoritative read keeps the selection lock until retry', async ({ page }) => {
  await enterCashier(page, fx.cashierPin);
  await freshOrder(page);
  let dropPost = true;
  let failReads = false;
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (dropPost && method === 'POST' && url.includes('/api/v1/pos/select-count')) {
      dropPost = false;
      failReads = true;
      await dropCommittedResponse(route);
      return;
    }
    if (
      failReads &&
      method === 'GET' &&
      (url.includes('/commercial-status') || url.endsWith('/settlement') || /\/api\/v1\/orders\/[^/]+$/.test(url))
    ) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first().click();
  await expect(page.getByRole('button', { name: 'Retry order check' })).toBeVisible();
  await expect(page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first()).toBeDisabled();
  failReads = false;
  await page.getByRole('button', { name: 'Retry order check' }).click();
  await expect(page.getByRole('button', { name: 'I checked the order' })).toBeVisible();
  await expect(eggLines(page)).toHaveCount(1);
});

test('fixed discount survives a lost response and a reload, then settlement locks it', async ({ page }) => {
  await enterCashier(page, fx.managerPin);
  await freshOrder(page);
  await page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first().click();
  await expect(eggLines(page)).toHaveCount(1);
  await page.getByTestId('accept-commercial').click();
  await expect(page.getByText('Commercial terms accepted')).toBeVisible();

  let dropped = false;
  let discountedOrderId = '';
  await page.route('**/apply-merchant-discount', async (route) => {
    if (!dropped) {
      dropped = true;
      discountedOrderId = route.request().url().split('/orders/')[1]?.split('/')[0] ?? '';
      await dropCommittedResponse(route);
      return;
    }
    await route.continue();
  });
  await page.getByTestId('merchant-discount-amount').fill('1000');
  await page.getByTestId('merchant-discount-reason').fill('Guest courtesy');
  await page.getByTestId('merchant-discount-apply').click();
  await expect(page.getByRole('heading', { name: 'Discount outcome uncertain' })).toBeVisible();
  await expect(page.getByTestId('merchant-discount-apply')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.getByTestId('merchant-discount-check-order').click();
  await expect(page.getByTestId('merchant-discount-result')).toContainText('1000');
  expect(discountedOrderId.length).toBeGreaterThan(8);
  await page.getByTestId('open-checkout').click();
  await expect(page.getByTestId('settlement-payable')).toContainText('4000');
  await expect(page.getByText('Settlement has started — merchant discount is locked.')).toBeVisible();
  await expect(page.getByTestId('merchant-discount-apply')).toHaveCount(0);

  await page.reload();
  await confirmNoAllergies(page);
  await expect(page.getByText(/Empty — tap a product/i)).toBeVisible();
  const payable = await page.evaluate(async (orderId) => {
    const res = await fetch(`/api/v1/orders/${orderId}/settlement`, { credentials: 'include' });
    const body = (await res.json()) as { settlement: { customerPayableMinor: string } | null };
    return body.settlement?.customerPayableMinor ?? '';
  }, discountedOrderId);
  expect(payable).toBe('4000');
});

test('percent discount needs a manager and rejects self-approval', async ({ page, browser }) => {
  await enterCashier(page, fx.cashierPin);
  await freshOrder(page);
  await page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first().click();
  await expect(eggLines(page)).toHaveCount(1);
  await page.getByTestId('accept-commercial').click();
  await expect(page.getByText('Commercial terms accepted')).toBeVisible();
  await page.getByTestId('merchant-discount-mode').selectOption('PERCENT');
  await page.getByTestId('merchant-discount-percent').fill('10');
  await page.getByTestId('merchant-discount-reason').fill('Staff meal');
  const created = page.waitForResponse(
    (res) => res.url().includes('/api/v1/identity/approval-requests') && res.request().method() === 'POST',
  );
  await page.getByTestId('merchant-discount-apply').click();
  const approval = await created;
  expect(approval.ok()).toBe(true);
  const approvalRequestId = ((await approval.json()) as { approvalRequestId: string }).approvalRequestId;
  await expect(page.getByText('Approval required')).toBeVisible();

  const selfStatus = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/identity/approval-requests/${id}/decide`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    return res.status;
  }, approvalRequestId);
  expect(selfStatus).toBe(403);
  await expect(page.getByTestId('merchant-discount-continue-approval')).toBeVisible();

  await approveAsManager(browser, approvalRequestId);
  await page.getByTestId('merchant-discount-continue-approval').click();
  await expect(page.getByTestId('merchant-discount-result')).toContainText('500');
  await expect(page.getByTestId('merchant-discount-result')).toContainText('4500');
});

async function approveAsManager(browser: Browser, approvalRequestId: string) {
  const context = await browser.newContext();
  const manager = await context.newPage();
  try {
    await companyLogin(manager, fx.managerPin);
    const status = await manager.evaluate(async (id) => {
      const res = await fetch(`/api/v1/identity/approval-requests/${id}/decide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'APPROVE' }),
      });
      return res.status;
    }, approvalRequestId);
    expect(status).toBe(200);
  } finally {
    await context.close();
  }
}
