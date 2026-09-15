# ADR-0027: Reversal Business Chronology Semantics

- **Status:** Accepted
- **Date:** 2026-09-15
- **Accepted:** 2026-09-15 (PO LAUNCH — binding decisions recorded)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0003, ADR-0010, ADR-0019, ADR-0025, ADR-0026; Block D1.3B; Architecture v1.2 / v1.3
- **Blocks enabled after Accept:** **D1.3B-R1** — Reversal Chronology Remediation (implementation; **not** launched by this ADR)
- **Remains blocked until D1.3B-R1 merges:** **D1.4A** — Actual COGS Read Model
- **Explicitly deferred:** Food Cost Ratio / Revenue Basis / Gross Profit / Theoretical Recipe Cost

## Context

D1.3B delivered `ReverseCompletedOrder` with dedicated reversal entities (`sales_order_completion_reversal`, `goods_issue_reversal`) and compensating `InventoryMovement` rows (`source_document_type = GoodsIssueReversal`).

D1.4A preflight correctly **STOPPED**: ADR-0026 requires Reporting period A/B semantics from each effect’s own business chronology, but D1.3B reversal artifacts store only technical clocks (`reversed_at`, `created_at`) and compensating movements **copy the original sale** `business_date` / `business_order` / `business_time`. `ReverseCompletedOrder` does not accept a business position.

This ADR freezes the binding Product Owner decision so remediation (D1.3B-R1) and then Actual COGS (D1.4A) can proceed without inventing chronology or maintaining two incompatible timelines.

## Product Owner binding decision

`ReverseCompletedOrder` is a **business event in its own right**.

It therefore has its own authoritative business position:

```text
businessDate
businessOrder
businessTime?
```

Technical timestamps:

```text
reversed_at
created_at
recorded_at
```

are audit/recording clocks only and **must never** substitute for reversal business chronology.

## Decision

### 1. Command contract (future D1.3B-R1)

`ReverseCompletedOrder` must require:

```text
orderId
idempotencyKey
businessDate
businessOrder
businessTime?
reason?
actorId?
deviceId?
```

Business chronology is **business-significant** and must be included in the reversal semantic fingerprint / idempotency comparison.

| Same key + … | Result |
| --- | --- |
| same reversal semantics including chronology | idempotent duplicate success |
| different business chronology (or other semantic mismatch) | `IdempotencyConflictError` |

### 2. Orders persistence

`sales_order_completion_reversal` must preserve the authoritative reversal position:

```text
business_date
business_order
business_time?
```

- The Order remains `COMPLETED` and immutable (ADR-0025).
- Reversal remains a separate compensating fact/entity.
- Do **not** mutate Order completion chronology.

### 3. Inventory persistence

`goods_issue_reversal` must preserve the **same** reversal business position.

Orders passes this position synchronously through the Inventory reversal port inside the same atomic transaction.

Orders and Inventory must **not** invent independent reversal positions.

### 4. Compensating InventoryMovement chronology (critical)

Compensating `GoodsIssueReversal` `InventoryMovement` uses the **reversal event business chronology**, **not** the original sale chronology.

Example:

```text
Jan 10 / businessOrder 50
SALE:
  InventoryMovement OUT −1

Jan 12 / businessOrder 20
REVERSAL:
  InventoryMovement IN +1
```

Inventory history must show stock leaving on Jan 10 and returning on Jan 12.

Do **not** rewrite Jan 10 by placing compensation at the sale position.

The compensating movement still preserves the **original historical quantity, amount/cost, currency, certainty, and provenance relationship** required to reverse the sale.

Do **not** revalue the reversal from current recipe / current moving average.

Two independent concepts are preserved:

```text
economic amount being reversed  = original GoodsIssue historical cost
economic time of the reversal   = reversal command business chronology
```

### 5. Same-position reversal

A reversal **may** share the same `businessDate` / `businessOrder` as its primary sale when that is genuinely the business fact.

In that case accepted economic replay ordering applies (ADR-0003):

```text
primary effect
→ linked reversal effect
```

The existing reversal-after-primary **effect-class** rule remains valid (`source_document_type` ending in `Reversal`).

Two **unrelated** facts at the same unresolved position must still produce `ORDER_UNRESOLVED`. Do not use reversal logic to order unrelated movements. Never use technical insertion / UUID / upload order as an economic tie-break.

### 6. Operational facts

`OrderCompletionReversed` and related Inventory reversal facts use the **reversal position**:

```text
businessDate
businessOrder
businessTime?
```

They must not reuse the sale position and must not derive economic chronology from `occurred_at` / `recorded_at`.

Original completion facts remain unchanged.

### 7. Reporting semantics (ADR-0026 remains binding)

