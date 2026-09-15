# ADR-0028: Order Commercial Snapshot & Revenue Basis Semantics

- **Status:** Accepted
- **Date:** 2026-09-15
- **Accepted:** 2026-09-15 (PO LAUNCH — binding decisions recorded; architecture-only Level C)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0003, ADR-0008, ADR-0010, ADR-0012, ADR-0013, ADR-0014, ADR-0016, ADR-0019, ADR-0025, ADR-0026, ADR-0027; Architecture v1.2 / v1.3; Block D1.4A
- **Blocks enabled after Accept (implementation not launched by this ADR):**
  1. Order Commercial Snapshot (Orders write-side freeze at CompleteOrder)
  2. Revenue Basis read model (Reporting)
  3. Food Cost Ratio + Operational Gross Profit reporting
- **Explicitly deferred / out of this ADR PR:** runtime code, migrations, schema, pricing/promo/loyalty engines, tax/fiscal/payment/settlement implementation, partial returns, Revenue/Food Cost/Gross Profit read models, FX, UI

## Context

D1.4A (Actual COGS Read Model) is merged and backed up on Origin `main` @ `465dcb906304f2e0d9414a2dc80fc888e634f193`. ADR-0026 / ADR-0027 remain binding. Actual COGS is implemented and **must not be modified** by this ADR.

ADR-0026 deferred Food Cost Ratio / Gross Profit until an authoritative **Revenue Basis** exists. ADR-0019 already places Revenue Basis / Net Sales on the economic metric ladder, but does not freeze:

- what amounts enter Revenue Basis for restaurant merchandise sales;
- how discounts and third-party funding are treated;
- how historical commercial terms are frozen on a completed Order;
- how Revenue effects reverse under ADR-0027 chronology.

Without that contract, Reporting cannot honestly compute Food Cost Ratio or Operational Gross Profit, and must not invent substitutes (menu price, payment received, fiscal total, Settlement amount).

This ADR freezes the **architecture-only** commercial economics contract.

## Terminology (binding)

**Revenue Basis** in this ADR means:

```text
OPERATING / MANAGEMENT REPORTING BASIS FOR FOOD COST AND MARGIN
```

It is **not** automatically:

- statutory accounting revenue;
- IFRS revenue;
- tax declaration revenue;
- fiscal receipt total;
- cash received;
- Settlement amount.

Do **not** make accounting/legal claims beyond this operational reporting contract.

## Product Owner binding decision — Revenue Basis

For restaurant merchandise sales:

```text
Revenue Basis = merchant-earned NET MERCHANDISE SALES
```

after merchant-funded discounts/promotions,

**excluding:**

- tax;
- tips / gratuities;
- service charges classified as non-merchandise charges;
- delivery charges classified as non-merchandise charges;
- payment-processing charges;
- platform commissions;
- deposits / prepayments as such;
- wallet / account funding;
- other non-merchandise monetary flows.

Conceptual identity:

```text
Gross merchandise amount
− merchant-funded merchandise discounts
+ authoritative third-party merchandise subsidy/reimbursement actually earned by merchant
= Net Merchandise Sales / Revenue Basis
```

Tax and non-merchandise charges remain **separate** economic components.

Do **not** use customer payable total as Revenue Basis.

## Decision

### 1. Complements D1.4A; does not change Actual COGS

| Concept | Owner / nature | Status |
| --- | --- | --- |
| **Actual COGS** | Reporting derived from historical GoodsIssue / InventoryMovement (ADR-0026 / D1.4A) | Unchanged |
| **Revenue Basis** | Reporting derived from frozen Order commercial snapshot (this ADR) | Architecture only here |
| **Food Cost Ratio** | `Actual COGS / Revenue Basis` | Deferred implementation |
| **Operational Gross Profit** | `Revenue Basis − Actual COGS` (management reporting name) | Deferred implementation |

Actual COGS remains exactly as implemented in D1.4A.

### 2. Merchandise classification

Classification follows **economic meaning**, not UI label.

A charge is included in Revenue Basis only when it represents **merchandise sold** as part of the Order commercial sale.

| Example | Treatment |
| --- | --- |
| food / drink CatalogItem | merchandise |
| packaging intentionally sold as a CatalogItem | may be merchandise |
| generic delivery fee | non-merchandise |
| gratuity / tip | non-merchandise |
| payment fee | non-merchandise |
| service charge | non-merchandise component unless a **future explicit ADR** reclassifies |

