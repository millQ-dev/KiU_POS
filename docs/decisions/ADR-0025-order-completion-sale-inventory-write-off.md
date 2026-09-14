# ADR-0025: Order Completion and Sale Inventory Write-off Semantics

- **Status:** Accepted
- **Date:** 2026-09-14
- **Accepted:** 2026-09-14 (Product Owner binding decisions recorded)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0003, ADR-0008, ADR-0009, ADR-0010, ADR-0016, ADR-0018, ADR-0019; Architecture v1.2 / v1.3; D1.1 Recipes & Preparations; D1.2A/B Production; Block C Goods Receipt
- **Blocks enabled after Accept:** D1.3A (Orders Foundation & Consumption Plan), then D1.3B (GoodsIssue & Automatic Sale Write-off)

## Context

The charter vertical reaches:

```text
Restaurant → Employee → Ingredient → Recipe → Goods Receipt → Sale → Automatic Write-off → Food Cost Report
```

D1.1 / D1.2A / D1.2B and Block C deliver recipes, production, and inventory costing. The next application vertical is **Sale → Automatic Inventory Write-off**. Food Cost remains deferred.

A Level C STOP correctly identified that Accepted ADRs define **consumption invariants** but not the executable **Order completion / GoodsIssue event model**. This ADR records Product Owner binding decisions so D1.3A/B can implement without inventing architecture.

## Decision

### 1. Sale is not a separate aggregate

Do **not** introduce a separate `Sale` source-of-truth aggregate.

The charter term **Sale** means the **economic completion of an Order**.

| Owner | Owns |
| --- | --- |
| **Orders** | Order, OrderLine, commercial/order snapshots, lifecycle |
| **Inventory** | typed inventory documents (including GoodsIssue), InventoryMovement, inventory balance projections |

Orders must **not** write Inventory tables directly.

### 2. Automatic write-off trigger

Authoritative sale/write-off trigger:

```text
CompleteOrder → OrderCompleted
```

Inventory is written off **exactly once** as part of successful Order completion.

Write-off is **not** triggered by:

- `SendToProduction`;
- an individual Payment;
- a partial Payment;
- arbitrary server arrival / upload order;
- a manual operator `PostGoodsIssue` workflow as the normal sale path.

Future POS/Settlement orchestration may require settlement coverage before allowing `CompleteOrder` in paid flows. **Settlement does not own inventory semantics** (ADR-0016: Order ≠ Settlement).

### 3. Preorders / open orders

An OPEN order or preorder:

- creates **no** inventory movement;
- fixes **no** issue cost;
- does **not** freeze the sale consumption recipe merely because a line was created.

Physical consumption and issue cost are determined at the actual `CompleteOrder` business event (ADR-0003 preorder rule preserved).

### 4. GoodsIssue ownership and atomic completion

Sale inventory write-off is an Inventory-owned typed **`GoodsIssue`** (ADR-0010).

- GoodsIssue references its source Order / OrderLines.
- Orders coordinates completion through an application/domain orchestration boundary.
- Orders does not mutate Inventory tables.

Target modular-monolith transaction:

```text
validate / freeze Order completion
  → create + POST GoodsIssue
  → immutable InventoryMovement OUT effects
  → Order COMPLETED
  → operational fact mirrors
```

Commit atomically, or none commit.

**Document ≠ Movement** remains binding (ADR-0010).

### 5. Minimal Order lifecycle for D1.3A

```text
OPEN → COMPLETED
OPEN → CANCELLED
```

Required commands/concepts only:

- `OpenOrder`
- `AddOrderLine`
- update/remove an OPEN line as required
- `CompleteOrder`
- `CancelOrder`

Business-significant content of COMPLETED and CANCELLED Orders is immutable.

Deferred from D1.3A/B:

- full POS workflow;
- SendToProduction / KDS;
- FloorPlan / Table;
- Settlement implementation;
- Payment implementation;
- Fiscalization.

### 6. Historical recipe/preparation pinning

Consumption version is frozen at **actual Order completion**, not at OPEN / preorder creation.

`CompleteOrder` resolves and persists an immutable **ConsumptionPlanSnapshot** sufficient for exact historical reproduction. It must preserve at least:

