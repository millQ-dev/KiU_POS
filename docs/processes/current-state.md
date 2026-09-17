# MillQ Current State

**Checkpoint:** P0 Vietnam Acquiring Integration Profile — **CLOSED** (research; no adapter)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `millQ-dev/MillQ` / `millQ-dev/KiU_POS`
**Acquiring Profile merge:** `dba048f29f3c8c5f821bf96654f26fb4b4cba94d` (PR #57)
**Updated:** 2026-09-17

## Runtime / CI / backup

| Item | State |
| --- | --- |
| S1.1 Settlement Foundation | **CLOSED** |
| PAY1.1 Payments Core | **CLOSED** (fully after backup @ `f6289e9…`) |
| Vietnam Acquiring Integration Profile | **CLOSED** @ PR #57 / `dba048f…` — research only |
| Production payment provider adapters | **NOT STARTED** — awaiting PO route selection |
| Fiscalization runtime | **NOT STARTED** |
| Cash / refund / void-after-success | **NOT STARTED** |

## Research docs

- `docs/research/vietnam-acquiring-profile-2026.md`
- `docs/research/vietnam-acquiring-provider-matrix-2026.md`
- `docs/research/vietnam-payment-ux-scenarios-2026.md`
- `docs/research/vietnam-acquiring-open-questions-2026.md`

## Next

PO/ChatGPT selects first production acquiring route from unordered shortlist → adapter launch only after that decision.
