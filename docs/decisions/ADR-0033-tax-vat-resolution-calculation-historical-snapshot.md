# ADR-0033: Tax / VAT Resolution, Calculation & Historical Snapshot

- **Status:** Accepted
- **Date:** 2026-09-17
- **Accepted:** 2026-09-17 (PO ACCEPT WITH DELTAS — rounding strategy policy-driven; TaxClassificationAssignment scoped; independent re-review APPROVE)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0008, ADR-0012, ADR-0014, ADR-0016, ADR-0025, ADR-0028, ADR-0029, ADR-0030, ADR-0032; Architecture v1.2 / v1.3; domain-module-map; P0 Vietnam Fiscalization Readiness (`NEEDS_TAX_ARCHITECTURE`)
- **Blocks enabled after Accept (implementation not launched by this ADR):**
  1. **TAX1.1 — Tax Domain Runtime** (classification assignment, TaxPolicy, calculate+accept, snapshots)
  2. Subsequent **ADR-0014 delta** (TaxSnapshot consumption + document modes) then **FISC1.1**
- **Explicitly deferred / out of this ADR PR:** Tax runtime, migrations, production VAT calculator, Fiscalization runtime, fiscal/payment providers, Promotions engine, cash denomination rounding, FX, payroll/CIT/withholding, household-business turnover rules as core restaurant logic, frontend fiscal UI

## Context

P0 Vietnam Fiscalization Readiness Review closed on Origin/GitHub `main` @ `9c97702e8462fa5277ee63edbd0f6dcccf929217` with verdict **`NEEDS_TAX_ARCHITECTURE`**.

Decree **254/2026/NĐ-CP** (eff. **2026-07-01**) requires cash-register e-invoices for deduction-method (*phương pháp khấu trừ*) economic organizations to state amount before VAT, VAT rate, VAT amount, and total including VAT. KiU today:

- has **no Tax domain**;
- C1.1 accepts commercial terms with `taxMinor: null`;
- S1.1 freezes payable `tax: ABSENT` (ABSENT ≠ PRESENT(0));
- ADR-0030 owns only `BASE_LIST_LINE_GROSS`;
- ADR-0014 forbids Fiscalization inventing business Money.

Therefore Fiscalization cannot safely start until authoritative Tax facts exist as frozen upstream inputs.

This ADR freezes **machinery**, not a Vietnam rate table.

---

## Terminology (binding)

| Term | Meaning |
| --- | --- |
| **Tax domain** | Dedicated module owning tax semantics, policy, calculation, and historical tax snapshots |
| **TaxClassification** | Versioned, jurisdiction-aware tax treatment class for sellable merchandise/service — **not** a raw percentage and **not** a Catalog UI category |
| **TaxClassificationAssignment** | Tax-owned, effective-dated binding: CatalogItem identity → TaxClassification under Tenant + LegalEntity + jurisdiction applicability — **not** a global field on CatalogItem |
| **TaxPolicy** | Versioned, effective-dated policy: pricing tax mode, rate/treatment, taxable-base rule, **TaxRoundingStrategy**, rounding-context refs |
| **PricingTaxMode** | `TAX_INCLUSIVE` \| `TAX_EXCLUSIVE` |
| **TaxRoundingStrategy** | Explicit versioned policy choice for how line/order tax Money is rounded and aggregated (e.g. `LINE_ROUND_THEN_SUM`, future `AGGREGATE_THEN_ROUND`) — **not** a jurisdiction-independent system default |
| **TaxTreatment** | `STANDARD_RATE` \| `REDUCED_RATE` \| `ZERO_RATE` \| `EXEMPT` \| `NOT_SUBJECT_TO_TAX` \| `UNKNOWN` \| `MISSING_CONFIGURATION` |
| **TaxableBase** | Authoritative Money basis to which the resolved tax treatment applies for a line (policy-defined; not an alias) |
| **TaxLineSnapshot** | Immutable historical line-level tax result |
| **TaxOrderSnapshot** | Immutable order-level tax acceptance envelope referencing TaxLineSnapshots + aggregate provenance |
| **TaxCalculationContext** | Named RoundingPolicy context for tax arithmetic (separate from `BASE_LIST_LINE_GROSS`) |

**Non-aliases (binding):**

```text
Customer Payable  ≠  TaxableBase
Customer Payable  ≠  VAT amount
Customer Payable  ≠  Revenue Basis
Merchandise Gross ≠  TaxableBase
Revenue Basis     ≠  VAT
Fiscal invoice total ≠ Revenue Basis SoT
```

