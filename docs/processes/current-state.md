# MillQ Current State

**Checkpoint:** PAY1.1 Payments Core Runtime — **FULLY CLOSED** (Origin + GitHub backup equality)  
**Research in flight:** P0 Vietnam Acquiring Integration Profile (docs only)  
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)  
**Backup host:** GitHub `millQ-dev/MillQ` / `millQ-dev/KiU_POS`  
**Origin main / GitHub main:** `f6289e946bb4df1acb183ec377871ee281f2b139` (**MATCH**)  
**PAY1.1 PR:** https://cursor.com/codebase/millqdev/MillQ/pull/55  
**Updated:** 2026-09-17

## Runtime / CI / backup

| Item | State |
| --- | --- |
| S1.1 Settlement Foundation | **CLOSED** |
| PAY1.1 Payments Core | **CLOSED** @ `f6289e9…` (incl. checkpoint #56) |
| GitHub backup equality | **PASS** @ `f6289e9…` |
| Vietnam Acquiring Integration Profile | **IN PROGRESS** — research docs only; no adapter |
| Production payment provider adapters | **NOT STARTED** — blocked on PO route selection |
| Fiscalization runtime | **NOT STARTED** |
| Cash / refund / void-after-success | **NOT STARTED** |

## Research deliverables (this block)

- `docs/research/vietnam-acquiring-profile-2026.md`
- `docs/research/vietnam-acquiring-provider-matrix-2026.md`
- `docs/research/vietnam-payment-ux-scenarios-2026.md`
- `docs/research/vietnam-acquiring-open-questions-2026.md`

## Next

PO/ChatGPT reviews shortlist + open questions → selects first production acquiring route → only then adapter launch.
