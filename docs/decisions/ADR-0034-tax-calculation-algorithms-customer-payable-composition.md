# ADR-0034: Tax Calculation Algorithms & Customer Payable Composition

- **Status:** Accepted — **narrowed direct-sale slice** (C0.2 / C0.2A PO ACCEPT WITH DELTAS, 2026-10-06)
- **Date:** 2026-09-17
- **Accepted:** 2026-10-06 (narrow Accept; third-party funding remains UNSUPPORTED)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0033 (Accepted — refined, not replaced), ADR-0032, ADR-0028, ADR-0030, ADR-0014, ADR-0012, ADR-0037 (C0 Tax/Fiscal Level C production decisions)
- **Blocks enabled after Accept:** **TAX1.1** for the narrowed C0 direct-sale slice
- **Explicitly deferred / UNSUPPORTED:** third-party-funded promotions; platform subsidies; Grab/Shopee/etc. funding semantics; runtime Fiscalization; provider adapters; restaurant dine-in/post-pay timing

## Context

TAX1.1 preflight correctly **STOPPED**: ADR-0033 did not uniquely freeze Tax Money arithmetic. ADR-0034 freezes **KiU Tax Calculation Algorithm V1** as explicit versioned semantics — **not** a claim that Vietnam law universally requires this sequence (LEGAL_UNKNOWN).

ADR-0034 **refines** ADR-0033. It does **not** reopen Tax domain ownership / assignment / fail-closed security already Accepted.

**PO ACCEPT WITH DELTAS (2026-09-18):** arithmetic direction accepted subject to C-source, non-rate storage, and algorithm-provenance deltas below. Mandatory ADR-0028 consistency check on third-party promo **FAILED** at that time.

**PO / Architecture ACCEPT WITH DELTAS (2026-10-06 — C0.2):** Narrow Accept for the initial production slice where:

```text
thirdPartyFunding = 0
platformSubsidy = 0
```

Third-party-funded promotion semantics remain explicitly **UNSUPPORTED**. Future Grab/Shopee/etc. funding must not block basic cafe Tax. A future Commercial funding ADR may extend support; until then TAX1.1 **must reject** non-zero third-party / platform subsidy inputs.

---

## Terminology (binding)

| Symbol / term | Meaning |
| --- | --- |
| **G** | Authoritative `BASE_LIST_LINE_GROSS` (ADR-0030) |
| **M** | Merchant-funded merchandise reductions = line merchant-funded discount + allocated order merchant-funded discount |
| **R_cf** | **customerFacingMerchandiseReductionMinor** — Commercial-owned authoritative amount by which the guest’s merchandise obligation is reduced vs G |
| **C** | **GuestMerchandiseCharge** = `G − R_cf` (authoritative guest merchandise obligation before exclusive additive tax / tips / service / other non-merch) |
| **X** | **TaxBasisInput** from TaxableBaseRule |
| **r** | Resolved decimal rate for rateful treatments |
| **LINE_ROUND_THEN_SUM_V1** | Code-owned TaxCalculationAlgorithm identity selected **deterministically** from accepted TaxPolicy dimensions (not a free admin/client knob) |

**Non-aliases (binding):**

```text
R_cf  ≠  M                          (not necessarily equal)
R_cf  ≠  thirdPartyMerchandiseFundingMinor   (not necessarily equal)
C     ≠  Revenue Basis
C     ≠  X   (unless TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE)
C     ≠  Order CustomerPayable total
ZERO_RATE taxAmountMinor=0  ≠  EXEMPT/NOT_SUBJECT taxAmount absent
```

All Money: exact minor-unit integers. Rates/intermediates: decimal-safe. **No JS `Number`.**

---

## Decision

### 1. Authoritative source of C (DELTA #1)

**Owner:** Orders / Commercial (not Tax, Settlement, or Reporting).

```text
C = G − customerFacingMerchandiseReductionMinor
```

where `customerFacingMerchandiseReductionMinor` (`R_cf`) is a **separate Commercial-owned customer-obligation fact**.

Tax **consumes** C / `R_cf`. Tax does **not** own promotion eligibility, discount proposal, funding-source policy, or customer-facing promo policy. Future Promotions may propose; Orders freezes authoritative accepted result.

**Forbidden TAX1.1 derivations of C:**

- Revenue Basis
- `thirdPartyMerchandiseFundingMinor` alone
- merchant-funded discount alone
- Order `customerPayableMinor`
- Payment amount
- guess / silent fallback

