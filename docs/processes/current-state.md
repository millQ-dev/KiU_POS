# MillQ Current State

**Checkpoint:** CASHIER-1 Production Front Door **MERGED / CANONICAL CLOSED** (pending Origin→GitHub backup verification in merge report)  
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)  
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` = legacy rename redirect to the same repository ID)  
**Updated:** 2026-10-11

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Migration head | **031** `031_tax_domain_foundation.sql` on main (no new migration in this docs block) |
| TAX1.1 Tax runtime | **MERGED** Origin PR#74 — canonical closed |
| ADR-0033 / ADR-0034 / ADR-0037 | **ACCEPTED** |
| CASHIER-1 Production Front Door | **MERGED** Origin PR#76 |
| Fiscalization (FISC1.1) | **NOT STARTED** — production `FiscalCheckoutGate` = **UNAVAILABLE** |
| ADR-0014 Fiscalization delta | **ACCEPTED** 2026-10-10 |
| ADR-0014 / ADR-0013 Chronology Delta | **ACCEPTED** 2026-10-11 (PO ACCEPT WITH DELTAS — D + strict A; docs-only; does **not** start FISC1.1) |
| Floor/Table (R1.1) | **FROZEN / NOT STARTED** |
| C0 Cafe Operability | **IN PROGRESS** — slice = **COUNTER-SERVICE / PREPAY CAFE** |

## TAX1.1 (canonical closed)

- Origin PR **#74 MERGED**
- `tax_required` tri-state: TRUE required / FALSE explicit ABSENT / NULL undecided fail-closed
- Mixed PricingTaxMode honest; stale Tax snapshot cannot authorize Settlement after reprice
- Production FiscalCheckoutGate remains **UNAVAILABLE** — **NO FISC1.1 runtime**

## CASHIER-1 (canonical closed)

**Flow:** Company ID → PIN Session → authorized Terminal → OPEN CashShift → server-derived CashierContext → existing CashierShell

**Delivered:**
- `GET /api/v1/cash/terminals` enriched with server-derived `brandId` / `legalEntityId` (+ names)
- Session resume via `GET /api/v1/identity/session`; logout / company re-ID revoke Session
- CashShift resume without auto-opening a second shift
- `posApi` Session cookie (`credentials: 'include'`)
- DEV cashier path gated: `import.meta.env.DEV` **AND** `?devCashier=1`
- Production CashierShell without DEV context controls
- Tax / Fiscal / no-tender blocked states remain fail-closed (no fake success)

**Explicitly out:** DeviceIdentity; Quick Lock; CashShift Close; FE Tax math; fiscal success fabrication; CASH tender; Favorites / Stop/Go-list; production send policy; Floor/Table.

## Fiscal track

| Item | State |
| --- | --- |
| ADR-0014 delta | **ACCEPTED** 2026-10-10 |
| Payment collection chronology | **ACCEPTED** 2026-10-11 — `PaymentCollectionEvent.collected_at` ← affirmed `provider_occurred_at` (collection only); no `received_at` / `satisfied_at` fallback; FISC1.1 = 1 Payment + 1 fully covered Check; CASH separate later |
| FISC1.1 | **NOT STARTED** — after this Chronology docs merge + backup + ChatGPT SHA equality + explicit FISC1.1 Level B launch |
| Production FiscalCheckoutGate | **UNAVAILABLE** (fail-closed) |
| LEGAL GATE G2 | **REQUIRED** for Vietnam fiscal production go-live (not granted by this Accept) |

## Legal baseline (product reference)

- Law **108/2025/QH15** — current
- Decree **254/2026/NĐ-CP** — current from 2026-07-01
- Decree **70/2025/NĐ-CP** — expired from 2026-07-01
- Forbidden: Vietnam restaurant → fiscal `NOT_REQUIRED` shortcut

## Next

1. Merge Chronology docs PR → Origin backup → ChatGPT independent SHA equality
2. Then explicit **FISC1.1** Level B (migration `032`, Fiscal Core, `PaymentCollectionEvent` runtime) — no real provider / no G2
3. Do **not** start DeviceIdentity / Quick Lock / CashShift Close / CASH tender / R1.1 / multi-payment fiscalization

Preserve:

- no DeviceIdentity
- no Quick Lock
- no CashShift Close
- no FE Tax math
- no fiscal success fabrication
- Vietnam restaurant → `NOT_REQUIRED` shortcut forbidden
