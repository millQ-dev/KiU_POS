# ADR-0032: Checkout & Settlement Orchestration

- **Status:** Accepted
- **Date:** 2026-09-16
- **Accepted:** 2026-09-16 (PO LAUNCH — architecture-only Level C; binding decisions recorded)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002, ADR-0008, ADR-0012, ADR-0013, ADR-0014, ADR-0016, ADR-0018, ADR-0019, ADR-0025, ADR-0027, ADR-0028, ADR-0029, ADR-0030, ADR-0031; Architecture v1.2 / v1.3; C1.1
- **Blocks enabled after Accept (implementation not launched by this ADR):**
  1. **S1.1 — Settlement / Checkout Runtime Foundation**
- **Explicitly deferred / out of this ADR PR:** runtime code, migrations, schema, API, frontend, Payment provider adapters, Fiscalization adapters, tax engine, cash denomination rounding, Promotions/Loyalty runtime, tips/service-fee runtime

## Context

C1.1 is **CLOSED** on Origin/GitHub `main` @ `99b63f4996638ca4e979e7b8a9aec415590ff307` (C1.1 merge parent `12334779f1ab313c905e740d252c972ead79dae6`). KiU can:

- accept authoritative `BASE_LIST_LINE_GROSS` merchandise line gross (ADR-0030);
- freeze Orders commercial snapshots (D1.4B / ADR-0028 fields);
- CompleteOrder → inventory write-off (ADR-0025).

Accepted architecture already freezes:

| ADR | Boundary |
| --- | --- |
| ADR-0013 | Payments non-custody; tips/deposits as allocation/reference; no wallet |
| ADR-0014 | Fiscalization pipeline from settlement / business outcome; Order ≠ FiscalDocument |
| ADR-0016 | Order ≠ Settlement; SettlementGroup → Check → allocations |
| ADR-0025 | CompleteOrder owns inventory write-off; Payment does not |
| ADR-0028 | Revenue Basis ≠ customer payable; commercial snapshot components |
| ADR-0030 | `BASE_LIST_LINE_GROSS` only — not tax/cash/promo/split rounding |

What is still missing is the **orchestration contract** that connects:

```text
accepted Order commercial state
  → customer payable snapshot
  → SettlementGroup / Check
  → Payment attempts / outcomes
  → Settlement satisfaction
  → fiscal orchestration hook
  → CompleteOrder authorization
```

without collapsing domain boundaries or inventing Payments/Fiscalization runtime.

Inspection of current code (preflight): **no** `SettlementGroup` / `Check` / Payment / FiscalDocument persistence or services exist yet. `customerPayableMinor` exists as an Orders commercial snapshot field (ADR-0028 / D1.4B) and must not be treated as Settlement SoT by itself.

## Terminology (binding)

| Term | Meaning |
| --- | --- |
| **Merchandise Gross** | Σ accepted rounded base list line gross Money (ADR-0030 / C1.1). Orders commercial fact. |
| **Revenue Basis** | Merchant-earned net merchandise sales from frozen Order commercial snapshot (ADR-0028). Reporting read model input — **not** payable. |
| **Customer Payable** | Amount the guest is expected to pay for a SettlementGroup / Check under a frozen **Settlement Payable Snapshot**. |
| **Settlement Outstanding** | Remaining unpaid portion of frozen Customer Payable after qualifying allocations. |
| **Paid / Allocated Amount** | Sum of PaymentAllocation amounts that qualify toward settlement coverage. |
| **Checkout** | Application orchestration layer that sequences OpenSettlement → payment requests → satisfaction → fiscal hook observation → CompleteOrder authorization. **Not** an aggregate. |
| **Settlement Payable Snapshot** | Frozen, auditable composition of payable components for one SettlementGroup (and its Checks). |

Do **not** use one generic UI/API property named `total` for all of the above.

---

## Decision

### 1. Checkout ownership

**Checkout = application orchestration layer only.**

