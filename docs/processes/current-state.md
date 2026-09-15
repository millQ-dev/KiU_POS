# MillQ Current State

**Checkpoint:** Block D1.3B-R1 Reversal Chronology Remediation **in review** — branch from Origin `main` @ `be9f750` (2026-09-15)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**ADR-0027 Accept PR #34:** merged @ `be9f750538d99d985f33d08738afe12e747f8ed1`
**Updated:** 2026-09-15

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Block D1.3B GoodsIssue & Automatic Sale Write-off | **Merged** (PR #32) |
| ADR-0027 Reversal Business Chronology Semantics | **Accepted / Merged** (PR #34 → `be9f750`) |
| Block D1.3B-R1 Reversal Chronology Remediation | **This PR** — bring ReverseCompletedOrder into ADR-0027 compliance |
| D1.4A Actual COGS Read Model | **STOP** until D1.3B-R1 merged + backed up + explicit PO launch |
| Food Cost Ratio / Revenue Basis | **Deferred** (ADR-0026) |
| Origin CI | **Attached** — Depot |
| GitHub backup | Post-merge Origin→GitHub via **MillQ Origin Backup** App |

## Accepted decisions

| ADR | Status | Topic |
| --- | --- | --- |
| ADR-0025 | Accepted | Order Completion & Sale Inventory Write-off |
| ADR-0026 | Accepted | Actual COGS & Food Cost Reporting Semantics |
| ADR-0027 | **Accepted** | Reversal Business Chronology Semantics |

## This PR (D1.3B-R1)

- Migration `010_d13b_r1_reversal_chronology.sql` — `business_date` / `business_order` / `business_time` on reversal entities; fail-closed if legacy rows lack chronology
- `ReverseCompletedOrder` requires business chronology; fingerprint includes it
- Compensating `GoodsIssueReversal` movements at **reversal** chronology; original historical cost preserved
- Operational facts at reversal chronology
- Legacy audit (local `millq_dev`): zero reversal rows before migrate

## Out of scope

- D1.4A Actual COGS Read Model
- Food Cost Ratio / Gross Profit / Revenue Basis
- Fabricated chronology backfill

## Next

1. Independent full-diff review + Origin CI
2. `origin pr merge --auto` → backup → Origin main == GitHub main
3. **STOP** — D1.4A only after explicit PO launch
