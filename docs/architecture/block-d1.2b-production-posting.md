# Block D1.2B Implementation — Production Posting / Inventory / Costing

**Status:** Remediation in review (Origin PR #29)
**ADRs:** ADR-0002, ADR-0003, ADR-0008, ADR-0009, ADR-0010, ADR-0018, ADR-0019
**Autonomy:** Level B (remediation within accepted ADRs)
**Baseline:** Origin `main` @ `ae49f08` (after D1.2A)

## Boundary

Completes **physical/economic posting** for FINALIZED STOCK_TRACKED `ProductionBatch`:

```text
D1.2A FINALIZED  = immutable production fact
D1.2B POSTED     = inventory/economic posting completed
```

Atomic flow:

1. Lock FINALIZED + `posting_status=UNPOSTED` batch
2. Validate request currency against **legal_entity valuation currency** (authoritative stream scope)
3. Resolve physical actual inputs (CatalogItem; nested STOCK_TRACKED → output CatalogItem; VIRTUAL nested rejected)
4. Quote issue cost at business position via shared stream replay (`FINAL` / `ESTIMATED_FROM_LAST_KNOWN` / `UNKNOWN` / `ORDER_UNRESOLVED`)
5. Insert Inventory **OUT** movements with persisted `cost_certainty` / `cost_basis`
6. Sum actual batch cost (certainty merged; UNKNOWN does not become silent FINAL zero)
7. Unless TOTAL_LOSS: insert Inventory **IN** for output CatalogItem with batch certainty; unit cost = batchCost / actual usable output
8. Lock valuation stream + `rebuildInventoryBalance` (shared with Goods Receipt; currency-scoped)
9. Mirror facts; audit; set `posting_status=POSTED`

**TOTAL_LOSS:** input OUTs + `ProductionTotalLoss` fact; **no** output IN; **no** `PreparationProduced`.

**Reversal:** dedicated `production_batch_reversal` entity (not a fake `production_batch`); compensating `ProductionBatchReversal` movements; `ProductionPostingReversed` fact; originals immutable.

## Chronology (ADR-0003 §8)

Economic order: `business_date ASC, business_order ASC`, then non-reversal before reversal compensations at the same position.
**Never** `recorded_at` / upload / UUID as costing tie-breaker. Same-class ties → `ORDER_UNRESOLVED`.

## Valuation stream scope

`legal_entity + warehouse + catalog_item + valuationCurrency`
Balance PK includes `currency_code`. Certainty persisted on movements and `inventory_balance.carrying_certainty`.

## Explicitly out of scope

Sales/Orders/POS, modifiers, Effective Recipe, sale write-off, Food Cost/CM UI, payments, fiscal, allergen resolver, Workforce, Professional Workspace, Intelligence recommendations, offline sync, full ADR-0003 deficit ledger / `NegativeStockResolutionDelta`.
