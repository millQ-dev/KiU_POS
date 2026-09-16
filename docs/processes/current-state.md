# MillQ Current State

**Checkpoint:** ADR-0032 Checkout & Settlement Orchestration — **ACCEPTED / CLOSED**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror; may resolve as `millQ-dev/KiU_POS`)
**Origin main:** `18f4a61ac00dd73ab7a6eabc6be570ffc5f9b21a` (Origin == GitHub)
**ADR-0032 PR:** https://cursor.com/codebase/millqdev/MillQ/pull/51 — **merged**
**Base at ADR start:** `99b63f4996638ca4e979e7b8a9aec415590ff307`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| P1.2 / P1.3 cashier vertical | **CLOSED** |
| ADR-0030 / C1.1 Commercial Rounding | **CLOSED** |
| ADR-0032 Checkout & Settlement Orchestration | **ACCEPTED** @ `18f4a61…` (PR #51) |
| Identity / production session auth | **ABSENT** — labeled DEV bootstrap only |
| S1.1 Settlement / Checkout Runtime Foundation | **NEXT** — not started |
| Payments / Fiscalization runtime | **NOT STARTED** |
| Tax / cash denomination / promo rounding | **DEFERRED** |
| GitHub backup | **MATCH** @ `18f4a61…` |

## ADR-0032 — delivered (docs only)

- Checkout = application orchestration (no CheckoutOrder aggregate)
- Orders coordinates SettlementGroup / Check / Settlement Payable Snapshot
- Merchandise Gross ≠ Customer Payable ≠ Revenue Basis
- OpenSettlement preconditions; edit lock; safe abort
- Exact Check payable conservation; Payment never mutates Order/inventory
- Zero-payable without fake Payment; fiscal hook via ADR-0014
- Next: **S1.1** (not Payment providers)

## Next

**S1.1 — Settlement / Checkout Runtime Foundation** per ADR-0032 §28.  
Do **not** start Payment provider adapters first.
