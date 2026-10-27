#!/usr/bin/env node
/**
 * DEMO-29 golden route capture against running demo:serve (same testids as E2E).
 * Env: E2E_BASE_URL, E2E_FIXTURE_PATH, DEMO29_EVIDENCE_DIR
 */
import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.E2E_BASE_URL;
const fixturePath = process.env.E2E_FIXTURE_PATH;
const evidenceDir = process.env.DEMO29_EVIDENCE_DIR;
if (!base || !fixturePath || !evidenceDir) {
  console.error('Need E2E_BASE_URL, E2E_FIXTURE_PATH, DEMO29_EVIDENCE_DIR');
  process.exit(1);
}
mkdirSync(evidenceDir, { recursive: true });
const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));

async function shot(page, name) {
  const path = join(evidenceDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`screenshot ${name}.png`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const ledger = { startedAt: new Date().toISOString(), steps: [], ids: {} };

try {
  await page.goto(base);
  await page.getByTestId('millq-test-banner').waitFor({ timeout: 15_000 });
  await shot(page, '01-banner-company');

  await page.getByTestId('company-code-input').fill(fx.companyCode);
  await page.getByTestId('company-continue').click();
  await page.getByTestId('pin-input').fill(fx.cashierPin);
  await page.getByTestId('pin-submit').click();
  await shot(page, '02-after-pin');

  const openingScreen = page.getByTestId('opening-cash-screen');
  const cashierReady = page.getByTestId('open-close-cash-shift');
  await expect(openingScreen.or(cashierReady)).toBeVisible({ timeout: 30_000 });
  if (await openingScreen.isVisible().catch(() => false)) {
    await page.getByTestId('opening-amount-input').fill(fx.openingAmountMinor);
    await page.getByTestId('opening-submit').click();
  }
  await expect(cashierReady).toBeVisible({ timeout: 30_000 });
  await shot(page, '03-cashier-open');

  const slot = page.getByTestId(`pos-slot-${fx.eggCatalogItemId}`).first();
  await expect(slot).toBeVisible({ timeout: 30_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/pos/select-count') && r.ok(), {
      timeout: 20_000,
    }),
    slot.click(),
  ]);
  await expect(
    page.getByRole('listbox', { name: /Order lines/i }).getByRole('option', { name: /Eggs/i }),
  ).toBeVisible({ timeout: 15_000 });
  await shot(page, '04-egg-line');

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('calculate-and-accept-commercial-terms') && r.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId('accept-commercial').click(),
  ]);
  await expect(page.getByText('Commercial terms accepted')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-checkout').click();
  await expect(page.getByTestId('receive-cash-panel')).toBeVisible({ timeout: 15_000 });
  await shot(page, '05-receive-cash');

  await page.getByTestId('receive-tendered-input').fill(fx.eggPriceMinor);
  await page.getByTestId('receive-human-confirm').check();
  await page.getByTestId('receive-cash-submit').click();
  await expect(page.getByTestId('fiscal-checkout-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('fiscal-gate-blocked')).toBeVisible();
  await expect(page.getByTestId('complete-order-submit')).toHaveCount(0);
  await shot(page, '06-fiscal-blocked');

  await page.getByTestId('fiscal-issue-submit').click();
  await expect(page.getByTestId('fiscal-document-id')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('fiscal-gate-satisfied')).toBeVisible({ timeout: 20_000 });
  await shot(page, '07-fiscal-satisfied');

  const fiscalDocId = await page.getByTestId('fiscal-document-id').innerText();
  await page.getByTestId('complete-order-submit').evaluate((el) => {
    el.click();
  });
  await expect(page.getByTestId('complete-order-success')).toBeVisible({ timeout: 30_000 });
  const orderId = await page.getByTestId('complete-order-id').innerText();
  const goodsIssueId = await page.getByTestId('complete-goods-issue-id').innerText();
  ledger.ids = { fiscalDocId, orderId, goodsIssueId };
  await shot(page, '08-complete-order');

  const shiftMeta = await page.evaluate(async (terminalId) => {
    const shiftRes = await fetch(
      `/api/v1/cash/shifts/current?terminalId=${encodeURIComponent(terminalId)}`,
      { credentials: 'include' },
    );
    return shiftRes.json();
  }, fx.terminalId);
  ledger.ids.cashShiftId = shiftMeta.shift?.cashShiftId ?? null;

  await page.getByTestId('open-close-cash-shift').click();
  await expect(page.getByTestId('closing-cash-count')).toBeVisible({ timeout: 20_000 });
  const expected = String(BigInt(fx.openingAmountMinor) + BigInt(fx.eggPriceMinor));
  await page.getByTestId('close-actual-input').fill(expected);
  await page.getByTestId('close-submit').click();
  await expect(page.getByTestId('closing-cash-success')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('close-variance')).toHaveText('BALANCED');
  const expectedTxt = await page.getByTestId('close-expected').innerText();
  writeFileSync(
    join(evidenceDir, 'close-result.json'),
    JSON.stringify({ variance: 'BALANCED', expectedTxt, expected }, null, 2),
  );
  await shot(page, '09-close-balanced');

  ledger.steps = [
    'company',
    'pin',
    'open_shift',
    'add_egg',
    'accept_commercial',
    'receive_cash',
    'fiscal_blocked_then_issue',
    'complete_order',
    'close_shift',
  ];
  ledger.finishedAt = new Date().toISOString();
  ledger.ok = true;
  writeFileSync(join(evidenceDir, 'golden-capture-ledger.json'), JSON.stringify(ledger, null, 2));
  console.log('GOLDEN_CAPTURE_DONE', JSON.stringify(ledger.ids));
} catch (e) {
  await shot(page, 'ZZ-failure').catch(() => null);
  ledger.error = String(e?.stack ?? e);
  ledger.ok = false;
  writeFileSync(join(evidenceDir, 'golden-capture-ledger.json'), JSON.stringify(ledger, null, 2));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
