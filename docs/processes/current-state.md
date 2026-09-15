# MillQ Current State

**Checkpoint:** ADR-0027 Reversal Business Chronology Semantics — **architecture-only Level C** (this PR)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**ADR-0026 Accept PR #33:** merged @ `39723023fb83c231285169091330d867ff739536`
**Block D1.3B PR #32:** merged @ `b2174ee`
**Updated:** 2026-09-15

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Block D1.3B GoodsIssue & Automatic Sale Write-off | **Merged** (PR #32) |
| ADR-0026 Actual COGS & Food Cost Reporting Semantics | **Accepted / Merged** (PR #33 → `3972302`) |
| ADR-0027 Reversal Business Chronology Semantics | **This PR** — architecture-only; no runtime/code/schema |
| D1.3B-R1 Reversal Chronology Remediation | **STOP** until explicit PO launch after ADR-0027 Accept + merge + backup |
| D1.4A Actual COGS Read Model | **STOP** until D1.3B-R1 merged + backed up (after ADR-0027) |
| Food Cost Ratio / Gross Profit / Revenue Basis | **Deferred** (ADR-0026) |
| Origin CI | **Attached** — Depot |
| GitHub backup | Post-merge Origin→GitHub via **MillQ Origin Backup** App |

## Accepted decisions

| ADR | Status | Topic |
| --- | --- | --- |
| ADR-0001 … ADR-0025 | Accepted | Prior decisions |
| ADR-0026 | **Accepted** | Actual COGS & Food Cost Reporting Semantics |
| ADR-0027 | **Accepted** (this PR records PO LAUNCH binding) | Reversal Business Chronology Semantics |

## Proposed

_None._

### Reversal chronology invariant (ADR-0027)

`ReverseCompletedOrder` is its own business event with authoritative `businessDate` / `businessOrder` / optional `businessTime`. Technical `reversed_at` / `created_at` / `recorded_at` never substitute.

Compensating `GoodsIssueReversal` InventoryMovement uses **reversal** chronology (not sale chronology), while preserving original historical cost/qty/currency/certainty. Same-position linked sale→reversal uses ADR-0003 effect-class ordering. Reporting (ADR-0026) period A/B follows that reversal chronology.

**Do not fabricate** chronology for legacy reversal rows; D1.3B-R1 must re-audit before migrate.

## This PR (ADR-0027)

- Architecture decision only
- Legacy fixture audit: zero reversal rows in local `millq_dev`
- **No** application code, migrations, D1.3B-R1, D1.4A, Food Cost Ratio

## Out of scope / STOP

- D1.3B-R1 implementation
- D1.4A Actual COGS Read Model
- Food Cost Ratio / Revenue Basis / Gross Profit
- D1.4A feature branch must remain untouched by this Accept

## Next

1. Independent architecture review + Origin CI
2. `origin pr merge --auto` → backup → Origin main == GitHub main
3. **STOP** — D1.3B-R1 only after explicit PO launch
4. D1.4A only after D1.3B-R1 merge + backup + PO launch
