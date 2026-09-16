# MillQ Current State

**Checkpoint:** ADR-0032 Checkout & Settlement Orchestration — **CURRENT** (docs / Level C)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only; canonical GitHub path may resolve as `millQ-dev/KiU_POS`)
**Origin main baseline:** `99b63f4996638ca4e979e7b8a9aec415590ff307` (Origin == GitHub at branch start)
**C1.1:** **CLOSED** @ `12334779f1ab313c905e740d252c972ead79dae6` (parent of tip)
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| P1.2 / P1.3 cashier vertical | **CLOSED** |
| ADR-0030 Commercial RoundingPolicy | **ACCEPTED** |
| C1.1 Commercial Rounding Runtime | **CLOSED** |
| ADR-0032 Checkout & Settlement Orchestration | **CURRENT** (this PR — architecture only) |
| Identity / production session auth | **ABSENT** — labeled DEV bootstrap only |
| Settlement / Checkout runtime (S1.1) | **NOT STARTED** — blocked on ADR-0032 Accept + merge |
| Payments / Fiscalization runtime | **NOT STARTED** |
| Tax / cash denomination / promo rounding | **DEFERRED** (separate named contexts) |

## C1.1 (closed)

- RoundingPolicy + decimal HALF_UP kernel + explicit accept/reprice
- Authoritative merchandise gross = Σ rounded lines
- Migration 017; tax/cash/promo still deferred

## ADR-0032 (this PR) — summary

- Checkout = application orchestration (no CheckoutOrder aggregate)
- Orders coordinates SettlementGroup / Check / Settlement Payable Snapshot (ADR-0016)
- Merchandise Gross ≠ Customer Payable (MVP numerical equality allowed)
- Customer Payable ≠ Revenue Basis (ADR-0028)
- OpenSettlement requires accepted/current commercial state
- Edit lock under live Settlement; safe abort to re-edit
- Exact Check payable conservation; no invented split residual rounding
- Payment never mutates Order / never owns inventory; Checkout → CompleteOrder
- Zero-payable without fake Payment; fiscal hook via ADR-0014
- Next runtime: **S1.1** Settlement / Checkout Runtime Foundation (not Payment providers)

## Next (after ADR-0032 Accept + backup)

**S1.1 — Settlement / Checkout Runtime Foundation** (implementation).  
Do **not** jump to Payment provider adapters first.
