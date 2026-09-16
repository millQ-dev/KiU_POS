# ADR-0031: POS Presentation, Layout Publication & Cashier Surface Semantics

- **Status:** Accepted
- **Date:** 2026-09-16
- **Accepted:** 2026-09-16 (PO LAUNCH — binding decisions recorded; architecture-only Level C)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0008, ADR-0017, ADR-0018, ADR-0025, ADR-0028, ADR-0029; Architecture v1.2 / v1.3; domain-module-map POS Presentation; M1.1 Menu Runtime; GOLDEN-1
- **ADR number note:** Launch suggested ADR-0030. **ADR-0030 remains reserved** for the deferred Commercial RoundingPolicy (unit Money × fractional MASS/VOLUME quantity → official Money). This POS Presentation freeze is therefore **ADR-0031**.
- **Blocks enabled after Accept (implementation not launched by this ADR):**
  1. LayoutDefinition storage
  2. Immutable LayoutPublication (+ MenuPage / MenuSlot freeze)
  3. Quick Access (max 10)
  4. LayoutAssignment
  5. LayoutResolver
  6. ResolvedPosSurface (intersection with M1.1 MenuResolver)
  7. Capability-aware cashier shell inputs
  8. First cashier UI/read surface
  9. Active item tap → existing AddOrderLine
  10. GOLDEN extension for POS selection path
- **Explicitly deferred / out of this ADR PR:** runtime code, migrations, schema, React/UI, API routes, Floor/Table runtime, Authorization catalog, Promotions, Loyalty, Payments, Fiscalization, modifiers, offline sync, Commercial RoundingPolicy, generic widget/action DSL

## Context

M1.1 delivered authoritative commercial resolution:

```text
SalesContext → MenuResolver → ResolvedMenu / ResolvedMenuItem
→ (explicit) SetOrderCommercialTerms → CompleteOrder freeze
```

Architecture v1.2 / ADR-0008 / ADR-0029 already separate:

| Layer | Question | Owner |
| --- | --- | --- |
| Catalog | What exists? | Catalog |
| Menu Configuration | What can be sold where / when / at what **base unit** price? | Menu Configuration |
| POS Presentation | How does POS show the resolved sellable surface? | POS Presentation |
| Channel Menu | How is assortment published externally? | Channel adapters (later) |

Without a POS Presentation freeze, the first KiU cashier screen would risk:

- storing price / availability / stock on layout slots;
- treating layout membership as commercial eligibility;
- forking Corner / Cafe / Restaurant into three POS codebases;
- requiring `tableId` on every Order (the iiko-class Corner trap);
- inventing commercial Money×Quantity rounding in the frontend;
- auto-generating a fake layout when none is assigned;
- collapsing Authorization into button placement.

This ADR freezes the **minimum POS Presentation + cashier surface** contract required for P1.1. It does **not** implement runtime or UI.

## Terminology (binding)

**LayoutDefinition** = editable POS layout configuration identity (draftable).

**LayoutPublication** = immutable published POS layout version used by runtime.

**MenuPage** = cashier navigation / presentation grouping (e.g. Coffee, Food). Presentation only — not a commercial Menu Category SoT.

**MenuSlot** = positioned sellable target reference inside a page (or Quick Access zone). Presentation only.

**LayoutAssignment** = assignment of a LayoutPublication to an operational scope with optional business-effective interval.

**ResolvedPosSurface** = read-model composition of LayoutPublication ∩ M1.1 ResolvedMenu for a PresentationContext (+ passed SalesContext).

**Quick Access** = dedicated POS Presentation zone with at most **10** pinned sellable slots.

**Presentation color** = visual distinction metadata (token / validated presentation value). Never business logic.

**PackageEntitlement + OutletCapabilityConfig** = tariff allow / outlet enable model. Corner / Cafe / Restaurant are **not** three POS engines.

---

## Binding separation (must preserve)

| Domain | Owns | Does not own |
| --- | --- | --- |
| **Catalog** | Product identity / profiles | Layout, price, Order |
| **Menu Configuration** | MenuPublication, Availability, Base Price, SalesContext resolution | Layout tiles, colors, hot buttons |
| **POS Presentation** | LayoutDefinition/Publication, MenuPage, MenuSlot, LayoutAssignment, presentation hints, Quick Access | Price, availability, inventory, Order truth, table truth, permissions |
| **Orders** | Order / OrderLine / commercial acceptance / completion | Layout placement |
| **Floor / Table Engine** | DiningArea, FloorPlan, Table, TableRuntimeState, TableAssignment | POS layout slots |
| **Identity / Authorization** | Actor, session, roles, AuthorizationPolicy | MenuSlot “grants” |

