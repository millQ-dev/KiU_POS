# MillQ Current State

**Checkpoint:** PAY1.1 Payments Core Runtime — **CLOSED** (pending Origin merge / independent review)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror; may resolve as `millQ-dev/KiU_POS`)
**Origin main baseline:** `3960e5d7b10392ea80ce0f3db1c7a3c4ca16815c` (S1.1 tip; Origin == GitHub at launch)
**Branch:** `feature/payments-core-runtime`
**Updated:** 2026-09-17

## Runtime / CI / backup

| Item | State |
| --- | --- |
| ADR-0032 Checkout & Settlement Orchestration | **ACCEPTED** |
| S1.1 Settlement / Checkout Runtime Foundation | **CLOSED** @ `6022910…` (PR #53); tip `3960e5d…` |
| PAY1.1 Payments Core Runtime | **IMPLEMENTED** on branch — TenderDefinition / Payment / Outcome evidence / PaymentAllocation |
| Production payment provider adapters | **NOT STARTED** — next gate is Vietnam Acquiring Profile / Provider Selection |
| Fiscalization runtime | **NOT STARTED** (production FiscalCheckoutGate remains UNAVAILABLE / fail-closed) |
| Cash tender / change | **NOT STARTED** |
| Refund / void-after-success | **NOT STARTED** (hard stop — compensating architecture) |
| Tax / cash denomination / residual split rounding | **NOT DEFINED / NOT STARTED** |
| Capability / PackageEntitlement runtime | **ABSENT** |

## PAY1.1 — delivered

- Migration **020**: `tender_definition`, `payment`, `payment_provider_outcome`, `payment_allocation`
- Extensible TenderDefinition axes: `provider_identity` / `rail_identity` / `instrument_family` / `presentation_capability` (not closed CASH\|CARD)
- Provider-neutral Payment lifecycle: INITIATED → PENDING → SUCCEEDED \| FAILED \| CANCELLED \| EXPIRED \| UNKNOWN
- Immutable provider-outcome evidence (VERIFIED/UNVERIFIED; CALLBACK/INQUIRY/DEV_SIMULATOR)
- Redirect/client signal **never** qualifies; unverified success never qualifies
- Amount/currency mismatch → QUARANTINED (no allocation)
- PaymentAllocation → real `QualifyingPaymentCoverageReader` + Settlement external-effect probe
- Orchestration: payment facts → `ReconcileSettlementCoverage` (Payments does not write Settlement tables)
- CompleteOrder only via CheckoutOrchestrator + fiscal gate (Payment never Completes Order)
- DEV/TEST Payment Simulator at `/api/v1/dev/payment-simulator/*` (visibly non-production; uses Core only)
- Golden-1 PAY1.1 variations: async QR-style + late inquiry

## Explicit NOT in PAY1.1

- NO production provider adapter (NAPAS/VietQR/VNPAY/MoMo/ZaloPay/card/SmartPOS)
- NO cash / change due
- NO Fiscalization runtime
- NO refund / void-after-success / chargeback
- NO provider credential / secret / PAN storage
- NO QR payload generation in Core

## Next mandatory product gate

**P0 — Vietnam Acquiring Integration Profile / Provider Selection**

Research real Vietnamese acquiring routes for KiU merchants (VietQRPay/VietQRGlobal access, VNPAY, MoMo, ZaloPay, bank/acquirer, card, SmartPOS/SoftPOS). Only after that block selects the first route may the first production Payment adapter launch.
