# ADR-0004: Business Structure and Jurisdiction Model

- **Status:** Proposed
- **Date:** 2026-08-09
- **Decision owners:** Product Owner and System Architect
- **Related issue:** [#11 — Define business structure, jurisdiction and module boundaries](https://github.com/millQ-dev/MillQ/issues/11)
- **Related analysis:** [`block-b-business-structure-jurisdiction-domain-boundaries.md`](../architecture/block-b-business-structure-jurisdiction-domain-boundaries.md)
- **Open Product Owner questions:** [`block-b-product-owner-questions.md`](../product/block-b-product-owner-questions.md)
- **Depends on:** [ADR-0001](ADR-0001-initial-technology-stack.md), [ADR-0002](ADR-0002-money-quantity-units-rounding.md), [ADR-0003](ADR-0003-yield-preparations-moving-average-costing.md)

## Context

MillQ must support a foreign owner company, one or more Vietnam operating legal entities, separate management companies, multiple brands and restaurants, departments, warehouses, and terminals. One owner may participate in several structures and jurisdictions.

A single parent-child hierarchy cannot express all real relationships. For example, a management company may manage restaurants legally operated by different entities, and one brand may be used by several legal entities. Conflating these links would corrupt access control, reporting, inventory responsibility, and historical attribution.

Country selection must provide sensible defaults such as VND for Vietnam without embedding Vietnam-specific conditions throughout shared modules.

## Decision

If accepted, MillQ will use the following business-structure and jurisdiction rules.

### 1. BusinessGroup is the top collaboration context, not a legal claim

`BusinessGroup` (группа бизнеса) groups the parties and operational nodes managed together in MillQ.

- It has a stable technical identity and lifecycle.
- It may register multiple legal entities, management entities, brands, restaurants, departments, warehouses, and terminals.
- A user identity may have memberships in multiple groups.
- Group registration does not prove legal ownership, tax consolidation, accounting consolidation, or permission.
- Whether the group is also the subscription, billing, or hard data-isolation boundary requires Product Owner decision.

### 2. Organizations, legal entities, and management entities are distinct concepts

`Organization` (организация) is a business actor record.

`LegalEntity` (юридическое лицо) is an organization with a registration jurisdiction and legal identifiers. Legal and financial facts reference the responsible legal entity explicitly.

`ManagementEntity` (управляющая структура) is a management profile attached to a responsible organization and used in `ManagementMandate` relationships. A mandate records which operational scope is managed and during which effective period.

- Management does not imply ownership.
- Ownership does not imply operational management.
- Neither relationship grants application access automatically.
- Whether a management entity must always be a registered legal entity, or may also be an internal non-legal structure, remains a Product Owner question.

### 3. Ownership and control are effective-dated relationships

`OwnershipInterest` (доля/связь владения с периодом действия) links an allowed owner party to a legal entity.

- It has validity dates, status, source/evidence reference, and audit metadata.
- Foreign-company ownership of a Vietnam legal entity is supported without changing the Vietnam entity's jurisdiction.
- Exact percentage, voting-control, beneficial-owner, and natural-person data are not defined until Product Owner and legal/privacy review.

`BrandControl` separately records the organization controlling or licensing a brand.

### 4. Legal operation, management, and brand use are separate

`RestaurantLocation` (ресторан как операционная точка) has separate effective-dated relationships:

- `LegalOperatorAssignment`: the responsible selling/operating legal entity;
- `ManagementMandate`: the management entity responsible for an approved scope;
- `BrandAssignment`: the brand or brands presented at the location;
- `JurisdictionAssignment`: the operating jurisdiction profile.

A location's current relationships are never used to reinterpret a historical order. A legal, financial, stock, or audit fact keeps the applicable responsible IDs and required version/snapshot references.

Whether one location may have several concurrent selling legal entities or brands is an open Product Owner decision. The architecture does not use the restaurant ID as a substitute for legal seller or brand.

### 5. Operational nodes keep narrow meanings

`Department` (подразделение) is an operational area placed in an approved parent context. It does not own inventory balance or cash by implication.

`Warehouse` (складской контур) is a stable structure and access-scope identity. Business Structure owns its identity and assignments; Inventory owns its ledger, balances, and movements.

- A warehouse inventory ledger has one responsible legal entity and one valuation currency.
- Stock of different legal entities/currencies is not mixed in one costing stream.
- Changing the responsible legal entity or valuation currency ends the old effective assignment and starts a separate ledger context; it never reinterprets the old ledger.
- A central warehouse may serve several locations through explicit service assignments.
- If one physical facility holds stock for several legal entities, separate logical warehouse/ledger contexts are required unless a later accepted decision proves another compliant separation.

`Terminal` (кассовый терминал) is a stable POS business endpoint assigned to a restaurant and optionally a department.

- A transaction carries explicit legal entity, location, terminal, and other required context.
- Terminal assignment does not replace authorization.
- Device credentials, sessions, shifts, offline identity, and synchronization belong to later blocks.
- Concurrent multi-legal-entity use of one terminal is an open Product Owner question.

### 6. Jurisdiction is explicit and versioned

`JurisdictionProfile` (версия настроек страны/региона) contains:

- country and optional subdivision identity;
- effective interval and source version;
- default currency and presentation/localization defaults;
- references to approved rounding, tax/fiscal, privacy, or other policies when those policies exist;
- available adapter/capability metadata.

Every legal entity selects a registration jurisdiction. Every restaurant selects an operating jurisdiction. Country-derived defaults are resolved through Jurisdiction during onboarding.

### 7. Defaults are inputs, not hidden mutable rules

At creation time MillQ records:

- selected jurisdiction;
- source profile version;
- each resolved setting that becomes explicit configuration;
- whether an allowed value used the default or an approved override.

Vietnam supplies VND as the onboarding currency default. This does not make VND a global constant and does not authorize any Vietnam tax/fiscal rounding behavior.

A later default change does not silently rewrite posted financial, inventory, order, payment, or costing facts. Legally significant calculations reference an effective approved policy as required by ADR-0002.

### 8. Shared modules do not branch on country/provider names

Common domain code requests an approved policy or capability from Jurisdiction. It must not scatter conditions such as `if country == "VN"` across Orders, Payments, Inventory, Customer, or Costing.

Country/provider behavior is supplied through versioned policies and adapters behind explicit boundaries. `Fiscalization` remains a generic future boundary; no Vietnam fiscal rule is accepted here.

### 9. Access scopes reference structure; they do not emerge from it

Business Structure exposes stable scope targets for:

- Business Group;
- Legal Entity;
- Management Entity;
- Brand;
- Restaurant Location;
- Department;
- Warehouse;
- Terminal.

Identity & Access owns grants against those targets. Default is deny. Ownership, management, employment, brand control, terminal placement, and structural containment never grant a permission automatically.

Exact role semantics, descendant inheritance, employee overrides, and permission evaluation are deferred to Block D.

### 10. Structure history is immutable and auditable

- Technical IDs are stable and separate from displayed names, codes, registrations, and future business numbers.
- Structural relationships are appended/versioned or ended; history is not overwritten.
- Sensitive changes identify actor, reason where required, recorded time, effective interval, and before/after values.
- Server recording order does not replace business-effective structure history.
- Exact correction/document/event mechanics are deferred to Block C.

## Invariants

1. One group can represent several companies, management entities, brands, restaurants, and jurisdictions.
2. Foreign ownership never changes the operating legal entity's or restaurant's jurisdiction by implication.
3. Business group membership, legal ownership, legal operation, management, and brand use are different facts.
4. A restaurant is not a legal entity and a brand is not a restaurant.
5. Historical facts retain their actual legal/operational context even after restructuring or renaming.
6. A business relationship grants no application permission by itself.
7. Country defaults come from a versioned jurisdiction profile and are stored/resolved explicitly.
8. Shared business logic contains no provider- or country-name branch for behavior owned by Jurisdiction/Integrations/Fiscalization.
9. A warehouse cost stream never mixes legal responsibility or valuation currencies.
10. Business Structure owns warehouse/terminal identities; operational modules own balances, movements, shifts, payments, and other facts.
11. No Vietnam tax, fiscal, e-invoice, privacy, or company-law behavior is inferred by this ADR.

## Alternatives considered

### One strict hierarchy

Rejected. A chain such as group → legal entity → manager → brand → restaurant cannot represent a manager serving several owners or a brand shared across legal entities without duplication or false parentage.

### Treat every node as a generic organization unit

Rejected. It hides legal, brand, stock, and device semantics and allows invalid substitutions such as using a brand as the seller.

### Infer legal entity and currency from the current restaurant parent

Rejected. It breaks historical attribution after restructuring and cannot safely support multiple legal contexts.

### Put all country logic in common modules

Rejected. It creates scattered conditional behavior, makes verification difficult, and couples every module to every jurisdiction.

### Make management relationship an access grant

Rejected. Business responsibility and application permission are different concerns; automatic access would violate deny-by-default.

## Consequences

### Positive

- Complex foreign ownership and multi-company management are representable from day one.
- Legal, operational, brand, inventory, and terminal context stays explainable.
- Structure changes do not corrupt historical orders, stock, costing, or analytics.
- New jurisdictions extend policy/adapters without rewriting core modules.
- Access can be scoped precisely in Block D.

### Negative / accepted cost

- Relationships and history require more explicit records than a simple tree.
- Every critical fact must carry sufficient context rather than relying on current parent lookup.
- UI onboarding must explain legal operator, manager, brand, location, and warehouse separately.
- Cross-company warehouse, catalog, customer, employee, and reporting choices still require Product Owner/legal decisions.

## Deferred decisions and required Product Owner answers

See the linked question list. In particular:

- BusinessGroup subscription/data-isolation semantics;
- natural-person and beneficial-ownership detail;
- legal status of a ManagementEntity;
- concurrent legal operators/brands per restaurant;
- central departments and multi-entity warehouse UX;
- terminal use across legal entities;
- override and access-inheritance rules;
- cross-company catalog/customer/employee sharing;
- consolidated reporting currency.

## Validation plan

Before acceptance:

1. Trace a foreign owner → Vietnam legal operator → separately managed two-restaurant structure.
2. Trace a management entity serving locations owned/operated by different legal entities.
3. Trace restructuring without changing historical legal/operator/brand/warehouse attribution.
4. Confirm each warehouse ledger retains one legal/currency context under ADR-0002/0003.
5. Confirm business relationships create no access grant.
6. Confirm Vietnam defaults are resolved through a profile and no fiscal behavior is invented.
7. Obtain independent review and explicit Product Owner/System Architect acceptance.

## Owner/architect acceptance checklist

- [ ] Accept BusinessGroup as a collaboration context that is not a legal person by implication.
- [ ] Accept separate Organization, LegalEntity, ManagementEntity, Brand, and operational-node concepts.
- [ ] Accept typed effective-dated ownership, legal-operation, management, brand, and jurisdiction relationships.
- [ ] Accept explicit legal/operational context on historical facts.
- [ ] Accept one legal/currency context per inventory ledger.
- [ ] Accept versioned jurisdiction profiles and explicit default resolution.
- [ ] Accept the prohibition on scattered country/provider branches in common modules.
- [ ] Accept the listed access-scope target types and no automatic grants from business relationships.
- [ ] Answer or explicitly defer the linked Product Owner questions.