---

## Decision

### 1. Domain ownership

**Tax** is a first-class domain module (Architecture / domain-module-map update is a consequence of Accept).

| Owner | Owns |
| --- | --- |
| **Tax** | TaxClassification, TaxPolicy, TaxClassificationAssignment rules/validation, tax calculation, TaxLineSnapshot / TaxOrderSnapshot, tax RoundingPolicy **context names** usage, tax configuration audit provenance |
| **Catalog** | CatalogItem identity; holds **assignment reference** to TaxClassification (not rates) |
| **Organization / LegalEntity** | Taxpayer identity; JurisdictionProfile binding (ADR-0012); LegalEntity-scoped applicability of TaxPolicy sets |
| **Orders** | Orchestrates calculate+accept ordering with commercial acceptance; stores references to accepted TaxOrderSnapshot identity; does **not** compute VAT |
| **Menu / POS Presentation** | Never authoritative Tax |
| **Promotions / Loyalty** | Propose funding/discount facts; do not compute VAT |
| **Settlement** | May freeze/reference customer-facing tax totals from accepted Tax facts; does **not** calculate VAT (ADR-0032) |
| **Fiscalization** | Consumes frozen Tax facts; maps to legal/provider documents (ADR-0014) |
| **Reporting** | Reads frozen Tax facts; never recomputes current TaxPolicy |

```text
Catalog  ≠  Pricing  ≠  Promotions  ≠  Loyalty  ≠  Tax
  ≠  Settlement  ≠  Fiscalization  ≠  Reporting
```

Architecture v1.2 statement that LegalEntity “owns … taxes” means **taxpayer / policy applicability ownership**, not that Organization embeds VAT arithmetic. Calculation SoT is the Tax module under LegalEntity/JurisdictionProfile scope.

### 2. TaxClassification

Durable entity with at least:

- stable identity;
- jurisdiction / profile applicability;
- effective interval `[effectiveFrom, effectiveTo)`;
- human label / code (not a rate);
- treatment category hook (maps to TaxTreatment via TaxPolicy);
- provenance (who created/superseded).

**Forbidden:**

- hardcoding `FOOD=8%` / `DRINK=10%` into Product identity;
- inferring Tax from category color, menu page, POS layout, payment method;
- collapsing TaxClassification to a mutable “current percentage” field on CatalogItem.

Historical Orders reference **TaxClassification identity + TaxPolicy version**, not live Catalog labels.

### 3. Classification assignment (Tax-owned; Catalog identity independent)

**TaxClassification** is a Tax-owned semantic identity.

**TaxClassificationAssignment** is Tax-owned configuration. It binds:

```text
CatalogItem identity
  → effective-dated TaxClassificationAssignment
  → TaxClassification
```

**Assignment applicability (binding minimum):**

- tenant
- LegalEntity
- jurisdiction applicability (via JurisdictionProfile / LegalEntity binding)
- effective interval `[effectiveFrom, effectiveTo)`

**Forbidden:**

- a globally mutable `taxClassificationId` (or equivalent) on CatalogItem that is valid across every LegalEntity;
- treating Catalog/Menu identity as Tax configuration;
- LegalEntity owning Catalog/Menu identity.

**Consequence (binding):**

```text
Same CatalogItem identity
  MAY resolve to different TaxClassification / TaxPolicy
  for different LegalEntities / jurisdictions / effective dates
without cloning Catalog identity.
```

```text
Catalog identity  ≠  Tax configuration
```

**Resolution path (server-side only):**

```text
Order
  → Tenant / LegalEntity
  → CatalogItem (line identity)
  → effective TaxClassificationAssignment @ businessDateTime
  → TaxClassification
  → TaxPolicyVersion
```

**Precedence (binding):**

1. Explicit TaxClassificationAssignment matching Tenant + LegalEntity + jurisdiction + CatalogItem at `businessDateTime`.
2. If missing and Tax is required for the sellable → `TAX_CLASSIFICATION_REQUIRED` (fail closed).
3. No inheritance from Menu page, POS layout, Outlet color, or Brand defaults that bypass LegalEntity scope.
4. Outlet may **restrict** which classifications are sellable locally only if a future accepted Outlet policy exists; Outlet never invents rates.

Menu/POS may **display** classification labels for operators; display is not SoT.