---

## Decision matrix (binding)

### 1. LayoutDefinition vs LayoutPublication

| Concept | Role |
| --- | --- |
| `LayoutDefinition` | Editable aggregate / identity |
| `LayoutPublication` | Immutable published version usable by runtime |

Publishing creates a **new** immutable `LayoutPublication`. Published content is never silently mutated. Corrections = new publication.

### 2. Publication immutability / versioning

Activated/effective:

- `LayoutPublication`
- published page membership
- published slot positions / Quick Access assignments
- presentation metadata frozen into the publication

are **immutable**.

`created_at` / `updated_at` / publish wall-clock are **audit metadata only**, never commercial or layout precedence.

Version identity must be explicit (monotonic publication version / publication id). Forbidden: `MAX(created_at)` as “current version”.

### 3. MenuPage ownership

`MenuPage` belongs to POS Presentation.

For MVP, pages are the cashier grouping / navigation mechanism.

Examples: Coffee, Food, Desserts, Drinks.

Do **not** invent a second commercial “Menu Category” SoT inside POS Presentation. Catalog taxonomies (if any) remain separate.

### 4. MenuSlot ownership

`MenuSlot` belongs to POS Presentation.

A sellable slot references at minimum:

- `catalogItemId`
- `productVariantId?` **only if** ProductVariant runtime is authoritative (today: CatalogItem only; keep contract extensible)

Slot may own presentation-only fields:

- position / order within page or Quick Access zone
- optional label override
- optional image / media reference
- optional color / presentation token
- optional size / density hint **only if** truly required for presentation (not pixel SoT)

Slot **MUST NOT** store:

- sale price / Money
- availability status as SoT
- stock quantity
- COGS / recipe / Food Cost
- discount / loyalty / promotion values

### 5. Quick Access semantics (max 10)

KiU cashier surface supports a dedicated **Quick Access** zone with up to **10** pinned sellable slots.

Rules (binding):

- max **10** active Quick Access positions per LayoutPublication;
- positions deterministic (`1..10` or equivalent ordered zone);
- duplicate position within one publication = invalid configuration;
- targets are CatalogItem (variant only when authoritative);
- Quick Access does **not** bypass Menu availability or Pricing;
- do **not** put `hotButton1…hotButton10` columns on CatalogItem.

Representation may be dedicated Quick Access slots or MenuSlot zone metadata — same semantics.

### 6. Presentation color ownership

Color lives only in POS Presentation (page and/or slot metadata).

Prefer semantic design token or validated presentation value.

Color **must not** influence:

- availability
- price
- authorization
- inventory
- package capability

### 7. Layout assignment hierarchy

Deterministic operational specificity (higher wins):

```text
Terminal > TerminalGroup > Outlet > Brand > Tenant
```

Aligned with ADR-0029 Menu assignment spine.

**LegalEntity is NOT a layout inheritance dimension.**

If Terminal / TerminalGroup runtime entities are still absent:

- architecture still defines their future precedence;
- first runtime (P1.1) may implement only scopes that exist (Tenant / Brand / Outlet), with contract extensibility;
- do not fake Terminal entities merely to fill fields.

### 8. LegalEntity exclusion

Confirmed: no `layout_assignment.legal_entity_id`. Changing LegalEntity alone must not change which LayoutPublication wins through layout inheritance.

### 9. Ambiguity behavior

At the same winning specificity for the same PresentationContext / effective time:

>1 matching active LayoutAssignment ⇒ explicit:

```text
AMBIGUOUS_LAYOUT_ASSIGNMENT
```

(or repo-equivalent configuration error).

Forbidden precedence:

- `created_at` / `updated_at`
- UUID order
- database insertion order
- “newest wins”

Reject at activation when detectable; defensively reject at resolution time.

### 10. Effective assignment validity

LayoutAssignment may carry:

- `effectiveFrom` (required when validity is used)
- `effectiveTo` (optional)

**Half-open:** `[effectiveFrom, effectiveTo)`.

Use offset-aware / absolute instants for layout rollout. Do not convert layout activation into restaurant business DATE semantics unnecessarily. Menu commercial schedules remain Menu Configuration (ADR-0029 / Outlet IANA TZ).

