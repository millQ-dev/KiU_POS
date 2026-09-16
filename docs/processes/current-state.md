# MillQ Current State

**Checkpoint:** S1.1 Settlement / Checkout Runtime Foundation — **CLOSED**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror; may resolve as `millQ-dev/KiU_POS`)
**Origin main:** `6022910362307b32f88604af451982e0a0c7112b` (Origin == GitHub)
**S1.1 PR:** https://cursor.com/codebase/millqdev/MillQ/pull/53 — **merged**
**Base:** `c94afe0065200a2d07ab684815cc13cc741b53bf`
**Updated:** 2026-09-17

## Runtime / CI / backup

| Item | State |
| --- | --- |
| ADR-0032 Checkout & Settlement Orchestration | **ACCEPTED** |
| S1.1 Settlement / Checkout Runtime Foundation | **CLOSED** @ `6022910…` (PR #53) |
| Payments Core Runtime | **NEXT** — not started |
| Payment provider adapters | **NOT STARTED** |
| Fiscalization runtime | **NOT STARTED** |
| Tax / cash denomination / residual split rounding | **NOT DEFINED / NOT STARTED** |
| Capability / PackageEntitlement runtime | **ABSENT** — DEV cashier uses Settlement path directly |
| GitHub backup | **MATCH** @ `6022910…` |

## S1.1 — delivered

- Migrations **018** + **019**: SettlementGroup, Payable Snapshot, Check, CheckLineAllocation
- OpenSettlement / AbortSettlement / backend edit lock (incl. CancelOrder)
- Exact Check + line conservation; no residual auto-rounding
- QualifyingPaymentCoverageReader (consumption only; empty in production)
- FiscalCheckoutGate fail-closed UNAVAILABLE
- CheckoutOrchestrator → CompleteOrder
- Cashier Open checkout / Abort; Customer Payable + Outstanding backend-authored; no Cash/Card/QR

## Next

**Payments Core Runtime** (TenderDefinition / Payment / PaymentAllocation / lifecycle / reconciliation) — before Card/QR provider adapters.