| Owner | Owns |
| --- | --- |
| **Checkout (app orchestration)** | sequencing, authorization gates, idempotent retries of orchestration steps, production cashier path policy |
| **Orders** | Order, OrderLine, accepted commercial snapshot; **coordinates** SettlementGroup / Check / CheckLineAllocation / Settlement Payable Snapshot per ADR-0016 |
| **Payments** | TenderDefinition, Payment, PaymentAllocation, provider refs/outcomes, reconciliation evidence; **no custody** (ADR-0013) |
| **Fiscalization** | FiscalPolicy, FiscalSeries, FiscalDocument, FiscalSubmission, correction chains, provider adapter **interface** (ADR-0014) |
| **Reporting** | Revenue Basis / Food Cost / OGP read models from frozen commercial facts (ADR-0028) |

Do **not** create:

- a second `CheckoutOrder` aggregate;
- a Settlement microservice that re-owns Order lines;
- Payment-owned inventory or commercial snapshot mutation.

**Reconciliation with ADR-0016:** Settlement structure remains **Orders-coordinated**. “Settlement owns SettlementGroup/Check/payable snapshot” means those **facts** belong to the Settlement facet coordinated by Orders — not a parallel Order.

### 2. Core invariants (preserved)

```text
Order        ≠ Settlement
Settlement   ≠ Payment
Payment      ≠ FiscalDocument
Order        ≠ FiscalDocument

Revenue Basis     ≠ Customer Payable
Merchandise Gross ≠ semantic alias of Customer Payable
```

Payment does **not** own inventory semantics. ADR-0025 remains authoritative for CompleteOrder → GoodsIssue.

### 3. OpenSettlement preconditions

`OpenSettlement` (conceptual command) is allowed only when **all** hold:

1. Order status is **OPEN**
2. accepted commercial state exists (`ACCEPTED`, not absent)
3. commercial state is **current** (not `NEEDS_REACCEPTANCE` / stale)
4. authoritative Merchandise Gross is available from accepted commercial facts
5. sales currency is coherent on the Order (one currency; ADR-0002 / ADR-0028)
6. tenant + LegalEntity coherent; SettlementGroup will not cross LegalEntities (ADR-0016)
7. no incompatible **live** SettlementGroup already exists for the Order (see §11)

**Forbidden:** opening Settlement from `NEEDS_REACCEPTANCE` or without accepted commercial terms.

### 4. Settlement Payable Snapshot

At successful `OpenSettlement`, Orders freezes an authoritative **Settlement Payable Snapshot** for the SettlementGroup.

Properties (binding):

- calculated/frozen by backend domain/application services — **never by React**;
- historically auditable;
- references the accepted Order commercial snapshot identity/version used as merchandise basis;
- one settlement/payable currency = Order sales currency;
- distinguishes components conceptually (names conceptual; SQL not frozen here):

| Component | Role |
| --- | --- |
| merchandiseGross | from accepted ADR-0030 / commercial snapshot |
| customerBorneDiscountOrReduction | customer-facing reductions (when present) |
| tax | when authoritative |
| serviceCharges | non-merchandise when present |
| tips | tip/gratuity presented for payment (when present) |
| otherExplicitCustomerFacingCharges | other non-merchandise charges |
| **customerPayable** | authoritative sum the guest must cover for this Settlement |

MVP numerical equality is allowed:

```text
merchandiseGross = 100000
other components absent
customerPayable = 100000
```

This is **numerical equality**, not semantic identity. Architecture must remain valid when future explicit components exist.

`customerPayableMinor` on Order commercial snapshot (ADR-0028) may be populated as commercial evidence but does **not** replace Settlement Payable Snapshot as Settlement SoT after Settlement opens.

### 5. Payable component ownership vs Revenue Basis