- sold CatalogItem identity;
- quantity / unit basis;
- exact root RecipeVersion or PreparationVersion actually applicable;
- exact nested recipe/preparation versions actually resolved;
- applied VIRTUAL / STOCK_TRACKED materialization semantics;
- normalized physical stock leaves and quantities;
- resolution/provenance hash or equivalent deterministic evidence.

Later publication of another RecipeVersion / PreparationVersion must not mutate or reinterpret a completed Order.

Do **not** use “current recipe” when replaying historical completed Orders.

### 7. Modifiers / Effective Recipe

**OUT OF SCOPE for D1.3A/B v1.**

First sale-write-off supports the **base** recipe/preparation graph only.

Do not invent modifier semantics or a universal Effective Recipe system in this vertical. A later PO-launched block will add that.

### 8. Consumption strategy source

Do not create a new mutable per-OrderLine strategy source of truth.

Physical behavior derives from accepted preparation materialization semantics (ADR-0003 / ADR-0009):

| Mode | Sale write-off |
| --- | --- |
| `VIRTUAL` / `EXPLODE_RECIPE_ON_SALE` | Expand recursively to physically stock-tracked leaves |
| `STOCK_TRACKED` / `CONSUME_FINISHED_ITEM` | Consume finished/prepared stock item only |

The completed ConsumptionPlanSnapshot may record the strategy that was resolved/applied for historical evidence.

**Invariant:** exactly one physical write-off path. Never both.

### 9. Cancel vs reversal

| Timing | Workflow | Inventory |
| --- | --- | --- |
| Before COMPLETED | `CancelOrder` | No GoodsIssue; no inventory movements |
| After COMPLETED | `ReverseCompletedOrder` | Explicit Order reversal record/fact → Inventory-owned GoodsIssue reversal → compensating movements → explicit audit/feed facts |

After COMPLETED, the original Order cannot be silently cancelled or edited.

Original Order, GoodsIssue, and movements remain **immutable**.

Do **not** create fake Orders or fake GoodsIssues merely to represent reversals (same class of defect rejected for D1.2B production stubs).

### 10. Partial payment / multi-check

Payments and Settlement do **not** directly trigger inventory write-off.

Partial settlement coverage never creates a sale GoodsIssue.

Future standard paid POS flow:

```text
Settlement complete → permits/causes CompleteOrder → OrderCompleted causes GoodsIssue
```

Settlement implementation itself is deferred from D1.3A/B unless an already accepted interface contract strictly requires a stub.

### 11. Warehouse selection

D1.3B sales issue warehouse is the **authoritative default sales/inventory-issue warehouse configured for the Outlet / RestaurantLocation**.

- Do not accept an arbitrary warehouse chosen by the client/terminal as inventory truth.
- Order completion stores the resolved warehouse reference for historical reproduction.
- Multi-warehouse line routing, terminal-specific override, and arbitrary manual override are deferred.

If implementation finds no existing location→default issue warehouse binding, D1.3A/B must introduce only the minimal Organization config concept implied by this boundary (not per-terminal inventiveness).

### 12. Block sequence after Accept

**D1.3A — Orders Foundation & Consumption Plan**

- minimal Order / OrderLine lifecycle;
- RecipeGraphResolver required by sale consumption (base graph only);
- historical ConsumptionPlanSnapshot;
- **no** inventory effects.

**D1.3B — GoodsIssue & Automatic Sale Write-off**

- automatic GoodsIssue on `CompleteOrder`;
- VIRTUAL recursive leaf write-off;
- STOCK_TRACKED finished-item write-off;
- Block C / D1.2B economic stream reuse;
- historical COGS-ready issue cost / certainty;
- reversal / compensation;
- idempotency / concurrency.

Do **not** combine Food Cost into either block.

### 13. Food Cost

**Explicitly deferred.**

Food Cost begins only after D1.3B is independently reviewed, accepted, merged into Origin, backed up to GitHub, and the Product Owner explicitly launches the Food Cost block.

### 14. Offline

D1.3A/B implementation is **online-first**.

Contracts must remain ADR-0018-compatible from day one:

- idempotent commands;
- business chronology;
- device/actor provenance where required;
- deterministic sync-safe semantics;
- no technical upload-order costing.

Do **not** implement Local Store, Outbox, Inbox, sync engine, or offline POS runtime in D1.3A/B.

## Cross-references (must remain preserved)

| ADR / block | Binding content reused |
| --- | --- |
| ADR-0002 | Units / money precision; no float money |
| ADR-0003 | Costing, negative stock, chronology, preorder, exclusive materialization |
| ADR-0008 | Module ownership (Orders ≠ Inventory) |
| ADR-0009 | Catalog / recipe graph / consumption modes |
| ADR-0010 | Typed document ≠ movement; posting / reversal |
| ADR-0016 | Order ≠ Settlement |
| ADR-0018 | Offline / business chronology |
| ADR-0019 | Historical COGS / CostQuote certainty |
| D1.1 | VIRTUAL / STOCK_TRACKED preparations |
| D1.2A/B | Production fact vs posting; shared inventory stream |
| Block C | Goods Receipt / shared rebuild / valuation currency stream |

## Conceptual architecture tests

These scenarios must remain consistent with this ADR (implementation later in D1.3A/B):

| Case | Expected under this ADR |
| --- | --- |
| Normal stock CatalogItem | CompleteOrder → GoodsIssue OUT of that item |
| VIRTUAL recipe | Expand to stock-tracked leaves only; no virtual parent OUT |
| Nested VIRTUAL preparation | Recursive expand; still one physical path |
| STOCK_TRACKED preparation | Consume finished stock only; do not explode recipe |
| Preorder before recipe change, complete after | Snapshot at CompleteOrder uses versions resolved at completion; OPEN line creation did not pin |
| Cancel before completion | No GoodsIssue / movements |
| Reverse after completion | Compensating GoodsIssue reversal + movements; originals immutable |
| Partial payment | No GoodsIssue |
| Split checks | Settlement may gate CompleteOrder later; Settlement never owns write-off |
| Negative stock / UNKNOWN | Same certainty semantics as ADR-0003 / D1.2B stream |
| Multiple warehouses | Default outlet issue warehouse only in D1.3B; no client-chosen truth |
| Later recipe publication | Completed Order snapshot unchanged |
| Retry / concurrent CompleteOrder | Idempotent one economic GoodsIssue |
| Offline command later with real business chronology | Chronology from business position, not upload order; runtime deferred |

## Contradictions checked

| Potential tension | Resolution in this ADR |
| --- | --- |
| Charter “Sale” vs Orders SoT | Sale = OrderCompleted economically; no Sale aggregate |
| ADR-0016 settlement completion vs write-off | Settlement may gate CompleteOrder; write-off owned by OrderCompleted → GoodsIssue |
| OrderLine snapshot at add vs ADR-0003 cost-at-sale | Commercial snapshot may exist earlier; **consumption** pinned only at CompleteOrder |
| Manual GoodsIssue vs automatic sale path | Manual GoodsIssue remains a typed inventory capability; **not** the normal sale write-off trigger |
| D1.2B reverse stub anti-pattern | Explicit Order reversal + GoodsIssue reversal entities; no fake Orders/GoodsIssues |
| Effective Recipe needed for modifiers | Explicitly deferred; base graph only in D1.3A/B |

No unresolved contradiction with Accepted ADRs was found for these binding decisions. Remaining work is implementation sequencing (D1.3A then D1.3B), not re-decision.

## Consequences

### Positive

- Unblocks D1.3A/B without inventing a Sale ledger.
- Preserves exactly-one write-off and historical CostQuote semantics.
- Keeps Settlement / Payments / Fiscal / Food Cost / Offline runtime out of the first sale-write-off path.

### Negative / follow-up

- D1.3A must deliver RecipeGraphResolver + ConsumptionPlanSnapshot before inventory effects.
- Organization needs an authoritative Outlet → default issue warehouse binding by D1.3B.
- Modifier / Effective Recipe remains a later PO-launched block.

## Status

**Accepted** (Product Owner binding decisions 2026-09-14). After Origin merge and GitHub backup verification: **STOP** — D1.3A starts only on explicit Product Owner launch.