Historical accepted Tax snapshots store **resolved** classification/policy facts. Later assignment changes do **not** mutate old Orders.

### 4. TaxPolicy resolver

**Inputs (conceptual):**

```text
tenantId
legalEntityId
jurisdictionProfileVersion   # via LegalEntity @ businessDateTime (ADR-0012)
businessDateTime
taxClassificationId
pricingTaxMode context       # from TaxPolicy / LegalEntity tax pricing binding
commercial funding facts     # D1.4B-compatible inputs (see §7)
```

**Output:** authoritative `TaxPolicyVersion` (treatment, rate or exemption marker, taxable-base rule id, RoundingPolicy refs, PricingTaxMode).

| Condition | Result |
| --- | --- |
| Required policy missing | `TAX_POLICY_REQUIRED` / `TAX_CALCULATION_UNAVAILABLE` |
| Multiple conflicting policies | `TAX_POLICY_AMBIGUOUS` |
| Classification missing/invalid | `TAX_CLASSIFICATION_REQUIRED` / `TAX_CLASSIFICATION_INVALID` |
| Rounding context missing | `TAX_ROUNDING_POLICY_REQUIRED` |
| TaxRoundingStrategy missing when Tax calculation required | `TAX_ROUNDING_STRATEGY_REQUIRED` (fail closed) |
| Treatment `UNKNOWN` / `MISSING_CONFIGURATION` when fiscal/tax required | fail closed — **never** silent `0%` |

**No cross-tenant TaxPolicy use. No cross-LegalEntity TaxPolicy / TaxClassification use** unless a future shared-configuration ADR is Accepted.

Caller-supplied `tenantId` / `taxPolicyId` / `taxClassificationId` / rates must not override Order→LegalEntity authoritative resolution. Prefer **not accepting** authoritative Tax IDs from cashier/API input at all. If mismatched caller values are present: **reject** — do not silently replace.

### 5. PricingTaxMode — TAX_INCLUSIVE / TAX_EXCLUSIVE (mandatory)

Architecture **must** support both modes. Mode is **not** inferred from country or currency.

**Owner of mode:** versioned **TaxPolicy** (LegalEntity binds which TaxPolicy set / default PricingTaxMode applies at `businessDateTime`). Commercial unit Money remains Menu/Pricing-resolved (ADR-0029); Tax interprets that Money according to PricingTaxMode.

**Example (illustrative rates only — not Vietnam fixtures):**

```text
Displayed / sold unit Money: 108_000
VAT rate example: 8%

TAX_INCLUSIVE:
  taxableBase + VAT derived from inclusive amount via named RoundingPolicy contexts
TAX_EXCLUSIVE:
  VAT derived on taxableBase; amountInclVAT = taxableBase + VAT (after named rounding)
```

Fiscalization must **consume** the frozen decomposition; it must not reverse-engineer inclusive/exclusive later.

### 6. TaxTreatment — do not collapse to numeric zero

| Treatment | Meaning |
| --- | --- |
| `STANDARD_RATE` / `REDUCED_RATE` | Rateful treatments; rate on TaxPolicyVersion |
| `ZERO_RATE` | Explicit zero-rated taxable supply |
| `EXEMPT` | Exempt supply (not the same as zero-rate) |
| `NOT_SUBJECT_TO_TAX` | Outside tax scope |
| `UNKNOWN` | Cannot determine — fail closed when required |
| `MISSING_CONFIGURATION` | Config gap — fail closed when required |

JurisdictionProfile may map local legal labels → these semantic categories. Numeric `0` VAT amount is allowed only when treatment is explicitly `ZERO_RATE` (or policy states zero amount for that treatment). **`EXEMPT` / `NOT_SUBJECT_TO_TAX` / `UNKNOWN` / `MISSING_CONFIGURATION` must not be stored as if they were `ZERO_RATE`.**

### 7. Taxable base and discount funding

TaxableBase is a **TaxPolicy-defined** function of preserved commercial funding facts. This ADR does **not** invent Vietnam statutory formulas.

**Required preserved inputs for calculation (minimum):**

| Fact | Source |
| --- | --- |
| Line list/base gross (`BASE_LIST_LINE_GROSS`) | Orders + ADR-0030 |
| Merchant-funded discount amount | Commercial / Promotions freeze (ADR-0028 A) |
| Third-party-funded merchandise amount | Commercial freeze (ADR-0028 B) |
| Compliment / 100% merchant-funded zero economics | Explicit commercial fact |
| Mixed funding components | Explicit component breakdown |
| Quantity (canonical decimal) | OrderLine |
| Currency | Order sales currency |

