# MillQ Current State

**Checkpoint:** ADR-0030 Commercial RoundingPolicy — **Accepted (architecture-only)**  
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)  
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)  
**P1.3:** **CLOSED** @ `45a7b7870437a2ba3d0a9f226d155698af24eea5` (Origin == GitHub)  
**Baseline for this ADR branch:** `45a7b7870437a2ba3d0a9f226d155698af24eea5`  
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| P1.2 First KiU Cashier Frontend Shell | **DONE** @ `0a81809…` |
| P1.3 Cashier Order Interaction UX | **CLOSED** @ `45a7b78…` (Origin == GitHub) |
| ADR-0030 Commercial RoundingPolicy | **Accepted (architecture)** — runtime **not** started |
| Identity / production session auth | **ABSENT** — labeled DEV bootstrap only |
| OPTION A (explicit gross) | **Runtime still binding until C1.1** |
| C1.1 Commercial Rounding Runtime | **NEXT** |
| Payments / Settlement / Fiscalization | **STOP** until after C1.1 |

## ADR-0030 (this PR) — summary

- Context: `BASE_LIST_LINE_GROSS`
- Grain: per Order line; Order merchandise gross = Σ rounded line gross
- Exact basis: unit Money × canonical quantity (arbitrary-precision; no float)
- Vietnam MVP product defaults: `HALF_UP`, `quantumMinor = 1` (class B; Decree 123 silent)
- LegalEntity from Order; effectivity `[from, to)`; acceptance business instant
- Provenance + roundingDelta; explicit reprice; D1.4B invalidation preserved
- Tax / cash / promo boundaries separated
- Migration **NONE** · Runtime **NONE**

## Next

Independent architecture review → Origin merge → backup → **C1.1 — Commercial Rounding Runtime & Automatic Base Gross Acceptance**  
Do **not** jump to Payments.
