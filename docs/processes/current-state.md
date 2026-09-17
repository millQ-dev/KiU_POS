# MillQ Current State

**Checkpoint:** ADR-0033 Tax/VAT Architecture — **Proposed** (Level C; awaiting PO Accept)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `millQ-dev/MillQ` / `millQ-dev/KiU_POS`
**Equality baseline (pre-ADR):** `9c97702e8462fa5277ee63edbd0f6dcccf929217`
**Updated:** 2026-09-17

## Runtime / CI / backup

| Item | State |
| --- | --- |
| S1.1 Settlement Foundation | **CLOSED** |
| PAY1.1 Payments Core | **CLOSED** |
| Vietnam Acquiring Integration Profile | **CLOSED** — research only |
| Production payment provider adapters | **NOT STARTED** — awaiting PO route / sales-legal |
| P0 Vietnam Fiscalization Readiness | **CLOSED** — verdict `NEEDS_TAX_ARCHITECTURE` |
| ADR-0033 Tax/VAT Architecture | **Proposed** — Level C; no runtime |
| Tax runtime (TAX1.1) | **NOT STARTED** — blocked on ADR-0033 Accept |
| Fiscalization runtime (FISC1.1) | **NOT STARTED** — blocked by Tax runtime + possible ADR-0014 delta |
| Cash / refund / void-after-success | **NOT STARTED** |

## Architecture / research

- `docs/decisions/ADR-0033-tax-vat-resolution-calculation-historical-snapshot.md`
- Fiscal readiness: `docs/research/vietnam-fiscalization-*-2026.md`
- Acquiring: `docs/research/vietnam-acquiring-*-2026.md`

## Next

1. **PO Accept ADR-0033** (Level C) after independent review.
2. Then **TAX1.1 Tax Domain Runtime** (separate launch).
3. Then ADR-0014 delta (if still needed) → FISC1.1.
4. Payment adapter still waiting sales/legal route selection.
5. Parallel counsel: Circular 91 offline windows (LEGAL_UNKNOWN).
