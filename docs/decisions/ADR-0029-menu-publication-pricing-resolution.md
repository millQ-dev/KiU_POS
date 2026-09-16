# ADR-0029: Menu Publication, Availability & Base Price Resolution Semantics

- **Status:** Accepted
- **Date:** 2026-09-16
- **Accepted:** 2026-09-16 (PO LAUNCH — binding decisions recorded; architecture-only Level C)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0008, ADR-0009, ADR-0011, ADR-0016, ADR-0018, ADR-0025, ADR-0028; Architecture v1.2 / v1.3; domain-module-map Menu Configuration; GOLDEN-1
- **Blocks enabled after Accept (implementation not launched by this ADR):**
  1. Menu Configuration storage + versioning
  2. MenuAssignment / publication activation
  3. AvailabilityResolver
  4. Base PricingResolver
  5. MenuResolver
  6. Orders integration: resolver → SetOrderCommercialTerms
  7. POS Presentation / MenuLayout (later; separate surface)
  8. Golden Restaurant variation: price originates from PriceRule and freezes historically
- **Explicitly deferred / out of this ADR PR:** runtime code, migrations, schema, Promotions, Loyalty, POS layout UI, Channel Menu providers, Stop List inventory coupling, FX, universal rules DSL

## Context

GOLDEN-1 proved the foundation economic vertical (procurement → production → Orders → Actual COGS → Revenue Basis → Food Cost / Operational GP). The next product surface is a real POS-resolved menu.

Architecture v1.2 / ADR-0008 already separate:

| Layer | Question |
| --- | --- |
| Catalog | What exists? |
| Menu Configuration | What can be sold where / when / at what **base** price? |
| POS Presentation | How does POS show the resolved menu? |
| Channel Menu | How is assortment published externally? |

`MenuDefinition`, `AvailabilityRule`, `PriceRule`, `MenuPublication`, `MenuResolver`, and `SalesContext` are named but **not** semantically frozen. Without that freeze, a Menu runtime would risk:

- collapsing Catalog identity into menu/POS presentation fields;
- treating missing price as zero (corrupting complimentary vs misconfigured);
- silent last-write-wins conflicts;
- re-resolving prices at CompleteOrder behind the cashier;
- rewriting historical Revenue by later publications (violating ADR-0028);
- evaluating schedules in server/DB timezone (the GOLDEN-1 DATE class of bug).

This ADR freezes the **minimum commercial Menu + Availability + Base Pricing** contract. It does **not** implement runtime.

## Terminology (binding)

**Base / list price** = ordinary resolved sale price for a sellable menu item in a `SalesContext`.

It is **not**:

- promotion / coupon / loyalty adjustment;
- third-party funding;
- payment-method discount;
- manager discretionary discount;
- tax / tip / non-merchandise charge.

**Pricing ≠ Promotions ≠ Loyalty** remains binding (Architecture v1.2 §10).

**Menu Availability** = commercial/configuration availability.

It is **not** automatically `inventory quantity > 0`.

**MenuPublication** = immutable published menu version used by runtime.

**MenuDefinition** = editable configuration identity that may continue to evolve after publications.

---

## Decision matrix (binding)

### 1. MenuDefinition vs MenuPublication

| Concept | Role |
| --- | --- |
| `MenuDefinition` | Editable aggregate / identity (draftable) |
| `MenuPublication` | Immutable published version/snapshot usable by runtime |

Publishing creates a **new** immutable `MenuPublication`. Published content is never silently mutated in place. Historical Orders reference publication provenance, not “whatever menu is current now”.

### 2. Publication immutability / versioning

Activated/effective:

- `MenuPublication`
- `PriceRule` version
- `AvailabilityRule` version

are **immutable**.

Corrections = new version / new publication. Draft configuration may mutate before publication/activation.

`created_at` / `updated_at` / publish wall-clock are **audit metadata only**, never commercial precedence or validity.

### 3. Operational inheritance precedence

Menu assignment and rule specificity follow the accepted spine:

```text
Tenant → Brand → Outlet → TerminalGroup → Terminal
```

**LegalEntity does NOT participate in menu inheritance** (ADR-0008). LegalEntity remains legal/fiscal/accounting scope.

Deterministic specificity (higher wins):

```text
Terminal > TerminalGroup > Outlet > Brand > Tenant
```

Forbidden as precedence:

- `created_at` / `updated_at`
- UUID order
- database insertion order
- “newest wins”

