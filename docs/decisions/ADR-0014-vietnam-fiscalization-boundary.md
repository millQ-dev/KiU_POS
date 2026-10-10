# ADR-0014: Vietnam Fiscalization Architecture Boundary

- **Status:** Accepted (Architecture v1.3) — **FISC1.1 readiness Delta Accepted** + **Payment Collection Chronology Delta Accepted**
- **Date:** 2026-09-04
- **Accepted (boundary):** 2026-09-12 (PO ACCEPT WITH DELTAS)
- **Delta drafted:** 2026-10-09 (docs only)
- **Accepted (Delta):** 2026-10-10 (PO decision: **ACCEPT** — no additional PO deltas)
- **Accepted (Chronology Delta):** 2026-10-11 (PO decision: **ACCEPT WITH DELTAS** — D + strict A; docs only)
- **Decision owners:** Product Owner and System Architect
- **Related:** Architecture v1.3; ADR-0012, ADR-0013, ADR-0016, ADR-0018; ADR-0032; ADR-0033, ADR-0034, ADR-0037 (Accepted); Tax runtime TAX1.1 (canonical closed); domain-module-map Fiscalization / Payments
- **After Chronology Delta Accept:** binds C0 fiscal business-time SoT for a later explicit FISC1.1 launch (see §D29 / §§D32–D38). This Accept does **not** start FISC1.1 runtime, select a provider, grant LEGAL GATE G2, enable offline fiscal production, DeviceIdentity, CASH tender, multi-payment/split fiscalization, or R1.1.

## Context

Vietnam e-invoice / fiscal compliance is a market P0. Treating fiscalization as “implement later after research” without an architecture boundary invites fiscal logic into Orders/Payments and blocks safe offline design.

**Accepted (2026-09-12):** Fiscalization as a dedicated domain boundary, immutable fiscal documents, provider adapters at the edge, LEGAL GATE G2 for production clearance.

**Why this Delta (2026-10-09 / Accepted 2026-10-10):** TAX1.1 and CASHIER-1 are canonical closed. ADR-0037 froze C0 Tax/Fiscal Level C product rules, but ADR-0014 still lacked binding detail needed to launch FISC1.1 without Fiscalization inventing Tax, Payment/Settlement truth, legal regime, fiscal success, numbering ownership, provider truth, or offline acceptance semantics.

This Delta **refines** ADR-0014. It does **not** reopen ADR-0033 / ADR-0034 / ADR-0037. It does **not** implement runtime. **FISC1.1 remains NOT STARTED** until an explicit implementation launch after this docs merge.

**Document structure:** The next section is the **historically Accepted Decision** (2026-09-12), preserved for honesty. Then the **Accepted Delta** (PO ACCEPT 2026-10-10) — D1–D31. Then the **Accepted Chronology Delta** (PO ACCEPT WITH DELTAS 2026-10-11) — D32–D38, binding D13’s PAYMENT COLLECTION EVENT to Payments-owned evidence.

---

## Decision (Accepted 2026-09-12 — unchanged historical text)

### Dedicated domain boundary

Fiscalization is a **dedicated domain boundary**. Pipeline:

```text
Settlement / business outcome
  → Fiscal Policy evaluation
  → FiscalDocument
  → FiscalSubmission
  → ProviderAdapter
  → Provider response / status
  → Audit
```

### Three layers (do not conflate)

| Layer | Timing |
| --- | --- |
| **Architecture boundary** | **Now** |
| **Provider adapter implementation** (MISA, Viettel, …) | Later |
| **Legal production clearance** | **LEGAL GATE G2** (separate) |

### Concepts owned by Fiscalization module

- `FiscalPolicy` (jurisdiction-bound, versioned)
- `FiscalSeries`
- `FiscalDocument`
- `FiscalSubmission`
- Correction / cancellation / replacement chains (compensating fiscal documents — not silent edit)
- Provider adapter **interface**
- Idempotency keys and reconciliation against provider/status

### What Fiscalization does NOT own

Fiscalization does **not** own:

