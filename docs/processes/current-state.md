# MillQ Current State

**Checkpoint:** C0.1 Goods Receipt HTTP auth **MERGED** — next **C0.2 Level C Tax/Fiscal decision**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` = legacy rename redirect to the same repository ID)
**Origin main:** `3e57c6eac3a2b001847467091861cd991f82a283`
**Updated:** 2026-10-06

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Origin ↔ GitHub KiU_POS equality | **EQUAL** @ `3e57c6e` |
| Migration head | **030** `030_procurement_goods_receipt_permission.sql` |
| C0.1 GR financial HTTP auth | **MERGED** Origin PR#71 |
| CASH1.1 CashShift Open | **MERGED** |
| SEC-0 / ID1.1 / PAY1.1 / S1.1 / C1.1 / GUEST1.1 | **MERGED** (PARTIAL maturity) |
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** — TAX1.1 **NOT STARTED** |
| ADR-0034 Tax calculation / payable | **OPEN** Origin PR#62 — Proposed / **BLOCKED** |
| Fiscalization (FISC1.1) | **NOT STARTED** — production `FiscalCheckoutGate` = **UNAVAILABLE** |
| Floor/Table (R1.1) | **FROZEN / NOT STARTED** |
| C0 Cafe Operability | **IN PROGRESS** — C0.1 done; **C0.2 Level C decision packet next** |

## Next

1. PO Accept / decide Level C list from C0.2 Tax/Fiscal packet.
2. Do **not** implement TAX1.1 / FISC1.1 / CashierShell / CASH tender / R1.1 until explicit launch after C0.2 decisions.
3. Do **not** set Vietnam restaurant → `NOT_REQUIRED` fiscal bypass.
