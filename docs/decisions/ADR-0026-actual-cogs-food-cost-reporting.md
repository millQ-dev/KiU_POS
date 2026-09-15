# ADR-0026: Actual COGS & Food Cost Reporting Semantics

- **Status:** Accepted
- **Date:** 2026-09-15
- **Accepted:** 2026-09-15 (PO LAUNCH — binding decisions recorded)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0003, ADR-0008, ADR-0010, ADR-0012, ADR-0016, ADR-0019, ADR-0025; Architecture v1.2 / v1.3; Block D1.3A; Block D1.3B
- **Blocks enabled after Accept:** D1.4A — Actual COGS Read Model (implementation; **not** launched by this ADR; **further blocked** until ADR-0027 Accept + **D1.3B-R1** remediation merge + backup)
- **Explicitly deferred:** Food Cost Ratio / Gross Profit / Revenue Basis / Theoretical Recipe Cost implementation
- **Related chronology:** ADR-0027 (Reversal Business Chronology Semantics) — Required for honest ADR-0026 period A/B reversal reporting

## Context

Charter vertical ends with Food Cost reporting after Sale → Automatic Write-off. ADR-0019 already freezes that economic metrics are **derived / read-side facts**, COGS comes from **historical** sale/write-off costing (CostQuote / history), `UNKNOWN` must not silently become zero, original currency is preserved, and Food Cost UX must follow that model.