- Order truth;
- Payment truth;
- Inventory truth.

It consumes settlement / payment outcomes and emits fiscal documents and submissions.

### Order ≠ FiscalDocument

- **Order ≠ FiscalDocument.**
- Cardinality must support: split settlement; partial settlement; corrections; refunds / reversals; **multiple** fiscal documents where policy requires.

### Immutability and corrections

- Fiscal documents are **immutable historical records**.
- Corrections create **explicit correction / replacement chains**.
- Do **not** mutate prior accepted fiscal history in place.

### Provider adapters

- Provider adapters are **capability-specific and replaceable** (ADR-0012).
- **No** provider SDK logic inside Orders or Settlement.

### Offline

- Business operation may complete according to offline policy.
- Fiscal submission may **queue**.
- System must distinguish statuses such as: **PENDING / QUEUED / SUBMITTED / ACCEPTED / REJECTED** (and equivalents as appropriate).
- **Never fabricate** provider acceptance while offline (aligns with ADR-0018 / offline-foundation).

### Jurisdiction / policy versioning

- **JurisdictionProfile** determines the applicable fiscal policy / version (ADR-0012).
- Historical fiscal behavior must remain traceable to the policy / version **effective at the relevant business time**.

### Legal gate

- Architecture acceptance is **NOT** legal approval.
- Specific Vietnam document types, required fields, deadlines, correction rules, and providers remain **LEGAL GATE** items.
- Do **not** invent Vietnam statute text, tax rates, or mandatory provider choice in this ADR.

### Consequences (Accepted)

- Settlement (ADR-0016) maps Checks / settlement outcomes to fiscal documents without embedding provider SDKs.
- Architecture acceptance ≠ permission to go live fiscally in Vietnam.

### Alternatives considered (Accepted)

- Defer entire fiscal topic until provider chosen — rejected (boundary now).
- Fiscal fields on Order row as SoT — rejected.
- Mutating accepted fiscal history in place — rejected.
- Provider SDK inside Orders/Settlement — rejected.
- Fabricating offline provider acceptance — rejected.

---

## Accepted Delta (FISC1.1 readiness) — PO ACCEPT 2026-10-10

**Status of §§D1–D31:** **Accepted** (PO decision: ACCEPT; no additional PO deltas). Binding for architecture/contracts. Does **not** by itself implement FISC1.1 runtime, provider adapter, or LEGAL GATE G2 clearance.

**Overlay note (Accepted elsewhere, not invented here):** ADR-0037 already Accepted C0 online-only CompleteOrder fail-closed, Tax-before-payable, mode-neutral `SATISFIED`, Vietnam → `NOT_REQUIRED` forbidden, and provider-neutral adapter minimums. This Delta places those Fiscal-side rules into ADR-0014 for a single Fiscalization boundary SoT. It does **not** delete the Accepted Offline architectural discipline above; it **narrows C0 production CompleteOrder** (see D15).

### D1. Tax snapshot consumption — binding

```text
Fiscalization NEVER calculates VAT.
Fiscalization NEVER invents Tax facts.
```

Canonical dependency (aligns ADR-0037):

```text
Commercial facts
  → Tax resolution / calculation
  → TaxOrderSnapshot / TaxLineSnapshot (frozen)
  → final payable / Settlement
  → Payment coverage
  → Fiscalization
  → FiscalCheckoutGate
  → CompleteOrder
```

For tax-required transactions (`LegalEntity.tax_required = TRUE` per TAX1.1; `NULL` undecided fails closed at Settlement and must not be treated as non-required by Fiscalization), FiscalDocument construction **must** consume the authoritative frozen `TaxOrderSnapshot` / `TaxLineSnapshot` already coupled to the accepted commercial fingerprint for that Order (same snapshot identity Settlement consumed when tax-required).

**Forbidden:**

- resolve TaxPolicy again during fiscal issue;
- recalculate VAT;
- infer VAT from gross/payable;
- infer rate from item/category name;
- default missing Tax to zero;
- replace a stale Tax snapshot with current policy automatically.