**Named taxable-base rule ids** live on TaxPolicyVersion (examples of **policy machinery names**, not Vietnam law claims):

- `TB_POST_MERCHANT_FUNDED_DISCOUNT`
- `TB_PRE_DISCOUNT_LIST_GROSS`
- `TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE`
- `TB_EXPLICIT_COMPLIMENT_ZERO` (when commercial compliment ⇒ taxable base zero / not applicable per policy)

Exact Vietnam mapping is **Jurisdiction configuration**, counsel-backed where needed — not hardcoded in this ADR.

**Mandatory scenario preservation:**

| Scenario | Architecture requirement |
| --- | --- |
| A. Restaurant-funded discount | Funding marked merchant-funded; TaxableBaseRule applied; Revenue Basis reduced per ADR-0028 |
| B. Third-party-funded discount | Funding marked third-party; do not treat as merchant discount for Revenue Basis; TaxableBaseRule may differ |
| C. Compliment | Explicit compliment fact; no silent missing-price compliment |
| D. Mixed funding | Component breakdown preserved; no single opaque “discount” blob |

```text
taxableBase  ≠  customerPayable   (identity)
taxableBase  ≠  merchandiseGross  (identity)
taxableBase  ≠  Revenue Basis     (identity)
```

Numerical equality may occur under some policies; it is never semantic identity.

### 8. Calculation ownership and orchestration

**Tax module** calculates authoritative VAT / tax Money.

**Orchestration order (binding for future TAX1.1 / commercial path):**

```text
Menu unit Money resolution (ADR-0029)
  → BASE_LIST_LINE_GROSS (ADR-0030)
  → Promotions / discount / funding facts (when present)
  → Tax resolve + calculate (this ADR)
  → explicit accept: commercial terms + TaxOrderSnapshot (coupled)
```

Frontend / cashier **never** calculates authoritative VAT.

**CompleteOrder** (ADR-0025 / ADR-0029 / ADR-0032):

- consumes already accepted TaxOrderSnapshot when Tax is required;
- **MUST NOT** resolve current TaxPolicy, recalc VAT, change classification, or re-run pricing;
- missing/stale required Tax snapshot → explicit failure (orchestration fail-closed).

**OpenSettlement / Checkout (binding intent for TAX1.1):** when Tax is required for the LegalEntity/jurisdiction, opening Settlement or advancing checkout that needs PRESENT tax must fail closed on missing/stale TaxOrderSnapshot (`TAX_SNAPSHOT_REQUIRED` / `TAX_SNAPSHOT_STALE`) — Settlement must not invent ABSENT→PRESENT(0).

### 9. TaxRoundingStrategy (mandatory — policy-driven, not universal default)

Exact Vietnam VAT rounding / aggregation semantics remain **LEGAL_UNKNOWN** (Decree 254 / Circular 91 do not prescribe a universal computational algorithm for VAT line arithmetic in the readiness research). Therefore architecture **MUST NOT** elevate any strategy to a permanent jurisdiction-independent system default.

**Binding:**

```text
TaxRoundingStrategy is an explicit versioned / effective-dated policy choice
on TaxPolicy (or TaxPolicy-bound rounding configuration).
```

**First supported named strategy** (implementation / fixture-capable; not a legal universal default):

```text
LINE_ROUND_THEN_SUM
```

Conceptual behaviour when that strategy is selected:

```text
For each OrderLine:
  resolve TaxPolicyVersion
  determine TaxableBase (policy rule)
  calculate/round line tax Money using named TaxCalculationContext(s)
Then:
  order/rate aggregates = sum of frozen line results
  (no second hidden re-round unless a named aggregate context is also selected)
```

**Architecture must also be able to represent**, without redesign, other deterministic strategies when verified legal/provider semantics require them, e.g.:

```text
AGGREGATE_THEN_ROUND
```

(or further named strategies Accepted later).

| Rule | Binding |
| --- | --- |
| Missing required TaxRoundingStrategy | fail closed (`TAX_ROUNDING_STRATEGY_REQUIRED`) |
| Hidden fallback strategy | **forbidden** |
| Residual allocation of aggregate VAT back onto lines | **unsupported** until an explicit residual-allocation ADR is Accepted |
| Silent `LINE_ROUND_THEN_SUM` when strategy unset | **forbidden** |

