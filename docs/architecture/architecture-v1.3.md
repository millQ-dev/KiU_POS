# MillQ Architecture v1.3

- **Status:** Proposed for acceptance (alignment after Block C merge + competitive/migration gap-analysis)
- **Date:** 2026-09-04
- **Canonical host:** Cursor Origin
- **Base:** Architecture [v1.2](architecture-v1.2.md) (Accepted) + Block C merged @ `a5e84b0` / main tip at alignment start `46f01ec`
- **Related ADRs:** ADR-0001…0004, 0006…0025 (Accepted)
- **Module map:** [`domain-module-map.md`](domain-module-map.md)
- **Authority command:** KiU correcting command after gap-analysis (PO / strategic architecture); PO ACCEPT ADR-0022 / ADR-0023 / ADR-0024 (2026-09-12)

## 1. Purpose

Architecture v1.3 **extends** v1.2 with boundaries that must be frozen **before** further application verticals (POS, FloorPlan, Migration adapters, fiscal providers, Grab/Shopee, Recipes/Sale write-off).

```text
v1.2 domain boundaries (Accepted)
        +
v1.3 deltas (this document + ADR-0011…0025 Accepted)
        =
Architecture v1.3 baseline for resumed implementation
```

**Does not** restart Block C. Block C remains the first completed goods-receipt vertical and is **v1.3-compatible** (audit below).

**Does not** start Block D or any new product vertical in the alignment PR.

## 2. Current factual state

