# ADR-0030: Commercial RoundingPolicy (Base List Line Gross)

- **Status:** Accepted
- **Date:** 2026-09-16
- **Accepted:** 2026-09-16 (PO LAUNCH — architecture-only Level C; Vietnam MVP product defaults recorded with legal/product/cash separation)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0008, ADR-0010, ADR-0012, ADR-0014, ADR-0016, ADR-0019, ADR-0025, ADR-0027, ADR-0028, ADR-0029, ADR-0031; Architecture v1.2 / v1.3; M1.1 OPTION A; D1.4B; P1.3
- **Blocks enabled after Accept (implementation not launched by this ADR):**
  1. **C1.1 — Commercial Rounding Runtime & Automatic Base Gross Acceptance**
- **Explicitly deferred / out of this ADR PR:** runtime code, migrations, schema, frontend Money×qty, Payments, Settlement, Fiscalization, tax rounding contexts, cash denomination rounding, Promotions allocation rounding, Loyalty, FX

## Context

P1.3 is **CLOSED** on Origin/GitHub `main` @ `45a7b7870437a2ba3d0a9f226d155698af24eea5`. KiU can resolve authoritative unit Money, build/edit OPEN Orders (COUNT and MASS/VOLUME), invalidate commercial state after mutation, and re-resolve current prices.

ADR-0002 forbids posting commercially significant calculated Money without a versioned `RoundingPolicy` selected by jurisdiction / LegalEntity / calculation context / effective period. M1.1 **OPTION A** therefore required the caller to supply explicit `grossMerchandiseMinor` and forbade:

```text
resolvedUnitPriceMinor × OrderLine.quantity → grossMerchandiseMinor
```

That temporary limitation now blocks automatic commercial acceptance and authoritative merchandise Order totals. Payments / Settlement must not begin until this boundary is frozen.

Inventory `CostValue` HALF_EVEN arithmetic (ADR-0002) remains a **technical costing** rule and is **not** official Money rounding.

## Terminology (binding)

| Term | Meaning |
| --- | --- |
| **RoundingPolicy** | Versioned, effective-dated commercial calculation policy for a named context |
| **Calculation context** | Explicit named boundary selecting which policy applies |
| **`BASE_LIST_LINE_GROSS`** | Named context for base merchandise line gross from resolved unit Money × OrderLine quantity |
| **exactUnroundedMinorBasis** | Arbitrary-precision decimal: `unitPrice.amountMinor × canonicalQuantity` (same currency minor coordinate) |
| **roundedGrossMinor** | Official integral `Money.amountMinor` after policy application |
| **roundingDelta** | `roundedGrossMinor − exactUnroundedMinorBasis` (sub-minor provenance; not a Money balance) |
| **quantumMinor** | Rounding grain in currency minor units (typically `1`) |
| **OPTION A** | M1.1 temporary explicit-gross contract — **superseded for this context after C1.1 implements this ADR** |

---

## Research summary (Vietnam MVP) — legal vs product vs cash

Authoritative sources inspected for Vietnam VND commercial documents (2026-09-16):

| Class | Source | Finding for this ADR |
| --- | --- | --- |
| **A. Legal / fiscal (invoices)** | Decree **123/2020/ND-CP** Art. 10 (invoice text/numbers/currency) | Requires Arabic numerals; VND as invoice currency (`đ`); seller may choose thousands/decimal separators. **Does not prescribe** HALF_UP / HALF_EVEN / DOWN / UP for unit price × quantity → line amount. |
| **A. Legal / accounting (FS abbreviation)** | Decree **174/2016/ND-CP** Art. 4 | When abbreviated monetary units are used on financial statements: digits ≥ 5 increase by 1; &lt; 5 discarded (**HALF_UP-style**). Scope = **abbreviated FS units**, not restaurant POS line gross. |
| **A. Commentary** | Tax-agent guidance summarizing the above (e.g. Viet An Law on VAT invoice rounding) | Confirms invoice formatting rules; quantity may follow “mathematical” rounding if rounded; **not a statute prescribing BASE_LIST_LINE_GROSS mode**. |
| **B. Product accounting** | ADR-0002 + Vietnam VND `minorUnitExponent = 0` | Official merchandise Money must be integral minors. KiU needs a deterministic named policy to derive line gross from unit×qty. |
| **C. Cash denomination** | ADR-0016 / Settlement (future) | Payable cash rounding to denomination is **out of scope** here. |