Technical timestamps are not layout validity.

### 11. Layout × ResolvedMenu intersection

A slot existing in LayoutPublication does **NOT** make an item sellable.

Authoritative commercial eligibility remains M1.1 `ResolvedMenu`.

Pipeline (binding):

```text
PresentationContext (+ SalesContext)
→ resolve LayoutPublication (LayoutResolver)
→ enumerate pages / slots / Quick Access
→ resolve/read MenuResolver.resolveMenu(SalesContext)
→ intersect
→ ResolvedPosSurface
```

Do **not** build a second POS-specific price resolver or availability resolver.

### 12–15. Slot × ResolvedMenu cashier states

For each layout slot target:

| Case | Cashier behavior |
| --- | --- |
| **A.** Not in effective ResolvedMenu | Not an active sellable button — **HIDDEN** from normal sellable grid |
| **B.** In menu + `UNAVAILABLE` | Visible but **DISABLED** (`DISABLED_UNAVAILABLE`); preserve availability provenance |
| **C.** In menu + AVAILABLE + `PRICE_UNAVAILABLE` | Visible but **DISABLED** (`DISABLED_PRICE_UNAVAILABLE`); configuration/error presentation |
| **D.** AVAILABLE + resolved unit PriceQuote | **ACTIVE** sellable button |
| **E.** MenuResolver configuration error | Must **not** collapse into ordinary UNAVAILABLE — surface `CONFIGURATION_ERROR` |

Distinct states remain mandatory. Do not map configuration errors to “unavailable”.

### 16. Layout missing

Effective commercial Menu may exist while no LayoutPublication is assigned.

Result:

```text
LAYOUT_NOT_ASSIGNED
```

Forbidden silent fallbacks:

- sort Catalog by UUID
- auto-generate arbitrary layout
- use DB insertion order as layout

A future onboarding wizard may create an explicit default LayoutDefinition via commands — never an implicit resolver invention.

### 17. Stale / invalid layout targets

Published layout may outlive a MenuPublication.

If a slot references a CatalogItem absent from current ResolvedMenu → §12–15 case A (not active / hidden). Do **not** mutate old LayoutPublication.

At **publish** time: all referenced targets must exist and belong to the same tenant. Cross-tenant targets rejected. Prefer FK / invariants over dangling references. Follow Catalog archive/deactivation model when present (no invented delete semantics).

### 18. Capability-driven package differences

Corner / Cafe / Restaurant are **not** three POS codebases.

Use:

```text
PackageEntitlement + OutletCapabilityConfig
```

Forbidden scattered forks:

```text
if package === 'CORNER'
if package === 'CAFE'
if package === 'RESTAURANT'
```

The same POS Presentation engine serves all packages. Surface differences come from **capabilities enabled/disabled**.

Only name capabilities that are already Accepted or clearly required by Accepted architecture. For this ADR, the binding capability called out for cashier independence is:

- `tables.enabled` (ADR-0017 / Architecture v1.2)

Do not invent the full future capability catalog here.

### 19–20. Tables boundary / Order independence

If `tables.enabled = false` (Corner-like; Cafe may be false/optional):

- cashier works **without** seeing/selecting a table;
- Order has **no required** `tableId`;
- no fake “Table 1” default.

If `tables.enabled = true` (Restaurant-like):

- future POS may expose a Table/Floor workspace entry;
- POS Presentation does **not** own DiningArea / FloorPlan / Table / TableRuntimeState / TableAssignment;
- Floor/Table Engine remains SoT (ADR-0017);
- Order remains valid without table at domain/schema level.

This ADR defines the integration boundary only — **no Floor/Table runtime**.

### 21. Authorization boundary

Layout placement does not grant permission.

Sensitive future actions (VOID, DISCOUNT, OPEN DRAWER, MANAGER OVERRIDE, …) require AuthorizationPolicy (Identity).

Do not encode authorization truth into MenuSlot. Do not design the full sensitive-action catalog in this ADR.

### 22. Current Order basket boundary

Current Order basket is a projection of **OPEN Order** state (Orders module).

POS surface composes:

```text
ResolvedPosSurface + Open Order
```

Do not duplicate Order lines into presentation tables.

### 23. Item tap / AddOrderLine

First cashier flow (binding):

```text
ACTIVE ResolvedPosSlot
→ select CatalogItem
→ AddOrderLine on OPEN Order
→ retain Menu/Price resolver provenance available for explicit commercial acceptance (ADR-0029 / M1.1 OPTION A)
```