| Component | Customer Payable | Revenue Basis (ADR-0028) | Primary owner of policy / freeze |
| --- | --- | --- | --- |
| Merchandise gross (base list) | **A** (included) | enters gross path toward net | Orders commercial + ADR-0030 |
| Merchant-borne merchandise discount | **A** (reduces) | **B** (reduces) | Promotions/Pricing propose; Orders freezes |
| Third-party merchandise funding | **A** may reduce guest share | **B** per ADR-0028 funding rules | Promotions + Orders freeze; no silent guess |
| Tax | **A** (included when present) | **D** (excluded) | Jurisdiction / FiscalPolicy; not invented here |
| Tip / gratuity | **A** (included when presented) | **D** (excluded) | Payments allocation / Settlement presentation; ADR-0013 non-custody |
| Service charge / delivery / payment fee (non-merch) | **A** (included when present) | **D** (excluded unless future ADR reclassifies) | Orders freeze / Settlement composition |
| Payment provider fees not charged to guest | **D** | **D** | Payments reconciliation only |

Legend: **A** = affects payable; **B** = affects Revenue Basis; **C** = both; **D** = neither.

Do **not** derive Customer Payable from Reporting Revenue Basis.  
Do **not** implement Promotions / tax formulas in this ADR.

### 6. Unsupported / absent components

Absence of tax, tip, discount, service charge, or other components means:

- those components contribute **nothing** to Customer Payable;
- MVP path may set `customerPayable = merchandiseGross`;
- absence must **not** invent zero tax/tip as if calculated.

Complimentary / zero merchandise economics remain explicit commercial facts on the Order (ADR-0028 / C1.1), not fake Payments.

### 7. Order editing after Settlement open

**Binding:**

```text
OpenSettlement
  → freezes commercial/order economic basis for that Settlement
  → Order commercial content MUST NOT mutate underneath live Settlement
```

While a live (non-aborted, non-terminal-cancelled) SettlementGroup exists:

- Add/Update/Remove OrderLine — **forbidden**
- commercial reaccept/reprice — **forbidden**
- Menu/price/policy changes do not rewrite Settlement Payable Snapshot

**Route back to editing:**

```text
eligible Settlement → AbortSettlement (safe abort only)
  → Order editable again
  → mutate Order
  → explicit commercial reaccept
  → OpenSettlement (fresh payable snapshot)
```

### 8. External-effect boundary (abort vs void/refund)

**Safe abort / cancel Settlement** is allowed only when **no irreversible external effects** exist for that SettlementGroup, including:

- no Payment with a successful/captured/final qualifying provider outcome allocated to its Checks;
- no irreversible provider state that Settlement/Payments treat as completed tender;
- no issued FiscalDocument consuming this Settlement outcome (ADR-0014).

After any such external effect exists:

- do **not** simply delete/reset Settlement;
- future void / refund / compensating Payment history / fiscal correction chains apply (ADR-0013 / ADR-0014 / ADR-0016);
- those paths are **out of scope** for this ADR and for S1.1 unless separately launched.

### 9. SettlementGroup / Check lifecycle (orchestration around ADR-0016)

Reuse ADR-0016 model exactly:

```text
Order
  → SettlementGroup
  → Check(s)
  → CheckLineAllocation
  → PaymentAllocation
```

#### Creation timing

| Event | Effect |
| --- | --- |
| `OpenSettlement` | Creates **one** SettlementGroup for the Order (MVP: one Order ↔ one live SettlementGroup); freezes Settlement Payable Snapshot; creates initial Check set |
| Default MVP | **One Check** covering full SettlementGroup Customer Payable |
| Split | Additional Checks / reallocations may occur **before** irreversible external effects, subject to conservation (§10) |

MVP: multi-Order SettlementGroup **not required** (ADR-0016). Cross-LegalEntity SettlementGroup **forbidden**.

Splitting Checks does **not** physically split the Order.

#### Allowed conceptual states (SettlementGroup)

```text
OPEN / COLLECTING
  → SATISFIED
  → (terminal for payment collection)

OPEN / COLLECTING
  → ABORTED   (only if safe abort — §8)

SATISFIED
  → remains historical; no silent reopen by Menu/policy change
```

Check states mirror outstanding vs covered for that Check’s frozen payable share.

Exact SQL enums are deferred to S1.1; semantics above are binding.