### 4. Ambiguity / conflict behavior

If two assignments or matching rules at the **same specificity** overlap for the same commercial surface / target / context / effective business time:

```text
CONFIGURATION ERROR
```

Reject at publish/activation when detectable; defensively reject at resolution time.

No silent pick of newest/oldest/UUID.

### 5. Effective dating

`MenuPublication` / `MenuAssignment` / `PriceRule` / `AvailabilityRule` carry explicit business validity:

- `effectiveFrom` (required)
- `effectiveTo` (optional)

**Half-open interval:** `[effectiveFrom, effectiveTo)`.

Technical timestamps are not commercial validity.

### 6. Outlet-local timezone (GOLDEN-1 protection)

Schedule and business-datetime evaluation MUST use **Outlet local commercial time**.

Binding:

1. **Outlet** has authoritative **IANA timezone** (e.g. `Asia/Ho_Chi_Minh`).
2. Required Organization field for the Menu runtime vertical if not already stored.
3. `SalesContext` carries an explicit business datetime that is evaluated in that Outlet timezone.
4. Forbidden evaluation bases:
   - Node process timezone;
   - database session timezone alone;
   - UTC calendar date accidentally converted to local business date;
   - server deployment region.

This explicitly protects against the GOLDEN-1 `asIsoDate` / DATE-shift class of bug.

### 7. Menu membership

`MenuPublication` decides which sellable `CatalogItem` / `ProductVariant` candidates appear.

- Sellable Catalog profile ≠ automatic membership in every menu.
- Membership does not own Catalog identity.
- Do not duplicate Catalog master data into Menu SoT.

Resolved membership retains at least:

- `catalogItemId`
- `productVariantId?`
- `menuPublicationId` / version
- provenance for historical drill-down

### 8–9. Availability semantics

Default:

membership in the effective `MenuPublication` ⇒ commercially **AVAILABLE**,

unless an applicable `AvailabilityRule` changes status.

Availability is **separate from price**. Distinct states:

| State | Meaning |
| --- | --- |
| Absent from menu | not a candidate |
| In menu + UNAVAILABLE | candidate but not sellable now |
| In menu + AVAILABLE + price missing | configuration error, not zero price |
| In menu + AVAILABLE + price present | sellable at base price |

Resolver availability result:

```text
AVAILABLE | UNAVAILABLE | CONFIGURATION_ERROR
```

with provenance.

Do **not** silently map configuration errors to “unavailable”.

Do **not** build a universal boolean rules engine / expression DSL.

Operational specificity for availability overrides matches §3. Same-precedence ambiguity = invalid configuration.

### 10–11. Base price & missing-price semantics

`PriceRule` returns authoritative base/list **Money** for a sellable menu item in a `SalesContext`.

**Missing price ≠ zero.**

Missing / unresolvable price ⇒ explicit:

```text
PRICE_UNAVAILABLE / CONFIGURATION_ERROR
```

Intentional complimentary sale is later **Orders commercial** logic (ADR-0028), not absence of a base price.

### 12. Price precedence

Same operational specificity as §3.

Context filters may include where configured:

- `serviceMode`
- `orderChannel`
- effective business schedule (Outlet-local)

MVP: **no arbitrary numeric priority**. Ambiguous overlapping `PriceRule`s at same precedence for the same target/context ⇒ `CONFIGURATION_ERROR`.

### 13. Currency

Every `ResolvedPriceQuote` carries:

- `amountMinor`
- `currencyCode`
- `minorUnitExponent`

(ADR-0002 Money). Never naked integers.

Do **not** assume sales currency == inventory valuation currency.

D1.4B / ADR-0028: one commercial currency per completed Order.

Therefore:

Orders may only accept commercial terms whose resolved line prices/funding compose into **one** sales currency.

Incompatible currencies across lines ⇒ reject commercial composition. **No FX** in this vertical.

### 14. SalesContext

Commercial resolution context (not authorization):

| Field | Notes |
| --- | --- |
| `tenantId` | required |
| `brandId` | required for resolution scope |
| `outletId` | required |
| `terminalGroupId` | optional |
| `terminalId` | optional |
| `serviceMode` | dine-in / takeaway / delivery class — **not** employee permission |
| `orderChannel` | aligns with existing Order `channel` string surface (`DIRECT`, `DELIVERY`, …); do not invent a second competing channel taxonomy |
| `businessDateTime` | explicit; evaluated in Outlet IANA timezone |