**Separation (binding):**

```text
A = legal/fiscal mandate (Decree 123 silent on line-gross mode)
B = product accounting choice for BASE_LIST_LINE_GROSS (this ADR)
C = cash denomination / Settlement (NOT this ADR)
```

Do **not** infer A from B, or C from B.

---

## Decision

### 1. Policy owner

**Orders / Commercial Calculation** owns:

- RoundingPolicy configuration for commercial Money contexts;
- selection at commercial acceptance / explicit reprice;
- provenance on accepted commercial state (D1.4B extension in C1.1).

**Menu Configuration** owns unit Money resolution only (ADR-0029).  
**POS Presentation** never rounds commercial Money (ADR-0031).  
**Reporting** reads frozen commercial facts; does not re-round (ADR-0028).

### 2. Named calculation context

```text
BASE_LIST_LINE_GROSS
```

RoundingPolicy **MUST** be selected by this explicit context. No unnamed / global / default arithmetic helper may post official merchandise line gross.

Future contexts (examples only — **not** decided here):

- tax / VAT line or document rounding;
- Settlement cash denomination;
- promotional allocation.

### 3. Exact basis (before rounding)

```text
exactUnroundedMinorBasis
  = unitPrice.amountMinor × OrderLine.canonicalQuantity
```

Rules:

- arbitrary-precision decimal arithmetic only (ADR-0002);
- **never** binary floating point;
- do **not** truncate / round before policy application;
- currency of unit Money and output Money must match; mismatch → hard failure;
- `minorUnitExponent` of output Money equals input unit Money’s captured exponent.

Example (VND, exponent 0):

```text
10000 × 0.333333333333 = 3333.33333333…  (exactUnroundedMinorBasis)
```

### 4. Rounding grain

**ROUND PER ORDER LINE.**

```text
roundedLineGross = round(exactUnroundedMinorBasis, policy)
Order merchandise gross = SUM(accepted rounded line gross Money)
```

Do **not**:

- sum all unrounded line bases then round once at Order level;
- distribute an unexplained residual across lines.

Conservation: Order merchandise gross equals the exact sum of accepted line `roundedGrossMinor` values (same currency).

### 5. Rounding mode (Vietnam MVP product choice — class B)

For context `BASE_LIST_LINE_GROSS`, Vietnam MVP default RoundingPolicy uses:

```text
roundingMode = HALF_UP
```

Definition (binding):

- round to nearest multiple of `quantumMinor`;
- when the exact remainder is exactly half a quantum, **round away from zero** (positive half rounds up; signed half follows away-from-zero).

Rationale:

- Decree 123 does **not** mandate a mode → this is **class B product accounting**, not a fabricated legal claim;
- Decree 174’s ≥5-up language is cited only as **related Vietnamese accounting digit-rounding tradition**, not as the invoice statute for this context;
- HALF_EVEN remains reserved for inventory `CostValue` (ADR-0002) and must not be silently reused here;
- DOWN / UP without half-rule are rejected for base list gross (would systematically bias merchants or guests).

Other jurisdictions / LegalEntities may configure different accepted modes via their own policy versions. No universal global mode.

### 6. Quantum

```text
quantumMinor = 1
```

for ordinary electronic merchandise line gross in the currency’s minor unit.

VND (`minorUnitExponent = 0`): quantum = 1 đồng.  
USD (`minorUnitExponent = 2`): quantum = 1 cent.

Do **not** mix cash-denomination quanta (e.g. nearest 1000 VND cash) into `BASE_LIST_LINE_GROSS`.

### 7. COUNT / MASS / VOLUME

One commercial rounding model for all Order quantity dimensions.

| Dimension | Quantity | Money model |
| --- | --- | --- |
| COUNT | canonical non-fractional integer string | same `BASE_LIST_LINE_GROSS` |
| MASS | canonical decimal string | same |
| VOLUME | canonical decimal string | same |