| Item | State |
| --- | --- |
| Origin main tip | `8844ccb` (ADR-0025 Accept PR #30) |
| Architecture v1.3 merge | `77c6949` (PR #9) |
| Block C | **Merged** (PR #7 → `a5e84b0`) and **v1.3-compatible** |
| Architecture v1.3 alignment | **Merged** (PR #9 → `77c6949`) |
| ADR-0012 / ADR-0013 | **Accepted** (PR #11 → `cf3375f`) |
| ADR-0015 / ADR-0019 | **Accepted** (PR #13 → `4510092`) |
| ADR-0014 / ADR-0016 | **Accepted** (PR #15 → `f764599`) |
| ADR-0018 | **Accepted** (PR #17 → `be58388`) |
| ADR-0017 | **Accepted** (PR #19 → `1f683dc`) |
| ADR-0011 | **Accepted** (PR #21 → `cf5398a`) |
| ADR-0022 / ADR-0023 / ADR-0024 | **Accepted** (PR #23 → `3590147`) |
| Block D1.1 Recipes & Preparations foundation | **Merged** (PR #25 → `3ff79a2`) |
| Block D1.2A ProductionBatch domain foundation | **Merged** (PR #27 → `4546dbe`) |
| Block D1.2B Production posting / inventory / costing | **Merged** (PR #29 → `57499df`) |
| ADR-0025 Order Completion & Sale Inventory Write-off | **Accepted / Merged** (PR #30 → `8844ccb`) |
| D1.3A / D1.3B / Food Cost | **STOP** until explicit PO launch per block |

**Do not** describe Block C as the next vertical. After ADR-0025 Accept, the next candidate is:

```text
D1.3A Orders Foundation & Consumption Plan
  → D1.3B GoodsIssue & Automatic Sale Write-off
  → Food Cost
```

(only when PO launches each block — not automatic).

## 3. Non-negotiable foundation (unchanged from v1.2)

Modular monolith; TypeScript monorepo; Origin SoT; ADR-0002/0003 measurement & costing; ADR-0006 Intelligence read-side; `operational_fact_feed` = mirror not ledger; ADR-0010 document posting.

## 4. v1.3 deltas (summary)

| Contour | Decision pointer |
| --- | --- |
| Migration Core + Canonical + Mapping + Historical policy | ADR-0011 (**Accepted**) |
| JurisdictionProfile ≠ provider adapters | ADR-0012 (**Accepted**) |
| Payment non-custody (no merchant/customer funds) | ADR-0013 (**Accepted**) |
| Vietnam fiscalization architecture boundary now | ADR-0014 (**Accepted**) |
| PII Vault, VN-primary residency, egress gate, MillQ LLC boundary | ADR-0015 (**Accepted**) |
| Order Settlement / Split Bill | ADR-0016 (**Accepted**) |
| FloorPlan / Table Engine | ADR-0017 (**Accepted**) |
| Offline multi-platform client runtime | ADR-0018 (**Accepted**) |
| Economic facts / contribution margin / channel profit | ADR-0019 (**Accepted**) |
| Security Control Plane / GovernmentRequestCase | ADR-0015 §Security (**Accepted**) |
| Production Intelligence Execution / ModelGateway | ADR-0020 (does **not** supersede ADR-0006) |
| Voice & Multilingual Interaction | ADR-0021 |
| Professional Account / Cross-Business Access | ADR-0022 (**Accepted**) |
| Workforce / Recruiting / Learning / Assessment | ADR-0023 (**Accepted**) |
| Allergen & Dietary Constraint Resolution | ADR-0024 (**Accepted**) |

Detailed module ownership: [`domain-module-map.md`](domain-module-map.md).

## 5. Organization / packages / catalog (v1.2 retained)

- Network-first Tenant; LegalEntity fiscal/legal — not menu spine.
- `PackageEntitlement` + `OutletCapabilityConfig` — no package forks.
- CatalogItem + profiles; Catalog ≠ Menu ≠ POS Layout ≠ Channel Menu.
- Units / ItemUnitConversion / SupplierPack; SupplierItem (ADR-0009).
- Recipe graph + ConsumptionStrategy (ADR-0003); no double write-off.
- CostQuote / certainty; no `product.cost`.
- SalesContext + specialized resolvers; Pricing ≠ Promotions ≠ Loyalty.
- Order independent of Table.
- Production routing versioned.
- Typed inventory documents + InventoryCountSession (ADR-0010).
- Workforce PersonalShift ≠ CashShift.
- TenderDefinition + payment lifecycle (plus ADR-0013 non-custody).
- Event taxonomy DOMAIN / AUDIT / INTEGRATION / TELEMETRY.
- Audit / provenance (actor vs authorizer).

## 6. Settlement / Split Bill (new)

**Order ≠ Settlement** (ADR-0016 **Accepted**).

```text
Order → SettlementGroup → Check(s) → CheckLineAllocation → PaymentAllocation
```

Supports: split bill, partial payment, mixed tenders, multiple payments, multiple Checks per Order. Settlement completion = allocated valid payment coverage (not mere payment-record presence). Provider outcome ≠ allocation. Deposits/prepayments referenceable/allocatable without MillQ wallet (ADR-0013). Tips separate from principal; no custody; tax via JurisdictionProfile. Refunds = compensating history. One SettlementGroup must not span LegalEntities. Combined orders within one LE optional later (not MVP). Fiscalization consumes settlement via ADR-0014 — no fiscal SDK in Settlement.

## 7. FloorPlan / Table Engine (new)

ADR-0017 **Accepted**: Order does **not** require Table; Floor/Table is optional capability (Corner OFF / Cafe optional / Restaurant enabled — not product forks).

```text
RestaurantLocation → DiningArea → FloorPlanVersion → Table
Runtime: TableRuntimeState; Floor/Table-owned optional TableAssignment (refs OrderId); optional TableCombination
```

- Floor plans versioned; no silent rewrite of historical table/plan context.
- TableRuntimeState is operational only — not settlement/inventory SoT.
- Assignment/move is explicit + auditable (Floor/Table owns TableAssignment; Orders does not); multiple Orders/Checks per table allowed.
- Combinations must not destroy Table identities; do not force `Order.table_id` as sole model.
- Reservations out of scope. Offline per ADR-0018. Not coupled to ProductionRoute.
- Accept = boundaries only (no floor editor / POS / reservation product).

See ADR-0017.

## 8. Fiscalization (architecture now ≠ provider later ≠ legal G2)

Dedicated Fiscalization boundary (ADR-0014 **Accepted**):

```text
Settlement / business outcome → Fiscal Policy evaluation → FiscalDocument
  → FiscalSubmission → ProviderAdapter → provider status → Audit
```

| Layer | Timing |
| --- | --- |
| Architecture boundary (FiscalPolicy, FiscalSeries, FiscalDocument, FiscalSubmission, correction chains, idempotency, reconciliation, provider adapter **interface**) | **Now** (Accepted) |
| Concrete MISA/Viettel/… adapter | Later |
| Legal production clearance | **LEGAL GATE G2** — separate from architecture acceptance |

- Does **not** own Order / Payment / Inventory truth. Order ≠ FiscalDocument; cardinality supports split/partial/corrections/refunds/multi-doc.
- Fiscal documents immutable; corrections = explicit chains.
- Offline: business may complete; fiscal may queue; statuses PENDING/QUEUED/SUBMITTED/ACCEPTED/REJECTED…; never fabricate acceptance.
- JurisdictionProfile selects policy/version at business time.
- No provider SDK in Orders/Settlement. Do **not** invent Vietnam legal text in ADRs.

## 9. Privacy, residency, egress, LLC

Architecture includes (ADR-0015 **Accepted** — single control-plane ADR, not split):

- Tenant / Business Group operational isolation; professional cross-BG access is exceptional ([ADR-0022](../decisions/ADR-0022-professional-account-cross-business-access.md) **Accepted** details the Professional Account model; ADR-0015 remains the privacy/isolation plane)
- Mutations in exactly one selected client context; cross-client mutation prohibited by default
- PII Vault as **logical** boundary (modular monolith OK for MVP; no mandatory separate deployable)
- Vietnam-primary **preferred/default** residency — not a claim that data never crosses borders; cross-border only via Egress Gate
- Egress decisions attributable (purpose, data categories, provider, destination, retention, approved service, tenant context, audit)
- Support/break-glass ≠ GovernmentRequestCase; scoped, reasoned, audited, not permanent super-admin
- Voice Interaction audio (zero-retention default) ≠ assessment/interview media ([ADR-0023](../decisions/ADR-0023-workforce-recruiting-learning-assessment.md) **Accepted** under ADR-0015 class B)

Exact legal qualification / certificates = **LEGAL GATE**, not architecture invent.

## 10. Payments non-custody

MillQ **MVP is non-custodial** (ADR-0013 **Accepted**): no merchant/customer fund custody; no wallet / internal money balance; Payments records provider outcomes, allocations, reconciliation, and references only. Tips may be payment allocations without custody; deposits/prepayments only as records of external receipt. Gift cards and marketplace collection/distribution are **out of scope** pending separate ADR/legal review.

## 11. JurisdictionProfile vs provider adapters

```text
LegalEntity (primary jurisdiction ownership)
  → JurisdictionProfile (policy; versioned + effective-dated)
Location/Outlet normally inherits LegalEntity profile
Provider adapters selected separately by capability (fiscal/payment/channel/…)
```

- Profile = **policy**, not provider implementation.
- Historical business/fiscal documents keep the profile/version at **business time**.
- Location-level jurisdiction override is **not** a generic capability (needs separate ADR).
- Changing a provider must **not** change Operational Core domain semantics.
- **Forbidden:** giant `VietnamAdapter`.

See ADR-0012 (**Accepted**).

## 12. Migration (product capability)

ADR-0011 **Accepted** freezes migration boundaries (not adapter implementations):

```text
Source Adapter → Staging → Normalize → Map → Validate
  → Dry-run → Idempotent Apply → Reconcile → Audit
```

- No direct writes to Operational Core tables; apply via normal domain/import commands.
- Extensible adapters (iPOS / MISA CUKCUK / KiotViet / Sapo / future) — first adapter not frozen; no source branching in Core.
- Modes: **A** Master Data, **B** Opening State / Cutover, **C** Historical Transaction (source-dependent).
- Staging + provenance + idempotency + reconciliation required; depends on ADR-0015.
- Explicit MigrationRun target scope (Tenant/LE/Location/Warehouse); no silent cross-boundary.
- Cutover lifecycle phases; no destructive Core rollback after apply.
- Catalog/units per ADR-0009; no `product.cost`; opening/history costing per ADR-0003; chronology ≠ upload order.

**No** ad-hoc `scripts/import-from-xxx.ts` as the architecture.

## 13. Offline multi-platform

ADR-0018 **Accepted** freezes architecture boundaries (not full sync implementation):

- First-class clients: Browser, iPad/iOS, Android (need not ship simultaneously).
- Server remains authoritative after sync — no second permanent SoT.
- Data classes: offline command capture; cached server-authoritative reference/config; external-service outcomes never fabricated.
- Business chronology outranks upload order; sync concepts: Local Store, Outbox, Inbox, Sync Cursor, idempotency, entity-specific conflict policy (no universal LWW; no specific local DB frozen).
- DeviceIdentity + attributable offline commands; encrypted-at-rest / scoped cache direction.
- Professional offline cross-client mutation out of MVP scope (ADR-0018; Professional Account model ADR-0022).
- Fiscal/payment/channel: queue OK; never fabricate ACCEPTED/SUCCESS.
- POS/KDS/printing usable without AI/voice; no mandatory local LLM/ASR.

`offline-foundation.md` remains the operational behavior reference.

## 14. Economic facts

Economic metrics are **derived read-side** facts (ADR-0019 **Accepted**), never Operational Core mutable truth and never `product.cost`.

Conceptual ladder:

```text
Gross Sales → (restaurant-borne discounts/promotions) → Revenue Basis / Net Sales
  → COGS → Gross Profit → Direct Variable Selling Costs → Contribution Margin
```

- COGS from historical sale/write-off/recipe costing via CostQuote/history.
- MVP Direct Variable Costs are typed components (packaging, payment fee, channel commission, …); rent/payroll/overhead excluded from MVP CM.
- Certainty/provenance per component; UNKNOWN ≠ silent zero; no false exact CM.
- Original currency preserved; FX only with explicit rate/source/time/reporting currency.
- Owner vs Accountant may use different views over the **same** facts.
- Tax/revenue treatment remains JurisdictionProfile-compatible (ADR-0012); Intelligence consumes under ADR-0006 / ADR-0020.

## 15. Production Intelligence Execution / ModelGateway (supporting)

ADR-0006 remains Accepted (Intelligence must not mutate Core). ADR-0020 (**Accepted**) adds execution contracts:

```text
Operational Core
  → Intelligence projections / EvidenceBuilder
  → ModelGateway (+ ApprovedModelRegistry)
  → Recommendation (human accept/reject)
  → normal domain command → audit
```

- No arbitrary LLM SQL/DB access.
- Preferred / default target: MillQ-controlled Vietnam-hosted / self-hosted inference **where economically, legally, and operationally justified** — **not** a mandatory MVP hosting invariant.
- Approved external providers **MAY** be used in production via `ModelGateway → ApprovedModelRegistry → ADR-0015 Egress Gate`.
- Provider/deployment-neutral; specific models (OpenAI/Kimi/Qwen/etc.) are replaceable candidates, not invariants.
- No restaurant-local model weights in MVP; POS does not depend on AI availability.

## 16. Voice & Multilingual Interaction (supporting)

ADR-0021 (**Accepted**): voice is first-class **supporting** capability, not a command bypass.

```text
mic → PTT/VAD → server ASR → router
  → A Informational query | B Translation
  → C Command preview | D Critical command
```

- **A/B:** no domain command; no command confirmation required.
- **C:** `VoiceCommandPreview` + auth; confirmation per command policy.
- **D:** refund / reversal / inventory adjustment / sensitive financial — explicit confirmation, authorization, reason when policy requires, normal domain command, audit.
- Voice/LLM/ASR never mutate Operational Core directly.

VI speech in + written VI out (no VI TTS required in MVP); EN/RU speech + text (+ optional guest TTS). Voice offline must not block POS/KDS/printing.

Allergen / dietary guest questions: structured resolver first (ADR-0024); voice/LLM may explain/translate only.

## 17. Professional Account / Cross-Business Access (new)

ADR-0022 **Accepted**: ordinary Tenant membership ≠ professional cross-business access (may coexist on one principal).

```text
Principal/User → optional ProfessionalProfile → ClientAccessGrant
  → Client Tenant/BG → Role + Scope
```

- Independent grants; no cross-client role inheritance; no shared tenant / merged ledgers.
- Mutations in exactly one selected client context; cross-client mutation prohibited.
- Authorized cross-client read aggregation via explicit read models/workspaces only.
- Future `ProfessionalOrganization → ProfessionalUser → ClientAssignment` (Accounting Company first); UI not required in MVP.
- Offline cross-client professional mutation out of scope (ADR-0018).
- Accept = boundaries only (no accountant workspace / billing model).

## 18. Workforce / Recruiting / Learning / Assessment (new)

ADR-0023 **Accepted**: `Candidate` ≠ `Employee` ≠ `User Account`; Candidate gets no automatic Core access.

```text
Vacancy → Candidate → Application → Interview/Screening
  → Training → Learning → Assessment → Human Employment Decision
  → Employee → optional User/Role/Scope
```

- Learning content classes A (business-private) / B (MillQ Library); marketplace future.
- Assessment attempts bound to exact ExamVersion; AI may score/recommend — **must not** hire/reject/terminate/change compensation autonomously.
- Qualification ≠ employment / payroll.
- Assessment audio retained under explicit ADR-0015 policy — **not** ADR-0021 zero-retention.
- May consume Catalog/Menu/Recipe/Allergen projections; does not own them.
- Accept ≠ recruiting portal / AI scoring / marketplace shipped.

## 19. Allergen & Dietary Constraint Resolution (new)

ADR-0024 **Accepted**:

```text
Ingredient/Catalog → Recipe/Preparation → Effective Recipe → Modifiers
  → configured Menu/Order item → Allergen & Dietary Resolution
```

Typed states: `CONTAINS` / `MAY_CONTAIN` / `CROSS_CONTAMINATION_RISK` / `NOT_KNOWN_TO_CONTAIN` / `UNKNOWN`.  
`UNKNOWN` never silently SAFE; `NOT_KNOWN_TO_CONTAIN` ≠ certification. Incomplete data stays uncertain. Resolver consumes recipe composition — does not own it. AI/voice query structured result only. Workforce may train on projections.

## 20. Action Center / Compliance Center

Read-side operational surfaces over Audit, Risk, FiscalSubmission status, MigrationJob, GovernmentRequestCase — **not** alternate SoT.

## 21. Device / Printing

OutputEndpoint (KDS/Printer/…) remains Production Routing. Device gateway / print spooler ownership sits at Integrations or Device edge — no UI-hardcoded `dish→printer`.

## 22. Block C compatibility (audit result)

| Check | Result |
| --- | --- |
| Document ≠ movement; DRAFT→POSTED→REVERSED | Compliant |
| No `product.cost`; CostQuote | Compliant |
| Warehouse-scoped MA (ADR-0003 §5) | Compliant |
| LE on balance = ownership denorm, not averaging axis | Compliant |
| Fact feed mirror; line-level GoodsReceived | Compliant |
| Catalog stubs without full profiles | Acceptable temporary stub |
| Code change required for v1.3 | **None** |

## 23. Work sequence after v1.3 acceptance

```text
Architecture v1.3 accepted (+ ADR-0011…0025 Accepted)
        ↓
~~Block D1.1 / D1.2A / D1.2B~~ Merged
        ↓
~~ADR-0025~~ Accepted / Merged (sale write-off event model)
        ↓
PO launches D1.3A — Orders Foundation & Consumption Plan
        ↓
D1.3B — GoodsIssue & Automatic Sale Write-off
        ↓
Food Cost (only after D1.3B + explicit PO launch)
        ↓
Migration Core scaffolding when scheduled (adapters later)
        ↓
POS / FloorPlan / Fiscal provider / Grab / Voice·AI runtime — only after their ADRs + gates
```

## 24. Explicit non-goals of the alignment PR

- No Migration adapter implementations
- No fiscal provider adapter
- No POS / FloorPlan / Grab / Shopee code
- No D1.3A/B Orders / GoodsIssue sale write-off **implementation** (ADR-0025 records semantics only)
- No ModelGateway / ASR / TTS / GPU / vLLM / Qwen install
- No Professional / Workforce / Allergen application implementation
- No dozens of empty future SQL tables