### 10. Payable conservation (split)

**Required invariant:**

```text
SUM(Check.customerPayableMinor) = SettlementGroup.customerPayableMinor
```

same currency, same frozen Settlement Payable Snapshot. No Money creation/loss through split.

**Residual / auto-split rounding:** ADR-0016 does **not** define residual-cent algorithms for Check payable partitions. Therefore ADR-0032:

- requires **exact** conservation;
- rejects partitions that do not sum exactly;
- does **not** invent tax/discount/split residual RoundingPolicy contexts here.

If a future automatic unequal split needs residual assignment, that requires a **named** calculation context / ADR (or an explicit S1.1 STOP) — not silent reuse of `BASE_LIST_LINE_GROSS` (ADR-0030).

CheckLineAllocation conservation for merchandise lines follows ADR-0016 / ADR-0002 money conservation when line-level allocations exist; S1.1 must keep exact minor-unit conservation.

### 11. Payment trigger direction

```text
Settlement / Check
  → requests Payment attempt (via Payments)
Payment
  → records provider lifecycle / outcome (ADR-0013)
Settlement
  → consumes authoritative qualifying PaymentAllocation coverage
```

**Forbidden:**

- Payment directly mutates Order lines or commercial snapshot;
- Payment directly triggers inventory write-off / CompleteOrder;
- provider webhook directly marking Order COMPLETED.

### 12. Payment lifecycle consumption (ADR-0013 terminology)

ADR-0013 freezes non-custody and record types (`TenderDefinition`, `Payment`, `PaymentAllocation`, statuses, external refs). It does **not** invent a second parallel Payment state machine here.

Conceptual outcome classes for Settlement satisfaction:

| Class | Counts toward Settlement satisfaction? |
| --- | --- |
| initiated / pending provider outcome | **No** |
| successful / final **qualifying** provider outcome with PaymentAllocation to Check(s) | **Yes** (allocated amount only) |
| failed / declined | **No** |
| cancelled / voided | **No** (compensating history if previously allocated) |
| duplicate callback / reconciliation | Idempotent — must not double-allocate |

Settlement satisfaction derives from **qualifying allocated coverage**, not from count of Payment objects (ADR-0016).

### 13. Partial / mixed payment

Operational freeze of ADR-0016:

- a Check may receive **multiple** Payment attempts over time;
- mixed tenders allowed (multiple TenderDefinitions);
- failed attempt may be followed by successful attempt;
- retries use idempotency (§20);
- partial allocation leaves Settlement Outstanding > 0 and Check open;
- satisfaction requires coverage of **each** required Check’s frozen payable (MVP: usually one Check).

### 14. Zero-payable path

If `customerPayable == 0` (authoritative frozen snapshot):

- Settlement may become **SATISFIED without** creating a fake zero-value Payment / Tender;
- complimentary / zero merchandise remains Orders commercial fact;
- Checkout may then proceed to fiscal hook observation + CompleteOrder authorization per §§16–17.

### 15. Underpay / overpay / change

| Case | Binding direction |
| --- | --- |
| **Underpayment** | Check / Settlement remains open; Outstanding > 0; not satisfied |
| **Exact coverage** | Allowed for all tenders |
| **Overpayment (card/QR/non-cash)** | **Forbidden** for MVP settlement satisfaction — reject allocation that would exceed outstanding |
| **Cash change / overpay** | **Deferred** — requires future Settlement/Payment cash-change + denomination rounding architecture; **not** invented here |

Customer Payable snapshot must **not** silently round to physical cash denominations (cash rounding out of scope).

### 16. Settlement satisfaction predicate

Deterministic backend predicate (conceptual):

```text
SettlementGroup is SATISFIED iff
  for every required Check:
    SUM(qualifying PaymentAllocation to Check)
      covers Check.customerPayableMinor exactly
  OR customerPayableMinor == 0 (zero-payable path)
```

No frontend satisfaction calculation.  
No provider-specific shortcut that skips PaymentAllocation.  
Pending payments do not satisfy.