Frontend/cashier **MUST NOT** submit trusted `R_cf` / `C` / `guestMerchandiseChargeMinor` on official calculate+accept. Server builds from trusted Commercial inputs/resolvers.

If required customer-facing economics are unresolved → fail closed (`GUEST_MERCHANDISE_CHARGE_REQUIRED` or repo-equivalent).

### 2. Funding vs customer reduction (two questions)

| Question | Fact |
| --- | --- |
| A. How much less does the customer owe? | `R_cf` / `C` |
| B. Who economically funds that reduction? | funding provenance: merchant-funded / third-party / mixed |

```text
customerFacingMerchandiseReductionMinor
  != merchantFundedDiscountMinor necessarily

customerFacingMerchandiseReductionMinor
  != thirdPartyMerchandiseFundingMinor necessarily
```

Funding provenance may decompose merchant vs third-party components; customer reduction remains a **separate** authoritative Commercial fact.

### 3. Supported commercial examples (deterministic)

| Case | G | R_cf | funding | C | C0 TAX1.1 |
| --- | --- | --- | --- | --- | --- |
| No reduction | 100 | 0 | — | 100 | **SUPPORTED** |
| Merchant-funded reduction | 100 | 20 | merchant component 20 | 80 | **SUPPORTED** (narrow ADR formula) |
| Third-party-funded customer promo | 100 | 20 | third-party compensation 20 | 80 | **UNSUPPORTED** — reject |

Revenue Basis remains separately governed by ADR-0028. **C ≠ Revenue Basis.**

### 4. ADR-0028 / third-party consistency — **OUT OF C0 SLICE** (historical FAILED check retained)

**Scenario under review:**

```text
Menu/list merchandise gross G = 100
Customer pays merchandise = 80
Third party reimburses merchant = 20
Expected GuestMerchandiseCharge C = 80
Expected merchant-earned Revenue Basis = 100
```

**Required honest representation:**

- `R_cf = 20` (customer-facing reduction)
- `thirdPartyMerchandiseFundingMinor = 20` (not labelled merchant-funded)
- Revenue Basis = 100
- without falsely labelling the reduction as merchant-funded

**Current Accepted ADR-0028 + D1.4B runtime:**

- Fields: `grossMerchandiseMinor`, `lineMerchantFundedDiscountMinor`, `allocatedOrderMerchantDiscountMinor`, `thirdPartyMerchandiseFundingMinor`, `netMerchandiseSalesMinor`
- **No** `customerFacingMerchandiseReductionMinor` / first-class GuestMerchandiseCharge
- Line net formula (`computeLineNetMerchandiseSalesMinor`):

```text
net = gross − lineMerchant − allocatedOrderMerchant + thirdParty
```

**Attempted encodings (all dishonest or incomplete):**

| Attempt | Result |
| --- | --- |
| G=100, merchant=0, thirdParty=20 | net=**120** ≠ expected RB 100; no `R_cf` |
| G=100, merchant=20, thirdParty=0 | net=80; **falsely** labels reduction as merchant-funded; loses third-party provenance |
| G=100, merchant=20, thirdParty=20 | net=100 numerically, but **double-labels** same economics as both merchant discount and third-party funding |
| G=100, merchant=0, thirdParty=0, customerPayable=80 | net=100; **no** third-party funding evidence; **no** `R_cf` |

Acceptance test `d14b-order-commercial-snapshot` “third-party funding preserves merchant Revenue Basis” currently expects net=**120** for G=100 + thirdParty=20 — which is a **different** economic reading (additive subsidy on full gross), not the platform-promo “customer 80 + reimburse 20 → RB 100” case from ADR-0028 prose example.

### Verdict of consistency check (2026-09-18)

# **UPSTREAM COMMERCIAL FUNDING SEMANTIC GAP** (third-party / platform-promo path)

**C0.2A narrow Accept (2026-10-06):** This gap **no longer blocks** ADR-0034 Accept or TAX1.1 for the direct-sale slice where `thirdPartyFunding = 0` and `platformSubsidy = 0`. The third-party / platform-promo path remains **UNSUPPORTED** until a dedicated Commercial funding ADR closes the gap honestly.

Current Commercial model **cannot** honestly represent simultaneously:

1. customer-facing reduction = 20  
2. third-party reimbursement = 20  
3. Revenue Basis = 100  