If the required snapshot is **missing**, **stale**, **ambiguous**, or **incompatible** with current accepted commercial facts → Fiscalization **fails closed**.

Settlement continues to **never** recalculate Tax (`SettlementTaxCalculator` forbidden — ADR-0037).

### D2. Tax snapshot history / provenance

Issued FiscalDocument must retain references/provenance sufficient to establish **which frozen Tax snapshot** supplied issued fiscal Tax facts.

Issued FiscalDocument must remain historically explainable after TaxPolicy, classification, price, catalog, or LegalEntity config changes.

Fiscal correction/replacement references original frozen fiscal **and** Tax evidence per correction semantics. Do **not** re-resolve current Tax for historical issued document truth.

### D3. FiscalPolicy ownership and resolution

`FiscalPolicy` is **Fiscalization-owned**, versioned / effective-dated, bound through authoritative LegalEntity + jurisdiction configuration.

LegalEntity is **not** the fiscal algorithm.

Conceptual resolution:

```text
Order / Settlement
  → Tenant
  → LegalEntity
  → JurisdictionProfile (policy refs — ADR-0012)
  → effective FiscalPolicy
  → FiscalDocumentMode + FiscalSatisfactionEvidenceProfile + requirements
```

Client **cannot** choose authoritative: FiscalPolicy, FiscalDocumentMode, invoice regime, or `SATISFIED` via request fields.

### D4. FiscalDocumentMode (provider-neutral)

First-class provider-neutral mode vocabulary. Minimum conceptual modes:

| Domain mode (stable) | Vietnam label (documentation only) |
| --- | --- |
| `CODED_E_INVOICE` | hóa đơn điện tử có mã |
| `NON_CODED_E_INVOICE` | hóa đơn điện tử không mã |
| `CASH_REGISTER_E_INVOICE` | hóa đơn điện tử khởi tạo từ máy tính tiền |

```text
restaurant category ≠ hard-coded CASH_REGISTER_E_INVOICE
```

LegalEntity / FiscalPolicy configuration decides registered mode. C0 product preference may remain cash-register e-invoice (ADR-0037) — it is **not** the only legal regime.

### D5. Invoice / document type ownership

Fiscalization owns an explicit fiscal document type/profile required for issuance.

Do **not** infer type from frontend or arbitrary order category.

VAT invoice vs sales invoice (and similar) mapping, where it depends on taxpayer method / legal configuration, is represented as **FiscalPolicy / legal profile configuration**, not hard-coded category logic.

Where exact Vietnam mapping is not verified in project research:

```text
LEGAL / ONBOARDING CONFIGURATION
```

Do not claim unmapped legal equivalences.

### D6. Mode-neutral FiscalCheckoutGate `SATISFIED`

Preserve existing business gate vocabulary unless a necessary delta is demonstrated.

```text
SATISFIED is MODE-NEUTRAL.
```

Meaning: the effective FiscalPolicy has the authoritative evidence required for its configured regime. Do **not** create `SATISFIED_MTT` / `SATISFIED_CODED` / `SATISFIED_NON_CODED` checkout states. Provider/mode-specific evidence stays inside Fiscalization.

### D7. `NOT_REQUIRED` — fail-closed rules

```text
Vietnam restaurant/cafe category MUST NOT automatically map to NOT_REQUIRED.
```

Forbidden shortcut: Vietnam F&B → `NOT_REQUIRED`.

`NOT_REQUIRED` only when authoritative FiscalPolicy **explicitly** determines no fiscal document is required for that transaction under supported legal configuration.

`NOT_REQUIRED` is **never** a fallback for: missing provider, missing configuration, provider outage, unsupported regime, unknown legal answer, or implementation not ready.

Unknown/missing config → **fail closed** (typically `UNAVAILABLE` / failed prerequisite — not silent `NOT_REQUIRED`).

### D8. FiscalSatisfactionEvidenceProfile

Explicit concept **owned and versioned by FiscalPolicy** (Fiscalization module; not a second policy SoT).