**Employee permissions are not part of SalesContext** (Architecture v1.2 §10). Authorization remains separate.

Current runtime Order stores `channel` only (no separate `serviceMode` column yet). Implementation may introduce `serviceMode` on SalesContext / Order as needed without collapsing it into Catalog or LegalEntity.

### 15–18. Price resolution timing & Open Order behavior

| Moment | Behavior |
| --- | --- |
| Add / select item on **OPEN** Order | Resolve current membership / availability / base price |
| Explicit reprice / refresh while OPEN | May resolve again using current SalesContext |
| OrderLine mutation invalidating commercial terms | Continues to require commercial re-acceptance (D1.4B) |
| **CompleteOrder** | Freezes **already accepted** commercial result |

**CompleteOrder MUST NOT** silently fetch a fresh MenuResolver price behind the cashier.

If accepted commercial terms are stale/missing ⇒ completion rejects (D1.4B preserved).

A new published price **does not** automatically mutate an already accepted OPEN Order commercial state.

No silent background reprice. Future POS may surface “price changed — refresh available”; UI is out of this ADR.

### 19. Historical provenance & reporting stability

After completion, new menu publication / PriceRule / AvailabilityRule / Catalog presentation metadata **must not** alter:

- Order commercial snapshot
- Revenue Basis
- Actual COGS
- Food Cost Ratio
- Operational Gross Profit

Reporting **must not** re-run MenuResolver for historical Revenue (ADR-0028).

Menu/Pricing proposes/resolves; **Orders owns** the applied historical commercial result.

Target path:

```text
SalesContext
→ MenuResolver
→ Availability + Base Price
→ OrderLine
→ SetOrderCommercialTerms
→ CompleteOrder
→ immutable OrderCommercialSnapshot
```

### 20–21. Promotions & Loyalty boundaries

- Do **not** smuggle Promotion into `PriceRule`.
- D1.4B manual commercial terms continue to support merchant-funded discount / third-party funding until Promotion runtime exists.
- Loyalty remains separate; Menu/Pricing must work without Loyalty.

### 22. POS Presentation boundary

Forbidden on Menu Configuration:

tile color/size, page/slot, hot button, visual category color, table UX, screen layout.

Those belong to **POS Presentation** (`MenuLayout` / `MenuPage` / `MenuSlot`).

Future:

```text
ResolvedMenu + MenuLayout → cashier surface
```

This ADR freezes only the commercial side.

### 23. Channel Menu boundary

`orderChannel` may vary base price / availability when configured.

Grab/Shopee/etc **Channel Menu** publication remains a separate adapter boundary (ADR-0011 / ADR-0012). No provider payload fields in Menu core. First runtime consumer is POS channel.

### 24. Stock / stop-list boundary

Do **not** hardwire Menu Availability to inventory balances.

Future Stop List / stock-aware operational availability may contribute as an **explicit Availability source**, not `qty > 0` baked into Menu Configuration MVP.

### 25. Package / capability boundary

Corner / Cafe / Restaurant are **not** three Menu engines.

`PackageEntitlement` / `OutletCapabilityConfig` may gate POS capabilities (e.g. tables). Menu/pricing resolution remains one conceptual engine. Forbidden: scattered `if (package === 'corner')` domain forks (Architecture v1.2 §4).

---

## Conceptual resolver contracts

### ResolvedPriceQuote

Immutable resolver output (not a second ledger):

- `catalogItemId`
- `productVariantId?`
- `amountMinor` / `currencyCode` / `minorUnitExponent`
- SalesContext identity
- `menuPublicationId` / version
- `priceRuleId` / version
- availability provenance where applicable
- effective business datetime
- resolution/provenance metadata

### ResolvedMenu / ResolvedMenuItem

`ResolvedMenu`:

- SalesContext
- `menuPublicationId` / version
- effective business context
- `items[]`

`ResolvedMenuItem`:

- `catalogItemId` / `productVariantId?`
- availability status + provenance
- price quote **or** explicit price-unavailable state
- menu provenance

Excluded from ResolvedMenu:

POS layout props; Inventory balance; COGS; recipe cost; profitability recommendations.

### MenuAssignment resolution algorithm

1. Filter assignments applicable to SalesContext.
2. Discard non-effective (outside `[effectiveFrom, effectiveTo)`).
3. Select highest operational specificity.
4. Exactly one effective publication must win for the commercial surface.
5. Same-specificity overlap ⇒ `CONFIGURATION_ERROR`.