`LINE_ROUND_THEN_SUM` may appear in Vietnam MVP fixtures **only** when the LegalEntity TaxPolicy explicitly selects it — never as unnamed global arithmetic.

### 10. Named Tax RoundingPolicy contexts

ADR-0030 `BASE_LIST_LINE_GROSS` **does not** own tax rounding.

This ADR freezes these **named contexts** (policies versioned/effective-dated per LegalEntity + jurisdiction + context). Which contexts a given TaxRoundingStrategy uses is policy-defined:

| Context | Purpose |
| --- | --- |
| `TAX_INCLUSIVE_EXTRACTION` | Split inclusive Money into taxable base + VAT |
| `TAX_LINE_TAXABLE_BASE` | Round taxable base when policy requires a rounded base distinct from commercial gross |
| `TAX_LINE_VAT_AMOUNT` | Round line VAT / tax amount |
| `TAX_RATE_AGGREGATE_VAT` | Round aggregate-by-rate total when strategy/policy requires an official aggregate Money distinct from sum-of-lines |

Missing required RoundingPolicy for a context demanded by the selected TaxRoundingStrategy → `TAX_ROUNDING_POLICY_REQUIRED`.

Product may choose HALF_UP quantum 1 for VND in fixtures only when explicitly configured — **never** as an unnamed global default.

All authoritative arithmetic: decimal-safe; **no JS `Number`**.

### 11. TaxLineSnapshot / TaxOrderSnapshot

#### TaxLineSnapshot (minimum facts)

- orderId / orderLineId
- catalogItemId (historical identity)
- taxClassificationId
- taxPolicyVersionId
- jurisdictionProfileVersionId / legalEntityId
- PricingTaxMode
- TaxTreatment (+ rate when rateful)
- taxableBase Money
- vatOrTaxAmount Money (or explicit non-amount treatment marker)
- amountIncludingTax Money (when applicable)
- currencyCode + minorUnitExponent (= Order currency)
- quantity canonical decimal + UoM
- funding input fingerprint/refs (merchant/third-party/compliment components used)
- RoundingPolicy version ids per context used + rounding deltas / provenance
- TaxRoundingStrategy id/version used
- businessDateTime used for resolution
- calculation semantic fingerprint

#### TaxOrderSnapshot (minimum facts)

- orderId + acceptance identity/version
- references to TaxLineSnapshots
- TaxRoundingStrategy id/version used
- aggregates by TaxTreatment/rate (per selected strategy)
- total tax Money / total incl-tax merchandise tax view as needed
- coupled commercial acceptance identity / fingerprint
- acceptor provenance / idempotency key
- acceptedAt (technical) + businessDateTime

**Snapshot relationship to commercial state — Decision B (binding):**

```text
TaxOrderSnapshot is Tax-owned and separately persisted.
Orders commercial acceptance references TaxOrderSnapshot identity when Tax is in scope.
```

Not embedded opaque blobs inside commercial JSON as SoT. Commercial `taxMinor` fields (ADR-0028) may mirror totals as evidence but TaxOrderSnapshot remains Tax SoT.

### 12. Invalidation / staleness / fingerprint

Tax acceptance becomes **stale** when any tax-relevant input changes, including:

- line identity set / quantity / UoM
- resolved unit Money / BASE_LIST_LINE_GROSS
- discount / funding semantics
- TaxClassificationAssignment
- TaxPolicyVersion
- RoundingPolicy versions for tax contexts
- PricingTaxMode
- jurisdiction / LegalEntity applicability
- businessDateTime used for resolution (when re-resolution required before accept)

**Do not** rely solely on `updatedAt`.

**Coupled invalidation (binding):**

```text
tax-relevant Order mutation
  → invalidate accepted commercial terms (existing C1.1 behavior)
  → invalidate accepted TaxOrderSnapshot
  → requires explicit recalculate + reaccept
```

**Completed Order:** never re-resolves Tax. Policy changes next day do not mutate history.

**OPEN Order reprice before acceptance:** may re-resolve using current effective policies at the new accept `businessDateTime` per accepted sales-context rules.

### 13. Settlement / Customer Payable

When Tax is present and required for guest charges:

```text
Customer Payable includes authoritative tax amounts presented to the guest
(Settlement Payable Snapshot may freeze tax component as PRESENT from TaxOrderSnapshot)
```