Purpose: determine what authoritative evidence is sufficient to set FiscalCheckoutGate to `SATISFIED` for a configured regime.

Possible evidence **classes** (conceptual — not legal sufficiency claims):

- authority accepted / code returned;
- provider-confirmed issued document;
- authoritative retrieval/status evidence;
- other legally valid registered-mode evidence.

Exact which evidence is legally sufficient remains:

```text
FISC1.1 / PROVIDER / COUNSEL DECISION
LEGAL_UNKNOWN / PROVIDER_UNKNOWN where unsupported by existing evidence
```

Architecture freezes profiles as **configurable/versioned and fail-closed**. Do not invent legal sufficiency.

### D9. Provider-neutral adapter contract

Minimum `FiscalProviderAdapter` capabilities (no vendor selection):

```text
issue
queryStatus
retrieveEvidence
retrieveCustomerDelivery / lookup data where applicable
idempotentRetry
reconcileTimeoutAfterSuccess
adjust / correct
replace
webhook and/or polling input
```

Provider implementation remains **OUT**. No MISA/Viettel/VNPT/provider-specific DTO enters Fiscal Core domain model. Provider DTO/status is **evidence/input**, never economic source-of-truth.

### D10. Separate document / attempt / outcome / gate

Distinguish clearly:

| Concept | Role |
| --- | --- |
| FiscalDocument | Business fiscal document / issued facts (+ Tax provenance); immutable once issued |
| FiscalSubmission / ProviderAttempt | Transport / attempt lifecycle |
| ProviderOutcome / evidence | Provider/authority response evidence — **append-only** once recorded |
| FiscalCheckoutGate result | Checkout-consumed satisfaction mapping |

A browser success message or transport HTTP 200 is **not** fiscal satisfaction.

Timeout is **not** definitive failure if the provider may have processed the request — see D12.

Unknown result must remain explicit.

Never retry `issue` blindly after timeout without idempotency / inquiry strategy.

### D11. Idempotency

```text
same fiscal business intent
+ same semantic document
+ same idempotency identity
  → safe retry / one legal issuance effect

same key + changed fiscal semantics/document
  → conflict
```

Adapter must support or emulate safe issue → inquiry / reconcile. No duplicate legal invoice due to network retry. Exact provider mechanism remains adapter-specific.

### D12. Timeout-after-success

When KiU sends issue, provider issues, network response is lost, KiU sees timeout:

- do **not** create a second document automatically;
- use status inquiry/reconciliation via stable provider/idempotency identity;
- until truth is recovered, FiscalCheckoutGate must **not** fabricate `SATISFIED`;
- no destructive overwrite of original attempt/evidence.

### D13. C0 issuance timing (preserve ADR-0037)

For **COUNTER-SERVICE / PREPAY CAFE** only:

```text
relevant fiscal business trigger = PAYMENT COLLECTION EVENT
fiscal business time ≠ DB created_at
```

Do **not** generalize to restaurant dine-in, post-pay table service, deposit flows, or unfrozen split-settlement edges. Those remain future Level C / legal work.

**Field binding for FISC1.1:** see **Accepted Chronology Delta** §§D32–D38 (PO ACCEPT WITH DELTAS 2026-10-11). D13 remains the product trigger; D32+ define which Payments evidence is authoritative.

### D14. Payment collected + fiscal failure

For C0:

Payment may be authoritatively recorded/covered while Fiscal requirement remains unsatisfied.

In that state:

- Payment evidence stays immutable;
- do **not** delete / fake / reverse Payment automatically;
- CompleteOrder stays blocked;
- fiscal retry / reconciliation is required;
- operator/client UI may show recovery-required state.

Do **not** invent a legal grace period. Do **not** claim customer may leave / service may complete while fiscal queued unless supported by legal counsel.

Lawful delayed transmission remains **LEGAL_UNKNOWN** until counsel/provider confirmation.

### D15. Online-only C0 vs Accepted Offline architecture

**Accepted Offline (above) remains:** business *may* complete according to offline policy; fiscal *may* queue; never fabricate provider acceptance (ADR-0018).

