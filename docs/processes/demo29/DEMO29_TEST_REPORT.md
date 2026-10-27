# DEMO29_TEST_REPORT — G1

**Origin SHA:** `7225085a7cef9e8ec6b98dc44d29781139163f23` (+ this PR’s demo hardening commits)  
**Disposable DB:** `millq_ci_pos_demo29_*` on localhost (destroyed/recreated during run)  
**AI_RUNTIME:** OFF

## Commands

```bash
export DATABASE_URL='postgresql://localhost:5432/millq_ci_pos_demo29_<unique>'
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @millq/api exec vitest run \
  src/modules/payments/refund-b1.acceptance.test.ts \
  src/modules/payments/refund-b2.acceptance.test.ts \
  src/modules/cash/cash12-close.acceptance.test.ts \
  src/config.listen-host.unit.test.ts
unset CI   # Playwright retries: 0
pnpm --filter @millq/e2e-cash12-close run test:e2e   # ×5 for flake evidence
```

## Results

| Suite | Result |
| --- | --- |
| Monorepo typecheck | PASS |
| refund-b1 | **13/13 PASS** (incl. SAVEPOINT / append-only) |
| refund-b2 | **9/9 PASS** |
| cash12-close acceptance | **8/8 PASS** |
| listen-host unit | **4/4 PASS** |
| Browser E2E (no-retry) ×5 after flake fix | **5× 10/10 PASS** (`TOTAL_FAILS=0`) |

### Pre-fix flake evidence (no-retry)

| Run | Result | Failure |
| --- | --- | --- |
| 1 | 10 passed | — |
| 2 | 10 passed | — |
| 3 | **FAIL** | `sellEggAndOpenSettlement` — `waitForResponse(commercial-terms)` timed out; snapshot showed **EMPTY basket** + `EMPTY_ORDER` while Accept was clicked |

**Root cause (proven):** unscoped `getByRole('option', /Eggs/i)` / add-to-basket race — product tap did not reliably land a basket line before Accept; wrong wait URL briefly used (`select-quantity` vs **`/api/v1/pos/select-count`**).

**Fix:** wait for `select-count` POST ok; assert Eggs inside `listbox "Order lines"`; ensure empty-basket gate before Accept. Logs: `/tmp/demo29-e2e-run*.log`, `/tmp/demo29-e2e-v3-*.log`.

### Residual flake risk

After fix: **0 failures in 5 consecutive no-retry full suites** (50 test executions). Residual risk low but not zero under heavy machine load; CI may still use `retries: 1` when `CI=1`.

## Refund B2

Consumed as merged dependency only — **no payout UI / no refund in demo route**. Regression suites green on disposable PG with migration 036 applied by tests.