Does **not**:

- CompleteOrder automatically
- trigger payment / fiscalization
- invent gross from unit×quantity

### 24. Commercial RoundingPolicy boundary (OPTION A remains binding)

M1.1 OPTION A remains binding until a future Commercial RoundingPolicy ADR (**reserved number ADR-0030**, not created here).

POS Presentation / UI **MUST NOT**:

- compute `resolvedUnitPriceMinor × OrderLine.quantity → grossMerchandiseMinor`;
- invent ROUND_HALF_UP / HALF_EVEN / floor / ceil / exact-product shortcuts;
- use frontend display math as official commercial Money posting.

Allowed:

- display resolved **unit** Money for a sellable item (including quantity-1 display);
- pass unit price + provenance into existing Orders commercial acceptance paths.

Official line gross remains explicit caller / commercial input (D1.4B).

### 25. Offline / cache boundary

Do not implement offline sync here (ADR-0018).

Immutable LayoutPublication (and M1.1 MenuPublication / rule versions) **must be cacheable** for future offline POS.

Architecture must not require a mutable server-side layout lookup for every button render as a domain invariant.

### 26. Historical economics independence

Changing LayoutPublication / page order / slot position / Quick Access / colors **MUST NOT** alter:

- OrderCommercialSnapshot
- Revenue Basis
- Actual COGS
- Food Cost Ratio
- Operational Gross Profit

POS Presentation is not economic SoT (ADR-0028).

---

## Conceptual contracts

### PresentationContext

Organizational presentation scope (not authorization):

| Field | Notes |
| --- | --- |
| `tenantId` | required |
| `brandId` | required / verified against Organization |
| `outletId` | required |
| `terminalGroupId` | optional; deferred until runtime exists |
| `terminalId` | optional; deferred until runtime exists |

Commercial dimensions (`orderChannel`, `serviceMode`, `businessDateTime`) belong to **SalesContext** (ADR-0029). POS Surface may **pass** SalesContext into MenuResolver; it must not invent a competing taxonomy.

Invalid organization topology ⇒ `INVALID_PRESENTATION_CONTEXT`.

### ResolvedPosSurface

Immutable resolver output (not a second ledger):

- presentationContext
- layoutPublicationId / version
- layoutAssignment provenance
- menuPublication provenance (from MenuResolver)
- pages[]
- quickAccess[]
- resolved context / as-of
- SalesContext echo where used

### ResolvedPosSlot

- slot identity
- page identity (or Quick Access zone identity)
- target `catalogItemId` (+ variant only if authoritative)
- display metadata (label override, color token, media, position)
- state: `ACTIVE` | `DISABLED_UNAVAILABLE` | `DISABLED_PRICE_UNAVAILABLE` | `CONFIGURATION_ERROR` | (hidden when absent from menu — not necessarily emitted)
- resolved unit Money when ACTIVE
- MenuResolver provenance reference (publication / assignment / price / availability)

Do not persist ResolvedPosSurface as a duplicate commercial snapshot.

### Error taxonomy (conceptual; follow repo `DomainValidationError` conventions)

| Code | Meaning |
| --- | --- |
| `LAYOUT_NOT_ASSIGNED` | no applicable LayoutAssignment |
| `LAYOUT_PUBLICATION_NOT_EFFECTIVE` | publication outside validity |
| `AMBIGUOUS_LAYOUT_ASSIGNMENT` | same-specificity conflict |
| `INVALID_PRESENTATION_CONTEXT` | incomplete/invalid topology |
| `LAYOUT_TARGET_INVALID` | publish-time / structural target failure |
| `MENU_RESOLUTION_FAILED` | MenuResolver configuration/hard failure surfaced to POS |

Slot-level: keep UNAVAILABLE vs PRICE_UNAVAILABLE vs CONFIGURATION_ERROR distinct.

---

## First cashier surface (semantic, not pixels)

```text
┌──────────────────────────────────────────────┐
│ Context / active order / operator shell      │
├───────────────┬──────────────────────────────┤
│ Pages /       │ Sellable item grid           │
│ categories    │ from ResolvedPosSurface       │
│               │                              │
│ Quick Access  │                              │
├───────────────┴──────────────┬───────────────┤
│                              │ Current Order  │
│                              │ basket         │
└──────────────────────────────┴───────────────┘
```

Exact visual design is a design-system / frontend concern. No domain columns like `width_px`. Touch density / accessibility / disabled-vs-error distinction belong to UI tokens, not business SoT.

