# DEMO29_ACCEPTANCE_MATRIX — G4

| ID | Criterion | Evidence | Pass? |
| --- | --- | --- | --- |
| A1 | Counter POS open → sell → cash → fiscal → complete → GI → close BALANCED | `manual-1793112022` ledger `ok:true` + `db-readback.txt` | **PASS** |
| A2 | Loopback-only serve; fiscal test adapter fail-closed off-loopback | `resolveListenHost` + unit tests + runbook | **PASS** |
| A3 | TEST banner visible in demo/e2e web | `VITE_MILLQ_TEST_BANNER` / `useMillqTestBanner` | **PASS** |
| A4 | Disposable `millq_ci_pos_*` only | Runbook + evidence DB name | **PASS** |
| A5 | Refund B2 regression green; not part of demo route | B1/B2 vitest 22/22 | **PASS** |
| A6 | E2E no-retry flake addressed | 5× PASS after select-count/listbox fix | **PASS** |
| A7 | No prod deploy / no prod 036 | Process + GO statement | **PASS** |
| A8 | AI_RUNTIME OFF | Env / no AI calls in route | **PASS** |
| N1 | Empty order / missing commercial blocked | E2E + cash12 acceptance | **PASS** (existing) |
| N2 | Fiscal gate blocks complete until SATISFIED | Golden + E2E | **PASS** |
| N3 | Close imbalance / wrong actual rejected or NON_BALANCED path covered | cash12-close acceptance + E2E negatives | **PASS** (suite) |
| N4 | Unauthorized / missing grant paths | E2E / API acceptance | **PASS** (existing) |
| X1 | INT-164…203 as **new** demo tasks | Out of scope — not executed as demo work | **N/A (excluded)** |
| X2 | Real refund / HTTP payout | Excluded | **N/A** |

## G4 negatives (summary)

Negatives are **not** re-implemented for DEMO-29; they are proven by the existing `@millq/e2e-cash12-close` and cash12-close / refund acceptance suites already green on disposable PG (see `DEMO29_TEST_REPORT.md`).