### 17. CompleteOrder trigger

```text
Payment outcome
  → updates Payment / PaymentAllocation facts
Settlement becomes SATISFIED
  → Checkout orchestrator evaluates completion prerequisites
Checkout orchestrator
  → CompleteOrder
```

- Payment **must never** directly call CompleteOrder.
- Settlement **does not** redefine CompleteOrder / GoodsIssue semantics (ADR-0025).
- CompleteOrder remains Orders + Inventory orchestration as already Accepted.

### 18. Production CompleteOrder bypass

| Path | Policy |
| --- | --- |
| Production cashier checkout surface (once Settlement capability enabled for that surface) | **Must not** bypass Settlement; CompleteOrder only via Checkout orchestration after satisfaction (+ fiscal prerequisite if required) |
| Domain/internal/test/non-settlement workflows | Raw `CompleteOrder` capability **may remain** for accepted internal uses |
| Enforcement | Application/surface policy + authorization — **not** inventing production Identity in this ADR |

### 19. Fiscalization hook (ADR-0014)

Pipeline reused exactly:

```text
Settlement / business outcome
  → Fiscal Policy evaluation
  → FiscalDocument
  → FiscalSubmission
  → ProviderAdapter
  → provider status
  → Audit
```

ADR-0032 freezes orchestration observation points only:

- Fiscalization **consumes** frozen Order commercial facts + Settlement Payable Snapshot + qualifying Payment/allocation outcomes as required by FiscalPolicy;
- Checkout **observes** fiscal requirement/state from Fiscalization;
- Fiscalization **does not** own Order/Payment/Inventory truth;
- **Do not** hardcode one universal before/after-CompleteOrder ordering here — **FiscalPolicy / JurisdictionProfile** own timing (ADR-0012 / ADR-0014);
- no fiscal SDK inside Orders/Settlement/Checkout;
- no invention of Vietnam statute / tax rates / mandatory provider.

### 20. Fiscal failure / retry

When Settlement is otherwise SATISFIED but a **required** fiscal operation is pending/failed/queued:

- do **not** create duplicate Payment;
- do **not** create duplicate CompleteOrder;
- do **not** create duplicate FiscalDocument;
- retries use ADR-0014 idempotency keys + correction/replacement chains;
- offline may queue fiscal submission without fabricating provider acceptance (ADR-0014 / ADR-0018);
- whether CompleteOrder may proceed while fiscal is queued is **FiscalPolicy-owned**, not redefined here.

### 21. One currency

One settlement/payable currency per current Order flow = Order sales currency.

- No FX;
- No cross-currency Check split;
- No conversion in Checkout.

### 22. Rounding boundaries

| Named context | Owner ADR | Usable for Checkout payable? |
| --- | --- | --- |
| `BASE_LIST_LINE_GROSS` | ADR-0030 | Merchandise gross **only** |
| Tax rounding | future named context | **Not** ADR-0030 |
| Discount allocation residual | ADR-0028 conservation; future named algorithm | **Not** ADR-0030 |
| Split residual | not defined — exact conservation only (§10) | **Not** invented here |
| Cash denomination | future Settlement/Payment | **Out of scope** |
| Tips / service charge | future named context if calculation needed | **Not** invented here |

### 23. Promotions / Loyalty / tips / service fees

- No runtime in this ADR.
- Component ownership reserved in §§4–5.
- Do not combine Promotion with PriceRule (ADR-0008 / ADR-0029).
- Do not treat third-party funding as a generic payable discount without ADR-0028 funding provenance.
- Tips are not merchandise Revenue Basis; Merchandise Gross is not “Amount Due”.

### 24. Idempotency

Same semantic request must not create duplicate economic/external facts:

| Operation | Expectation |
| --- | --- |
| OpenSettlement retry | same Order + same commercial fingerprint → same SettlementGroup or idempotent no-op |
| Create/Split Check retry | semantic key → no duplicate Check Money |
| Payment request retry | Payments idempotency key → one provider attempt semantics |
| Provider callback duplicate | reconcile; no double allocation |
| Satisfaction evaluation retry | pure read of facts; no side-effect Money |
| CompleteOrder orchestration retry | ADR-0025 CompleteOrder idempotency preserved |
| Fiscal orchestration retry | ADR-0014 submission idempotency |

### 25. Concurrency

Must be enforced with transactional / Order-scoped locking (not UI alone):

| Race | Required behavior |
| --- | --- |
| Two terminals OpenSettlement same Order | exactly one live SettlementGroup; other fails explicitly |
| Two terminals pay same Check | allocations serialized; outstanding cannot go negative; over-allocate rejected |
| Concurrent split/update | one writer wins; other fails on stale version |
| Stale payable snapshot | reject operations that do not match frozen snapshot identity |
| Payment callback vs AbortSettlement | abort forbidden once qualifying external effect exists (§8) |
| Duplicate CompleteOrder attempt | idempotent / rejected per ADR-0025 |

### 26. Historical immutability

After Settlement Payable Snapshot freeze (and after CompleteOrder commercial freeze):

later changes to Menu, RoundingPolicy, promotions, tax policy, payment provider configuration **must not** rewrite:

- historical Customer Payable;
- Settlement Outstanding history;
- Revenue Basis;
- allocated payment coverage facts.

Reporting must not recompute historical Customer Payable from current rules.

### 27. Error / failure classes (conceptual)

Future runtime must expose explicit domain/application failures equivalent to:

- commercial terms not accepted / not current
- Settlement already open / incompatible
- payable unavailable
- currency mismatch
- Settlement not payable / not open for collection
- Settlement not satisfied
- payment still pending
- fiscal prerequisite pending (where FiscalPolicy requires)
- stale / concurrent Settlement version conflict
- abort forbidden (external effects exist)
- over-allocation / overpayment rejected

No generic 500 for expected business states.

### 28. Next runtime block

Recommended first implementation after Accept:

```text
S1.1 — Settlement / Checkout Runtime Foundation
```

Expected scope (architecture permission only — **not** this PR):

- SettlementGroup / Check runtime persistence
- frozen Settlement Payable Snapshot
- OpenSettlement + abort (safe path)
- split/check exact conservation
- outstanding / satisfaction calculation
- checkout locking / edit lock
- zero-payable path
- Checkout → CompleteOrder orchestration hook
- production cashier path must not bypass Settlement once enabled

**Explicitly not S1.1 unless separately decided:**

- Payment provider adapters / card-QR integrations
- Fiscal provider adapters
- cash denomination rounding / change
- tax engine
- Promotions / Loyalty runtime
- tips/service-fee product runtime beyond snapshot fields

Payment runtime may follow only after S1.1 proves Settlement ↔ Payment allocation boundary.

---

## Decision matrix (required answers)