**C0 production CompleteOrder policy (ADR-0037 Accepted + this Accepted Delta confirmation):**

```text
ONLINE-ONLY
```

No production offline fiscal completion for C0. No default `ALLOW_COMPLETE_WITH_FISCAL_PENDING`.

No provider connectivity / no required authoritative evidence → gate not `SATISFIED` → CompleteOrder blocked.

Future offline production CompleteOrder behavior requires separate Level C + legal evidence. ADR-0032 §20 “whether CompleteOrder may proceed while fiscal queued is FiscalPolicy-owned” remains true generally; **C0 FiscalPolicy must not authorize** CompleteOrder with fiscal pending.

### D16. Terminal / cash-register context ownership

Organization owns: Tenant, LegalEntity, Outlet, Terminal.

Fiscalization may own fiscal registration/binding facts that map operational Terminal / Outlet / LegalEntity to a registered fiscal / cash-register identity.

Do **not** redefine Terminal inside Fiscalization. Do **not** introduce `DeviceIdentity = Terminal`. Do **not** start DeviceIdentity runtime.

If a provider/tax authority requires a cash-register/device registration ID: model as Fiscalization-owned **binding/reference** to Organization entities — not a second Terminal SoT. Exact provider registration fields remain provider implementation.

### D17. Seller identity

Seller source: LegalEntity + authoritative fiscal registration/configuration.

Fiscalization consumes seller identity / fiscal registration facts. Caller cannot author authoritative: seller name, tax code/MST, seller address, LegalEntityId.

Where LegalEntity master data is incomplete for production legal fields: record **IMPLEMENTATION / CONFIGURATION gap**. Do not duplicate LegalEntity master SoT in Fiscalization.

FiscalDocument is scoped to authoritative `tenant_id` + `legal_entity_id`; cross-tenant / cross-LegalEntity issue or read is forbidden.

### D18. Buyer fiscal information

Preserve ADR-0037: normal consumer flow may omit buyer fiscal details; there must be a requested-invoice path to provide them where required. No CRM in this ADR.

Buyer fiscal snapshot belongs to fiscal document input/evidence when supplied, with provenance and historical freeze. Exact C0 capture runtime may remain FISC1.1 scope.

### D19. Fiscal numbering ownership

Separate:

| Identity | Owner |
| --- | --- |
| KiU internal FiscalDocumentId | Fiscalization |
| Configured series/symbol metadata | Fiscalization (`FiscalSeries` config/reference) |
| Provider/authority legal invoice number/code | Provider/authority evidence — **not manufactured locally** |

Do **not** assume KiU owns the legally authoritative sequential invoice number when provider/tax authority owns/assigns it. Never manufacture an authority-issued number locally. Exact regime/provider numbering rules: configuration / provider / legal scope.

### D20. Correction / replacement boundary

Issued FiscalDocument facts are never ordinary-updated.

Correction / replacement / adjustment:

- create explicit new fiscal action/document/evidence;
- reference original document;
- preserve chain;
- use provider adapter capability;
- remain idempotent/reconcilable.

Do **not** define full refund runtime or correction UX in this Delta.

Exact Vietnam adjustment vs replacement mandatory choice where legally unclear: **LEGAL_UNKNOWN** / provider+counsel.

### D21. Delivery ≠ issuance

Printing, PDF rendering, QR presentation, email/send-to-customer, receipt UI ≠ legal fiscal issuance / authoritative fiscal acceptance.

A rendered receipt **never** sets FiscalCheckoutGate `SATISFIED`.

CashShift / Receipt ≠ Fiscal e-invoice (ADR-0037).

### D22. State model — separate lifecycles

Do **not** overload one enum with: business document lifecycle, transport attempt lifecycle, provider outcome, and checkout satisfaction.

Prefer separate concepts:

| Lifecycle | Example provider-neutral states (illustrative) |
| --- | --- |
| FiscalDocument | created/intended → issued-with-evidence → corrected/replaced (chain) |
| Submission / Attempt | pending → attempted → unknown-after-timeout → terminal outcome linked |
| ProviderOutcome | accepted/issued evidence · rejected · unknown · reconciled |
| FiscalCheckoutGate | see D23 |

Original Accepted `PENDING / QUEUED / SUBMITTED / ACCEPTED / REJECTED` may map onto Submission/Outcome — not onto Checkout gate and not onto Payment success.

### D23. FiscalCheckoutGate mapping

**Owner:** Fiscalization computes/provides fiscal gate evidence/result.  
**Consumer:** CheckoutOrchestrator.  
Orders / Settlement / Payment do **not** manufacture gate state.

Preserve fail-closed meaning for existing runtime vocabulary, including at least:

```text
NOT_REQUIRED
PENDING
SATISFIED
REQUIRED_NOT_SATISFIED
FAILED_*
UNAVAILABLE
```

(Production today remains `UNAVAILABLE` until FISC1.1 — honest fail-closed.)

Do not change public/runtime enum unless required by Accepted architecture after FISC1.1 design. Document mapping from internal evidence → gate state in FISC1.1.

Client assertions such as `fiscalAccepted=true` / `fiscalNotRequired=true` must **never** authorize completion.

### D24. CompleteOrder

CompleteOrder does not calculate Fiscal truth. Checkout orchestration requires authoritative FiscalCheckoutGate outcome.

For fiscally required C0: only `SATISFIED` permits progression through the fiscal gate. Payment success alone is insufficient.

### D25. Tax mixed PricingTaxMode

TAX1.1 permits line-level mixed `PricingTaxMode` with truthful Tax snapshot representation.

Fiscalization must consume line-level frozen facts without forcing a homogeneous envelope lie.

If a provider representation cannot support a valid Tax snapshot → fail closed / provider capability error. Do not recalculate or flatten Tax semantics to ease provider DTOs.

### D26. Legal / provider unknowns — preserve

Do **not** fabricate answers to:

| Topic | Label |
| --- | --- |
| Exact offline/connectivity transmission window | LEGAL_UNKNOWN |
| Whether customer may leave before delayed transmission | LEGAL_UNKNOWN |
| Restaurant dine-in / post-pay timing | LEGAL_UNKNOWN (future Level C) |
| Mandatory adjustment vs replacement in all cases | LEGAL_UNKNOWN |
| Exact multi-outlet / business-location codes | LEGAL_UNKNOWN |
| Exact SATISFIED evidence per regime | PROVIDER_UNKNOWN / LEGAL_UNKNOWN |
| Provider signing / certification mechanism | PROVIDER_UNKNOWN |
| Provider webhook vs polling behavior | PROVIDER_UNKNOWN |
| Who holds signing key / HSM / token | PROVIDER_UNKNOWN / IMPLEMENTATION_UNKNOWN |

### D27. Provider / signing security boundary

Fiscal Core does not expose provider credentials to client.

Signing key/token/HSM ownership is adapter/deployment/provider specific.

No secrets in: FiscalDocument, browser, logs, audit payload, webhook URL query parameters.

Inbound provider callbacks **and** polling / status-retrieval channels that become authoritative evidence must later require cryptographic/provider authentication + replay protection. **Do not implement in this docs task.**

### D28. Security threat model required for future FISC1.1

FISC1.1 must obtain independent security review covering at least:

- client-forged `SATISFIED` / fake `NOT_REQUIRED`;
- stale/wrong Tax snapshot;
- cross-tenant FiscalDocument / cross-LegalEntity fiscal issue;
- seller MST/identity injection; amount/tax mutation;
- provider outcome forgery; webhook signature bypass; callback replay;
- issue replay / duplicate legal invoice; idempotency semantic collision;
- timeout-after-success duplicate issue; provider reference collision;
- evidence mutation/deletion; correction-chain tampering;
- secret/signing-key leakage; DEV simulator production exposure;
- reconciliation poisoning; operator force-`SATISFIED`.

