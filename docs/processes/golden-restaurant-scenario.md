# GOLDEN-1 — Golden Restaurant Scenario / Torture Test

**Status:** permanent CI gate  
**Entry point:** `apps/api/src/scenarios/golden-restaurant.acceptance.test.ts`  
**Baseline at introduction:** Origin `main` @ `361ef9b8c2255f8d4984c882b0d6f93125689340` (post D1.4D)

> PERMANENT. Do not delete or reduce coverage to make CI green.  
> Unsupported future semantics remain explicit **DEFERRED / EXPECTED STOP**.

## PASS (executable in this gate)

| Capability | Proven |
| --- | --- |
| Procurement / dual Goods Receipt | PASS |
| Moving-average cost change | PASS |
| STOCK_TRACKED production + yield ≠ plan | PASS |
| DIRECT_STOCK sale consumption | PASS |
| VIRTUAL recipe leaf consumption | PASS |
| STOCK_TRACKED root (no double explosion) | PASS |
| OPEN quantity mutation | PASS |
| Stale commercial terms after line mutation | PASS |
| Explicit commercial re-accept | PASS |
| Line merchant discount | PASS |
| Awkward order discount + frozen allocation | PASS |
| Compliment Revenue FINAL 0 + COGS > 0 | PASS |
| Third-party merchandise funding | PASS |
| Tax/tip/non-merch excluded from Revenue | PASS |
| CompleteOrder atomicity (snapshot+GI+movements) | PASS |
| CompleteOrder rollback on write-off failure | PASS |
| Idempotent CompleteOrder / SetTerms | PASS |
| Actual COGS from historical inventory facts | PASS |
| Revenue Basis from frozen snapshot | PASS |
| Food Cost = ΣCOGS / ΣRevenue | PASS |
| Operational Gross Profit | PASS |
| Historical stability (recipe/catalog mutation) | PASS |
| Full later-period reversal | PASS |
| Sale vs reversal vs combined periods | PASS |
| Same-position reversal | PASS |
| Backdated reversal (not `reversed_at`) | PASS |
| UNKNOWN COGS | PASS |
| ORDER_UNRESOLVED | PASS |
| Revenue Coverage Gap | PASS |
| Tenant isolation | PASS |
| Live Menu/Pricing resolution (unit price + explicit gross) | PASS |
| Historical Revenue/COGS/FC/OGP stable after later PriceRule/Publication | PASS |
| POS Presentation / live cashier selection (Layout ∩ Menu → AddOrderLine) | PASS |
| Historical economics stable after LayoutPublication v2 | PASS |
| First React KiU cashier shell (consumes P1.1 HTTP contracts) | PASS |
| Cashier Order Interaction (COUNT mutate → commercial invalidate → re-resolve → explicit re-accept) | PASS |
| MASS/VOLUME quantity entry (authoritative metadata; no unit×qty gross) | PASS (web + HTTP) |

## DEFERRED / EXPECTED STOP

| Step | Dependency |
| --- | --- |
| Modifier commercial + physical | Modifier / Effective Recipe vertical |
| Dangerous op / manager override | Authorization / Roles vertical |
| Split payment | Settlement / Payments runtime |
| Partial return | Partial Return / Commercial Correction |
| Period Lock | PeriodLock vertical |
| Contribution Margin / channel fees | ADR-0019 future ladder |
| Explainable Intelligence | Intelligence reads proven evidence only |
| TOTAL_LOSS on main sale path | Keep on D1.2B suite (not main economic day) |
| React cashier Order Interaction UX | **PASS** P1.3 |
| Floor/Table runtime | DEFERRED — P1.1–P1.3 prove tableless POS without Floor/Table |
| Commercial RoundingPolicy (unit Money × fractional qty) | DEFERRED Level C — **ADR-0030 reserved, NOT created** |

## Bugs discovered by Golden

1. **Business DATE UTC shift (Level B fix in this PR):** several `asIsoDate` helpers used
   `Date#toISOString` / UTC getters. In positive-offset timezones (e.g. Europe/Moscow),
   node-pg `DATE` values (local midnight) shifted back one calendar day when re-written
   into movements. Fixed to local calendar parts in Procurement, GoodsIssue, Production
   posting, Actual COGS, Orders read mapping, and inventory balance rebuild.
