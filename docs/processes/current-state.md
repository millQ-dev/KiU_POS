# MillQ Current State

**Checkpoint:** TAX1.1 **MERGED / CANONICAL CLOSED**  
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)  
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` = legacy rename redirect to the same repository ID)  
**Origin main:** `0e69c4e55ab2e06a732fd4cdb51dd10c637f917c`  
**Updated:** 2026-10-09

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Origin ↔ GitHub KiU_POS equality | **EQUAL** @ `0e69c4e55ab2e06a732fd4cdb51dd10c637f917c` |
| Migration head | **031** `031_tax_domain_foundation.sql` **on main** |
| C0.1 GR financial HTTP auth | **MERGED** Origin PR#71 |
| C0.2 Level C Tax/Fiscal packet | **ACCEPT WITH DELTAS** |
| C0.2A docs (ADR-0034 narrow + ADR-0037) | **MERGED** Origin PR#73 |
| ADR-0033 / ADR-0034 / ADR-0037 | **ACCEPTED** |
| TAX1.1 Tax runtime | **MERGED** Origin PR#74 — canonical closed |
| Fiscalization (FISC1.1) | **NOT STARTED** — production `FiscalCheckoutGate` = **UNAVAILABLE** |
| ADR-0014 Fiscalization delta | **NEXT LEVEL C DOCS WORK / NOT STARTED** (do not mark complete) |
| CASHIER-1 Production Front Door | **ACCEPTED SCOPE / NOT STARTED** |
| Floor/Table (R1.1) | **FROZEN / NOT STARTED** |
| C0 Cafe Operability | **IN PROGRESS** — slice = **COUNTER-SERVICE / PREPAY CAFE** |

## TAX1.1 (canonical closed)

- Origin PR **#74 MERGED** @ main `0e69c4e`
- Tax runtime present (assignment-chain resolve, TaxOrderSnapshot, Settlement consume)
- `legal_entity.tax_required` tri-state: **TRUE** = required; **FALSE** = explicit ABSENT; **NULL** = undecided / fail-closed
- Mixed `PricingTaxMode` lines represented honestly (envelope null / Settlement `MIXED`)
- Stale Tax snapshot cannot authorize OpenSettlement after commercial reprice
- Production `FiscalCheckoutGate` remains **UNAVAILABLE**
- **NO FISC1.1 runtime** yet

## Current product track — CASHIER-1

**Status:** ACCEPTED SCOPE / NOT STARTED

**Target:**

```text
Company ID → PIN session → authorized Terminal → OPEN CashShift → existing CashierShell
```

**Minimum known API gap (do not implement in this checkpoint):** server-derived cashier topology must expose required `brandId` and `legalEntityId` without client fabrication.

**Explicitly out of CASHIER-1:** DeviceIdentity; Quick Lock; CashShift Close; frontend Tax math; fiscal success fabrication; CASH tender; Favorites / Stop/Go-list; production send policy; Floor/Table.

## Fiscal track

| Item | State |
| --- | --- |
| ADR-0014 delta | **NEXT LEVEL C DOCS WORK / NOT STARTED** |
| FISC1.1 | **NOT STARTED** |
| Production FiscalCheckoutGate | **UNAVAILABLE** (fail-closed) |

## Legal baseline (product reference)

- Law **108/2025/QH15** — current
- Decree **254/2026/NĐ-CP** — current from 2026-07-01
- Decree **70/2025/NĐ-CP** — expired from 2026-07-01
- Forbidden: Vietnam restaurant → fiscal `NOT_REQUIRED` shortcut

## Next

1. **CASHIER-1 — Production Front Door**  
   Company ID → PIN Session → authorized Terminal → OPEN CashShift → CashierShell
2. **ADR-0014 Fiscalization delta** — docs-only Level C (may be drafted in parallel)
3. **FISC1.1** remains **NOT STARTED**

Preserve:

- no DeviceIdentity
- no Quick Lock
- no CashShift Close
- no FE Tax math
- no fiscal success fabrication
- Vietnam restaurant → `NOT_REQUIRED` shortcut forbidden