### Error taxonomy (conceptual; names may follow repo conventions)

| Code | Meaning |
| --- | --- |
| `MENU_NOT_ASSIGNED` | no applicable assignment |
| `MENU_PUBLICATION_NOT_EFFECTIVE` | publication outside validity |
| `MENU_ITEM_NOT_FOUND` | not in publication membership |
| `ITEM_UNAVAILABLE` | availability rule says unavailable |
| `PRICE_UNAVAILABLE` | no resolvable base price |
| `AMBIGUOUS_MENU_ASSIGNMENT` | same-specificity assignment conflict |
| `AMBIGUOUS_AVAILABILITY_RULE` | same-precedence availability conflict |
| `AMBIGUOUS_PRICE_RULE` | same-precedence price conflict |
| `CURRENCY_MISMATCH` | incompatible commercial currencies |
| `INVALID_SALES_CONTEXT` | incomplete/invalid context |
| `CONFIGURATION_ERROR` | generic config failure (prefer specific codes) |

Configuration ambiguity is **explicit failure**, never last-write-wins.

---

## Offline boundary

Do not implement offline protocol here (ADR-0018 governs).

Architecture must allow POS to cache:

- immutable `MenuPublication`
- active rule versions
- configuration packages

“Call server for every button tap” is **not** a domain requirement.

---

## Migration boundary

External menu/price imports (iPOS / MISA / KiotViet / Sapo / …) map through canonical commands/models.

No competitor-specific fields on Menu core (ADR-0011).

---

## Implementation sequence (after Accept — separate PRs)

1. Menu Configuration storage + versioning (+ Outlet IANA timezone if missing)
2. MenuAssignment / publication activation
3. AvailabilityResolver
4. Base PricingResolver
5. MenuResolver
6. Orders integration: resolver → `SetOrderCommercialTerms`
7. POS Presentation / MenuLayout
8. First usable cashier screen

Promotions remain a later independent vertical.

**No runtime in this ADR PR.**

---

## GOLDEN-1 relation

Live Menu/Pricing remains **DEFERRED** in GOLDEN-1 until MenuResolver runtime exists.

After runtime implementation, GOLDEN-1 must gain a variation where:

- base price originates from `PriceRule`;
- Order accepts it via commercial terms;
- CompleteOrder freezes it;
- later publication/price changes do not rewrite Revenue.

---

## Consequences

### Positive

- POS can consume a commercial ResolvedMenu without Catalog pollution.
- D1.4B / ADR-0028 historical freeze remains intact.
- Conflict and missing-price failures are honest.
- Outlet-local time closes a known chronology hazard class.

### Negative / deferred

- No Promotions/Loyalty/Stop List/layout in this freeze.
- Outlet timezone becomes a required Organization field for the next vertical.
- Ambiguity rejection may force operators to clean overlapping configs before go-live.

### Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Price on CatalogItem | collapses Catalog ≠ Menu |
| Newest assignment wins | non-deterministic; violates chronology discipline |
| Missing price = 0 | confuses complimentary with misconfiguration |
| CompleteOrder re-resolves price | invisible bill change; violates D1.4B |
| Availability = stock > 0 | couples Menu to Inventory balances |
| Package-forked Menu engines | violates Architecture v1.2 packages/capabilities |
| Promotion inside PriceRule | Pricing ≠ Promotions |
| FX at Menu resolve | out of scope; Order one-currency rule |

---

## Conceptual acceptance (architecture must support)

1. Publish menu → immutable publication; definition may evolve further.
2. Terminal assignment overrides Brand assignment for same surface.
3. Two Outlet-level overlapping assignments same time → configuration error.
4. Schedule evaluated in Outlet IANA timezone, not server TZ.
5. Item in menu without price → PRICE_UNAVAILABLE, not 0.
6. Complimentary path remains Orders commercial terms, not missing PriceRule.
7. OPEN Order accepted price unchanged by later publication until explicit reprice.
8. CompleteOrder uses accepted terms; does not call MenuResolver for a new price.
9. Post-completion PriceRule change leaves Revenue Basis unchanged.
10. ResolvedMenu carries no tile color / slot / COGS / stock qty.

---

## Status

**Accepted** — architecture freeze only. MenuResolver runtime requires a separate Level B implementation launch after this merge.