Differences come from quantity values, not from a separate Money engine.

### 8. Exact product cases

Even when `exactUnroundedMinorBasis` is already an integer multiple of `quantumMinor`:

- calculation still runs under `BASE_LIST_LINE_GROSS`;
- policy provenance is still recorded;
- `roundingDelta` may be `0`;
- **no** unversioned “if exact, bypass policy” path.

### 9. Policy selection dimensions

Authoritative selection key:

```text
LegalEntity
+ jurisdictionProfile (when configured; otherwise LegalEntity’s jurisdiction)
+ calculationContext = BASE_LIST_LINE_GROSS
+ effectiveInstant
→ exactly one winning RoundingPolicy version
```

**LegalEntity source for an Order:** `sales_order.legal_entity_id` (already required at OpenOrder).  
Do **not** infer LegalEntity / jurisdiction from Menu assignment, Layout assignment, Brand, or Outlet alone.

Runtime link (C1.1): Orders commercial acceptance loads the Order’s `legalEntityId`, resolves jurisdiction profile for that entity, then selects policy. If LegalEntity or jurisdiction cannot be resolved → fail closed.

### 10. Effectivity

RoundingPolicy versions use half-open intervals:

```text
[effectiveFrom, effectiveTo)
```

`effectiveTo = null` means open-ended.

**Business timestamp for selection** (commercial acceptance / explicit reprice):

```text
SalesContext.businessDateTime
```

when present on the acceptance/reprice command; otherwise the authoritative business instant captured on that commercial acceptance action (same business-time discipline as Menu/Price resolution — not wall-clock `NOW()`, not `created_at`, not reporting query time).

Historical reads use the **frozen policy provenance** on accepted commercial state — never “current policy at report time”.

### 11. Commercial acceptance time

Policy is selected when official commercial terms are **calculated and accepted** (or on explicit reprice), using the business instant above.

Later policy / Menu price / Layout changes do **not** silently mutate accepted OPEN or COMPLETED commercial state.

### 12. Provenance (minimum on accepted line commercial state)

C1.1 must retain (extend D1.4B minimally; no second ledger):

- order line identity / catalog item identity;
- `resolvedUnitPriceMinor`;
- `currencyCode`, `minorUnitExponent`;
- canonical quantity (+ unit/dimension as already on OrderLine);
- `exactUnroundedMinorBasis` (canonical decimal string, sub-minor precision);
- `roundingPolicyId`, `roundingPolicyVersion`;
- `roundingMode`, `quantumMinor`;
- `calculationContext` = `BASE_LIST_LINE_GROSS`;
- `roundedGrossMinor`;
- `roundingDelta` (canonical decimal string);
- effective calculation business instant;
- existing Menu/Price provenance (publication / price rule evidence already used by M1.1).

### 13. Rounding delta

```text
roundingDelta = roundedGrossMinor − exactUnroundedMinorBasis
```

Audit-visible; sub-minor precision; **not** a second Money balance; **not** silently discarded.

### 14. Order merchandise gross aggregation

```text
Order merchandise gross = Σ accepted line roundedGrossMinor
```

(same currency; exact integer sum of minors)

Do **not** re-run unit×qty at Order total rendering.  
Do **not** independently re-round the Order total unless a **separately named** future context requires it (not this ADR).

### 15. Historical immutability

Completed Order retains accepted rounded amounts and policy provenance. Later RoundingPolicy / Menu / Layout / quantity-rule changes must not rewrite historical gross or Revenue Basis (ADR-0028).

### 16. Reversals

Full reversal uses the **exact negative of frozen historical commercial facts**.  
Do **not** recompute line gross with current policy.  
Partial returns / allocations: deferred to their own architecture decision.

### 17. Explicit reprice (OPEN)

New PriceRule or new RoundingPolicy does **not** silently mutate accepted OPEN commercial state.

Explicit reprice / reacceptance:

1. resolve current unit Money (M1.1);
2. select current applicable RoundingPolicy (`BASE_LIST_LINE_GROSS`);
3. compute exactUnroundedMinorBasis;
4. round deterministically;
5. explicitly accept replacement commercial state (D1.4B).

