# MillQ Current State

**Checkpoint:** ADR-0033 Tax/VAT Architecture — **ACCEPTED** (PO ACCEPT WITH DELTAS; awaiting merge/backup confirmation)
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
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** (deltas: TaxRoundingStrategy policy-driven; TaxClassificationAssignment scoped) |
| Tax runtime (TAX1.1) | **NOT STARTED** — awaiting separate PO launch |
| Fiscalization runtime (FISC1.1) | **NOT STARTED** — blocked by Tax runtime + possible ADR-0014 delta |
| Cash / refund / void-after-success | **NOT STARTED** |

## Architecture / research

- `docs/decisions/ADR-0033-tax-vat-resolution-calculation-historical-snapshot.md` — **Accepted**
- Fiscal readiness: `docs/research/vietnam-fiscalization-*-2026.md`
- Acquiring: `docs/research/vietnam-acquiring-*-2026.md`

## Next

1. ChatGPT verifies Origin/GitHub equality after merge+backup.
2. Then PO launches **TAX1.1 Tax Domain Runtime** (not auto-started).
3. Then ADR-0014 delta (if still needed) → FISC1.1.
4. Payment adapter still waiting sales/legal route selection.