Do **not** hide non-merchandise charges inside merchandise revenue.

### 3. Order Commercial Snapshot (historical Order truth)

A completed Order must eventually own / reference an **immutable historical commercial snapshot**.

Conceptual structure (names are conceptual; SQL naming is **not** frozen by this ADR):

```text
OrderCommercialSnapshot
  orderId
  tenantId
  legalEntityId
  outletId

  currencyCode
  minorUnitExponent

  businessDate
  businessOrder
  businessTime?

  line commercial snapshots

  grossMerchandiseMinor
  merchantFundedDiscountMinor
  thirdPartyMerchandiseFundingMinor
  netMerchandiseSalesMinor   ← Revenue Basis for the Order

  taxMinor
  nonMerchandiseChargesMinor
  tipMinor

  customerPayableMinor where meaningful

  pricing / adjustment / tax provenance
```

The commercial snapshot is **historical Order truth**.

It must **not** be reconstructed later from current Menu / Pricing / Promo / Loyalty state.

### 4. OrderLine Commercial Snapshot

Each sold OrderLine must eventually retain enough frozen evidence to explain its commercial economics:

```text
OrderLineCommercialSnapshot
  orderLineId
  soldCatalogItemId
  quantity

  currencyCode
  minorUnitExponent

  resolved unit/base merchandise price
  grossMerchandiseMinor

  line-level merchant-funded adjustments
  allocated order-level merchant-funded adjustments

  third-party merchandise funding attributable to line

  netMerchandiseSalesMinor

  taxMinor attributable to line where authoritative
  relevant provenance
```

**Required invariant (ADR-0002 money conservation):**

```text
SUM(line netMerchandiseSalesMinor) = Order Revenue Basis (netMerchandiseSalesMinor)
```

Exact deterministic minor-unit conservation. No rounding money may disappear or be created.

### 5. Ownership (ADR-0008)

| Concern | Owner |
| --- | --- |
| Pricing / Promotion / Loyalty **policy & proposal** of commercial terms | Pricing / Promotions / Loyalty modules (specialized resolvers; **not** a universal rules DSL) |
| **Frozen commercial result** accepted for the sale | **Orders** |
| Derived Revenue / Food Cost / Operational Gross Profit views | **Reporting / Finance** (read-side) |

- Reporting must **not** re-run Pricing, Promo, Loyalty, or MenuResolver to answer historical Revenue Basis.
- Orders must **not** own pricing policy engines.
- One historical commercial fact model only (Orders-owned freeze; Reporting derives).

This aligns with ADR-0025 (“Orders owns … commercial/order snapshots”) and ADR-0008 (“Pricing ≠ Promotions ≠ Loyalty”).

### 6. Price freeze semantics

Binding direction:

- commercial terms may be operationally editable while the Order is **OPEN**, according to future pricing commands / policies;
- a price accepted for an OrderLine must **not** change merely because Menu / Pricing configuration later changes;
- explicit repricing while OPEN must be an **explicit business operation**, not silent current-menu lookup;
- at **`CompleteOrder`**, final commercial terms become **immutable historical snapshot truth**.

After completion, changing menu price, price list, promotion, loyalty rule, catalog metadata, or outlet configuration must **not** rewrite historical Revenue Basis.

OPEN Order / preorder (ADR-0025): no completed sale Revenue Basis until `CompleteOrder`.

### 7. Discounts and funding provenance

Distinguish economic funding:

#### A. Merchant-funded discount

Reduces Revenue Basis.

#### B. Third-party-funded merchandise subsidy / reimbursement

If the merchant has an **authoritative right** to receive that merchandise compensation, it does **not** economically behave like a merchant-funded discount. It contributes to merchant-earned merchandise consideration.

Example:

```text
Menu merchandise: 100
Customer promo pays: 80
Platform funds merchant: 20

Merchant Revenue Basis may remain 100
if the 20 reimbursement is authoritative.
```

Do **not** assume every promo reduces Revenue Basis.

Funding source / provenance must be explainable.

If funding cannot be determined authoritatively: **do not silently guess** — treat Revenue Basis (or the affected component) as unavailable / unresolved until authoritative funding evidence exists (ADR-0019 UNKNOWN must not silently become zero).