CRITICAL/HIGH and financial-integrity MEDIUM must **block** FISC1.1 merge.

### D29. Scope of FISC1.1 enabled by this Accepted Delta (explicit launch still required)

Narrow FISC1.1 Core only (still requires a separate FISC1.1 implementation authorization):

- FiscalPolicy resolution;
- FiscalDocument foundation;
- consume frozen Tax snapshot;
- create fiscal intent/document;
- provider-neutral submission port;
- immutable provider evidence/outcome;
- idempotent issuance;
- timeout reconciliation;
- FiscalCheckoutGate mapping;
- current C0 online-only flow.

**Does not automatically enable:** real provider adapter; Vietnam production go-live; offline fiscal completion; restaurant dine-in/post-pay; refund runtime; correction UX; DeviceIdentity; CASH tender; Floor/Table.

### D30. LEGAL GATE G2

Preserved: Architecture acceptance ≠ legal production clearance. Provider certification/onboarding and counsel confirmation remain separate. This Delta Accept ≠ Vietnam fiscal go-live.

### D31. Relationship to ADR-0037

This Delta **implements architecturally** the Fiscal side of ADR-0037 Accepted rules inside ADR-0014 so FISC1.1 has a single Fiscalization boundary SoT. ADR-0037 remains Accepted product Level C; do not reopen it.

### Accepted Delta consequences

- Tax (ADR-0033 / TAX1.1) remains SoT for VAT facts; Fiscalization consumes snapshots only.
- Checkout (ADR-0032) observes FiscalCheckoutGate; does not invent fiscal truth.
- Accepted Offline architectural queue + never-fabricate remains; C0 production CompleteOrder stays online-only fail-closed.
- After docs merge of this Accepted Delta: **do not start FISC1.1** until an explicit FISC1.1 implementation launch; **do not create fiscal migrations/tables** in this docs PR; **LEGAL GATE G2** still required for Vietnam fiscal go-live.

### Accepted Delta alternatives considered

- Separate competing Fiscalization ADR — rejected unless governance requires; this is an ADR-0014 Delta.
- Fold Delta concepts into “Accepted unchanged core” before PO Accept — rejected (honesty).
- Delete Accepted Offline solely into C0 online-only — rejected; both layers retained.
- Invent legal grace period / offline CompleteOrder default for C0 — rejected.
- Recalculate Tax inside Fiscalization — rejected.
- Hard-code MTT as only regime — rejected.
- Vietnam restaurant → `NOT_REQUIRED` — rejected (ADR-0037).

---

## Accepted Chronology Delta (PO ACCEPT WITH DELTAS 2026-10-11)

**Status of §§D32–D38:** **Accepted** (PO decision: **ACCEPT WITH DELTAS**). Docs only. Does **not** implement FISC1.1 runtime, `PaymentCollectionEvent` tables, provider adapters, CASH tender, or LEGAL GATE G2.

**Problem closed:** D13 / ADR-0037 LC-08 named PAYMENT COLLECTION EVENT but did not bind a trustworthy clock. Runtime candidates (`provider_occurred_at`, `received_at`, `satisfied_at`, `payment.created_at`, DB `NOW()`) have different meanings. FISC1.1 must not invent chronology via technical default.

### D32. Payments-owned immutable `PaymentCollectionEvent`

Payments owns an immutable **`PaymentCollectionEvent`** (conceptual SoT; runtime in FISC1.1 / Payments follow-on — not this docs PR).

Minimum facts:

- authoritative **`collected_at`** (fiscal business time for C0 issuance);
- immutable reference to the Payment evidence that proved actual **collection** (not authorization-only, not operation-create);
- tenant / LegalEntity / Payment / SettlementCheck binding required for FISC1.1 C0.

Fiscalization **consumes** `PaymentCollectionEvent`; it does **not** invent Payment truth, does **not** overwrite `collected_at`, and does **not** treat provider fiscal ACK time as collection time.

Fiscal document **issuance / submission / provider response** times are separate clocks and must not replace `collected_at`.

### D33. Strict source for electronic provider tenders (D + strict A)

