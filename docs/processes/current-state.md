# MillQ Current State

**Checkpoint:** C1.1 Commercial Rounding Runtime — **IN PROGRESS** (this branch)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**ADR-0030:** **ACCEPTED** @ `1e1abdca68c899829ceb47ca90b4337539b9bbc1` (Origin == GitHub)
**Baseline for C1.1:** `1e1abdca68c899829ceb47ca90b4337539b9bbc1`
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| P1.2 First KiU Cashier Frontend Shell | **DONE** |
| P1.3 Cashier Order Interaction UX | **CLOSED** |
| ADR-0030 Commercial RoundingPolicy | **ACCEPTED** @ `1e1abdc…` |
| C1.1 Commercial Rounding Runtime | **CURRENT** (this branch) |
| OPTION A (explicit gross) | **Legacy-compatible**; cashier path uses automatic BASE_LIST_LINE_GROSS accept |
| Identity / production session auth | **ABSENT** — labeled DEV bootstrap only |
| Payments / Settlement / Fiscalization | **NOT STARTED** — next architecture: Settlement/Checkout boundary |
| Tax / cash denomination / promo rounding | **DEFERRED** (separate named contexts) |

## C1.1 (this PR) — summary

- RoundingPolicy persistence + versioning + `[effectiveFrom, effectiveTo)` + gist overlap exclusion
- Selection: LegalEntity + jurisdiction + `BASE_LIST_LINE_GROSS` + `SalesContext.businessDateTime`
- No production default policy; missing → `COMMERCIAL_ROUNDING_POLICY_REQUIRED`
- Exact decimal kernel (`calculateRoundedLineGross`); HALF_UP; quantum via policy; COUNT/MASS/VOLUME
- Automatic calculate + **explicit** accept/reprice → Orders `SetOrderCommercialTerms`
- Authoritative merchandise gross = Σ accepted rounded line gross (no Order re-round)
- Cashier: Calculate & accept / Reprice & accept; frontend never multiplies unit×qty
- Migration **017**; VN MVP HALF_UP = product accounting choice (B), not legal mandate
- Legacy explicit-gross snapshots remain readable (nullable rounding provenance)

## Next (after C1.1 merge + backup)

**Settlement / Checkout orchestration boundary** (architecture) — Order merchandise gross vs customer payable vs Settlement vs Payment vs Fiscalization.
Do **not** implement Payments until that boundary is explicit.