### 8. Order-level discount allocation

Order-level merchandise discounts must be **deterministically allocated** to eligible OrderLines so Revenue Basis is available at:

- Order;
- OrderLine;
- sold CatalogItem;
- Outlet;
- period.

Requirements (binding):

- deterministic allocation;
- exact minor-unit conservation (ADR-0002);
- stable result independent of DB insertion order / UUID / upload order / technical arrival;
- no over-allocation;
- explicit eligibility.

**Recommended future implementation direction** (not frozen algorithm here):

proportional allocation over eligible merchandise basis, with deterministic residual-cent / minor-unit assignment using **stable business line ordering**.

Exact algorithm may be frozen in the Order Commercial Snapshot implementation ADR/spec. This ADR requires conservation and determinism only.

### 9. Tax (ADR-0012 / ADR-0014)

Tax is **not** part of Revenue Basis for Food Cost.

Revenue Basis is **tax-exclusive** merchandise economics.

- Do **not** invent tax by subtracting an assumed rate.
- Tax calculation remains compatible with accepted JurisdictionProfile / fiscal architecture (ADR-0012 / ADR-0014).
- Commercial snapshot should retain authoritative tax amount / provenance when available.
- If authoritative decomposition between merchandise and tax is required but unavailable: do **not** silently fabricate tax-exclusive Revenue Basis — mark/report Revenue Basis **unavailable** until authoritative tax decomposition exists.
- **Never** use FiscalDocument total as the Revenue SoT.
- Fiscal receipt issuance timing must **not** move Revenue Basis between business periods (ADR-0003 / ADR-0027 clocks).

### 10. Currency (ADR-0002 / ADR-0019)

A single Order commercial snapshot has **one** transaction / sales currency:

- `currencyCode`
- `minorUnitExponent`

No mixed commercial currencies inside one Order snapshot.

Do **not** assume sales currency equals Inventory valuation currency.

- Actual COGS keeps its historical valuation currency (D1.4A).
- Future Food Cost / Operational Gross Profit may combine Revenue and COGS only when currencies are compatible.
- If currencies differ: Food Cost / Operational Gross Profit remain **unavailable** unless a future explicit FX contract supplies reporting currency, exchange rate, source, effective business time, and provenance.
- **No silent FX.**

### 11. Payments / Settlement (ADR-0013 / ADR-0016)

Payments and Settlement are **not** Revenue Basis SoT.

| Situation | Effect on Revenue Basis |
| --- | --- |
| unpaid completed Order | sale economics may still exist |
| split tender | does **not** split Revenue Basis |
| card / cash mix | does **not** alter merchandise revenue |
| delayed payment | does **not** move sale Revenue Basis to payment date |
| over / under collection | must **not** redefine commercial sale value |
| payment provider outcome | is **not** merchandise revenue |
| payment refund alone | must **not** silently rewrite Order commercial history |

Settlement answers: *How was the obligation paid / covered?*  
Order Commercial Snapshot answers: *What merchandise economics did the sale create?*

Keep these separate (ADR-0016: Order ≠ Settlement). Tips remain separate from principal (ADR-0016); tips are non-merchandise for Revenue Basis.

### 12. Cancellation and reversal (ADR-0025 / ADR-0027)

#### OPEN Order cancellation

- no completed sale Revenue Basis;
- no compensating revenue effect required.

#### Completed Order reversal

Must be append-only / compensating, aligned with ADR-0027.

- Original commercial snapshot remains **immutable and visible**.
- `ReverseCompletedOrder` later contributes:

```text
REVERSAL Revenue effect = exact negative of original historical Revenue Basis
```

at **reversal business chronology**:

```text
businessDate
businessOrder
businessTime?
```

Do **not** re-resolve current price / promotion / tax / menu.

Example:

```text
Jan 10 completed sale Revenue Basis +1,000
Jan 12 ReverseCompletedOrder

Reporting:
  Jan 10 = +1,000
  Jan 12 = −1,000
Combined period = 0
```

Both effects remain drillable.

Technical `reversed_at` / `created_at` / `recorded_at` do **not** control period membership.

### 13. Partial returns / partial refunds — deferred

Current `ReverseCompletedOrder` represents **full** completed-order reversal semantics.

Do **not** invent partial commercial return semantics inside ADR-0028.

