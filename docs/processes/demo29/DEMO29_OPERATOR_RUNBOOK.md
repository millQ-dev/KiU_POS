# DEMO29_OPERATOR_RUNBOOK — G2

**Purpose:** reproducible **loopback-only** human/browser demo of existing counter-service POS.  
**AI_RUNTIME=OFF** · **PROD_DEPLOY=NO** · **PROD_MIGRATION_036=NO**

## Prerequisites

- Local Cursor Desktop / workstation with Origin checkout at (or after) `7225085…`
- PostgreSQL able to create/drop **only** `millq_ci_pos_<unique>` databases
- Node/pnpm as per repo; Chromium via Playwright in `@millq/e2e-cash12-close`

## Safety rules

1. `DATABASE_URL` **must** match `/millq_ci_pos(_…)?/` and must **not** contain `millq_dev`.
2. Demo API binds **`127.0.0.1`** when `MILLQ_ALLOW_FISCAL_TEST_ADAPTER=1` (fail-closed if non-loopback requested).
3. No public tunnels, LAN NAT, or shared staging DBs.
4. UI shows **TEST / NOT LEGAL OR REAL PAYMENT** banner (`VITE_MILLQ_TEST_BANNER` via `vite.e2e.config.ts`).
5. Never paste PINs into chat/PRs; redact `fixture.json` before sharing.

## Start

```bash
createdb -h localhost millq_ci_pos_demo29_<unique>
export DATABASE_URL="postgresql://localhost:5432/millq_ci_pos_demo29_<unique>"
export DEMO29_API_PORT=18080          # optional fixed ports
export DEMO29_WEB_PORT=18081
export DEMO29_EVIDENCE_DIR="$PWD/docs/processes/demo29/evidence/manual-$(date +%s)"
mkdir -p "$DEMO29_EVIDENCE_DIR"

pnpm --filter @millq/e2e-cash12-close run demo:serve
```

Wait for `=== DEMO-29 READY (loopback) ===`. Open printed `WEB` URL in Chromium.

Credentials: company code printed; PIN only in `$DEMO29_EVIDENCE_DIR/fixture.json` (local).

## Operator golden route

1. Company ID → Continue  
2. Employee PIN → Sign in  
3. Select terminal if prompted → Opening float → **Open cash shift**  
4. Tap **Eggs** → basket line appears  
5. **Calculate & accept current prices**  
6. **Open checkout** → tendered = due → human confirm → ReceiveCash  
7. Confirm fiscal gate **blocked** → **Issue fiscal document** (test adapter) → gate SATISFIED  
8. **Complete order** once → note GoodsIssue id  
9. **Close cash shift** → actual = opening + Σ CASH PCE (no refunds) → BALANCED  

Optional one-shot golden (prepare + serve + capture + teardown; preferred for evidence):

```bash
export DEMO29_EVIDENCE_DIR="$PWD/docs/processes/demo29/evidence/manual-$(date +%s)"
pnpm --filter @millq/e2e-cash12-close exec node src/demo29-golden-oneshot.mjs
```

Against a running `demo:serve`, capture using the **live** temp fixture path printed at READY (not the redacted evidence copy):

```bash
export E2E_BASE_URL=http://127.0.0.1:18081
export E2E_FIXTURE_PATH=/path/from/READY/log/fixture.json
export DEMO29_EVIDENCE_DIR=...
pnpm --filter @millq/e2e-cash12-close exec node src/demo29-golden-capture.mjs
```

## Stop / teardown

1. Ctrl+C on `demo:serve` (stops API+Vite).  
2. `dropdb -h localhost millq_ci_pos_demo29_<unique>` — **only that DB**.  
3. Keep evidence screenshots under `docs/processes/demo29/evidence/` with pins redacted.

## Listen host change (this PR)

- `resolveListenHost()` in `apps/api/src/config.ts`  
- Non-production default `127.0.0.1`; production default `0.0.0.0`  
- Fiscal test adapter refuses non-loopback bind
