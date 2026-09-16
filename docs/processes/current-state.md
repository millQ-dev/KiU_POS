# MillQ Current State

**Checkpoint:** S1.1 Settlement / Checkout Runtime Foundation — **CURRENT** (this branch)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror; may resolve as `millQ-dev/KiU_POS`)
**Baseline:** `c94afe0065200a2d07ab684815cc13cc741b53bf`
**ADR-0032:** **ACCEPTED** @ `18f4a61…`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| ADR-0032 Checkout & Settlement Orchestration | **ACCEPTED** |
| S1.1 Settlement / Checkout Runtime Foundation | **CURRENT** |
| Payments runtime / provider adapters | **NOT STARTED** |
| Fiscalization runtime | **NOT STARTED** |
| Tax / cash denomination / residual split rounding | **NOT DEFINED / NOT STARTED** |
| Capability / PackageEntitlement runtime | **ABSENT** — DEV cashier uses Settlement path directly |

## S1.1 (this PR) — delivered

- Migration **018**: SettlementGroup, Settlement Payable Snapshot, Check, CheckLineAllocation
- OpenSettlement + frozen payable (ABSENT extras; MVP payable == merchandise gross numerically)
- Default one Check; exact conservation splits only
- Live Settlement edit lock (backend)
- Safe AbortSettlement + external-effect probe ports
- QualifyingPaymentCoverageReader (consumption only; empty in production)
- FiscalCheckoutGate (fail-closed UNAVAILABLE in production)
- CheckoutOrchestrator → CompleteOrder
- Cashier: Open checkout / Abort; Customer Payable + Outstanding from backend; no Cash/Card/QR

## Next (after S1.1 merge + backup)

**Payments Core Runtime** (TenderDefinition / Payment / PaymentAllocation / lifecycle) — not provider adapters first.