without either wrong Revenue Basis arithmetic, missing customer-facing reduction SoT, or false merchant-funded labelling.

**This gap is Commercial / ADR-0028 runtime semantics — not Tax.**  
Do **not** hide it inside Tax. Do **not** silently alter ADR-0028 in this block.  
**TAX1.1 must fail closed** on non-zero third-party / platform subsidy inputs rather than invent dishonest funding labels.

---

### 5. Evaluation order (binding) — ACCEPTED direction

```text
commercial facts (G, M, R_cf/C, compliment, funding provenance)
  → TaxableBaseRule → X
  → PricingTaxMode arithmetic (LINE_ROUND_THEN_SUM_V1)
```

### 6. TaxableBaseRule V1 — ACCEPTED direction

| Rule | Formula |
| --- | --- |
| `TB_PRE_DISCOUNT_LIST_GROSS` | `X = G` |
| `TB_POST_MERCHANT_FUNDED_DISCOUNT` | `X = G − M` (third-party **not** subtracted) |
| `TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE` | `X = C` |
| `TB_EXPLICIT_COMPLIMENT_ZERO` | `X = 0` only with explicit compliment evidence |

`X >= 0`; negative → validation failure. Unknown rule → fail closed. Closed registry only.

### 7. TaxCalculationAlgorithm identity (DELTA #3)

`TaxCalculationAlgorithm` id/version is **code-owned semantic provenance**, not an independently user-configurable algorithm selector.

TaxPolicy selects accepted dimensions:

- PricingTaxMode
- TaxableBaseRule
- TaxRoundingStrategy
- RoundingPolicy references

Those selections **deterministically** resolve to a code-known algorithm/version (e.g. strategy `LINE_ROUND_THEN_SUM` → algorithm `LINE_ROUND_THEN_SUM_V1`).

Snapshot **records** algorithm id/version for historical explainability.

**Forbidden:**

- client/cashier submit `taxCalculationAlgorithmId` / version
- admin/config accept arbitrary unknown algorithm ids
- automatic downgrade to V1 when unsupported/missing
- silent fallback when combination incompatible → fail closed

### 8. TAX_INCLUSIVE rateful V1 — ACCEPTED formulas

```text
exactTaxableBase = X / (1 + r)
taxableBase = ROUND(exactTaxableBase, TAX_INCLUSIVE_EXTRACTION)
VAT = X − taxableBase
amountIncludingTax = X
Invariant: taxableBase + VAT == X
```

No independent VAT rounding. No `TAX_LINE_VAT_AMOUNT` after remainder.  
Mandatory context: `TAX_INCLUSIVE_EXTRACTION`. Not used: `TAX_LINE_VAT_AMOUNT`, `TAX_LINE_TAXABLE_BASE`, `TAX_RATE_AGGREGATE_VAT`.

### 9. TAX_EXCLUSIVE rateful V1 — ACCEPTED formulas

```text
taxableBase = X
exactVAT = X × r
VAT = ROUND(exactVAT, TAX_LINE_VAT_AMOUNT)
amountIncludingTax = taxableBase + VAT
```

No second total round. Mandatory: `TAX_LINE_VAT_AMOUNT`.

### 10. Non-rate treatment storage (DELTA #2)

| Treatment | rate | taxAmountMinor | notes |
| --- | --- | --- | --- |
| `ZERO_RATE` | explicit **0** | **0** (real calculated Tax fact) | taxableBase=X; amountIncludingTax=X |
| `EXEMPT` | **NULL/absent** | **NULL/absent** | not fabricated numeric zero VAT; no additive Tax in payable; basis/C evidence may remain |
| `NOT_SUBJECT_TO_TAX` | **NULL/absent** | **NULL/absent** | same as EXEMPT for amount semantics |
| `UNKNOWN` / `MISSING_CONFIGURATION` | — | — | **no** accepted Tax result; fail closed when Tax required |

**Zero ≠ absence:** `ZERO_RATE` with `taxAmountMinor=0` is a valid rateful result. `EXEMPT`/`NOT_SUBJECT` must not be persisted as `taxAmountMinor=0`.

Do **not** invent VAT-derived `amountIncludingTax` for EXEMPT/NOT_SUBJECT. Customer-facing merchandise obligation remains **C**. Fiscalization may map later.

### 11. Customer Payable — ACCEPTED direction

