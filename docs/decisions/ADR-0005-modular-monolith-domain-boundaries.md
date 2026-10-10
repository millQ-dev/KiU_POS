# ADR-0005: Modular Monolith Domain Boundaries

- **Status:** Proposed
- **Date:** 2026-08-09
- **Decision owners:** Product Owner and System Architect
- **Related issue:** [#11 — Define business structure, jurisdiction and module boundaries](https://github.com/millQ-dev/MillQ/issues/11)
- **Related analysis:** [`block-b-business-structure-jurisdiction-domain-boundaries.md`](../architecture/block-b-business-structure-jurisdiction-domain-boundaries.md)
- **Open Product Owner questions:** [`block-b-product-owner-questions.md`](../product/block-b-product-owner-questions.md)
- **Depends on:** [ADR-0001](ADR-0001-initial-technology-stack.md), [ADR-0002](ADR-0002-money-quantity-units-rounding.md), [ADR-0003](ADR-0003-yield-preparations-moving-average-costing.md), [Proposed ADR-0004](ADR-0004-business-structure-and-jurisdiction.md)

## Context

MillQ covers identity, structure, countries, catalog, recipes, purchasing, inventory, menu, pricing, orders, kitchen, payments, cash, customers, delivery, external services, costing, analytics, risk, and future fiscalization.

If these areas share tables and rules without ownership, one change can silently corrupt another area. If they are prematurely built as separate services, the initial team inherits network, deployment, consistency, and operational complexity that the Charter rejects.

MillQ therefore needs `module boundaries` (границы модулей — правила, определяющие, какая часть программы владеет данными и изменениями) inside one modular monolith.

## Decision

If accepted, the following rules define the initial domain modules.

### 1. Modules are internal boundaries, not services

- MillQ remains one modular monolith: one primary backend deployment and one PostgreSQL system initially.
- A module may have its own code namespace, database ownership convention, public application contract, and tests.
- Modules do not communicate over a network merely because a boundary exists.
- No microservice, broker, Kubernetes, or separate database is implied.
- Exact package/schema layout is deferred to Block H/I.

### 2. Every data class has one source-of-truth owner

`Source of truth` (источник истины — единственная часть, имеющая право окончательно хранить и менять факт) belongs to exactly one module.

Another module may:

- send a `command` (команда — проверяемый запрос владельцу изменить его данные);
- run a `query` (запрос — прочитать данные без изменения);
- consume a `domain event` (доменное событие — запись о уже произошедшем бизнес-факте);
- maintain a `projection` (проекция — перестраиваемая производная копия для чтения/отчёта).

It may not update the owner's tables directly.

### 3. Required modules and ownership

| Module | Owns the source of truth for | Must not own or rewrite |
| --- | --- | --- |
| Identity & Access | User/account identity, minimal operational employee profile, memberships/work assignments, roles, permissions, grants, overrides, access-scope references | Companies, HR/payroll facts, orders, audit evidence |
| Business Structure | Groups, organizations, legal entities, management profiles, brands, locations, departments, warehouse/terminal identities, structural relationships | Access grants, inventory balances, shifts, sales |
| Jurisdiction | Versioned country/region defaults, policy/capability and adapter registry metadata | Company-selected facts or unverified legal behavior |
| Catalog | Canonical item identity/type/category, base-unit and package/conversion versions | Recipes, menu presentation, price, stock, cost |
| Recipes & Preparations | Versioned recipes/preparation specifications and effective-recipe resolution | Inventory movements, orders, menu presentation |
| Purchasing | Suppliers, purchasing intent/terms, purchase orders, supplier receipt source facts | Stock movements/balances and derived cost |
| Inventory | Inventory ledgers, movements, balances, stock operations | Supplier source documents, orders, recipes, cost revisions |
| Menu | Versioned channel assortment, presentation, location/channel publication, availability configuration | Canonical catalog, price/promotion rules, orders |
| Pricing & Promotions | Versioned prices, discount/surcharge/promotion rules and evaluations | Historical order results and payment facts |
| Orders | Orders/sales, lines/modifiers, sales channel, applied commercial snapshots | Price-rule definitions, payment/refund, kitchen, stock, fiscal result |
| Kitchen | Kitchen tickets, routing, execution states/timestamps | Commercial order state and recipe definitions |
| Payments | Payment/refund transactions and provider-neutral status | Orders, cash shifts, fiscal documents |
| Cash Management | Drawers, cash shifts, cash in/out, counts and reconciliation | Payment/order source facts |
| Customer | Reusable guest profile, contacts, addresses, notes, preferences/consents | Order history facts and delivery execution snapshots |
| Fulfillment / Delivery | Handoff/delivery task, address snapshot, timing, dispatch/courier data later | Commercial order and reusable customer profile |
| Integrations | Provider connections, secret references, external mappings/messages and sync/reconciliation state | Core order/payment/menu/customer tables |
| Costing | Derived valuation state, cost results/status, negative-stock resolution values, recalculation revisions | Inventory movement, receipt, recipe, sale, payment facts |
| Analytics | Derived read models, aggregates, report definitions, refresh/checkpoint metadata | Any operational source fact |
| Audit & Risk | Immutable audit evidence, risk signals/cases/explanations/review outcomes | Source business facts or unsupported fraud declarations |
| Fiscalization | Future provider-neutral official receipt/e-invoice request/result/correction links | Order/payment source facts and unapproved jurisdiction law |

The detailed responsibility, dependency, allowed-write, and outgoing-data matrix in the linked analysis is normative supporting material for review.

### 4. Shared-database write rule

Using one PostgreSQL database does not make all tables shared.

- Only the owning module writes its records.
- Database constraints and transactions may protect cross-record integrity without transferring ownership.
- Read access from another module uses an explicit contract or approved read model; unrestricted table joins must not become hidden business dependencies.
- Future schema/package conventions must make violations visible in code review and tests.

### 5. Cross-module transactions preserve ownership

One application use case may coordinate several modules in one database transaction when inventory or financial integrity requires it.

- Each participating module validates and writes only its own state.
- A coordinating application layer may sequence module commands without owning their data.
- Failure must not leave a falsely completed financial/inventory fact.
- Exact transaction boundaries, state machines, outbox/event persistence, retries, idempotency, reversals, and recovery belong to Block C/H.

This rule does not authorize implementing Block C in this ADR.

### 6. Dependencies point toward stable capabilities

- Jurisdiction and Business Structure are foundational reference capabilities.
- Identity & Access references Business Structure scope targets; Business Structure does not depend on permission grants.
- Catalog precedes Recipes; Catalog/Recipes precede Menu; Menu and Pricing provide inputs to Orders.
- Purchasing and Orders provide source facts to Inventory through explicit commands/contracts.
- Inventory, Purchasing, and Recipes provide inputs to Costing; Costing never writes back to their source facts.
- Orders provides facts to Kitchen, Payments, Fulfillment, Inventory, and future Fiscalization without surrendering order ownership.
- Payments supplies cash facts to Cash Management without making cash shifts payment-owned.
- Integrations translates external protocols and invokes provider-neutral core contracts.
- Analytics and Audit & Risk consume events/data broadly and do not become operational dependencies that edit source modules.

Direct cyclic code dependencies are prohibited. Coordination uses an application orchestrator, a narrow neutral contract, or completed-fact events. Exact mechanics are deferred.

### 7. Country and provider logic stay behind explicit edges

- Jurisdiction owns approved country policy/capability metadata.
- Integrations owns GrabFood and other provider-specific protocol/mapping/state.
- Fiscalization owns future official receipt/e-invoice state.
- Orders, Payments, Inventory, Menu, Customer, and Costing consume provider-neutral contracts and approved policy references.
- Core modules do not import GrabFood-specific types or embed Vietnam fiscal rules.

### 8. Historical snapshots belong with the consuming fact

Definitions and applied outcomes have different owners:

- Pricing owns price/promotion definitions; Orders owns the immutable applied price/adjustment result.
- Catalog owns item identity; Orders keeps the required sold-line name/code snapshot.
- Customer owns reusable profile data; Fulfillment/Orders keep the required address/contact snapshot used for the fact.
- Recipes owns versions/resolution; the sale/production fact keeps the exact version/result reference needed for history.
- Business Structure owns current/history relationships; each critical fact keeps the responsible context that applied then.

The snapshot is evidence of the consuming fact, not a second editable master record.

### 9. Events describe facts but do not select infrastructure

Candidate events such as `SaleCompleted`, `InventoryMovementRecorded`, `PaymentAccepted`, and `CostRevised` describe facts available to other modules.

Block B does not decide:

- synchronous versus asynchronous handling;
- an outbox, queue, broker, or worker;
- ordering, delivery guarantee, idempotency key, or replay storage;
- exact payload schemas.

Those decisions belong to Blocks C/H/F as applicable.

### 10. Analytics and Audit & Risk are non-authoritative consumers

- Analytics can rebuild derived views from source facts and cost revisions.
- Audit & Risk can record evidence, raise explainable signals, and later request review/blocking through approved contracts.
- Neither module may edit or delete the source order, payment, movement, receipt, kitchen, customer, fiscal, or structure fact it analyzes.
- An anomaly is not proof of fraud.

## Invariants

1. Every owned data class has exactly one source-of-truth module.
2. Only the owner module writes its data.
3. A projection can be rebuilt and never becomes an authoritative operational fact.
4. A module boundary does not imply a service, network call, separate deployable, or separate database.
5. Shared database transactions may coordinate correctness without allowing cross-module table writes.
6. Orders, payments, cash, kitchen, inventory, costing, audit, analytics, and fiscalization remain separate sources of truth.
7. Pricing/recipe/structure changes never rewrite historical applied snapshots by implication.
8. Integrations contains provider-specific logic; core modules use provider-neutral contracts.
9. Fiscalization is separate from Orders and Payments and contains no unapproved Vietnam behavior.
10. Analytics and Audit & Risk cannot mutate source business facts.
11. Direct cyclic module dependencies are prohibited.
12. Event transport and transaction mechanics are not invented in Block B.

## Alternatives considered

### One undivided application layer and shared data model

Rejected. Ownership becomes unclear, cross-feature changes are unsafe, and later extraction or testing becomes expensive.

### Microservices per domain

Rejected by the Charter and ADR-0001. It adds network and distributed-consistency problems before they are justified.

### Shared database with unrestricted cross-module writes

Rejected. It creates a distributed ownership problem inside one process and makes invariants unenforceable.

### Everything communicates only by asynchronous events

Rejected. Some critical operations need immediate validation and one transaction; mandatory event-driven infrastructure would be premature.

### Put channel, payment, delivery, and fiscal provider logic in Orders

Rejected. It leaks volatile external/country concerns into the commercial core and blocks other channels/providers.

### Put costing inside Inventory

Rejected. Inventory movement is a business fact, while cost is derived, revisable, and has separate uncertainty/recalculation history under ADR-0003.

## Consequences

### Positive

- One deployable remains simple while domain ownership becomes explicit.
- Inventory and financial facts can use one transaction without microservice complexity.
- Teams and AI agents can change one area with a reviewable dependency surface.
- External providers and new jurisdictions do not contaminate core modules.
- Historical snapshots, analytics, audit, and revised costing remain explainable.

### Negative / accepted cost

- Explicit commands, queries, event contracts, and adapters add structure before feature code.
- Some data is intentionally duplicated as immutable snapshots or rebuildable projections.
- Shared-database ownership needs enforcement conventions in later repository work.
- Cross-module orchestration and transaction/event mechanics still require Block C/H decisions.

## Deferred decisions

- Exact folder/package/database-schema layout.
- Public contract and dependency-enforcement tooling.
- Transaction manager/unit-of-work mechanics.
- Event persistence, outbox, queue, worker, retry, ordering, and schema versioning.
- Read-model storage/refresh strategy.
- Detailed APIs and lifecycle state machines.
- Offline module replicas/synchronization.
- Concrete Vietnam/GrabFood/fiscal adapters.
- Detailed permission and risk-control algorithms.

## Validation plan

Before acceptance:

1. Verify every module in Operator v2 appears exactly once with clear ownership.
2. Review all cross-module data for a single source of truth.
3. Trace receipt, sale, external-order, payment/cash, costing, analytics, risk, and future fiscal flows without direct cross-module writes.
4. Confirm the dependency map has no required cyclic code dependency.
5. Confirm one deployment/database remains possible and no microservice infrastructure is introduced.
6. Confirm no Block C state machine/transaction implementation or country/provider behavior is invented.
7. Obtain independent review and explicit Product Owner/System Architect acceptance.

## Owner/architect acceptance checklist

- [ ] Accept the 20-module map inside one modular monolith.
- [ ] Accept one source-of-truth owner per data class.
- [ ] Accept owner-only writes and explicit command/query/event/projection contracts.
- [ ] Accept cross-module coordination in one database transaction while ownership stays separate.
- [ ] Accept the stated dependency direction and prohibition on cyclic code dependencies.
- [ ] Accept separate Catalog/Recipes/Menu/Pricing/Orders ownership.
- [ ] Accept separate Orders/Kitchen/Payments/Cash/Inventory/Costing ownership.
- [ ] Accept Integrations and Fiscalization as isolated edges.
- [ ] Accept Analytics and Audit & Risk as non-mutating consumers.
- [ ] Accept deferral of exact packages, transactions, event transport, and lifecycle mechanics.
