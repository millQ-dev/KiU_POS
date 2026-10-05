# MillQ Current State

**Checkpoint:** STATE FREEZE / PRE-RESTAURANT AUDIT — post CASH1.1
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup mirrors observed equal @ freeze:** GitHub `millQ-dev/KiU_POS` **and** `millQ-dev/MillQ` (naming drift — reconcile which is the sole backup target)
**Origin main:** `4e47cb0f419f47c16288e9cccb3ad875526b65ce`
**Updated:** 2026-10-05

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Origin ↔ GitHub equality | **EQUAL** @ `4e47cb0` (no divergence at freeze) |
| Migration head | **029** `029_cash_shift_open.sql` (001→029 clean + idempotent PASS) |
| CASH1.1 CashShift Open | **MERGED** Origin PR#69 → `4e47cb0` |
| SEC-0 financial HTTP hardening | **MERGED** (ancestor of CASH1.1) |
| ID1.1 Identity / PIN / Session / AccessGrant | **MERGED** |
| PAY1.1 / S1.1 / C1.1 / GUEST1.1 / POS / Menu | **MERGED** (kernel + HTTP partial; see matrix) |
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** — TAX1.1 runtime **NOT STARTED** |
| ADR-0034 Tax calculation / payable composition | **OPEN** Origin PR#62 (Proposed / not Accepted on main) |
| ADR-0035 Employee Engagement docs | **OPEN** Origin PR#63 (docs lag Guest QR runtime) |
| Fiscalization runtime (FISC1.1) | **NOT STARTED** — production checkout **fail-closed** |
| Floor/Table runtime (R1.1) | **NOT STARTED** — ADR-0017 Accepted architecture only |
| Origin CI | **Not attached** as merge gate (local checks + Origin ruleset) |

## Health @ freeze (`4e47cb0`)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm build` | PASS |
| `pnpm test` | PASS — domain 79 · contracts 9 · api 321 · web 26 (**435** total) |
| Clean migrate 001→029 | PASS |
| Migrate re-run | PASS / idempotent |
| Golden Restaurant | PASS (17) — CompleteOrder requires injected fiscal gate in tests |
| SEC-0 adversarial | PASS (11) |

## Harsh maturity (summary)

Nothing is end-to-end **production-ready** for an unattended cafe open.

Closest runnable: Identity PIN + CashShift **Open** + Guest QR **read** + Orders/Settlement/Payments **core**.

Production cashier path after CashShift open is a **stub** (`CashierReadyShell`). Full POS UI requires `?devCashier=1`. CompleteOrder is **BLOCKED** without Fiscalization (default fiscal gate `UNAVAILABLE`). Reporting economics exist as **services only** (no HTTP). Master data creation is largely **SQL/seed/service**.

## Product / package rule (unchanged)

One POS engine. `PackageEntitlement` + `OutletCapabilityConfig`. No `if CORNER/CAFE/RESTAURANT` business forks. `Order ≠ Table` (ADR-0017 / ADR-0031).

## Next (decision required — do not auto-start)

1. PO accepts this State Freeze report.
2. Reconcile sole GitHub backup repo name (`KiU_POS` vs `MillQ`).
3. Decide launch order: **R1.1 Floor/Table Foundation** vs cafe-operability glue (prod CashierShell wiring + fiscal/tax path) vs reporting HTTP.
4. Do **not** start R1.1 until PO launch packet.

Full audit report lives in the agent conversation / ChatGPT handoff for this freeze — not duplicated here as architecture.