| Mode | lineMerchandisePayable |
| --- | --- |
| TAX_INCLUSIVE | `C` (do not add VAT again) |
| TAX_EXCLUSIVE rateful | `C + VAT` |
| ZERO_RATE / EXEMPT / NOT_SUBJECT | `C` |

```text
CustomerPayable = Σ lineMerchandisePayable + authoritative non-merchandise components
```

Settlement presentation: **INCLUDED** (inclusive) vs **ADDITIVE** (exclusive rateful). Never ABSENT→PRESENT(0).

### 12. Reserved contexts / aggregates

`TAX_LINE_TAXABLE_BASE` reserved (V1 integer basis).  
`TAX_RATE_AGGREGATE_VAT` not consulted; aggregates = sum of frozen line VAT. No residual redistribution.

### 13. Mixed modes / non-merchandise / compliment

Mixed inclusive/exclusive lines tolerated (line-wise payable). Merchandise CatalogItem tax path only. Explicit compliment required for `TB_EXPLICIT_COMPLIMENT_ZERO`; do not infer from price=0 alone.

### 14. Snapshot provenance additions

Preserve: X, C/`R_cf` ref, TaxableBaseRule, **algorithm id/version**, used RoundingPolicy contexts, exact intermediates, treatment/rate/amount null semantics per §10.

### 15. Security

Server-only: PricingTaxMode, TaxableBaseRule, strategy, RoundingPolicy, rate, treatment, algorithm, `R_cf`, C, VAT, payable.

Fail closed: no missing→V1, missing rounding→0, UNKNOWN→EXEMPT, missing C→Revenue Basis, EXEMPT→taxAmount=0 forge, thirdParty spoofed into `R_cf`.

Future TAX1.1 adversarial tests (when unblocked): client cannot lower C / inflate `R_cf`; thirdParty≠customer reduction spoof; Revenue Basis≠C; ZERO_RATE≠EXEMPT forge; algorithm not caller-selected; conservation holds.

---

## Required examples (illustrative)

**A.** Inclusive HALF_UP: X=19, r=0.08 → base 18, VAT 1, incl 19  
**B.** Inclusive DOWN: → base 17, VAT 2, incl 19  
**C.** Exclusive HALF_UP: X=12, r=0.08 → base 12, VAT 1, incl 13  
**D.** POST_MERCHANT: G=100, M=20 → X=80 then mode  
**E.** PRE_DISCOUNT: G=100, M=20, C=80 → X=100 while C=80  
**F.** Third-party promo: **UNSUPPORTED** in TAX1.1 — reject non-zero third-party / platform subsidy  
**G.** Compliment: explicit → C=0, X=0  

---

## Consequences

- Tax arithmetic formulas are **Accepted** for the narrowed C0 direct-sale slice (`thirdPartyFunding = 0`, `platformSubsidy = 0`).
- Third-party-funded / platform-subsidy economics remain **UNSUPPORTED**; TAX1.1 rejects them.
- For supported merchant-funded / no-reduction cases, Commercial must supply authoritative `R_cf` / GuestMerchandiseCharge **C** (or equivalent honest inputs) per §1; when no reduction, `R_cf = 0`, `C = G` is valid.
- TAX1.1 may launch after C0.2A docs merge (this ADR + ADR-0037).
- Extending to third-party funding requires a future Commercial ADR + ADR-0034 delta — not silent invention.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Derive C from thirdParty / Revenue Basis | Forbidden by this delta; hides Commercial gap |
| Keep ADR-0034 BLOCKED until all third-party cases work | Over-blocks basic cafe Tax (rejected by C0.2 PO) |
| Silently change ADR-0028 net formula in this PR | Out of scope; needs dedicated Commercial decision |
| Independent inclusive VAT round | Breaks conservation |
| Implement only TAX_INCLUSIVE and pretend EXCLUSIVE is equivalent | Forbidden (C0.2 LC-14 / ADR-0033) |

## Status progression

```text
Proposed
  → PO ACCEPT WITH DELTAS draft incorporated (2026-09-18)
  → ADR-0028 consistency check FAILED (third-party path)
  → STOP: UPSTREAM COMMERCIAL FUNDING SEMANTIC GAP
  → C0.2 PO ACCEPT WITH DELTAS — narrow slice (2026-10-06)
  → ADR-0034 Accepted (third-party UNSUPPORTED) → C0.2A merge → backup
  → TAX1.1 launch for narrowed slice
  → (future) Commercial funding ADR → third-party support delta
```