Settlement **MUST NOT** calculate VAT. Absence remains ABSENT until Tax acceptance supplies PRESENT facts (ADR-0032).

### 14. Fiscalization consumption

Fiscalization receives frozen:

- line identity/description as required by FiscalPolicy
- quantity/unit
- taxableBase, rate/treatment, VAT amount, amount incl VAT
- aggregates by rate/treatment
- discount/funding facts when required by document mode
- seller LegalEntity tax identity (Organization)
- payment/settlement facts as required by FiscalPolicy

Fiscalization **never** invents missing Tax Money. Missing required TaxOrderSnapshot → explicit configuration/business error — not silent skip.

Fiscal delivery mode (có mã / không mã / máy tính tiền) remains **FiscalPolicy / ADR-0014** — not this ADR.

### 15. Reporting / Revenue Basis

- Reporting derives net-of-tax sales, VAT collected, taxable sales by rate **only** from frozen Tax + commercial snapshots.
- Historical reports must not use current TaxPolicy.
- **ADR-0028 unchanged:** Revenue Basis remains **tax-exclusive** merchant-earned net merchandise; Tax is stored separately; FiscalDocument is never Revenue SoT.
- If authoritative tax decomposition is required for tax-exclusive Revenue Basis and Tax snapshot is missing → Revenue Basis **unavailable** (existing ADR-0028 rule), not invented.

### 16. Reversal / correction

Completed Order reversal / compensation uses **original frozen Tax facts** (negate/compensate per future correction ADR).

**Never** rerun current TaxPolicy for historical reversal amounts.

Fiscal correction/replacement documents remain **Fiscalization-owned** (ADR-0014). Tax supplies original/compensating monetary facts.

### 17. Currency / quantity

- Tax snapshot currency **must** equal Order/commercial currency. No FX. Cross-currency tax out of scope.
- COUNT / MASS / VOLUME all supported via canonical decimal quantity. No integer-quantity assumption.

### 18. Configuration errors (conceptual names)

Exact public error codes follow repo conventions at TAX1.1; semantics required now:

| Semantic | Intent |
| --- | --- |
| `TAX_POLICY_REQUIRED` | No applicable policy |
| `TAX_POLICY_AMBIGUOUS` | Conflicting policies |
| `TAX_CLASSIFICATION_REQUIRED` | Assignment missing |
| `TAX_CLASSIFICATION_INVALID` | Assignment/class not applicable |
| `TAX_CALCULATION_UNAVAILABLE` | Cannot compute authoritatively |
| `TAX_ROUNDING_POLICY_REQUIRED` | Named tax rounding context missing |
| `TAX_ROUNDING_STRATEGY_REQUIRED` | TaxRoundingStrategy missing when calculation required |
| `TAX_SNAPSHOT_REQUIRED` | Required snapshot missing at checkout/complete |
| `TAX_SNAPSHOT_STALE` | Fingerprint mismatch / invalidated |

Never silently choose a default VAT rate. Never silently use 0% for unknown/missing.

### 19. Vietnam fit (no hardcoded rate table)

- ADR defines machinery; Jurisdiction/LegalEntity configuration holds effective-dated rates/treatments.
- Temporary VAT reductions / exclusions = new TaxPolicyVersions with `[effectiveFrom, effectiveTo)` — no code fork.
- Household-business turnover thresholds are **not** baked into core restaurant Tax logic; taxpayer profile may select different TaxPolicy/FiscalPolicy sets later.
- Future fiscal mapping:

```text
Frozen TaxLineSnapshots
  → aggregate taxableBase by rate/treatment
  → aggregate VAT by rate
  → total VAT
  → total including VAT
  → Fiscalization provider/document mapping (ADR-0014)
```

### 20. Corporate vs household

P0 target: corporate restaurant / café merchant. Same Tax engines may later serve household businesses via configuration — do not encode household-only rules as universal restaurant defaults.

---

## Security (blocking)

### Assets

TaxClassification, TaxPolicy versions, taxable base, VAT amounts, Tax snapshots, LegalEntity tax identity, fiscal input derived from Tax.

### Threats (non-exhaustive)

- client/cashier selects lower tax rate or treatment
- client submits `vatAmount` / `taxableBase` / `taxRate` / `taxPolicyId` / `taxClassificationId` as trusted facts
- caller injects TaxClassification or TaxPolicy from another LegalEntity
- cross-tenant or cross-LegalEntity TaxPolicy / assignment use
- forced stale policy / snapshot
- historical snapshot tampering / ordinary CRUD mutate
- rounding manipulation / extreme decimals / overflow
- race: edit ↔ accept ↔ CompleteOrder / TaxPolicy change

