# ADR-0054: Restaurant Imprint foundation (read-side profile, immutable claims, rebuildable snapshot)

- **Status:** **Proposed — APPROVE WITH CHANGES recorded (PO, 2026-10-29).** The Product Owner approved the architecture direction **Imprint B** (immutable provenance claims, rebuildable snapshot, progressive population, strict isolation from Operational Core) and **JEV autonomy A** (**no JEV/LLM runtime in Stage 1**), **subject to five required clarifications now locked in "PO APPROVE WITH CHANGES (2026-10-29) — five locked requirements."** This GO authorizes **completing the architecture documentation only**; it is **not** an unconditional ACCEPT of this final text. Per `PROJECT_CHARTER.md` §9/§12 and `AGENTS.md` §2, a recorded **PO ACCEPT of this final text** is still required before any dependent structural code (migration, schema, contracts, service). See **Decision proposal for PO ACCEPT (final, seven points)** at the end.
- **Date:** 2026-10-29
- **Autonomy:** **Level C** (new read-side domain architecture). Implementation after PO ACCEPT is **Level B** (schema, contracts, cross-module read integration). **No production deploy, no persistent-database migrate/backfill, no live pilot** without a separate explicit PO GO.
- **Related:** ADR-0001, ADR-0002, ADR-0006, ADR-0008, ADR-0010, ADR-0012, ADR-0015 (Privacy/Residency/Egress/Security — applicable requirements retained), ADR-0020, ADR-0039, ADR-0040. Supersedes nothing; owns no existing operational domain. Does not alter Proposed ADR-0053 (fiscal sandbox adapter boundary).
- **Provenance baseline:** Gate 0 read-only audit (2026-10-29) against Origin `main` `42957b698c985d13d646599a429945730eb9ade5`. First draft was registered as ADR-0053 on branch tip `601abd82` against `340e833`. Renumbered to **ADR-0054** after fiscal PR #137 occupied 0053. Re-verified against Origin `main` `7bc9e0016c8127d46a44c3378f5e7cf82c485f04` on 2026-10-29 (see **Freshness**).

## Freshness and preflight (verified facts, not assumptions)

Verified directly against Origin `main` `7bc9e0016c8127d46a44c3378f5e7cf82c485f04`:

- Gate 0 SHA `42957b6` is an ancestor of current `main`. Concurrent work since that SHA includes allergens M6 (ADR-0050, PR #131), merchant discount v1 (ADR-0051, PR #130), fiscal G2 docs (#133), fiscal sandbox ADR (#137), and modifier per-unit price (#138). None of that work creates an Imprint module.
- **No `restaurant-imprint` runtime exists** on `main`. This ADR does not collide with existing code.
- **Migration head is `039_order_allergen_context_m6.sql`.** The next free migration is **`040`**. `038` and `039` are already taken. The number is reserved against Origin at I-02 time, never hard-coded as a schema change in this ADR.
- **ADR-0053 is not free.** It is Proposed `docs/decisions/ADR-0053-fiscal-sandbox-adapter-boundary.md` on `main` (KIU-FISCAL, PR #137). This Imprint document is **ADR-0054**. ADR-0052 remains the Modifier v1 contract and is unrelated.
- Live HTTP prefix is **`/api/v1`**; there is **no `/api/office`** router and **no `OfficeSession`** type. Any Imprint read endpoint must follow `/api/v1`.
- Identity enforcement is server-side via `identity_access_grant` + `assertPermission` (`apps/api/src/modules/identity/`), **no RLS**. This ADR does not add `OfficeSession`, Vault, or Egress.
- GitHub backup `main` observed at `f9931eb43025897871635d0f33ca644526a069f1` lags Origin `main` `7bc9e00` by modifier price #138. GitHub is backup only; Origin HEAD is authoritative. This agent does not write to GitHub.

## Context

KiU needs a versioned, explainable description of each restaurant (outlet) for onboarding, business diagnostics and future JEV workflows. The Operational Core already owns authoritative business data: `GoodsReceipt` (Procurement), inventory movements (Inventory), orders/consumption (Orders), cash/payments/fiscal facts. Those posted documents and movements (ADR-0010) must **not** be shadowed by a generic agent memory or a second ledger.

There are three different kinds of information that must coexist without being collapsed into one another:

1. **Authoritative operational facts** owned and validated by a source module.
2. **Human claims** (declared, configured, targeted) that are not operational truth.
3. **Currently unknown data.** `unknown` is not `zero`, not `false`, and not invented.

Gate 0 confirmed `operational_fact_feed` is a **mirror / notification stream**, not a ledger: e.g. a `GoodsReceipt` reversal does **not** emit a correcting feed entry, so old `GoodsReceived` entries persist after reversal. The feed is therefore usable as a *hint to re-read the source*, never as the sole reconciliation source.

## Decision

### 1. Bounded read-side module, no new write paths

Introduce a **separate bounded read-side module `restaurant-imprint`** inside the existing TypeScript modular monolith. No microservice, no separate general event-sourcing infrastructure, no new cross-module write path, no vector/embedding store, no external model call. The module only **reads** from authoritative source modules' validated read interfaces and **writes only its own** `imprint_*` tables.

### 2. Domain ownership (what Imprint does and does not own)

- Imprint **owns** only: its claims, revisions, snapshots, ingest cursors, and projection errors.
- Imprint **does not own and never writes**: `GoodsReceipt`/procurement documents, `inventory_movement`, orders/consumption, cash/payment/fiscal facts, organization tables, identity tables, `operational_fact_feed`, or the `recommendations` table (ADR-0006/0020 — reserved for Production Intelligence, **not** an Imprint store). The in-memory fact store in `packages/contracts` is a test fixture and is **not** the Imprint store.
- Operational authorities are unchanged: **Procurement owns receipts; Inventory owns movements; Orders owns orders/consumption; financial/fiscal source facts are never duplicated by Imprint.**

### 3. Scope key

Scope key is **`tenantId` + `outletId`** (outlet-scoped imprint). Tenant and outlet are **server-derived** from the authenticated session, never request-supplied. The server-side `tenantId` + `outletId` authorization check is **mandatory and default-deny at every boundary — ingest, source adapters, snapshot rebuild, and read API** — not only at the HTTP layer (see R2). Network/brand facts are referenced by source and resolved *for* an outlet; **`outlet ≠ legal entity`**, and `brand ≠ legal entity`. A `warehouse` with `NULL outlet_id` **must not** be silently associated to an outlet (Gate 0: `warehouse.outlet_id` is nullable).

### 4. Two layers: immutable claims + rebuildable snapshot

- **(a) Immutable, versioned claims** with `source`, `origin ∈ {DECLARED, CONFIGURED, OBSERVED, TARGET}`, validity window, verification, and a payload fingerprint. Append-only; corrections/supersessions create new claims, never destructive edits.
- **(b) Rebuildable materialized snapshot** projecting selected claims with conflicts, unknowns, source watermarks, a generation `revision`, and `STALE`/`DEGRADED` flags. **The snapshot is not operational truth** and is fully reproducible from claims + source adapters + the registered resolver version.

### 5. Typed extensible namespace, populate only verified paths

A typed, extensible domain namespace exists from day one (identity/structure, menu, operations, inventory, procurement, workforce, finance, customer experience, goals). **Only fields with an actually available source contract on Origin are populated.** Every other registered path resolves to explicit **`UNKNOWN`**. Arbitrary JSON keys are forbidden; only **registered `FactPath`s** are accepted. An unknown incoming taxonomy path is rejected/held, and the previous snapshot remains usable.

### 6. Source of truth per field

For operational fields the only source is the **owning module's validated read interface/query**. `operational_fact_feed` may be used as an efficiency hint or change notification, **never** as a central ledger or sole reconciliation source. Document Engine transaction semantics (ADR-0010) are not changed. Statuses are always taken from the owning aggregate, not inferred from feed presence.

### 7. Source adapters and idempotent ingestion

Adapters publish claims keyed by a stable dedupe key: `(tenant_id, outlet_id, source_module, source_entity_type, source_entity_id, source_revision, path, payload_fingerprint)` or an equivalent stable key.

- A repeat with an identical key/payload is a **no-op**.
- The **same source event identity with a different payload is a conflict** — quarantined and audited; the existing snapshot is unchanged (never silent latest-write-wins between conflicting human/source claims).
- Changed source data produces a **superseding** claim/revision; a claim may also be explicitly **invalidated**. Superseded and invalidated claims remain addressable in history but **must not participate in the current snapshot** (see R3); correction is only via supersede/invalidate, never destructive edit.
- **`DRAFT` is never stock/receipt truth.** A fact is never inferred solely from the presence of a `DRAFT` document. Corrections/reversals produce a changed effective view while preserving the evidence chain. The Imprint adapter re-reads the authoritative source on correction/reversal; it never invents `CORRECTED` runtime or `StockTransfer` that do not exist in the source.

### 8. Clock semantics

Separate, explicit clocks: `observedAt`, `recordedAt`, `effectiveFrom`/`effectiveTo`, plus source `businessDate`/`businessOrder` when the source provides them. Missing business time is **not manufactured**; where a source lacks event IDs, a deterministic source-version content hash plus an explicit backfill cursor is used, and business chronology is never fabricated from ingestion order.

### 9. Snapshot, conflict resolution, reliability

- Per-field, typed source precedence; **no blanket latest-write-wins** and no universal confidence algorithm in Stage 1.
- At-least-once ingestion with idempotent persistence; **atomic cursor + claim commit**; snapshot swap only after a complete coherent rebuild (optimistic compare-and-swap on the current pointer).
- Partial source failure marks the snapshot `STALE`/`DEGRADED=true` and **retains the last good snapshot**; `unknown ≠ zero`, `unknown ≠ false`, `DRAFT ≠ POSTED`.
- Rebuilds are stable under retries and out-of-order delivery; concurrent rebuilds for one outlet publish exactly one atomic revision.

### 10. Privacy / sensitivity map

Every registered path carries a sensitivity class and retention policy. **No raw PII, secrets, credentials, receipts, or raw attachments** are stored or logged. Sensitive fields (e.g. employee-level data) are minimized, omitted, or policy-redacted. `includeProvenance` output is capability/scope-filtered. No automatic persistence of inferred health/employee data.

### 11. Scoped authorization choice (narrow, default-denied)

Recommended and adopted **unless a conflicting accepted ADR is found on Origin**:

- Use the current **server-side Identity** and **`identity_access_grant`** with **separate, explicit, least-privilege Imprint read/provenance grant(s)** (e.g. `imprint.read`, and a distinct grant gating provenance/sensitive fields), **default denied**.
- **Do not** expose the full outlet imprint to everyone holding `pos.operate`.
- Scope is the **server-derived tenant + authorized outlet**, never a caller-supplied tenant. Enforcement is via repository/service authorization + audit + **negative cross-tenant tests** (AC-09). **No RLS assumption.**
- There is **no `OfficeSession`** today and this block does **not** invent one, nor a new authorization actor / Vault / Egress.
- **Gating rule:** if current Origin cannot safely support such grants, **defer only the HTTP slice I-07**, not the entire Imprint domain. The internal read-side domain (claims, revisions, snapshot, adapters, replay) proceeds regardless.

### 12. Operational isolation (hard boundary)

- Core checkout/posting/inventory/fiscal critical paths **must remain independent of Imprint availability.** When Imprint is disabled or degraded, restaurant operations and read endpoints degrade gracefully (AC-08, AC-16).
- No query/publish side effects on operational tables. Imprint never calls document posting and never mutates Procurement/Inventory/Orders/fiscal state.

### 13. JEV autonomy A — future, not Stage 1 runtime

JEV differentiated autonomy is a **future policy**, not a Stage 1 runtime. **No JEV/LLM model invocation, no proactive alerts, no diagnostic inference** in Stage 1. JEV never bypasses domain commands. Declared/target/inferred claims are never silently converted into operational facts; operational corrections go through the owning domain's reversal/correction.

## PO APPROVE WITH CHANGES (2026-10-29) — five locked requirements

These five requirements are **binding and override any softer wording elsewhere in this ADR**. They are the Product Owner's required changes and the conditions of the pending final ACCEPT.

- **R1 — Data ≠ Consent.** The presence of any data in Restaurant Imprint does **not** grant JEV/LLM (or any automation) permission to process, use, or transmit it. Processing/use/transfer authorization is a separate, explicit decision; Imprint storage is never consent. (No JEV/LLM runtime exists in Stage 1 regardless.)
- **R2 — Tenant isolation (default deny).** A server-side `tenantId` + `outletId` authorization check is **mandatory** for **ingest, source adapters, snapshot rebuild, and the read API**. Scope is server-derived, never caller-supplied; absence of a positive grant is denial. Enforced in repository/service code (**no RLS** assumption) with negative cross-tenant tests (AC-09).
- **R3 — Claim lifecycle.** Claims are **immutable**. Correction is only by **supersede** or **invalidate**; invalidated/superseded claims are retained in history but **must not participate in the current snapshot**. No destructive edit; no silent latest-write-wins between conflicting human/source claims.
- **R4 — Deterministic snapshot.** Conflict-resolution rules, freshness, provenance, and the transition to **`UNKNOWN`** are **versioned**; the snapshot records the resolver/policy version and source watermarks. A rebuild from the same claims + adapters + resolver version is **reproducible** and deterministic for registered fields.
- **R5 — Privacy boundary.** Stage 1 runs **no LLM** and requires **no new Vault/Egress** components, **but retains all applicable requirements of already-accepted privacy ADRs — ADR-0015 (Privacy/Residency/Egress/Security), and ADR-0012 where relevant**: data minimization, no raw PII/secrets/receipts, residency/egress constraints, and audit. Existing domain boundaries are unchanged; **no `OfficeSession`, no RLS, no `/api/office`** is introduced.

## Registered typed fact paths (initial v0.1, intent)

Only paths with an available Origin source contract are populated in Stage 1; all others are registered as `UNKNOWN`. Final naming is aligned to Origin conventions at contract time (I-03) without changing invariants.

| Path | Owner source | Stage 1 |
| --- | --- | --- |
| `organization.outlet.identity` | Organization (`outlet`) | Populated (I-05) |
| `organization.outlet.brand_ref` | Organization (`brand`) | Populated (I-05) |
| `organization.outlet.legal_entity_ref` | Organization (`legal_entity`) | Populated (I-05) |
| `organization.outlet.capabilities` | Organization (`outlet_capability_config`) | Populated (I-05) |
| `inventory.warehouse_refs` | Organization/Inventory (`warehouse`, non-NULL outlet only) | Populated (I-05) |
| `procurement.last_posted_receipt_ref` | Procurement (`goods_receipt` POSTED/REVERSED ref + status) | Populated (I-06) |
| `operations.active_terminal_refs` | Organization (`terminal`) | `UNKNOWN` until a read contract is confirmed |

Derived costs are never stored as a generic `product.cost`; they link to the owning `CostQuote`/revision with certainty. Documents are referenced by source ID/status and provenance, never by duplicating authoritative transaction tables.

## Alternatives rejected

- Unified restaurant JSON overwriting facts on every sync (no lineage/conflict handling).
- A source-of-truth ledger constructed from `operational_fact_feed`.
- An LLM semantic/vector memory as the authoritative store.
- Trigger-based cross-module direct writes or mutating posted documents.
- Mandatory AI availability for POS / document posting.

## Consequences and constraints

- Extra storage, replay and explicit conflicts are intentional costs for explainability.
- Imprint degrades without blocking checkout, goods receipt, production, costing, or fiscal/payment flows.
- No embedding/vector DB and no new external provider in Stage 1.
- Baseline performance is **measured** from the Origin system and documented; no invented production SLA.

## Known UNKNOWN / open items (resolve with a delta before dependent code if Origin contradicts)

- Ownership of broad network/brand facts and the initial source event delivery channel.
- Exact grant names and whether `identity_access_grant` can carry the Imprint read/provenance grants safely (gates **only** I-07, per §11).
- The actual next migration number is reserved on Origin at I-02 (expected `040`; never hard-coded).
- Exact `/api/v1` sub-path and pagination/ETag conventions at I-07.
- `operations.active_terminal_refs` read contract (otherwise stays `UNKNOWN`).

ADR approval does **not** authorize a production database migration.

## Implementation slices (gated; for reference only — no code in this ADR)

Order: **I-01 (this ADR) → PO ACCEPT → I-02 (migration `040`) + I-03 (Zod contracts) → I-04 (claim/revision/snapshot service) → I-05 (Organization adapter) → I-06 (narrow GoodsReceipt adapter) → I-07 (`/api/v1` read endpoint, gated by §11) / I-08 (replay/backfill, disposable tenant) → I-09 (AC-01…AC-16)**. Each slice is a small Origin `feature/` PR, Level B, with Bugbot + separate-context substantive AI review on current HEAD, cleared blockers, then merge-when-ready and required Depot CI. No GitHub PR; no direct `main` push; no force merge.

## Decision proposal for PO ACCEPT (final, seven points)

The 2026-10-29 **APPROVE WITH CHANGES** is recorded above; the five required changes (R1–R5) are locked. Per Origin policy this final text still needs an explicit **PO ACCEPT** before dependent structural code (I-02+). Requesting ACCEPT of exactly the following, which does **not** add any new fiscal, financial, legal, or data-exposure rule:

1. `restaurant-imprint` is a **read-side only** module; it writes only `imprint_*` tables and never mutates operational/organization/identity/feed tables.
2. Scope key **`tenantId` + `outletId`**, both **server-derived**, with a **mandatory default-deny tenant check at ingest, source adapters, snapshot rebuild, and read API (R2)**; `outlet ≠ legal entity`, `brand ≠ legal entity`; a `warehouse` with `NULL outlet_id` is not projected onto an outlet.
3. Two layers — immutable append-only **claims** with **supersede/invalidate, where invalidated/superseded claims are excluded from the current snapshot (R3)** — and a rebuildable **snapshot**; snapshot is not operational truth; `UNKNOWN ≠ zero/false`; `DRAFT ≠ POSTED`.
4. **Deterministic snapshot**: **versioned** conflict-resolution/freshness/provenance/`UNKNOWN` rules recorded in the snapshot, **reproducible rebuild (R4)**; statuses come from the **owning aggregate**; `operational_fact_feed` is a hint/notification, never the sole reconciliation source; Document Engine semantics unchanged.
5. **Scoped authorization** via existing server-side Identity + `identity_access_grant`, least-privilege, default-denied, **no RLS**, **no new `OfficeSession`/Vault/Egress**; if grants cannot be supported safely, **only I-07 (HTTP)** is deferred, not the domain.
6. **Data ≠ Consent (R1)** and operational isolation: Imprint storage grants **no** automation/JEV/LLM permission to process/use/transmit; core checkout/posting/inventory/fiscal paths remain independent of Imprint; **no JEV/LLM runtime** in Stage 1.
7. **Privacy boundary (R5)**: Stage 1 adds **no new Vault/Egress** and **retains the applicable requirements of accepted privacy ADRs (ADR-0015; ADR-0012 where relevant)**; implementation is **Level B** per slice; **no production deploy and no persistent-DB migrate/backfill** without a separate PO GO.

Until this ACCEPT is recorded, dependent structural code (I-02 onward) is **STOPPED**; document-only work (this ADR) and independent tests proceed.
