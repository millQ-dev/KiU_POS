# MillQ Current State

**Checkpoint:** C0.2A **MERGED** — **TAX1.1** implementation PR (do not merge until strategic review)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` = legacy rename redirect to the same repository ID)
**Origin main:** `90838c8b82500b6eba7f521e632d3f56af0be25a`
**Updated:** 2026-10-06

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Origin ↔ GitHub KiU_POS equality | **EQUAL** @ `90838c8` (post–C0.2A backup) |
| Migration head | **031** `031_tax_domain_foundation.sql` (TAX1.1 branch; main still 030 until merge) |
| C0.1 GR financial HTTP auth | **MERGED** Origin PR#71 |
| C0.2 Level C Tax/Fiscal packet | **ACCEPT WITH DELTAS** |
| C0.2A docs (ADR-0034 narrow + ADR-0037) | **MERGED** Origin PR#73 |
| ADR-0033 / ADR-0034 / ADR-0037 | **ACCEPTED** |
| TAX1.1 Tax runtime | **PR #74 OPEN — DO NOT MERGE** (assignment-chain head; strategic review) |
| Fiscalization (FISC1.1) | **NOT STARTED** — production `FiscalCheckoutGate` = **UNAVAILABLE** |
| Floor/Table (R1.1) | **FROZEN / NOT STARTED** |
| C0 Cafe Operability | **IN PROGRESS** — slice = **COUNTER-SERVICE / PREPAY CAFE** |

## Legal baseline (product reference)

- Law **108/2025/QH15** — current
- Decree **254/2026/NĐ-CP** — current from 2026-07-01
- Decree **70/2025/NĐ-CP** — expired from 2026-07-01
- Forbidden: Vietnam restaurant → fiscal `NOT_REQUIRED` shortcut

## Next

1. Strategic review of TAX1.1 PR — **do not merge** until Accept.
2. Do **not** start FISC1.1 / CashierShell / CASH tender / R1.1 until explicit launch.
3. Do **not** set Vietnam restaurant → `NOT_REQUIRED` fiscal bypass.