Partial line / quantity return, partial commercial correction, or partial refund linked to merchandise requires a separately defined business command / model if not already Accepted elsewhere.

**Payment refund is not an acceptable substitute** for partial sales reversal.

### 14. Commercial corrections

Completed historical commercial truth is immutable.

Future corrections must be:

- explicit;
- append-only / compensating;
- business-chronology positioned;
- provenance-preserving.

Never UPDATE old completed economics into a new value without historical evidence.

Full correction subsystem design is **out of scope** for this ADR unless already required by Accepted architecture.

### 15. Future reporting grains

Future Revenue read-side must support at least:

- Order;
- OrderLine;
- sold CatalogItem;
- Outlet;
- Legal Entity;
- business date;
- period;
- currency;
- channel where already authoritative.

Revenue Basis must support the same sold-item / order dimensions needed to combine later with Actual COGS.

Do **not** invent category / channel history if it is not currently frozen.

### 16. Future Food Cost Ratio (ADR-0026 remains binding)

```text
Food Cost Ratio = Actual COGS / Revenue Basis
```

where:

- Actual COGS = D1.4A historical derived COGS;
- Revenue Basis = this ADR’s net merchandise sales.

Must **not** use customer payable total, tax-inclusive fiscal total, payment received, Settlement amount, or current menu price.

Do **not** implement the ratio in this ADR.

Edge cases (zero Revenue Basis, negative reversal-only periods, UNKNOWN COGS, incompatible currencies) must remain **explicit and never fabricated**.

### 17. Future Operational Gross Profit

```text
Operational Gross Profit = Revenue Basis − Actual COGS
```

Use the management-reporting name **Operational Gross Profit** unless and until accounting semantics are separately accepted.

Do **not** imply statutory accounting Gross Profit. Do **not** implement it in this ADR.

### 18. Historical stability

Later changes must **not** rewrite historical Revenue Basis:

- menu price / pricing rule / promotion / loyalty changes;
- tax profile version changes;
- CatalogItem metadata / outlet configuration changes;
- payment status / settlement timing;
- fiscal provider timing.

Historical commercial economics changes only through an accepted explicit economic correction / reversal.

### 19. Drill-down / explainability

Future reporting must answer: *Why is Revenue Basis for this order 820?*

Conceptual path:

```text
report period
  → Outlet
  → sold CatalogItem
  → Order
  → OrderLine
  → base / resolved price
  → gross merchandise amount
  → discounts / adjustments
  → funding source
  → tax separation
  → net merchandise sales
  → commercial provenance
```

For reversal:

```text
Revenue reversal
  → reversal entity
  → original Order Commercial Snapshot
  → exact historical commercial amount compensated
```

## Conceptual acceptance matrix

ADR-0028 must remain valid against at least:

1. one item, no discount  
2. multiple quantities  
3. multiple OrderLines  
4. line-level merchant discount  
5. order-level merchant discount  
6. deterministic minor-unit allocation  
7. 100% complimentary merchant-funded item → Revenue Basis zero  
8. third-party-funded merchandise promo  
9. tax stored separately / excluded from Revenue Basis  
10. tip excluded  
11. delivery charge excluded  
12. service charge excluded under current policy  
13. payment fee excluded  
14. payment amount differs from Revenue Basis without rewriting sale  
15. split tender does not affect Revenue Basis  
16. fiscal total does not become Revenue SoT  
17. menu price changes after sale → historical Revenue unchanged  
18. promo configuration changes after sale → unchanged  
19. cancellation before completion → no Revenue effect  
20. completed reversal same period → positive + negative effects  
21. completed reversal later period → negative effect in later period  
22. backdated reversal → explicit reversal business period  
23. reversal uses original commercial snapshot  
24. transaction currency preserved  
25. COGS / revenue currency mismatch → no silent Food Cost  
26. DB insertion order does not alter economics  
27. partial refund is **not** silently interpreted as partial sales reversal  
28. exact Order total = exact sum of line commercial allocation  
29. Revenue Basis remains independent of current Pricing / Menu lookup  
30. Actual COGS D1.4A remains unchanged  

## Architecture review — alignment notes

