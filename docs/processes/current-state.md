# MillQ Current State

**Checkpoint:** PAY1.1 Payments Core Runtime — **CLOSED**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror; may resolve as `millQ-dev/KiU_POS`)
**Origin main:** `01cfa9349ada1083127e0c8291a4d62bd3d52e79`
**PAY1.1 PR:** https://cursor.com/codebase/millqdev/MillQ/pull/55 — **merged**
**Base:** `3960e5d7b10392ea80ce0f3db1c7a3c4ca16815c`
**Pre-merge head:** `5ee1b617529a29172b475e2a06422cceef2898dd`
**Updated:** 2026-09-17

## Runtime / CI / backup

| Item | State |
| --- | --- |
| ADR-0032 Checkout & Settlement Orchestration | **ACCEPTED** |
| S1.1 Settlement / Checkout Runtime Foundation | **CLOSED** @ `6022910…` |
| PAY1.1 Payments Core Runtime | **CLOSED** @ `01cfa93…` (PR #55) |
| Production payment provider adapters | **NOT STARTED** |
| Fiscalization runtime | **NOT STARTED** (FiscalCheckoutGate UNAVAILABLE / fail-closed) |
| Cash tender / change | **NOT STARTED** |
| Refund / void-after-success | **NOT STARTED** |
| Tax / cash denomination rounding | **NOT DEFINED / NOT STARTED** |
| GitHub backup | **PENDING** — Origin `01cfa93…`; GitHub main still `3960e5d…` (App credentials absent in this agent env) |

## PAY1.1 — delivered

- Migrations **020** + **021**: TenderDefinition, Payment (+ intended Settlement bind), PaymentProviderOutcome, PaymentAllocation
- Extensible tender axes (provider / rail / instrument / presentation) — not closed CASH\|CARD
- Lifecycle INITIATED|PENDING|SUCCEEDED|FAILED|CANCELLED|EXPIRED|UNKNOWN
- Immutable verified/unverified provider-outcome evidence; redirect never qualifies
- Amount/currency mismatch → QUARANTINED
- Real QualifyingPaymentCoverageReader + external-effect (intended SUCCESS or allocation)
- Orchestration: Payment → ReconcileSettlementCoverage (no direct Settlement table writes)
- CompleteOrder only via CheckoutOrchestrator + fiscal gate
- DEV Payment Simulator: `NODE_ENV !== production` only
- Golden-1 async QR-style + late inquiry

## Explicit NOT in PAY1.1

- NO production provider adapter
- NO cash / change
- NO Fiscalization runtime
- NO refund / void-after-success
- NO credential / PAN storage
- NO QR payload generation in Core

## Next mandatory product gate

**P0 — Vietnam Acquiring Integration Profile / Provider Selection**

Do **not** launch a production Payment adapter until that block selects the first integration route for the KiU Vietnam legal entity.