System actions (pay, void, …) may remain fixed shell controls initially. **No** universal ActionSlot / widget DSL in this ADR.

### Operator / session

POS shell may observe current operator/session/device. Identity owns users, roles, PINs, grants. POS Presentation does not own a duplicate auth model.

---

## Package acceptance matrix (architecture)

| Configuration | Capabilities | Expected |
| --- | --- | --- |
| **A. Corner-like** | `tables.enabled = false` | Same MenuResolver + LayoutResolver; pages/grid/Quick Access; no forced table; Order independent |
| **B. Cafe-like** | tables disabled or optional | Same engine; configurable layout; no package-name fork |
| **C. Restaurant-like** | `tables.enabled = true` | Same menu/layout engine; future table workspace entry possible; Order still valid without table |

---

## Concurrency invariants (architecture; runtime strategy in P1.1)

1. Concurrent publish of the same LayoutDefinition must not create ambiguous “current version” via races — explicit version / command semantics (not `MAX(created_at)`).
2. Same-scope overlapping active LayoutAssignments must not be silently produced by concurrent writers — database-safe overlap/locking analogous in spirit to M1.1.

Exact PostgreSQL mechanism is a P1.1 implementation concern; the invariant is binding now.

---

## No generic UI DSL

Forbidden in this vertical’s core:

- arbitrary JSON widget engine
- universal dashboard builder
- low-code UI DSL
- unrestricted polymorphic component trees
- universal ActionSlot framework

First POS layout remains deliberately narrow: pages, sellable slots, Quick Access ≤ 10.

---

## Next runtime block after Accept

**P1.1 — POS Presentation Runtime** (separate launch; not this PR):

1. LayoutDefinition storage
2. Immutable LayoutPublication
3. MenuPage / MenuSlot
4. Quick Access max 10
5. LayoutAssignment (existing Organization scopes)
6. LayoutResolver
7. ResolvedPosSurface
8. Intersection with M1.1 MenuResolver
9. Capability-aware shell inputs (`tables.enabled`)
10. First cashier UI/read surface
11. Active item tap → existing `AddOrderLine`
12. GOLDEN extension for POS selection path

P1.1 UI scope proves only:

- pages + ≤10 quick buttons
- unit prices from MenuResolver
- disabled unavailable / price-error distinction
- add active item to OPEN Order
- basket updates
- tables not required when capability disabled

Not yet: checkout/payment, fiscal, promotions, loyalty, modifiers, split bills, production send, floor-map, manager overrides, offline.

---

## GOLDEN-1 marker

Architecture PR updates Golden dependency only:

| Capability | State |
| --- | --- |
| POS Presentation / live cashier selection | **DEFERRED** — depends on ADR-0031 + P1.1 |

Do **not** mark PASS in this ADR PR.

Future Golden variation must prove:

```text
LayoutPublication → ResolvedPosSurface → select ACTIVE item
→ AddOrderLine → Menu unit-price provenance
→ explicit commercial acceptance (OPTION A)
→ CompleteOrder
→ layout mutation does not rewrite historical economics
```

---

## Hard out of scope

Promotions · Loyalty · Commercial RoundingPolicy (ADR-0030 reserved, not created) · full Table/Floor runtime · Payments · Settlement · Fiscalization · Production Routing UI · KDS · modifiers · stock stop-list · Channel Menu · Contribution Margin · Period Lock · Intelligence · offline sync protocol · generic action/widget DSL · package-name domain forks

---

## Consequences

- P1.1 can implement a real KiU cashier surface without guessing layout semantics.
- Catalog / Menu / POS / Orders / Floor / Auth boundaries stay enforceable.
- Corner remains free of forced tables; Restaurant can later attach Floor without rewriting Orders.
- OPTION A commercial gross discipline is not undermined by UI math.
- Offline-ready immutable publications remain possible.

## Acceptance criteria (architecture review)

Reviewer must confirm the decision matrix §1–26 answers are binding and P1.1 is implementable without another semantic guess for:

Definition vs Publication; Page/Slot; Quick Access max 10; color; assignment precedence; LegalEntity exclusion; ambiguity; effective validity; Layout × ResolvedMenu; absent/unavailable/price-error/config-error; layout missing; stale targets; capabilities; tables optional; Order basket; AddOrderLine; RoundingPolicy boundary; offline cacheability; historical economics independence; no generic UI DSL.