No silent reprice on CompleteOrder.

### 18. Line mutation

D1.4B remains binding: add / update quantity / remove → clear accepted commercial terms → new calculation/acceptance required. New acceptance may use currently effective policy at the acceptance business instant.

### 19. Failure semantics

| Condition | Error (conceptual) |
| --- | --- |
| No valid policy for LegalEntity + context + instant | `COMMERCIAL_ROUNDING_POLICY_REQUIRED` |
| Overlapping / multiple equally applicable policies | `COMMERCIAL_ROUNDING_POLICY_AMBIGUOUS` |
| Currency / exponent mismatch | hard validation failure |
| Missing unit Money / PRICE_UNAVAILABLE | existing Menu/POS failures — **not** rounded zero |

**Forbidden fallbacks:** HALF_UP/HALF_EVEN/Math.round/zero/exact-only/previous arbitrary policy without selection.

### 20. Ambiguity / uniqueness

At a given LegalEntity (+ jurisdiction) + `BASE_LIST_LINE_GROSS` + effective instant: **exactly one** winning policy version.

Forbidden tie-breakers: `created_at`, `updated_at`, UUID, insertion order.

C1.1 must enforce non-overlapping intervals under concurrency (transactional uniqueness / exclusion).

### 21. Tax boundary

ADR-0030 does **not** define VAT/tax line or document rounding. Separate named contexts later. Fiscalization remains ADR-0014 / future fiscal adapters.

### 22. Cash rounding boundary

Cash denomination rounding belongs to **Settlement / Payment** (ADR-0016 family). Not `BASE_LIST_LINE_GROSS`.

### 23. Promotion / discount boundary

Does not redesign Promotions. D1.4B explicit commercial state remains authoritative for discounts/funding. Future discount allocation may use separately named rounding contexts. Do not smuggle promotional allocation into `BASE_LIST_LINE_GROSS`.

### 24. Tips / fees / complimentary

Tips, service fees, payment fees remain outside base merchandise line gross unless Accepted commercial architecture places them there (ADR-0028).  
Complimentary treatment is **explicit** commercial semantics — never inferred from `roundedGrossMinor == 0`.

### 25. Zero semantics

Rounding to zero is allowed only when exact basis + policy produce that result.  
Missing price remains `PRICE_UNAVAILABLE`. Zero is never a substitute for absent Money.

### 26. Negative quantity / Money

Do not introduce negative sale quantity as ad hoc returns. Prefer reversal of frozen values. Signed mathematical behavior for rounding applies only where Accepted reversal architecture requires signed Money; full reversal uses frozen negation.

### 27. Determinism

Same unit Money + canonical quantity + policy version + context → bit-for-bit same `roundedGrossMinor`, `exactUnroundedMinorBasis`, and `roundingDelta` across API instances, environments, retries, and reporting reconstruction tests.

### 28. Versioning

Policy version is immutable once used for accepted commercial facts. Corrections → new version. Do not edit historical policy definitions in place after use.

### 29. OPTION A supersession

After C1.1 implements this ADR:

- KiU **may** derive official `grossMerchandiseMinor` for `BASE_LIST_LINE_GROSS` via RoundingPolicy;
- caller-supplied explicit gross remains allowed as an override path only if a later Accepted contract says so;
- until C1.1 ships, OPTION A remains the **runtime** rule (architecture now frozen; runtime not yet present).

### 30. Next runtime block

```text
C1.1 — Commercial Rounding Runtime & Automatic Base Gross Acceptance
```

Expected scope (not this PR): RoundingPolicy persistence/versioning; resolver; exact decimal calculation; line gross; provenance; D1.4B integration; P1.3 automatic commercial acceptance/reprice; authoritative merchandise Order total; COUNT + MASS/VOLUME; Golden extension.

**Sequence:** ADR-0030 → C1.1 → only then checkout / Settlement architecture/runtime.  
**Payments are still out.**

---