### Authority boundary (binding)

```text
Authoritative Tax inputs and results are server-resolved only.

Future runtime derives:
  Order → Tenant / LegalEntity → CatalogItem
    → effective TaxClassificationAssignment → TaxPolicy

Frontend/cashier MUST NOT submit trusted authoritative:
  taxRate | taxableBase | vatAmount | taxPolicyId | taxClassificationId | taxTreatment
```

Prefer not accepting authoritative Tax IDs from cashier/API input at all.  
If a caller supplies classification/policy IDs that do not match server resolution for the Order’s Tenant/LegalEntity: **reject** — do **not** silently replace mismatched values.

Clients may submit **intent** (e.g. request company invoice buyer identity — Fiscal/Orders concern) but never authoritative Tax Money or assignment/policy identifiers.

### Authorization

Future Tax configuration writes (TaxPolicy, TaxClassification, assignments, tax RoundingPolicy) are **privileged management** operations. Cashier role must not modify them. Production Identity implementation is separate; privilege expectation is explicit now.

### Tenant / LegalEntity isolation

Resolution must prove same Tenant and LegalEntity applicability as the Order. Cross-tenant forbidden. Cross-LegalEntity forbidden without future Accepted shared-config ADR.

### Tamper resistance

Accepted/completed Tax snapshots: **no** generic `PUT/DELETE` CRUD. Corrections = compensating/history-preserving records only.

### Input hardening (future TAX1.1)

Reject NaN/Infinity/excessive exponent/illegal negative rates/out-of-bounds rates/excessive scale/overflow amounts/negative taxable base unless explicit compensating flow. No JS Number authoritative arithmetic.

### Idempotency / concurrency (future TAX1.1)

- Same calculate+accept retry with same semantic fingerprint → same Tax facts (idempotent).
- Concurrent quantity edit / reprice / TaxPolicy change / accept / CompleteOrder must not freeze stale Tax (DB transaction/row version/lock — UI lock insufficient).

### Audit

Tax configuration changes: who/what, effective interval, version, timestamps, supersession. Sales reference immutable versions.

### Future PR review gate

Every Tax runtime PR requires **FUNCTIONAL + ARCHITECTURE + SECURITY** APPROVE. CRITICAL/HIGH block merge. MEDIUM affecting financial/fiscal integrity blocks merge.

### Required future adversarial tests

1. Cashier cannot select tax rate  
2. Client `vatAmount` rejected/ignored  
3. Cross-tenant TaxPolicy rejected  
4. Cross-LegalEntity TaxPolicy / TaxClassification rejected (no silent replace)  
5. Missing TaxClassificationAssignment fails closed  
6. Ambiguous policy fails closed  
7. Stale Tax snapshot rejected  
8. Completed Order stable after policy/assignment change  
9. Duplicate accept idempotent  
10. Concurrent accept/edit cannot freeze wrong VAT  
11. Extreme decimal input rejected  
12. TaxPolicy / assignment mutation requires privileged boundary  
13. Accepted Tax snapshot cannot ordinary-CRUD mutate  
14. Fiscalization cannot issue using fabricated Tax facts  
15. Client-supplied foreign LegalEntity `taxClassificationId` / `taxPolicyId` rejected  
16. Missing TaxRoundingStrategy fails closed (no hidden default)  

---

## Golden scenarios (architecture examples for future tests)

Illustrative rates only unless a fixture cites official effective-dated config.

| ID | Scenario |
| --- | --- |
| A | `TAX_INCLUSIVE` COUNT line with explicit TaxRoundingStrategy `LINE_ROUND_THEN_SUM` → base + VAT via named contexts |
| B | `TAX_EXCLUSIVE` COUNT line → VAT on base; amount incl VAT |
| C | Fractional MASS/VOLUME quantity; decimal-safe |
| D | Two lines, different TaxClassification / rates; aggregates by rate |
| E | Restaurant-funded discount; funding preserved; TaxableBaseRule applied |
| F | Third-party-funded discount; Revenue Basis vs TaxableBase distinction held |
| G | Compliment; explicit fact; policy-driven tax outcome |
| H | `ZERO_RATE` vs `EXEMPT` vs `NOT_SUBJECT_TO_TAX` not collapsed |
| I | Next-day TaxPolicy / assignment change; completed Order unchanged |
| J | Quantity mutation invalidates commercial + Tax acceptance |
| K | Reversal uses original frozen Tax facts |
| L | Same CatalogItem → different TaxClassificationAssignment per LegalEntity |
| M | Missing TaxRoundingStrategy fails closed (no hidden LINE_ROUND_THEN_SUM) |

