# Block B — Product Owner Questions

- **Status:** Open for Product Owner answers
- **Date:** 2026-08-09
- **Related issue:** [#11 — Define business structure, jurisdiction and module boundaries](https://github.com/millQ-dev/MillQ/issues/11)
- **Related analysis:** [`block-b-business-structure-jurisdiction-domain-boundaries.md`](../architecture/block-b-business-structure-jurisdiction-domain-boundaries.md)
- **Related Proposed ADRs:** [ADR-0004](../decisions/ADR-0004-business-structure-and-jurisdiction.md), [ADR-0005](../decisions/ADR-0005-modular-monolith-domain-boundaries.md)

This file lists business choices for which no accepted answer was found. The architecture does not silently decide them.

`Blocking for ADR acceptance` means the answer materially fixes the business model. It does not authorize implementation or Block C.

## A. Questions blocking final acceptance of the structure model

### B-01. What exactly is a Business Group in MillQ?

Is it:

- only a convenient management grouping;
- the customer subscription/billing account;
- the hard data-isolation boundary;
- or all of these?

May one legal entity be registered in several Business Groups, or must it belong to exactly one?

**Why it matters:** determines data isolation, duplicate-company prevention, group membership, and future billing. The proposal treats the group only as a collaboration context until answered.

### B-02. Which owner types must be represented?

Must MillQ record:

- only ownership between companies;
- natural-person owners;
- ownership percentage;
- voting/control percentage;
- beneficial owners;
- documentary evidence and verification status?

**Why it matters:** natural-person and beneficial-owner data introduces legal, privacy, security, and retention obligations. The proposal supports an ownership relationship but does not define these fields.

### B-03. Must every Management Entity be a legal entity?

Can a management entity be:

- only a registered company;
- also an internal head-office team/business unit;
- an external operator with no company record managed in MillQ?

**Why it matters:** determines whether `ManagementEntity` always references `LegalEntity` or can reference a broader organization/unit type.

### B-04. Can one restaurant have multiple concurrent legal sellers/operators?

Examples include one venue selling through different legal entities by department, terminal, product group, service type, or shift.

Choose whether launch requires:

- exactly one legal operator for a restaurant at any business instant;
- several operators, but one fixed operator per terminal;
- several operators selectable per order/line;
- another explicit rule.

**Why it matters:** affects orders, payments, cash shifts, inventory, official receipts, numbering, permissions, and offline behavior. Block B records the legal operator explicitly but does not pick the cardinality.

### B-05. May a restaurant operate in a different jurisdiction from its legal entity's registration?

Should MillQ support foreign-company branches/permanent establishments directly, or require a local operating legal entity for each restaurant?

**Why it matters:** determines allowed jurisdiction combinations. This needs legal verification and cannot be inferred from the foreign-owner requirement.

### B-06. What is the Brand model at launch?

Can:

- one restaurant use several brands simultaneously;
- one brand be licensed to several unrelated legal entities/groups;
- a virtual/delivery-only brand share one kitchen/location;
- a brand exist without an operating restaurant yet?

**Why it matters:** determines BrandAssignment cardinality, menu/channel scopes, analytics, and access scopes. The proposal keeps brand separate and effective-dated without choosing these restrictions.

### B-07. Where may Departments exist?

Are departments only inside a restaurant, or must launch also support central office, central kitchen/production, procurement office, and other departments outside a restaurant?

**Why it matters:** determines the allowed parent of Department and whether a more general operating-location type is required.

### B-08. How should a physical warehouse serving several legal entities appear?

Accepted costing rules prohibit mixing legal/currency cost streams. Should the user see:

- separate logical warehouses for each legal entity inside one physical facility;
- one facility with visibly separated legal-entity inventory ledgers;
- no multi-entity physical warehouse at launch?

**Why it matters:** the accounting separation is fixed, but the business object and operator workflow are not.

### B-09. Can one physical POS terminal work for several legal entities?

If yes, can it switch:

- only between shifts;
- per order;
- per order line;
- automatically by department/product/payment;
- or only through separately registered logical terminals?

**Why it matters:** affects legal seller attribution, cash, payment, official receipts, numbering, permissions, offline sync, and audit. The proposal keeps every transaction's legal context explicit but does not decide switching.

### B-10. Which country defaults are mandatory and which may be overridden?

For each level—legal entity, restaurant, department, warehouse, terminal—decide whether users may override:

- currency;
- locale/language;
- time zone;
- business-day boundary;
- measurement/display defaults;
- approved integrations;
- policy selections when legally permitted.

Also decide which overrides require elevated permission/reason.

**Why it matters:** Block B defines versioned defaults but cannot invent override policy.

## B. Questions that may be answered now or explicitly deferred to the named block

### B-11. How should access scope include descendants? — Block D

If a user receives access at group, legal entity, management entity, brand, or restaurant level, should it cover:

- only currently linked descendants;
- current and future descendants automatically;
- an explicit frozen set;
- different behavior by role/permission?

Business relationships themselves will never grant access; this question concerns explicit grants.

### B-12. What master data may be shared across legal entities/groups? — Blocks D/E/G

Decide the ownership/publication model for:

- products and ingredients;
- recipes and preparations;
- menus;
- price lists/promotions;
- suppliers;
- brands.

Possible needs include a group master catalog with local overrides, fully separate catalogs, or explicit publication from one scope to another. The current proposal assigns module ownership but does not invent sharing rights.

### B-13. May customer profiles be shared across legal entities or jurisdictions? — Blocks E/G

Should a returning guest be one profile across a business group, separate per legal entity, or linked with explicit consent?

**Why it matters:** customer sharing requires privacy, consent, controller/processor, retention, and cross-border review. No answer is presumed.

### B-14. May one employee/person work for several legal entities or groups? — Block D

Separate the login identity from employment/contract records. Decide whether one person can have several concurrent employments and whether those records may be visible across entities.

**Why it matters:** permissions, shifts, audit, payroll boundaries, and privacy differ from authentication identity.

### B-15. What consolidated reporting currency should owners see? — Later accounting/analytics decision

Source ledgers keep their own approved valuation currency. Decide whether group reports:

- show each currency separately;
- convert to one selected presentation currency;
- store several presentation currencies;
- use which rate source/date and revision policy.

This question cannot alter the accepted one-currency-per-ledger rule.

### B-16. Can a management mandate cover a whole legal entity/group or only named locations? — Block D implications

If a mandate covers a broad scope, should newly created restaurants be included automatically as a business responsibility? This remains separate from access grants.

### B-17. Are cross-group relationships allowed? — Block B/administration decision

Examples: an external management company in another customer account, a licensed brand owned outside the group, or a central supplier serving several groups.

Decide whether MillQ stores a shared party reference, a duplicated external reference, or prohibits this at launch.

### B-18. Which structure changes need mandatory reason/approval? — Blocks C/D

Candidates include:

- changing legal operator;
- changing jurisdiction/currency;
- ending ownership/management mandate;
- reassigning warehouse or terminal;
- moving a department;
- changing brand assignment.

The proposal requires audit history but does not invent approval thresholds.

## Requested Product Owner response format

For each question, answer with:

1. selected rule;
2. launch requirement or later phase;
3. any prohibited scenario;
4. who may perform/approve it if already known;
5. whether legal/accounting/privacy verification is required before implementation.