D1.3B is merged and backed up (Origin PR #32 → `b2174ee56a7417b4a4db516ae3ea1855ed470f0a`). Authoritative historical sale write-off cost now exists via:

```text
OrderCompleted
  → frozen ConsumptionPlanSnapshot
  → GoodsIssue / GoodsIssueLine
  → InventoryMovement OUT
  → historical issue cost / certainty / provenance
```

This ADR freezes **Actual COGS reporting semantics** so the next implementation (D1.4A) can build a Reporting-owned read model **without inventing revenue** or collapsing Actual vs Theoretical costing.

## Product Owner binding decision (split)

### A. Actual COGS read model — NOW (architecture; D1.4A after Accept)

Build a derived/read-side **Actual COGS reporting model** from the D1.3B historical chain above.

### B. Food Cost Ratio / Gross Profit — DEFERRED

Do **not** calculate:

```text
Food Cost % = COGS / Revenue
```

until an authoritative **Revenue Basis** is separately defined and implemented. The repository does not yet freeze:

- Sale Price semantics;
- discounts / promotions treatment;
- Revenue Basis / Net Sales;
- tax treatment (JurisdictionProfile-compatible — ADR-0012);
- Settlement economics;
- Payment economics.

These must **not** be invented inside Food Cost / Actual COGS.

## Decision

### 1. Source of truth

Actual COGS is **derived read-side economics** (Reporting / Finance), consistent with ADR-0019.

It is **not**:

- a mutable field on Product / CatalogItem;
- a new operational ledger;
- a second inventory costing system;
- a value recomputed from the **current** RecipeVersion / PreparationVersion / RecipeProfile;
- a value owned or mutated by Intelligence (ADR-0006 / ADR-0020).

**Historical operational truth** remains:

| Owner | Artifact |
| --- | --- |
| Orders | Order, OrderLine, ConsumptionPlanSnapshot, completion / reversal entities, OrderCompleted facts |
| Inventory | GoodsIssue, GoodsIssueLine, GoodsIssue reversal entities, InventoryMovement, cost certainty / basis / provenance |

Reporting **consumes** those accepted facts and projections. Never use mutable `product.cost`. Never re-run the live recipe graph to answer historical Actual COGS.

### 2. Required reporting grain

Actual COGS must be derivable at least by:

- Order;
- OrderLine;
- sold CatalogItem;
- physical stock item (CatalogItem / stock identity on the movement);
- Outlet;
- Legal Entity;
- Warehouse;
- business date;
- arbitrary reporting period;
- valuation currency;
- cost certainty.

Where already available **without inventing new ownership**:

- category;
- channel.

Do **not** add new category/channel sources of truth merely for reporting.

### 3. Required metrics (first read model)

Support:

- sold quantity;
- Actual COGS amount;
- COGS per sold unit where mathematically meaningful;
- COGS by Order;
- COGS by sold item;
- COGS by Outlet;
- COGS by period;
- certainty breakdown;
- provenance / drill-down to authoritative GoodsIssue and InventoryMovement.

At this stage do **not** name any metric “Food Cost %” / “Food Cost Ratio” unless a valid Revenue Basis exists.

Naming must distinguish:

| Name | Meaning | Status |
| --- | --- | --- |
| **Actual COGS** | What inventory costing assigned to the sale write-off | This ADR / D1.4A |
| **Theoretical Recipe Cost** | Normative recipe cost under a defined valuation basis | Future / separate |
| **Expected COGS** | If ever implemented — separate derived concept | Future / separate |
| **Food Cost Ratio** | Actual COGS / accepted Revenue Basis | Deferred |

Do not collapse these concepts.

### 4. Certainty

Every derived Actual COGS result must preserve **material** certainty (ADR-0003 / ADR-0019).

Accepted states (existing taxonomy):

- `FINAL`
- `ESTIMATED_FROM_LAST_KNOWN`
- `UNKNOWN`
- `ORDER_UNRESOLVED`

Rules:

- `UNKNOWN` must never silently become `0`;
- `ORDER_UNRESOLVED` must not be presented as exact;
- estimated components must remain visibly estimated;
- aggregate certainty must reflect its material inputs;
- component-level drill-down remains available regardless of aggregate label.

#### Deterministic aggregate certainty (binding)

For a reporting group / period over material Actual COGS components:

1. If any material component is `UNKNOWN` → aggregate certainty **cannot** be `FINAL` (expose `UNKNOWN` or a more severe unresolved state if chronology also fails).
2. If any material component is `ORDER_UNRESOLVED` → aggregate **must** expose unresolved chronology (`ORDER_UNRESOLVED`), even if amounts are shown with caution labels.
3. Else if all material components are `FINAL` → `FINAL`.
4. Else if no `UNKNOWN` / `ORDER_UNRESOLVED` but at least one `ESTIMATED_FROM_LAST_KNOWN` → `ESTIMATED_FROM_LAST_KNOWN`.

Precedence (worst wins among material inputs):

```text
ORDER_UNRESOLVED > UNKNOWN > ESTIMATED_FROM_LAST_KNOWN > FINAL
```

This matches ADR-0003 reporting visibility and ADR-0019 “derived certainty reflects missing/estimated material components.” No new certainty enum is introduced.

Amounts for `UNKNOWN` components remain **non-fabricated**: either omitted from “exact total” presentation with explicit gap, or carried only with an `UNKNOWN` label — never coerced to monetary zero as if FINAL.

### 5. Reversals

Reversed sales must not simply disappear. Historical truth remains **append-only / compensating** (ADR-0010 / ADR-0025).

Reporting semantics:

- original sale GoodsIssue remains visible in audit history;
- reversal contributes an explicit compensating economic effect;
- net Actual COGS for a period = original + reversal according to **their actual business chronology**;
- do **not** mutate or delete the original row.

#### Period behavior

| Case | Behavior |
| --- | --- |
| Sale and reversal in the **same** reporting period | Net period Actual COGS includes both effects at their business chronology positions; audit still shows both |
| Sale in period A, reversal in period B | Period A retains the original sale economics; period B shows the compensating reversal; neither period rewrites the other’s authoritative rows |
| Backdated reversal whose business chronology belongs in a previously reported period | That period’s **read-side** report may change on replay — expected audited rebuild from facts, **not** mutation of the original movement |

Reports must be reproducible from authoritative facts alone.

### 6. Chronology

Reports group by **business chronology**, not technical arrival (ADR-0003):

- `businessDate`;
- `businessOrder`;
- `businessTime` where semantically valid.

Never use as economic chronology:

- `recorded_at`;
- upload time;
- DB insertion order;
- synchronization order.

A late-entered historical fact may change a historical read-side report if its business chronology belongs inside that period. That is audited replay, not mutation of the original movement.

### 7. Currency

Original valuation currency must be preserved (ADR-0002 / ADR-0019).

First Actual COGS read model:

- reports native / original currency;
- may aggregate only compatible **same-currency** facts;
- must **not** silently sum VND + USD + RUB;
- must **not** silently convert currencies.

Cross-currency consolidated reporting requires a later explicit FX contract (reporting currency, rate, rate source, effective date/time, provenance). **OUT** of first implementation (D1.4A).

### 8. Read model ownership

**Reporting / Finance read-side** owns the Actual COGS projection / query model.

Not Orders. Not Inventory operational truth. Not Intelligence.

Inventory continues to own source documents / movements. Orders owns Order truth. Reporting consumes accepted facts / projections.

Owner and Accountant may have different projections / views over the **same** underlying economic fact model (ADR-0019). One underlying model only.

### 9. Drill-down contract

Every reported Actual COGS aggregate must be explainable without re-resolving current recipes:

```text
report period
  → Outlet
  → sold CatalogItem
  → Order
  → OrderLine
  → GoodsIssue
  → GoodsIssueLine
  → InventoryMovement
  → cost certainty / basis / provenance
```

A user must be able to answer: “Why is this COGS number this amount?”

### 10. Historical stability

These later changes must **NOT** rewrite historical Actual COGS:

- new RecipeVersion;
- new PreparationVersion;
- changed RecipeProfile binding;
- changed Outlet default warehouse;
- changed current CatalogItem metadata;
- changed menu configuration.

Actual COGS is **historical issue cost**. Only a legitimate corrected / backdated economic fact can change a historical report through accepted replay / reversal semantics.

### 11. Same-item aggregation (record D1.3B)

Multiple physical leaves of the **same GoodsIssue and same business position** targeting the same stock item may be aggregated into one InventoryMovement OUT while preserving separate evidence lines.

This prevents false `ORDER_UNRESOLVED` **inside one economic event**.

Do **not** generalize aggregation across:

- separate Orders;
- separate GoodsIssues;
- independent economic facts.

Independent ambiguous events remain subject to ADR-0003 `ORDER_UNRESOLVED`.

### 12. Theoretical vs Actual

| Concept | Definition |
| --- | --- |
| **Actual COGS** | What inventory costing actually assigned to the sale write-off |
| **Theoretical Recipe Cost** | What a normative recipe would theoretically cost under a defined valuation basis |

Not interchangeable. First post-Accept implementation (D1.4A) implements **Actual COGS only**. Theoretical Recipe Cost requires its own later PO launch.

### 13. Food Cost Ratio (deferred formula)

Future:

```text
Food Cost Ratio = Actual COGS / accepted Revenue Basis
```

ADR-0026 states the **denominator is not defined by this block**.

Do **not** use as a substitute without a separately accepted Revenue Basis contract:

- payment received;
- gross order nominal;
- fiscal total;
- menu price;
- settlement amount.

Requests for Food Cost % before Revenue Basis exists must be **unavailable / not fabricated**.

### 14. Next implementation block (not started here)

**D1.4A — Actual COGS Read Model**

In scope after explicit PO launch:

- Reporting-owned derived projection / query model;
- Order / OrderLine Actual COGS;
- item / outlet / period aggregation;
- certainty;
- reversal semantics;
- native currency;
- drill-down / provenance;
- deterministic historical rebuild.

Explicitly OUT of D1.4A:

- Food Cost Ratio;
- Gross Profit;
- Revenue Basis;
- Net Sales;
- tax calculation;
- Settlement;
- Payments;
- Contribution Margin;
- commissions;
- delivery fees;
- payment fees;
- promotion economics;
- FX conversion;
- Theoretical Recipe Cost;
- Intelligence recommendations;
- dashboard UI unless separately launched.

## Conceptual acceptance tests (architecture)

ADR-0026 must remain valid against:

1. simple `FINAL` sale;
2. `UNKNOWN`-cost sale;
3. `ESTIMATED_FROM_LAST_KNOWN` sale;
4. `ORDER_UNRESOLVED` sale;
5. multi-line Order;
6. same stock item from multiple evidence leaves (one GoodsIssue / one business position);
7. two separate Orders at ambiguous chronology;
8. sale + reversal same day;
9. reversal in a later period;
10. recipe changes after sale (Actual COGS unchanged);
11. backdated historical fact (period rebuild);
12. two currencies in the same reporting query (no silent sum / convert);
13. Outlet aggregation;
14. OrderLine drill-down;
15. request for Food Cost % before Revenue Basis — unavailable / not fabricated.

## Contradictions / alignment notes

| Topic | Finding |
| --- | --- |
| ADR-0019 Food Cost UX / FoodCostRatio naming | **Aligned** — Ratio stays on the metric ladder **after** Revenue Basis; this ADR forbids fabricating the denominator |
| ADR-0019 COGS from historical write-off | **Aligned** — Actual COGS read model derives from D1.3B GoodsIssue / movement / certainty |
| ADR-0003 certainty taxonomy | **Aligned** — reuse existing states; aggregate precedence documented; no competing enum |
| ADR-0025 / D1.3B same-GoodsIssue leaf aggregation | **Aligned** — recorded; not generalized across independent economic facts |
| Revenue / Net Sales / tax | **No contradiction** — explicitly deferred; JurisdictionProfile remains ADR-0012 concern |
| Contribution Margin / Direct Variable Costs | **Out of D1.4A** — Actual COGS is one typed component input later; not implemented here |

No unresolved contradiction requiring a new Level C product invent. Remaining work is **D1.4A implementation sequencing** after explicit PO launch.

## Consequences

- D1.4A can implement Actual COGS reporting without inventing revenue.
- Food Cost Ratio / Gross Profit remain blocked until Revenue Basis ADR / implementation.
- Theoretical Recipe Cost remains a separate future launch.
- Docs and UX copy must say **Actual COGS**, not “Food Cost %”, until Ratio is accepted.

## Alternatives considered

- Implement Food Cost % using menu price / payment / fiscal total — **rejected** (invents Revenue Basis).
- Recompute historical COGS from current recipe — **rejected** (breaks historical truth).
- Store Actual COGS on CatalogItem / Product — **rejected** (mutable false SoT).
- Intelligence owns COGS ledger — **rejected** (ADR-0006 / ADR-0020).
- New certainty enum for reporting — **rejected** (reuse ADR-0003).
- Silent multi-currency totals — **rejected** (ADR-0019).
- Hide reversed sales from history — **rejected** (append-only / compensating).

## Out of scope for this ADR PR

- Application code, migrations, schema, HTTP APIs, UI.
- D1.4A implementation.
- Revenue Basis / Food Cost Ratio / Gross Profit / Theoretical Recipe Cost implementation.