---

## ADR-0014 delta packet (do **not** edit ADR-0014 in this block)

After Tax Accept, minimal remaining Fiscalization ADR delta likely:

1. Explicit consumption of **TaxOrderSnapshot / TaxLineSnapshot** as required Money inputs.  
2. FiscalDocumentMode: có mã / không mã / máy tính tiền.  
3. Terminal / cash-register identity under LegalEntity + Outlet.  
4. FiscalCheckoutGate vocabulary map to runtime statuses (keep S1.1 enum; map FAILED_* if needed).  
5. Numbering ownership (provider/CQT vs local) rule.

Launch ADR-0014 delta separately after TAX1.1 semantics are Accepted/runtime-ready as PO decides.

---

## Parallel LEGAL_UNKNOWN / PROVIDER_UNKNOWN (non-blocking for this ADR)

- Exact offline/deferred transmission windows (Circular 91 counsel)  
- Edge dine-in timing vs Decree 254 Art. 9  
- Exact VAT computational rounding / aggregation algorithm in law (hence configurable TaxRoundingStrategy + RoundingPolicy; Vietnam LEGAL_UNKNOWN)  
- Provider certification / signing / HSM details  
- Provider selection  

---

## Consequences

- domain-module-map gains **Tax** module.  
- C1.1 path must later expand to coupled Tax calculate+accept before fiscally valid checkout when Tax required.  
- S1.1 payable `tax` may become PRESENT from TaxOrderSnapshot — still not Settlement-calculated.  
- FISC1.1 remains blocked until Tax runtime exists **and** ADR-0014 delta (if needed) is Accepted.  
- Payment adapter remains independently gated on acquiring selection.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Fiscalization calculates VAT | Violates ADR-0014 / readiness verdict; mixes legal mapping with tax math |
| Tax rates on CatalogItem / Menu | Not versionable; couples UI identity to law; breaks history |
| Embed Tax only inside commercial JSON blob | Weak Tax ownership; harder isolation/security; Reporting/Fiscal unclear SoT |
| Infer inclusive/exclusive from VN/VND | Illegal convenience; merchants may differ |
| Reuse `BASE_LIST_LINE_GROSS` for VAT | Forbidden by ADR-0030 / ADR-0032 |
| Universal system default `LINE_ROUND_THEN_SUM` | Vietnam rounding LEGAL_UNKNOWN; must be explicit TaxRoundingStrategy |
| Hidden residual allocation of aggregate VAT | Needs explicit Accepted residual policy |
| Global `taxClassificationId` on CatalogItem | Couples Catalog identity to one Tax treatment across LegalEntities |
| Hardcode Vietnam 8%/10% in ADR | Rate table belongs in effective-dated config |
| Collapse exempt/zero/unknown to 0 | Destroys legal/reporting semantics |

## Acceptance criteria (architecture)

- [x] Tax domain ownership frozen  
- [x] TaxClassification + assignment owner frozen  
- [x] TaxPolicy resolver inputs/outputs + fail-closed errors  
- [x] TAX_INCLUSIVE / TAX_EXCLUSIVE ownership  
- [x] TaxableBase ≠ payable ≠ merchandise ≠ Revenue Basis  
- [x] Discount funding scenarios preserved without inventing VN statute  
- [x] Multiple rates + non-collapsed treatments  
- [x] Named tax rounding contexts; TaxRoundingStrategy policy-driven (not universal default)  
- [x] TaxClassificationAssignment scoped (Catalog identity ≠ Tax config)  
- [x] Historical Tax snapshots + invalidation + CompleteOrder consume-only  
- [x] Settlement / Fiscalization / Reporting boundaries  
- [x] Security threat model + adversarial tests listed  
- [x] No runtime / migration in this PR  

## Status progression

```text
Proposed
  → independent TAX/MONEY/SECURITY review APPROVE
  → PO ACCEPT WITH DELTAS (2026-09-17)
  → deltas incorporated + independent re-review APPROVE
  → Accepted
```

Runtime TAX1.1 requires separate launch after Accept — **not** started by this ADR.
