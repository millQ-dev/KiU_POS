# MillQ Current State

**Checkpoint:** C0.2A Tax/Fiscal Level C docs — next **TAX1.1** (after this checkpoint merges)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` = legacy rename redirect to the same repository ID)
**Origin main:** `5687c1fd10618a79972b0fa6f7d727b5fcc12056` (pre–C0.2A; update on merge)
**Updated:** 2026-10-06

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Origin ↔ GitHub KiU_POS equality | **EQUAL** @ `5687c1f` (post–PR#72 backup) |
| Migration head | **030** `030_procurement_goods_receipt_permission.sql` |
| C0.1 GR financial HTTP auth | **MERGED** Origin PR#71 |
| C0.2 Level C Tax/Fiscal packet | **ACCEPT WITH DELTAS** (PO / Architecture 2026-10-06) |
| C0.2A docs (ADR-0034 narrow + ADR-0037) | **IN PROGRESS** this PR |
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** |
| ADR-0034 Tax calculation / payable | **ACCEPTED** (narrow: `thirdPartyFunding=0`, `platformSubsidy=0`) |
| ADR-0037 C0 counter-service Tax/Fiscal LC | **ACCEPTED** (this docs block) |
| TAX1.1 Tax runtime | **NEXT** after C0.2A merge — Fiscal gate remains UNAVAILABLE |
| Fiscalization (FISC1.1) | **NOT STARTED** — production `FiscalCheckoutGate` = **UNAVAILABLE** |
| Floor/Table (R1.1) | **FROZEN / NOT STARTED** |
| C0 Cafe Operability | **IN PROGRESS** — slice = **COUNTER-SERVICE / PREPAY CAFE** |

## Legal baseline (product reference)

- Law **108/2025/QH15** — current
- Decree **254/2026/NĐ-CP** — current from 2026-07-01
- Decree **70/2025/NĐ-CP** — expired from 2026-07-01
- Forbidden: Vietnam restaurant → fiscal `NOT_REQUIRED` shortcut

## Next

1. Merge C0.2A after independent Architecture **APPROVE**; Origin→GitHub backup; verify equality.
2. Launch **TAX1.1** — minimal Vietnam direct-sale Tax runtime (do **not** wait for FISC ACK/outage decisions).
3. Do **not** start FISC1.1 / CashierShell / CASH tender / R1.1 until explicit launch.
4. Do **not** set Vietnam restaurant → `NOT_REQUIRED` fiscal bypass.
