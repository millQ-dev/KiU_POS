# MillQ Current State

**Checkpoint:** C0-CHRONO1 **MERGED** Origin #116 @ `488bd049d2ab460ee63c9a7079ae06d9d0df0d95` — follow-up C0-CHRONO1.1 (Web Locks only) in flight  
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)  
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` = legacy rename redirect to the same repository ID)  
**Updated:** 2026-10-27

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Migration head | **034** `034_cash12_close_cash_shift.sql` (no new migration in C0-FISC2) |
| TAX1.1 Tax runtime | **MERGED** Origin PR#74 — canonical closed |
| ADR-0033 / ADR-0034 / ADR-0037 | **ACCEPTED** |
| CASHIER-1 Production Front Door | **MERGED** Origin PR#76 |
| Fiscalization (FISC1.1) | **MERGED** Core Runtime; production adapter default **unavailable**; C0-FISC1 test-satisfying adapter only with `MILLQ_ALLOW_FISCAL_TEST_ADAPTER=1` + disposable `millq_ci_pos_*` (no real provider / no G2) |
| C0-PAY1 ReceiveCash UI | **MERGED** Origin #110 |
| C0-FISC2 Fiscal → CompleteOrder | **MERGED** #112 — SettlementCheckout issue/reconcile + CheckoutOrchestrator advance; terminal monotonic `businessOrder`; disposable E2E |
| C0-CHRONO1 Terminal businessOrder | **MERGED** #116 @ `488bd04…` — device monotonic `businessOrder`; session-locked Complete chronology; concurrent tests |
| C0-CHRONO1.1 Web Locks only | **IN PR** — remove unsafe localStorage busy-lock; fail closed without `navigator.locks`; durable sessionStorage for Complete key/chrono |
| GitHub backup parity | **MATCH** Origin/GitHub (post-#116 `488bd04…`; refresh after each merge) |
| Origin review policy | **PO ACCEPT 2026-10-26** — formal non-author APPROVE ruleset **removed**; A=arm MWR→CI, B=Bugbot+AI review→arm MWR→CI, C=PO ACCEPT then review/CI; ChatGPT packet = PO consultation only; see `origin-independent-review.md` |
| ADR-0014 Fiscalization delta | **ACCEPTED** 2026-10-10 |
| ADR-0014 / ADR-0013 Chronology Delta | **ACCEPTED** 2026-10-11 |
| ADR-0038 C0 CASH+CARD PCE | **ACCEPTED** 2026-10-11 |
| ADR-0039 Brand/Office bootstrap | **ACCEPTED** 2026-10-11 |
| Floor/Table (R1.1) | **FROZEN / NOT STARTED** |
| C0 Cafe Operability | **IN PROGRESS** — slice = **COUNTER-SERVICE / PREPAY CAFE** |

## TAX1.1 (canonical closed)

- Origin PR **#74 MERGED**
- `tax_required` tri-state: TRUE required / FALSE explicit ABSENT / NULL undecided fail-closed
- Mixed PricingTaxMode honest; stale Tax snapshot cannot authorize Settlement after reprice
- Production FiscalCheckoutGate is FISC1.1-authoritative (default adapter unavailable ⇒ fail-closed until verified evidence)

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

**Explicitly out:** DeviceIdentity; Quick Lock; FE Tax math; fiscal success fabrication; Favorites / Stop/Go-list; production send policy; Floor/Table.

**CASH1.2 CloseCashShift:** ADR-0046 Accepted; runtime `OPEN→CLOSED` with server expected (opening + Σ CASH PCE `amount_collected_minor`); shortage grant `cash_shift.close.shortage`. Refunds / cash-in-out / RECONCILED still out.

## Fiscal track

| Item | State |
| --- | --- |
| ADR-0014 delta | **ACCEPTED** 2026-10-10 |
| Payment collection chronology | **ACCEPTED** — CARD `provider_occurred_at` + `COLLECTION_OR_CAPTURE`; CASH `ReceiveCash` server clock; no `received_at` / `satisfied_at` fallback |
| FISC1.1 Core Runtime | **MERGED** — migration 032; CASH+CARD PCE; Fiscal Core; gate wired; A4 OPEN polish → `docs/processes/review-packets/fisc11-level-c-open-items.md` |
| Production FiscalCheckoutGate | Authoritative; default **unavailable adapter** ⇒ not SATISFIED without verified evidence |
| LEGAL GATE G2 | **REQUIRED** for Vietnam fiscal production go-live (not granted by FISC1.1 Core) |

## Legal baseline (product reference)

- Law **108/2025/QH15** — current
- Decree **254/2026/NĐ-CP** — current from 2026-07-01
- Decree **70/2025/NĐ-CP** — expired from 2026-07-01
- Forbidden: Vietnam restaurant → fiscal `NOT_REQUIRED` shortcut

## Next

1. Continue C0 cafe operability inside Accepted ADRs; Level C only with separate PO ACCEPT
2. Obey MWR arming order (A after PR open; B after Bugbot+AI review on HEAD; C after PO ACCEPT)
3. No real VN provider / G2 / DeviceIdentity / R1.1 / refunds without separate decisions; no prod deploy / persistent migrate without separate PO GO

Preserve:

- no DeviceIdentity
- no Quick Lock
- no cash refunds / mid-shift cash-in-out without separate ADR
- no FE Tax math
- no fiscal success fabrication
- no LEGAL GATE G2 claim
- Vietnam restaurant → `NOT_REQUIRED` shortcut forbidden