For C0 electronic provider tenders in FISC1.1:

```text
PaymentCollectionEvent.collected_at
  = payment_provider_outcome.provider_occurred_at
    of the VERIFIED SUCCEEDED outcome that proves ACTUAL PAYMENT COLLECTION
```

Adapter / evidence contract must affirm that `provider_occurred_at` is **collection** time, not authorization time and not provider operation-create time. If the adapter cannot affirm collection semantics → **do not** create `PaymentCollectionEvent` → fiscalization fail closed.

### D34. Forbidden clocks (no fallback)

Do **not** use as fiscal `collected_at` / PAYMENT COLLECTION EVENT time:

| Forbidden | Why |
| --- | --- |
| `payment_provider_outcome.received_at` | MillQ ingest / “when KiU learned” — not when money was collected |
| `settlement_group.satisfied_at` | Settlement coverage-complete orchestration time — not collection |
| `payment.created_at` | Request create; already forbidden by D13 / LC-08 |
| `payment.updated_at` / bare DB `NOW()` at SUCCESS write | Technical state-transition clock |
| Fiscal submission / provider ACK / document issue wall clock | Delivery/issuance ≠ collection |

**No fallback chain** to `received_at` or `satisfied_at`. Missing trustworthy collection time ⇒ **fail closed** (D35).

### D35. Missing trustworthy collection time — fail closed

If no immutable `PaymentCollectionEvent` with trustworthy `collected_at` exists for the fiscally required C0 intent:

- do **not** create / issue FiscalDocument;
- FiscalCheckoutGate must **not** become `SATISFIED`;
- CompleteOrder remains blocked;
- do **not** fabricate `collected_at` from ingest or Settlement clocks.

### D36. FISC1.1 C0 shape — one Payment, one Check

FISC1.1 supports only:

```text
exactly one Payment
+ exactly one SettlementCheck
+ that Check fully covered by that Payment’s qualifying VERIFIED SUCCESS allocation
+ PaymentCollectionEvent present for that Payment
```

Multi-payment, split Checks, partial coverage, or ambiguous collection evidence ⇒ **explicit blocked fiscal state** (not `NOT_REQUIRED`, not silent `SATISFIED`). Out of FISC1.1 scope; future Level C.

### D37. CASH tender is not provider-time

`provider_occurred_at` / electronic-provider collection evidence is **not** a universal rule for CASH.

CASH requires a **separate** Accepted confirmed cash-receipt / drawer collection event before CASH may drive fiscal `collected_at`. Until that event exists and is Accepted:

- CASH tender fiscalization remains **out of FISC1.1**;
- do not pretend card/provider chronology applies to cash.

### D38. Relationship to D13 / ADR-0013 / FISC1.1 launch

- D13 product trigger unchanged: PAYMENT COLLECTION EVENT.
- ADR-0013 records Payments ownership of `PaymentCollectionEvent` (companion delta).
- This Chronology Delta **enables** FISC1.1 design to bind fiscal business time honestly; it does **not** by itself launch FISC1.1, create migration `032`, or select a provider.

### Accepted Chronology Delta consequences

- Historical financial fact for C0 invoice time = Payments `PaymentCollectionEvent.collected_at` from affirmed collection evidence.
- KiU learning lag (`received_at`) and Settlement satisfaction lag (`satisfied_at`) stay observable but non-authoritative for fiscal business time.
- Split / multi-tender / CASH fiscalization remain blocked until further Accepted Level C.

### Accepted Chronology Delta alternatives considered

- Fallback `provider_occurred_at` → `received_at` → fail closed — **rejected** by PO (ingest ≠ collection).
- Use `settlement_group.satisfied_at` as fiscal business time — **rejected** (coverage orchestration ≠ collection).
- Use `payment.created_at` / DB `NOW()` — **rejected** (D13 / LC-08).
- Universalize provider collection time to CASH — **rejected** (needs own cash-receipt event).
- Support multi-payment/split in FISC1.1 — **rejected** (explicit blocked; later Level C).
