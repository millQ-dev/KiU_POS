# MillQ Current State

**Checkpoint:** POS v1 status correction — module readiness is not product GO  
**Tip:** Cursor Origin `main` @ `95e5cdf862634b76c47bc459cd9edbd5d047cb70` (#156)  
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)  
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` = legacy rename redirect to the same repository ID)  
**Updated:** 2026-10-30  
**This checkpoint:** Level A documentation. It does not change Accepted ADR semantics. It does not grant POS v1 GO, production deploy, or a persistent-database migrate.

Open Origin pull requests are not part of this tip. An unmerged test is not verification.

## Product readiness on this tip

Combined C0 Golden Path verified with disposable fiscal test adapter; production POSV1_NO_GO remains.

| Item | State |
| --- | --- |
| POS v1 | **POSV1_NO_GO** |
| Track P exit | **Incomplete.** Counter cash and the QR-unavailable honesty UI stay verified or declared deferred. Post-pay void stays declared deferred. QR collection and card collection are not implemented. |
| Combined C0 Golden Path | **Verified with disposable fiscal test adapter** (#154). Depot disposable PostgreSQL runs `c0-combined-golden-path.acceptance.test.ts` on a fresh `millq_ci_pos_*` database. `TEST_ACCEPTED` is not production fiscal success. Production **POSV1_NO_GO** remains. |
| KIU-MOD backend invariants | **VERIFIED 11/11** according to the KIU-MOD post-merge audit `MOD-POSTMERGE-OPERABILITY` on `017e4d3` (#150). #152 does not change modifier, order, or allergen sources, so that module verdict still applies on this tip. It is not the combined Golden Path. That audit did not re-run Postgres acceptance. |
| R1.1 Floor/Table | **HOLD.** The entry gate stays closed. `037` is already the modifier migration. See `docs/processes/next01/R1.1-IMPLEMENTATION-PROPOSAL.md`. |
| Fiscal G2 | **OPEN.** ADR-0053 sandbox accept does not close G2-01 through G2-18 and does not authorize production issuance. #152 adds local sandbox binding and intent recovery. That path does not call a provider and does not satisfy `FiscalCheckoutGate`. |
| QR / card collection | **Not implemented.** An honesty screen is not collection. |
| Offline sync | **Not implemented.** ADR-0018 is Accepted. There is no POS sync runtime. |
| Cashier merchant discount UI | **Present (UI).** CashierShell/OrderBasket hosts `MerchantDiscountPanel` against ADR-0051 apply + ApprovalRequest. FIXED_MINOR / PERCENT, mandatory reason, manager approval when the cashier lacks `orders.merchant_discount.approve`, server totals from the apply response, durable idempotency for lost responses, locked after settlement opens. No new permissions or money rules. Disposable PostgreSQL Playwright coverage is `apps/e2e-cash12-close/src/cashier-select-discount.browser.spec.ts`, required in the Depot disposable PostgreSQL job together with the existing CASH1.2 browser suite. The stack uses the disposable fiscal test adapter only. A full page reload still opens a new in-memory order; the original settlement payable is read back with an authenticated GET. |

The eleven KIU-MOD invariants, as that audit recorded them:

1. Published groups, defaults, mandatory selection, configured counts.
2. `askEveryTime`.
3. Per-unit signed price and ADR-0030 rounding.
4. Frozen configuration fingerprint.
5. Stale configuration rejection.
6. Kitchen instruction codes versus `guestNote`.
7. Allergy-aware Effective Recipe.
8. REMOVE / REPLACE / ADD, unit conversion, and yield.
9. Exactly one GoodsIssue on completion.
10. Publish grant versus configure grant, tenant, and outlet.
11. Idempotency, concurrency, and retry.

That audit reported no accepted-scope backend defect. It also recorded that there is no separate kitchen-release command: configuration is enforced at commercial accept and again at completion, and the kitchen ticket is a read of the frozen snapshot.

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Migration head | **041** `041_restaurant_imprint_foundation.sql`. Sequence on this tip: **037** modifier Effective Recipe, **038** merchant discount, **039** allergen M6, **040** replace yield, **041** imprint foundation. Disposable/CI only. **Not** a production migrate GO. Do not reserve the next number before an implementation PR. |
| ADR-0048 Payments Refund | **ACCEPTED WITH DELTAS** 2026-10-27; B1 #120 merged; B2 = human CASH confirm → MONEY_RETURNED + expected − at Close; VietQR adapter blocked; G2 / FiscalCorrectionPolicy still OPEN; no HTTP payout API; no prod migrate GO |
| TAX1.1 Tax runtime | **MERGED** Origin PR#74 — canonical closed |
| ADR-0033 / ADR-0034 / ADR-0037 | **ACCEPTED** |
| CASHIER-1 Production Front Door | **MERGED** Origin PR#76 |
| Fiscalization (FISC1.1) | **MERGED** Core Runtime; production adapter default **unavailable**; C0-FISC1 test-satisfying adapter only with `MILLQ_ALLOW_FISCAL_TEST_ADAPTER=1` + disposable `millq_ci_pos_*` (no real provider / no G2) |
| C0-PAY1 ReceiveCash UI | **MERGED** Origin #110 |
| C0-FISC2 Fiscal → CompleteOrder | **MERGED** #112 — SettlementCheckout issue/reconcile + CheckoutOrchestrator advance; terminal monotonic `businessOrder`; disposable E2E |
| C0-CHRONO1 Terminal businessOrder | **MERGED** #116 @ `488bd04…` — device monotonic `businessOrder`; session-locked Complete chronology |
| C0-CHRONO1.1 Web Locks only | **MERGED** #117 @ `2ae1472…` — Web Locks only (no localStorage busy-lock); fail closed without `navigator.locks`; durable sessionStorage for Complete key/chrono; Playwright uses production hooks |
| GitHub backup parity | Not re-checked by this correction. Origin `main` is the source of truth. The old MATCH line at `de1e799` is stale. |
| Origin review policy | **PO ACCEPT 2026-10-26** — formal non-author APPROVE ruleset **removed**; A=arm MWR→CI, B=Bugbot+AI review→arm MWR→CI, C=PO ACCEPT then review/CI; ChatGPT packet = PO consultation only; see `origin-independent-review.md` |
| ADR-0014 Fiscalization delta | **ACCEPTED** 2026-10-10 |
| ADR-0014 / ADR-0013 Chronology Delta | **ACCEPTED** 2026-10-11 |
| ADR-0038 C0 CASH+CARD PCE | **ACCEPTED** 2026-10-11 |
| ADR-0039 Brand/Office bootstrap | **ACCEPTED** 2026-10-11 |
| Floor/Table (R1.1) | **HOLD / NOT STARTED** — entry gate closed; no floor module and no floor migration. ADR-0017 stays Accepted and is not reopened here. |
| DEMO-29 | **CLOSED** — `DEMO29_GO` for the tableless counter cash path; evidence `docs/processes/demo29/evidence/manual-1793112022/`. This is not the combined Golden Path. |
| NEXT-01 Track P | **Exit incomplete.** Counter cash verified. QR honesty declared deferred. Modifier backend is module-verified. Cashier discount UI is missing. QR/card collect is not implemented. |
| NEXT-02 | **MERGED** #124 — QR/card unavailable honesty + sale success polish. Honesty does not flip POSV1_GO. |
| NEXT-03 | Prep closed by PO ACCEPT 2026-10-28 (historical `NEXT03_*`). M1–M8 and D1–D6 stay accepted. |
| NEXT-04 verticals | **MERGED** on this tip, not in progress: modifier domain #127, modifier UI #129, merchant discount #130, allergen M6 #131, per-unit price #138, Effective Recipe #139, M4/M5/M7/T8 #143, discount HALF_UP #144, cash12 allergy answer #145, combined golden path #154. **POSV1_NO_GO** remains. |
| ADR-0049 Modifier / Effective Recipe v1 | **ACCEPTED** 2026-10-28. Semantics unchanged by this correction. |
| ADR-0050 Order-local allergen M6 | **ACCEPTED** 2026-10-28. Semantics unchanged by this correction. |
| ADR-0051 ApplyOrderMerchantDiscount | **ACCEPTED** 2026-10-28. Semantics unchanged by this correction. |
| ADR-0053 Fiscal sandbox | **ACCEPTED WITH CHANGES** 2026-10-29. Sandbox boundary only. G2 stays open. |
| ADR-0054 Restaurant Imprint | **ACCEPTED** 2026-10-29. Persistence and adapters through #150. Not a POS v1 GO. |
| C0 Cafe Operability | Counter/prepay cafe cash path proven via DEMO-29. Combined C0 Golden Path verified with disposable fiscal test adapter; production POSV1_NO_GO remains. |

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
- If an add-product response is uncertain, CashierShell locks the work area, reads the order, commercial and settlement state, and asks the operator to inspect it. A failed read remains locked and may be retried; the add-product POST is never automatically replayed. A GET is only a snapshot and cannot prove a still-running POST has finished. The operator must not assume an absent line means the original request failed; a server-side operation identity/completion contract is a follow-up, not part of this UI change. Recovery state is in-memory and does not provide order recovery across reloads.

**Explicitly out:** DeviceIdentity; Quick Lock; FE Tax math; fiscal success fabrication; Favorites / Stop/Go-list; production send policy; Floor/Table.

**CASH1.2 CloseCashShift:** ADR-0046 Accepted; runtime `OPEN→CLOSED` with server expected = opening + Σ CASH PCE `amount_collected_minor` − Σ MONEY_RETURNED CASH refunds bound to `cash_shift_id` (ADR-0048 B2); shortage grant `cash_shift.close.shortage`. Cash-in-out (ADR-0047) / RECONCILED still out.

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

1. Track P stays incomplete. The cashier merchant-discount screen is present. QR collection, card collection, and post-pay void stay as recorded above. Combined C0 Golden Path verified with disposable fiscal test adapter; production POSV1_NO_GO remains. This file does not assign the remaining work.
2. R1.1 Floor/Table stays HOLD. The written entry gate is still closed. Do not start Floor runtime, and do not reserve a migration number, until that gate is opened on purpose.
3. Obey MWR arming order (A after PR open; B after Bugbot+AI review on HEAD; C after PO ACCEPT)
4. No VietQR payout / G2 claim / DeviceIdentity / fabricated paid QR; no prod deploy / persistent migrate without separate PO GO

Preserve:

- no DeviceIdentity
- no Quick Lock
- no mid-shift cash-in-out without ADR-0047 Accept
- no fictitious CASH MONEY_RETURNED (handover evidence required); no VietQR payout without provider evidence
- no FE Tax math
- no fiscal success fabrication
- no LEGAL GATE G2 claim
- Vietnam restaurant → `NOT_REQUIRED` shortcut forbidden
- no CHRONO1.1 model reopen
