# MillQ Current State

**Checkpoint:** C1.1 Commercial Rounding Runtime — **CLOSED** (merged)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Origin main:** `12334779f1ab313c905e740d252c972ead79dae6` (Origin == GitHub)
**ADR-0030:** **ACCEPTED** @ `1e1abdca68c899829ceb47ca90b4337539b9bbc1`
**C1.1 PR:** https://cursor.com/codebase/millqdev/MillQ/pull/49 — **merged** (pre-merge tip `d252d8a` ← base `1e1abdc`)
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| P1.2 First KiU Cashier Frontend Shell | **DONE** |
| P1.3 Cashier Order Interaction UX | **CLOSED** |
| ADR-0030 Commercial RoundingPolicy | **ACCEPTED** @ `1e1abdc…` |
| C1.1 Commercial Rounding Runtime | **CLOSED** @ `1233477…` (PR #49) |
| OPTION A (explicit gross) | **Legacy-compatible**; cashier path uses automatic BASE_LIST_LINE_GROSS accept |
| Identity / production session auth | **ABSENT** — labeled DEV bootstrap only |
| Payments / Settlement / Fiscalization | **NOT STARTED** |
| Tax / cash denomination / promo rounding | **DEFERRED** (separate named contexts) |
| GitHub backup | **MATCH** Origin `main` == GitHub `main` @ `1233477…` |

## C1.1 — delivered

- RoundingPolicy persistence + versioning + `[effectiveFrom, effectiveTo)` + gist overlap exclusion
- Selection: LegalEntity + jurisdiction + `BASE_LIST_LINE_GROSS` + `SalesContext.businessDateTime`
- No production default policy; missing → `COMMERCIAL_ROUNDING_POLICY_REQUIRED`
- Exact decimal kernel (`calculateRoundedLineGross`); HALF_UP; quantum via policy; COUNT/MASS/VOLUME
- Automatic calculate + **explicit** accept/reprice → Orders `SetOrderCommercialTerms`
- Authoritative merchandise gross = Σ accepted rounded line gross (no Order re-round)
- Cashier: Calculate & accept / Reprice & accept; frontend never multiplies unit×qty
- Migration **017**; VN MVP HALF_UP = product accounting choice (B), not legal mandate
- Legacy explicit-gross snapshots remain readable (nullable rounding provenance)

## Next (architecture — do not skip to Payments)

**Settlement / Checkout orchestration boundary** (ADR / Level C proposal as needed):

- Order merchandise gross (C1.1) vs customer payable
- Settlement vs Payment vs Fiscalization
- Payment lifecycle triggers

Do **not** implement Payments until that boundary is explicit and accepted.
