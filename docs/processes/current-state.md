# MillQ Current State

**Checkpoint:** P0 Vietnam Fiscalization Readiness Review — **CLOSED** (research + architecture; no runtime)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `millQ-dev/MillQ` / `millQ-dev/KiU_POS`
**Fiscal readiness baseline:** `1390758879e3764557c0b6930fe640b00547b749`
**Updated:** 2026-09-17

## Runtime / CI / backup

| Item | State |
| --- | --- |
| S1.1 Settlement Foundation | **CLOSED** |
| PAY1.1 Payments Core | **CLOSED** (fully after backup @ `f6289e9…`) |
| Vietnam Acquiring Integration Profile | **CLOSED** @ PR #57 / `dba048f…` — research only |
| Production payment provider adapters | **NOT STARTED** — awaiting PO route / sales-legal |
| P0 Vietnam Fiscalization Readiness | **CLOSED** — verdict `NEEDS_TAX_ARCHITECTURE` |
| Fiscalization runtime (FISC1.1) | **NOT STARTED** — blocked by Tax/VAT architecture |
| Cash / refund / void-after-success | **NOT STARTED** |

## Research docs

### Payments / acquiring
- `docs/research/vietnam-acquiring-profile-2026.md`
- `docs/research/vietnam-acquiring-provider-matrix-2026.md`
- `docs/research/vietnam-payment-ux-scenarios-2026.md`
- `docs/research/vietnam-acquiring-open-questions-2026.md`

### Fiscalization readiness (2026)
- `docs/research/vietnam-fiscalization-readiness-2026.md`
- `docs/research/vietnam-fiscalization-gap-matrix-2026.md`
- `docs/research/vietnam-fiscalization-ux-scenarios-2026.md`
- `docs/research/vietnam-fiscalization-open-questions-2026.md`

## Next

1. **Level C — Tax / VAT Architecture ADR** (blocking for fiscal runtime).
2. Parallel: counsel on Circular 91 / offline windows (non-blocking for Tax ADR launch).
3. Then ADR-0014 delta if still needed → then FISC1.1.
4. Acquiring route selection remains external (sales/legal); payment adapter still not started.