| # | Decision | Answer |
| --- | --- | --- |
| 1 | Checkout owner | Application orchestration; no CheckoutOrder aggregate |
| 2 | OpenSettlement preconditions | OPEN + accepted/current commercial + merchandise gross + currency/LE coherent + no incompatible live Settlement |
| 3 | Payable snapshot owner | Orders-coordinated Settlement Payable Snapshot (Settlement facet) |
| 4 | Component model | merchandise / discounts / tax / service / tips / other → customerPayable |
| 5 | Merchandise vs payable | Distinct concepts; MVP numerical equality allowed |
| 6 | Payable vs Revenue | Distinct; ADR-0028 binding; matrix in §5 |
| 7 | Absent components | Contribute nothing; no invented zeros-as-calculated |
| 8 | Edit lock | Live Settlement freezes Order commercial edits |
| 9 | Return to editing | Safe AbortSettlement → mutate → reaccept → new OpenSettlement |
| 10 | Irreversible boundary | Qualifying Payment / irreversible provider / FiscalDocument → no simple abort |
| 11 | SettlementGroup creation | At OpenSettlement; MVP one live group per Order |
| 12 | Check creation | Default one full Check; splits before external effects |
| 13 | Split conservation | Exact SUM(Check)=Group; no invented residual rounding |
| 14 | Payment request ownership | Settlement/Check requests; Payments records |
| 15 | Outcome consumption | Qualifying PaymentAllocation only |
| 16 | Partial payment | Allowed; Outstanding remains |
| 17 | Mixed payment | Allowed; multi tender / multi attempt |
| 18 | Zero payable | Satisfied without fake Payment |
| 19 | Underpayment | Remains open |
| 20 | Overpayment/change | Non-cash overpay forbidden MVP; cash change deferred |
| 21 | Satisfaction | Deterministic coverage predicate |
| 22 | CompleteOrder trigger | Checkout after Settlement satisfied (+ fiscal policy) |
| 23 | Production bypass | Cashier path must not bypass once enabled |
| 24 | Fiscal hook | ADR-0014 pipeline; FiscalPolicy owns timing |
| 25 | Fiscal retry | Idempotent; no duplicate Payment/CompleteOrder/FiscalDocument |
| 26 | One currency | Order sales currency only; no FX |
| 27 | Rounding boundaries | ADR-0030 only for base gross; others named later |
| 28 | Cancellation/abort | Safe abort only; else void/refund/fiscal correction |
| 29 | Idempotency | Semantic keys across OpenSettlement/Pay/Complete/Fiscal |
| 30 | Concurrency | Order/Check transactional locks; no UI-only |
| 31 | Historical behavior | Frozen snapshots immutable to later config |
| 32 | Errors | Explicit commercial/settlement/payment/fiscal classes |
| 33 | Terminology | Merchandise Gross / Customer Payable / Revenue Basis / Outstanding / Allocated |
| 34 | Next runtime | **S1.1** Settlement / Checkout Runtime Foundation |

## Consequences

- Payments implementation must not start from Merchandise Gross alone.
- S1.1 can implement Settlement foundation without inventing Payment providers.
- ADR-0013 / ADR-0014 / ADR-0016 / ADR-0025 / ADR-0028 / ADR-0030 remain uncontradicted.
- Cash change, tax rounding, promo allocation residual, and Check residual auto-split remain explicit future work if needed.

## Alternatives considered

- Collapse Customer Payable into Merchandise Gross alias — **rejected**.
- Derive payable from Revenue Basis / Reporting — **rejected**.
- Payment objects hanging on Order without SettlementGroup/Check — **rejected** (ADR-0016).
- Payment triggers CompleteOrder / inventory — **rejected** (ADR-0025).
- CheckoutOrder aggregate — **rejected**.
- Reuse `BASE_LIST_LINE_GROSS` for tax/cash/split — **rejected** (ADR-0030).
- Require fake zero Payment for zero payable — **rejected**.
- Invent Check residual RoundingPolicy in this ADR — **rejected** (exact conservation until named context exists).
- Hardcode fiscal-before-vs-after-CompleteOrder universally — **rejected** (FiscalPolicy owns timing).
- Implement Payments providers in the same block as this ADR — **rejected**.

## Acceptance criteria (architecture)

This ADR is acceptable only if:

- ADR-0013 / 0014 / 0016 are reused, not contradicted;
- Customer Payable is not an alias for Merchandise Gross;
- Customer Payable is not derived from Revenue Reporting;
- MVP numerical equality gross/payable is representable without semantic coupling;
- OpenSettlement preconditions are exact;
- editing after Settlement open is deterministic;
- payable snapshot is frozen and auditable;
- split preserves payable exactly;
- Payment never mutates Order directly;
- Payment never owns inventory write-off;
- zero-payable path exists;
- partial/mixed payment is unambiguous;
- Settlement satisfaction predicate is deterministic;
- Checkout → CompleteOrder boundary is explicit;
- fiscal hook is explicit without implementing Fiscalization;
- tax/cash/promo rounding are not invented;
- retries/concurrency cannot duplicate economic facts;
- S1.1 can be implemented without new Level C decisions for the foundation scope above.
