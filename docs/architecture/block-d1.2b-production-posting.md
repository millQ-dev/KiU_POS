# Block D1.2B Implementation — Production Posting / Inventory / Costing

**Status:** Implemented on feature branch (awaiting independent handoff review #2)  
**ADRs:** ADR-0002, ADR-0003, ADR-0008, ADR-0009, ADR-0010, ADR-0018, ADR-0019  
**Autonomy:** Level C  
**Baseline:** Origin `main` @ `ae49f08` (after D1.2A)

## Boundary

Completes **physical/economic posting** for FINALIZED STOCK_TRACKED `ProductionBatch`:

```text
D1.2A FINALIZED  = immutable production fact
D1.2B POSTED     = inventory/economic posting completed
```

Atomic flow:

1. Lock FINALIZED + `posting_status=UNPOSTED` batch  
2. Resolve physical actual inputs (CatalogItem; nested STOCK_TRACKED → output CatalogItem; VIRTUAL nested rejected)  
3. Quote issue cost at business position (FINAL / ESTIMATED_FROM_LAST_KNOWN / UNKNOWN) via Block C stream replay  
4. Insert Inventory **OUT** movements  
5. Sum actual batch cost (UNKNOWN does not become silent zero certainty)  
6. Unless TOTAL_LOSS: insert Inventory **IN** for output CatalogItem at batch material cost; unit cost = batchCost / actual usable output  
7. `rebuildInventoryBalance` (shared with Goods Receipt)  
8. Mirror `InventoryConsumed` + `PreparationProduced` facts; audit  
9. Set `posting_status=POSTED` + idempotency fingerprint  

**Reversal included:** compensating `ProductionBatchReversal` movements; originals immutable; retry idempotent.

## Reuse (no second costing engine)

- `inventory_movement` / `inventory_balance` (migration 002)  
- `rebuildInventoryBalance` (`apps/api/src/modules/inventory/rebuild-balance.ts`) shared with Block C  
- Domain: `costForQuantity`, `computeActualBatchUnitCost`, `replayStreamBefore` / `issueCostQuoteFromStream`  

## Explicitly out of scope

Sales/Orders/POS, modifiers, Effective Recipe, sale write-off, Food Cost/CM UI, payments, fiscal, allergen resolver, Workforce, Professional Workspace, Intelligence recommendations, offline sync.