| Topic | Finding |
| --- | --- |
| ADR-0002 money / rounding | **Aligned** — commercial amounts are posted Money; line↔order conservation mandatory; no silent invent |
| ADR-0003 / ADR-0027 chronology | **Aligned** — Revenue SALE/REVERSAL period membership uses business chronology only |
| ADR-0008 Pricing ≠ Promo ≠ Loyalty | **Aligned** — resolvers propose; Orders freezes; Reporting reads |
| ADR-0010 posting / historical truth | **Aligned** — commercial snapshot freezes at CompleteOrder; corrections append-only |
| ADR-0012 JurisdictionProfile | **Aligned** — tax policy hooks remain jurisdiction-owned; no hardcoded tax invent |
| ADR-0013 payment non-custody | **Aligned** — tips/deposits non-custodial; not Revenue Basis |
| ADR-0014 fiscal boundary | **Aligned** — FiscalDocument not Revenue SoT; fiscal timing ≠ period membership |
| ADR-0016 Order ≠ Settlement | **Aligned** — Settlement coverage ≠ merchandise economics |
| ADR-0019 economic ladder | **Aligned / refined** — Revenue Basis / Net Sales remains ladder step; this ADR freezes **merchant-earned net merchandise sales** and third-party funding distinction (restaurant-borne vs third-party funded) without inventing statutory revenue |
| ADR-0025 CompleteOrder | **Aligned** — commercial freeze at completion; OPEN has no Revenue effect; Orders owns commercial snapshots |
| ADR-0026 Actual COGS / Food Cost deferral | **Aligned** — denominator now defined architecturally; ratio still deferred for implementation; D1.4A unchanged |
| ADR-0027 reversal chronology | **Aligned** — Revenue reversal compensates original snapshot at reversal business position |
| Architecture v1.3 metric ladder | **Aligned** — Operational Gross Profit named carefully to avoid statutory GP claims |
| Third-party delivery platforms | **Aligned under current policy** — delivery fee / platform commission excluded from Revenue Basis; commissions remain typed Direct Variable Cost candidates later (ADR-0019), not merchandise revenue |
| Accidental statutory-accounting claims | **Guarded** — Revenue Basis and Operational Gross Profit are management/operating reporting terms |

### Product Owner choices required?

**None that block Accept.** Soft areas are explicitly deferred rather than guessed:

- exact order-level allocation algorithm (conservation/determinism required; algorithm in implementation);
- partial return / partial commercial correction command model;
- any future reclassification of service charge into merchandise (requires new ADR);
- FX contract for cross-currency Food Cost / Operational Gross Profit.

## Consequences

- Implementation may proceed only after **explicit PO launch** of each follow-up block.
- Food Cost Ratio / Operational Gross Profit remain unavailable in runtime until commercial snapshot + Revenue read model exist and currencies are compatible.
- D1.4A Actual COGS stays the sole COGS read model; no second costing engine.
- UX / docs must not present Food Cost % until Revenue Basis facts exist.

## Recommended implementation sequence (subject to explicit PO launch)

Do **not** auto-start after this ADR merges.

1. **Order Commercial Snapshot** — Orders write-side freeze at `CompleteOrder` (+ reversal compensation linkage).  
2. **Revenue Basis read model** — Reporting derived SALE/REVERSAL effects and aggregates.  
3. **Food Cost Ratio + Operational Gross Profit** — combine ADR-0026 Actual COGS with ADR-0028 Revenue Basis.

Block identifiers for those launches are assigned by Product Owner at launch time; do **not** invent conflicting roadmap IDs in this ADR.

## Alternatives considered

- Use customer payable / fiscal total / payment received as Revenue Basis — **rejected**.
- Reconstruct historical revenue from current menu / promo — **rejected**.
- Reporting re-runs Pricing/Promo engines — **rejected**.
- Collapse tips / delivery / commissions into merchandise revenue — **rejected**.
- Treat every promo as merchant-funded discount — **rejected**.
- Invent partial return semantics here — **rejected** (deferred).
- Silent FX between sales currency and COGS valuation currency — **rejected**.
- Claim statutory / IFRS / tax-declaration revenue — **rejected**.

## Out of scope for this ADR PR

- Application / runtime code.
- Migrations / DB schema.
- Pricing, promotion, loyalty, tax, fiscal, payments, settlement implementations.
- Partial refunds / returns implementation.
- Revenue read model / Food Cost Ratio / Operational Gross Profit / FX / UI / Intelligence recommendations.