## Decision matrix (complete for C1.1)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Policy owner | Orders / Commercial Calculation |
| 2 | Selection dimensions | LegalEntity (+ jurisdiction) + `BASE_LIST_LINE_GROSS` + effective instant |
| 3 | Context name | `BASE_LIST_LINE_GROSS` |
| 4 | Versioning | Immutable versions; correction = new version |
| 5 | Effective interval | `[effectiveFrom, effectiveTo)` |
| 6 | Business timestamp | acceptance/reprice `SalesContext.businessDateTime` / acceptance business instant |
| 7 | Exact arithmetic | arbitrary-precision decimal; no binary float |
| 8 | Grain | per Order line; Order = sum of rounded lines |
| 9 | Mode (VN MVP) | `HALF_UP` (product class B) |
| 10 | Quantum | `quantumMinor = 1` |
| 11–13 | COUNT/MASS/VOLUME | one model; quantity differs |
| 14 | Currency | match unit Money; fail on mismatch |
| 15 | Exact product | still under policy + provenance |
| 16 | Missing policy | `COMMERCIAL_ROUNDING_POLICY_REQUIRED` |
| 17 | Ambiguous policy | `COMMERCIAL_ROUNDING_POLICY_AMBIGUOUS` |
| 18 | Provenance | §12 fields |
| 19 | Rounding delta | §13 |
| 20 | Order gross | Σ rounded line gross |
| 21 | Reprice | explicit only |
| 22 | Line mutation | invalidate (D1.4B) |
| 23 | Historical reporting | frozen facts |
| 24 | Reversal | negate frozen; no re-round |
| 25 | Tax | out of scope |
| 26 | Cash rounding | Settlement |
| 27 | Promotion | separate contexts later |
| 28 | Zero | only if policy result; never missing Money |
| 29 | Determinism | bit-for-bit |
| 30 | Next block | **C1.1** |

---

## Alternatives considered

### Keep OPTION A forever

Rejected. Blocks automatic commercial acceptance and honest checkout totals after P1.3.

### Order-level round of Σ(unrounded bases)

Rejected. Conceals per-line rounding and creates unexplained residuals.

### Reuse CostValue HALF_EVEN for commercial Money

Rejected. ADR-0002: costing precision ≠ official Money.

### Claim Decree 123 mandates HALF_UP for line gross

Rejected. Fabrication. Mode is product class B with research appendix.

### Exact-only (fail unless exact integer)

Rejected as primary path: MASS/VOLUME fractional qty is in product scope; exact-only would re-block checkout.

### Silent CompleteOrder reprice

Rejected. Explicit acceptance/reprice only.

## Consequences

### Positive

- C1.1 can implement without inventing semantics;
- OPTION A retirement path is clear;
- audit provenance and historical Revenue remain honest;
- tax / cash / promo boundaries stay separable.

### Negative / accepted cost

- Every LegalEntity needs at least one `BASE_LIST_LINE_GROSS` policy before automatic acceptance;
- Vietnam HALF_UP is a product choice — revisit if future statute mandates otherwise;
- D1.4B storage must grow provenance fields in C1.1.

## Validation plan (for C1.1 — not this PR)

1. Exact decimal basis for COUNT and MASS/VOLUME examples (including half-quantum ties).
2. Missing / ambiguous policy failures.
3. Provenance round-trip; delta visibility when non-zero and zero.
4. Order gross = sum of rounded lines.
5. Mutation invalidates; reprice explicit; CompleteOrder does not re-round.
6. Reversal uses frozen negation.
7. No float path; Golden economics with policy-derived gross.

## Out of scope

Runtime · migrations · Payments · Settlement · Fiscalization · tax rounding · cash denomination · promotions allocation · FX · UI calculator bypassing policy

## Owner / architect acceptance record

- [x] Named context `BASE_LIST_LINE_GROSS`
- [x] Per-line grain; Order = Σ rounded lines
- [x] Exact arbitrary-precision basis; no binary float
- [x] Vietnam MVP mode `HALF_UP`, quantum `1` as **product (B)** with Decree 123 silence documented
- [x] LegalEntity from Order; not Menu inheritance
- [x] Effectivity `[from, to)` + acceptance business instant
- [x] Provenance + roundingDelta
- [x] Explicit reprice; D1.4B invalidation preserved
- [x] Tax / cash / promo boundaries
- [x] Next block C1.1; Payments still out