Reporting REVERSAL effect position comes from the authoritative reversal entity/document chronology.

Therefore:

```text
Sale period A
Reversal period B

A → +Actual COGS
B → −Actual COGS
```

- Sale + reversal in the same period may net to zero while both remain visible in drill-down.
- A backdated reversal belongs to its explicitly supplied business position and may alter a rebuilt historical read model.
- A reversal-only period may legitimately have **negative** net Actual COGS (do not clamp to zero).

### 8. Inventory replay consequences

Reversal compensation at reversal chronology participates normally in the shared inventory valuation stream:

- carries the original sale cost being compensated;
- preserves valuation currency;
- preserves appropriate certainty / basis;
- enters the stream at the **reversal** business position;
- rebuilds affected streams using existing ADR-0003 ordering;
- never uses technical insertion order.

A later reversal may therefore change inventory quantity / carrying state **from the reversal position forward**, not retroactively before the reversal.

### 9. Legacy data / migration rule

**Do not fabricate chronology for existing reversal rows.**

Specifically forbidden:

- copying `reversed_at` into `business_date`;
- deriving chronology from `created_at`;
- assigning arbitrary `businessOrder`;
- silently using original sale chronology as the reversal event position.

Before D1.3B-R1 implementation, inspect whether persistent reversal rows exist outside disposable test fixtures.

If authoritative existing rows without business chronology exist, **STOP** and report them to PO for explicit remediation policy.

Do not invent a backfill.

### 10. Follow-up blocks (not this ADR)

After this ADR is Accepted and merged:

1. **D1.3B-R1 — Reversal Chronology Remediation** (implementation; requires explicit PO launch)
2. Then **D1.4A — Actual COGS Read Model** (remains blocked until D1.3B-R1 is merged and backed up)

This ADR is **architecture-only**. No runtime code, no migration, no D1.3B-R1, no D1.4A, no Revenue / Food Cost Ratio in this change.

## Conceptual acceptance (architecture must support)

1. Sale Jan 10 → reversal Jan 10.
2. Sale Jan 10 → reversal Jan 12.
3. Sale Jan 10 → explicitly backdated reversal Jan 9/10 as allowed by business chronology.
4. Same idempotency key + same reversal position → duplicate success.
5. Same key + different reversal position → conflict.
6. Same-position linked sale/reversal → primary before reversal.
7. Two unrelated events at unresolved same position → `ORDER_UNRESOLVED`.
8. Inventory quantity returns only from reversal position forward.
9. Reversal restores original historical cost; no current-cost revaluation.
10. Reporting period A/B follows reversal chronology.
11. Technical `reversed_at` differs from `businessDate` → `businessDate` wins.

## Consequences

### Positive

- One shared timeline for Inventory and Reporting.
- ADR-0026 period A/B / reversal-only negative COGS become implementable without inventing clocks.
- Aligns with ADR-0003 effect-class ordering for same-position linked reversals.

### Trade-offs / risks

- D1.3B compensating movements that currently copy sale chronology are **non-compliant** after Accept and require D1.3B-R1 remediation.
- Offline / late-upload clients must supply an intentional business position for reverse (not “now”).

### Out of scope

- Implementing command/schema changes (D1.3B-R1).
- Actual COGS read model (D1.4A).
- Food Cost Ratio / Revenue Basis / Gross Profit.
- Changing GoodsReceipt / ProductionBatch reversal chronology (this ADR binds **sale completion / GoodsIssue** reversal; other document types keep their accepted semantics unless separately decided).

## Legacy-row audit (this Accept PR)

Local disposable fixture database `millq_dev` at Accept time:

| Table / filter | Count |
| --- | --- |
| `goods_issue_reversal` | 0 |
| `sales_order_completion_reversal` | 0 |
| `inventory_movement` where `source_document_type = 'GoodsIssueReversal'` | 0 |

No authoritative production database was available to this Accept agent. D1.3B-R1 must re-audit target environments before migrate and must not fabricate chronology if non-zero rows appear.

## Status of contradictions with Accepted ADRs

| Topic | Resolution |
| --- | --- |
| ADR-0025 ReverseCompletedOrder | Remains binding; this ADR **adds** required business chronology to the reversal event |
| ADR-0026 Reporting periods | Clarified: reversal position is independent; D1.4A waits for D1.3B-R1 |
| ADR-0003 stream replay | Same-position linked reversal uses effect-class; unrelated same-position → `ORDER_UNRESOLVED` |
| ADR-0010 Document ≠ Movement / compensating truth | Preserved; chronology of compensating movement = reversal event |

No unresolved contradiction remains for Accept. Remaining work is **D1.3B-R1 implementation**, not re-decision.
