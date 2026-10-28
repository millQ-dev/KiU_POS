# R1-ORIGIN-GAP-MATRIX — Floor/Table audit (read-only) · Origin `a1bb99e`

**Track R posture:** read-only until Track P exit (or P independently complete). **No R1.1 code in G0/NEXT-02.** Prep: `R1.1-IMPLEMENTATION-PROPOSAL.md` (gate closed).

## Authority

| Source | Status |
| --- | --- |
| ADR-0017 Floor/Table | **Accepted** — boundaries/invariants; Accept ≠ UI/runtime |
| ADR-0016 Settlement/Split | **Accepted** — Order≠Settlement; split within Order |
| ADR-0018 Offline | **Accepted** — no universal LWW |
| ADR-0032 Checkout | **Accepted** — orchestration; Floor not required |
| `current-state.md` | R1.1 **FROZEN / NOT STARTED** |
| Notion R1 overview / backend R&D / waiter FE / golden QA | **SOURCE_UNAVAILABLE** this run — treat R&D schemas as **proposals**, not Accepted API |
| R3-4 cross-assignment / R3-5 Hostess Reservations | **OPEN** (per NEXT-01; Notion not re-fetched) — default stricter grants; **no** booking engine |
| Figma tablet/mobile waiter | **SOURCE_UNAVAILABLE** live — design reference only |

## Acceptance invariants (ADR / NEXT-01) vs Origin code

| # | Requirement | Accepted basis | Code / DB evidence | Figma | Tests | Class | Smallest PR / level |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Order valid without Table (counter unchanged) | ADR-0017 §1 | Orders have no required table FK; DEMO-29 counter path | SOURCE_UNAVAILABLE | cash12 / DEMO-29 | **EXISTS** | Preserve regression in any R1.1 |
| R2 | Capability `tables.enabled` | ADR-0017 §2; ADR-0008 | `package_entitlement` + `outlet_capability_config` exist (guest QR uses pattern); **POS does not read** `tables.enabled` (pos test forbids PackageEntitlement in layout sources) | SOURCE_UNAVAILABLE | pos §56; guest-menu entitlement | **PARTIAL** | Level B: wire capability gate when Floor module lands — not invent keys |
| R3 | DiningArea / FloorPlanVersion / Table entities | ADR-0017 §3–4 | **No** tables `dining_area`, `floor_plan`, `table_runtime`, `table_assignment`, `pos_table` (pos §56 `rowCount===0`); no `apps/api/src/modules/floor*` | SOURCE_UNAVAILABLE | pos.acceptance §56 | **MISSING** | R1.1 schema+commands **Level B** (ADR-accepted boundaries) — names/SQL need review vs R&D; **not** bulk-copy Notion |
| R4 | FloorPlan versioning; no silent rewrite of history | ADR-0017 §4 | N/A — no plan runtime | SOURCE_UNAVAILABLE | — | **MISSING** | Include in R1.1 FloorPlanVersion design |
| R5 | TableAssignment owned by Floor/Table; Order ID immutable on move | ADR-0017 §6 | No assignment table/API | SOURCE_UNAVAILABLE | — | **MISSING** | Assign/Move commands Level B |
| R6 | Multiple independent Orders per Table | ADR-0017 §7 | N/A runtime | SOURCE_UNAVAILABLE | — | **MISSING** (invariant to encode) | Model + tests in R1.1 |
| R7 | Table AVAILABLE only after departure + authorized ready/clean — not solely because one Order paid | NEXT-01 / ADR runtime intent | No TableRuntimeState | SOURCE_UNAVAILABLE | — | **MISSING** | Explicit transition commands; Level B; do not auto-free on CompleteOrder |
| R8 | No implicit reservation engine | ADR-0017 §9; R3-5 OPEN | No reservations module | SOURCE_UNAVAILABLE | — | **DEFERRED** | Exclude until PO on R3-5 |
| R9 | No LWW; CONFLICT on concurrent move | ADR-0018 + NEXT-01 | No move API | SOURCE_UNAVAILABLE | — | **MISSING** | expectedVersion + CONFLICT test Level B |
| R10 | Split bills within one Order; exact VND; no split after qualifying payment | ADR-0016 | `settlement-service.splitChecksExact` **EXISTS**; S1.1 + pay11 tests | SOURCE_UNAVAILABLE | `s11-settlement.acceptance.test.ts`, pay11 | **PARTIAL** | API/exact split EXISTS; equal-split UX / waiter UI **MISSING** — Level B UI later; do not claim full split product |
| R11 | SettlementGroup/Check chain stays one Order (pilot) | ADR-0016; NEXT-01 | Settlement bound to Order today | SOURCE_UNAVAILABLE | settlement tests | **EXISTS** (pilot constraint) | Guard against cross-Order checkout |
| R12 | Offline actor/idempotency/audit for Floor commands | ADR-0018 | Identity/grants patterns exist elsewhere; Floor commands absent | SOURCE_UNAVAILABLE | — | **MISSING** for Floor | Follow cash/orders patterns in R1.1 |
| R13 | Waiter tablet/mobile UI | Roadmap UI; ADR-0017 UI deferred | No Floor React surface; cashier is counter shell only | SOURCE_UNAVAILABLE | — | **MISSING** | **R1.2 after R1.1**; no separate mobile platform now |
| R14 | Guest menu soft `dining_area_id` / `table_ref` | migration 022 comment | Soft refs only — “Floor/Table runtime not present yet” | — | guest-menu | **PARTIAL** / soft | Must not be mistaken for Floor engine |

## CONFLICT check

| Topic | Finding |
| --- | --- |
| ADR-0017 vs code | **No CONFLICT** — Accept explicitly deferred runtime; code absence matches “not started” |
| Guest soft table refs vs Floor ownership | **No CONFLICT** if soft refs stay non-authoritative until Floor owns assignment |
| splitChecksExact vs equal-split UX | **PARTIAL** only — not CONFLICT |

## R3-4 / R3-5

| Choice | Status | Default until PO |
| --- | --- | --- |
| R3-4 colleague waiter cross-assignment | **OPEN** / SOURCE_UNAVAILABLE detail | Stricter explicit grants; no silent cross-waiter mutate |
| R3-5 full Hostess Reservations | **OPEN** | **Exclude** booking engine from R1.1 |

## R1.1 gate (when allowed)

Start only after: Track P exit (or P complete) **and** no new Level C invent. First vertical slice (from NEXT-01):

1. Configured floor → waiter sees Table 6 → Order A → move to Table 8 (same OrderId) → paid ≠ auto-free → ready after clean approval.  
2. Two waiters concurrent move → one wins, other **CONFLICT**.  
3. Counter Order-without-Table regression green.  
4. Disposable DB only; migration ≤ CI/`millq_ci_pos_*`; no prod migrate GO.

**Autonomy:** schema + commands = **Level B** under Accepted ADR-0017 (unless PO deltas change semantics → Level C STOP).

## Verdict for Track R at G0

**R1_AUDIT_READY** — existence map complete from Origin code.  
**R1_IMPLEMENTING** — **not** started.  
**R1_NEEDS_PO** — only if R1.1 requires R3-4/5 Accept or schema choices beyond ADR-0017; otherwise proceed after P exit with Level B proposal PR (schema draft for review).
