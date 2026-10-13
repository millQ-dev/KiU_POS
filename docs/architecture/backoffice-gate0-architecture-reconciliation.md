# KiU Backoffice — GATE 0 / Architecture Reconciliation

- **Autonomy:** Level **C** (docs-only)
- **Date:** 2026-10-13
- **Canonical Origin baseline:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **Branch:** `docs/backoffice-gate0-reconciliation`
- **STOP:** No runtime, no migrations, no merge without separate PO merge authorization, no OFFICE1.1 Accept/merge, no Backoffice implementation without subsequent PO authorization.
- **PO review (2026-10-13):** APPROVE WITH CHANGES — NOT MERGE AUTHORIZATION. See [`backoffice-gate0-po-delta-2026-10-13.md`](backoffice-gate0-po-delta-2026-10-13.md). Tip at review: `e545285…`.

---

## 0. Execution status and Notion reconciliation

### 0.1 Live Notion login

Browser session to Notion still hits a login wall. **Authoritative consumption for Gate 0 is the Markdown export** supplied under `Downloads/Private & Shared/` (not live Notion scraping).

### 0.2 Export status (ten source pages)

| Page | ID | Export |
| --- | --- | --- |
| Parent Index | `3f721d5d34878197bab3c0f34c6b3867` | Present |
| 00 Handoff | `3f821d5d34878186b682d5db96ff591d` | Present |
| Owner | `3f821d5d34878178b417e5e574d5e8d8` | Present |
| Manager | `3f821d5d348781d09e3ad589f2c07726` | Present |
| Accountant | `3f821d5d348781fb947fe08664edb8cc` | Present |
| Chef | `3f821d5d3487810b9e86f82eb10159e1` | Present |
| Bar Manager | `3f821d5d34878172b4c8c018180d50c5` | Present |
| Engineering Contracts | `3f821d5d348781c49786ff2d638b94f6` | Present |
| Implementation Roadmap | `3f821d5d3487811eaa15d7a947ef89a0` | Present |
| Q Place + Q Card | `3f821d5d348781ed94e1e0c9dfbeb254` | **Absent** from folder — separate discovery; **not invented** |

Matrix: [`backoffice-gate0-notion-origin-matrix.md`](backoffice-gate0-notion-origin-matrix.md). Preserve **ACCEPTED** vs **PROPOSED** vs **OPEN** from source pages.

### 0.3 Allowed sources

| Source | Use |
| --- | --- |
| Origin `main` @ `18316b8…` | Runtime / migration / route / test inventory |
| Accepted ADRs on main | Boundaries already decided |
| Markdown export 00–07 + parent | PO-accepted Backoffice handoff 13.10.2026 |
| PO delta 2026-10-13 | Required corrections (priority, channels, authz) |
| Origin PR #82 (draft) | Preserve OFFICE1.1; **do not** Accept Amendment A / ADR-0040 |

**Q Place / Q Card** remains a separate discovery stream (out of five-cabinet delivery scope).

---

## 1. Current Origin SHA and migration head

| Item | Value |
| --- | --- |
| Origin `main` SHA | `18316b8f8aa2da6d045b04aebbde3c5434ea046e` |
| Tip commit subject | `feat(fisc): FISC1.1 PaymentCollectionEvent and Fiscalization Core runtime (#81)` |
| Migration head | `032_fisc11_payment_collection_fiscal_core.sql` (32 migrations, `001`–`032`) |
| Active non-draft Origin PRs (visible list) | #63 ADR-0035; #2 foundation checkpoint |
| OFFICE1.1 preflight | **PR #82 draft** — title `docs(office): OFFICE1.1 Global Username & Professional Access preflight`; head `142adb26632526d06e9e63f8160335f4cd918477`; base `18316b8…` |

### 1.1 Preserve PR #82 (do not reimplement / merge / Accept)

PR #82 already contains (on its tip, **not** on `main`):

- `docs/decisions/ADR-0039-amendment-A-phone-first-optional-email.md` (**Proposed**)
- `docs/decisions/ADR-0040-office-username-invites-professional-grants.md` (**Proposed**)
- `docs/architecture/office1.1-global-username-professional-access.md`
- review packets under `docs/processes/review-packets/office11-*`

**Rules for Gate 0 and successors:**

- Do **not** duplicate those ADR texts into this branch.
- Do **not** silently Accept Amendment A or ADR-0040.
- Do **not** merge PR #82 without explicit PO authorization after OPEN decisions.
- ADR-0039 body on `main` remains **Accepted** (docs/architecture); Office runtime still **not** shipped.

### 1.2 PR #82 review issues — recorded separately (not Accepted)

See [`docs/architecture/office1.1-pr82-open-review-issues.md`](office1.1-pr82-open-review-issues.md). Summary:

1. Avoid unnecessary duplicate Zalo OTP for signup and first session.
2. Resolve trusted-device / repeat-login MFA UX and costs.
3. Empty LegalEntity/Outlet scope must not silently mean tenant-wide.
4. Internal Accountant memberships must appear alongside independently granted professional clients in the unified read hub.
5. Username recycling, phone loss and recovery need explicit security rules.

These remain **OPEN** on the OFFICE1.1 track. They are **inputs** to Backoffice Identity readiness, not Gate 0 Accept decisions.

---

## 2. Existing-work / missing-work matrix

### 2.1 Classification legend

| Class | Meaning |
| --- | --- |
| **EXISTS** | Implemented on Origin `main` and covered by acceptance/adversarial tests cited |
| **PARTIAL** | Some code/schema exists; missing pieces listed |
| **MISSING** | Not implemented on `main` |
| **LEVEL C REQUIRED** | Needs a new Accept / ADR before runtime |
| **LEGAL / PROVIDER GATED** | External approval or provider required |

### 2.2 Caveat (Notion)

Section 2.3 remains the Origin module inventory. **Line-by-line Notion→Origin classification** lives in [`backoffice-gate0-notion-origin-matrix.md`](backoffice-gate0-notion-origin-matrix.md) (export-based). Q Place+Q Card page still absent from export → that stream stays PARTIAL/out-of-scope.

### 2.3 Domain matrix (Origin @ `18316b8`)

#### Identity

| Capability | Class | Evidence |
| --- | --- | --- |
| Tenant-bound POS user + PIN + session | **EXISTS** | mig `027`; `IdentityService.authenticatePin` / `resolveSession` / `revokeSession`; routes `POST /api/v1/identity/pin/authenticate`, `GET /api/v1/identity/session`, `POST .../logout`; tests `id11-pos-auth.acceptance.test.ts` |
| Permission grants (tenant / outlet scoped) | **EXISTS** | `identity_access_grant` + unique indexes for tenant-wide vs outlet; `hasPermission` / `assertPermission`; permissions: `cash_shift.open`, `cash_shift.open.approve`, `pos.operate`, `procurement.goods_receipt.manage`, `payments.receive_cash` |
| Login challenge + dangerous-op approval | **EXISTS** | `identity_login_challenge`, `identity_approval_request`; `LoginChallengeService`, approval `createRequest` / `decide`; routes under `/api/v1/identity/login-challenges*`, `/api/v1/identity/approval-requests*`; notification outbox `DANGEROUS_OPERATION_APPROVAL_REQUESTED` |
| Company code public resolve | **EXISTS** | `CompanyIdentityService`; `GET` company by code in `identity.ts`; mig `025` |
| GlobalAccount / OfficeSession / MFA / bootstrap | **MISSING** (runtime) / **LEVEL C** (Amendment A + ADR-0040 Proposed on PR #82) | ADR-0039 Accepted docs on main; no GlobalAccount tables/routes on `main` |
| `@username`, invites, ClientAccessGrant runtime | **MISSING** | ADR-0022 Accepted (boundaries only); ADR-0040 Proposed on PR #82 only |
| Task / dispatcher permissions | **MISSING** | No `task.*` permission keys |

#### Organization

| Capability | Class | Evidence |
| --- | --- | --- |
| Tenant / outlet / terminal topology | **PARTIAL** | Foundation + `026_organization_terminal.sql`; cash terminals list; company code |
| LegalEntity + bank accounts (Office bootstrap) | **MISSING** runtime | ADR-0039 Accepted contract only |
| Floor / Table engine | **MISSING** runtime / ADR **Accepted** | ADR-0017; **explicitly out of first Manager vertical** |

#### Cash

| Capability | Class | Evidence |
| --- | --- | --- |
| Open CashShift + manager approval path | **EXISTS** | `CashShiftService.openShift`; routes `GET/POST /api/v1/cash/*`; `cash11-open.acceptance.test.ts`; OpeningCashScreen waits for manager approval |
| Cash drawer variances / end-of-day Manager tasks | **MISSING** as TaskService | No task derivation from cash events |

#### Orders

| Capability | Class | Evidence |
| --- | --- | --- |
| Open/mutate/cancel/complete/reverse order + commercial snapshot + consumption plan | **EXISTS** | `OrdersService.*`; POS routes `/api/v1/orders*`; tests `orders.acceptance.test.ts`, `d13b-*`, `d14b-*` |
| Manager contextual tasks from order exceptions | **MISSING** | No TaskService |

#### Settlement

| Capability | Class | Evidence |
| --- | --- | --- |
| Open / abort / split / reconcile settlement | **EXISTS** | `SettlementService`; mig `018`–`019`; `s11-settlement.acceptance.test.ts` |
| Fiscal gate observation hook | **EXISTS** | `observeFiscalGate` / checkout gate wiring |

#### Payments

| Capability | Class | Evidence |
| --- | --- | --- |
| Tender defs, payments, allocations, non-custody lifecycle | **EXISTS** | `PaymentsService`; mig `020`–`021`; `pay11-payments.acceptance.test.ts` |
| ReceiveCash + PCE | **EXISTS** | `ReceiveCashService.receiveCash`; `POST /api/v1/payments/receive-cash`; FISC1.1 tests |

#### Fiscalization

| Capability | Class | Evidence |
| --- | --- | --- |
| Policy versions, issue, reconcile, collection-time bind, freeze, SATISFIED | **EXISTS** (Core staging) | `FiscalService`; mig `032`; `fisc11*.test.ts` |
| Production fiscal **provider** go-live | **LEGAL / PROVIDER GATED** | ADR-0014; adapter interface exists; live VN provider not authorized by Gate 0 |
| Full Accounting / e-invoice product UI | **MISSING** / out of first vertical | — |

#### Inventory

| Capability | Class | Evidence |
| --- | --- | --- |
| GoodsIssue from consumption plan + reverse | **EXISTS** | `GoodsIssueService`; mig `008`–`010` |
| Balance rebuild / read helpers (via procurement service) | **PARTIAL** | `getBalance` / `rebuildBalance` on goods-receipt service; no Backoffice stock UI |
| ml-based Bar inventory specialty | **MISSING** / likely **LEVEL C** after Notion | No ml UoM specialization beyond general units ADR-0002/0009 |

#### Procurement

| Capability | Class | Evidence |
| --- | --- | --- |
| Goods receipt draft → validate → post → reverse | **EXISTS** | `GoodsReceiptService`; routes `/api/v1/goods-receipts*`; `block-c.acceptance.test.ts`, `c01-goods-receipt-http-auth.acceptance.test.ts` |

#### Recipes

| Capability | Class | Evidence |
| --- | --- | --- |
| Recipe draft / scale / publish path (service) | **PARTIAL** | `RecipesService` + `recipes.acceptance.test.ts`; HTTP surface for Chef cabinet **MISSING** |
| Chef QA / publication approval tasks | **MISSING** | Needs TaskService + cabinet |

#### Production

| Capability | Class | Evidence |
| --- | --- | --- |
| Production batch draft/finalize + posting/reverse | **EXISTS** (service) | `ProductionBatchService`, `ProductionPostingService`; tests `production-batch/posting.acceptance.test.ts` |
| Chef production task UX / HTTP | **MISSING** | No dedicated production routes in `apps/api/src/routes` |

#### POS / KDS

| Capability | Class | Evidence |
| --- | --- | --- |
| POS presentation resolve + select + cashier web | **EXISTS** | `pos` module; routes `/api/v1/pos/*`; `apps/web/src/cashier/*` |
| KDS / production routing runtime | **MISSING** | Documented PARTIAL in architecture-v1.3-gap-inspection; no KDS module |
| Employee biometrics | **MISSING** / privacy-constrained | ADR-0015 rejects default biometric voice ID; **out of first vertical** |

#### Reporting

| Capability | Class | Evidence |
| --- | --- | --- |
| Revenue basis / actual COGS / operating economics services | **PARTIAL** | `reporting/*` services + acceptance tests; no Owner/Accountant cabinet read hub HTTP |
| Accountant multi-client read inbox | **MISSING** | ADR-0022 allows read aggregation; runtime absent |

#### Task / Manager dispatcher (PO ACCEPTED Manager + PO delta)

| Capability | Class | Evidence |
| --- | --- | --- |
| Four-color TaskService; Manager may move **any** color incl. RED→YELLOW | **MISSING** / **LEVEL C** (ADR-0041 / PR-T0) | No TaskService in runtime |
| Manual priority change: reason + actor + from/to + time + immutable history | **MISSING** | — |
| `displayPriority` ≠ `originalSeverity` ≠ domain gates | **LEVEL C** | PO delta withdraws `priorityFloor` as reclassification ban |
| Channels A–D (Task / Owner ApprovalRequest / compliance / manual escalation) | **MISSING** | Must not collapse into one lifecycle |
| Priority change never disables legal/financial/food-safety/operational gates | **FORBIDDEN to bypass** | Encode in TaskService ADR |
| POS `identity_approval_request` | **EXISTS** (dangerous-op) | Separate from Ordinary Manager Task |

#### Workforce / payroll

| Capability | Class | Evidence |
| --- | --- | --- |
| `workforce_employee` stub + link from identity | **PARTIAL** | mig `027` |
| Payroll | **MISSING** / out of first vertical | ADR-0023 / ADR-0019 exclude payroll from MVP CM |

---

## 3. Exact architecture conflicts and remaining Level C decisions

### 3.1 Conflicts (must not paper over)

| Conflict | Detail |
| --- | --- |
| **Notion unread vs Gate 0 completeness** | Full handoff matrix blocked; any claim of “PO page parity” is false until export |
| **ADR-0039 Accepted vs Office runtime absent** | Docs Accepted; GlobalAccount not in migrations — Backoffice cabinets cannot assume OfficeSession |
| **ADR-0022 Accepted vs no ClientAccessGrant tables** | Professional path decided; Accountant cabinet blocked on Identity runtime |
| **PR #82 Proposed vs Gate 0** | Gate 0 must not Accept Amendment A / ADR-0040; Backoffice Identity depends on those OPEN decisions |
| **POS ApprovalRequest ≠ TaskService** | Reuse patterns (idempotency, audit, outbox) carefully; do not overload `identity_approval_request` into four-color tasks |
| **Display priority vs operational gates** | PO: Manager may reclassify any color with audit; reclassification must **never** disable gates; do **not** ban RED→YELLOW via `priorityFloor` |
| **Empty scope semantics** | R82-3 + PO §4: empty LE/Outlet fail-closed; explicit tenant-wide needs authorized scope + confirmation + audit |
| **DTO names vs Accepted ADRs** | Page 06 names are **PROPOSED**; do not rename Accepted ADR terms (`ClientAccessGrant`, `GlobalAccount`, PCE, etc.) |
| **Four channels** | Task ≠ Owner ApprovalRequest ≠ compliance/safety ≠ manual Owner escalation |

### 3.2 Remaining Level C decisions (known without Notion)

| ID | Decision | Blocks |
| --- | --- | --- |
| C-BO-01 | PO merge authorization for Gate 0 docs (#83) after delta | Merge of #83 only |
| C-BO-02 | TaskService ADR Accept (PR-T0 / ADR-0041) — displayPriority, channels A–D, reviewRequired, idempotency | Manager vertical + cabinets |
| C-BO-03 | OFFICE1.1 OPEN issues on PR #82 (OTP, trusted device, empty scope, unified hub, recovery) | Office Identity for cabinets |
| C-BO-04 | Mapping POS `identity_approval_request` ↔ Owner ApprovalRequest channel B (keep separate lifecycles) | Avoid double models |
| C-BO-05 | Bar ml-inventory / open-item floor / comps (ACCEPTED product; engineering detail OPEN) | Bar Manager vertical |
| C-BO-06 | Fiscal production provider selection / legal | Live fiscal beyond Core staging |
| C-BO-07 | Q Place / Q Card (export page missing; separate discovery) | Keep separate |
| C-BO-08 | Reminder/escalation timing defaults; automation policy matrix | Config OPEN per page 06/07 |

**Not Level C for first Manager vertical (brief §4):** Floor/Table, payroll, fiscal provider, biometrics, full Accounting.

---

## 4. Proposed TaskService domain / API / security contract

> **Status:** **Proposed** (Gate 0). Names below are **brief-derived proposals**, not Accepted ADR terms and not Notion DTO verbatim (Notion unread).

### 4.1 Domain placement

- New Core module: **`task`** (or `operations-task`) under ADR-0008-style ownership.
- Does **not** own inventory/financial truth; may **reference** source entities and emit audit.
- Does **not** replace Settlement/Payments/Fiscal gates.

### 4.2 Core entities (proposed)

```text
Task                              -- Channel A (Ordinary Manager Task)
  taskId, tenantId
  outletId?                       -- empty/omitted ≠ tenant-wide (fail-closed)
  displayPriority: RED|ORANGE|YELLOW|WHITE   -- Manager may move to ANY color
  originalSeverity: RED|ORANGE|YELLOW|WHITE  -- immutable at create/derive; not a ban on display moves
  status: OPEN | IN_PROGRESS | COMPLETED | CANCELLED | REVOKED | SUPERSEDED
  reviewRequired: boolean
  reviewStatus?: PENDING_REVIEW | APPROVED | REJECTED
  source: { type, id, eventId? }
  assignees: ActorRef[]
  deadlineAt?
  createdBy, createdAt
  derivationKey?
  revokedAt?, revokeReason?

TaskPriorityHistory             -- append-only
  taskId, actorId, at
  fromDisplayPriority, toDisplayPriority
  explanation (mandatory, non-empty)
  -- ALLOW any four-color transition including RED→YELLOW
  -- NEVER clears domain gates / ApprovalRequest / compliance holds

-- Separate entities / lifecycles (not Task subtypes that complete into approvals):
OwnerApprovalRequest            -- Channel B
ComplianceSafetyIncident        -- Channel C
OwnerEscalation                 -- Channel D (manual Manager → Owner)

TaskComment / TaskAttachment / TaskReminder
TaskAssignmentHistory
```

> Names above are **PROPOSED** engineering labels (page 06). Not Accepted ADR identifiers until PR-T0 Accept.

### 4.3 Invariants (PO delta)

1. **Four-color freedom:** Manager may change `displayPriority` to any of RED/ORANGE/YELLOW/WHITE with audited reason; **no** `priorityFloor` ban on RED→YELLOW.
2. **Triple separation:** `displayPriority` ≠ `originalSeverity` ≠ backend legal/financial/food-safety/operational gates.
3. **No gate bypass:** completing a Task or changing its color must not approve payments, recipe publish, refunds, or regulated ops; must not clear compliance holds.
4. **Channel separation:** A/B/C/D remain distinct; Manager ops notify Manager only; Owner push only via B, C (where mandated), or D.
5. **Idempotent derivation:** `(tenantId, derivationKey)` → same Task or SUPERSEDE+audit.
6. **Permissions:** fail-closed empty LE/Outlet; explicit tenant-wide requires authorized scope + confirmation + audit; professional ≠ membership.
7. **Audit + stale revoke:** append-only history; membership/outlet leave revokes or forces reassign.

### 4.4 API sketch (proposed)

```text
POST   /api/v1/tasks                      -- create (manual) + idempotency-Key
POST   /api/v1/tasks:derive               -- internal/system; idempotent by derivationKey
GET    /api/v1/tasks/dispatcher           -- Manager four-color board (filters: outlet, lane, priority)
GET    /api/v1/tasks/:taskId
POST   /api/v1/tasks/:taskId/assign
POST   /api/v1/tasks/:taskId/comments
POST   /api/v1/tasks/:taskId/attachments
POST   /api/v1/tasks/:taskId/complete     -- if reviewRequired → PENDING_REVIEW
POST   /api/v1/tasks/:taskId/review       -- approve/reject + explanation
POST   /api/v1/tasks/:taskId/priority          -- any four-color move; mandatory explanation; never clears gates
POST   /api/v1/tasks/:taskId/escalate-owner    -- Channel D
POST   /api/v1/tasks/:taskId/revoke
-- Channels B/C use separate route families (OwnerApprovalRequest / ComplianceSafetyIncident)
```

Audience: **OfficeSession** (future) or explicitly authorized Manager principal — **not** guest; POS session may only create derivation events via server-side ports, not full dispatcher.

### 4.5 Event / retry

- Outbox events: `TASK_CREATED`, `TASK_ASSIGNED`, `TASK_COMPLETED`, `TASK_REVIEW_REQUIRED`, `TASK_OVERRIDDEN`, `TASK_REVOKED`, `TASK_REMINDER_DUE`.
- Consumers must be idempotent; reconnect replays outbox without duplicate Tasks (`derivationKey`).

### 4.6 Security

| Concern | Rule |
| --- | --- |
| AuthN | OfficeSession (post OFFICE1.1) for dispatcher; POS dangerous-op stays on existing approval path until C-BO-04 |
| AuthZ | `task.dispatch`, `task.complete`, `task.review`, `task.override`, `task.assign` permission keys (proposed) |
| PII | Attachments/comments via privacy controls (ADR-0015); no secrets in task payload |
| Cross-tenant | Forbidden; Accountant multi-client = multiple authorized single-tenant reads (ADR-0022) |

---

## 5. Minimal Manager dispatcher UX → API flow (first usable vertical)

### 5.1 In scope (end-to-end reviewable)

```text
Authorized manager context
  → live dispatcher (four-color board)
  → open contextual Task (linked source entity)
  → employee completion
  → optional manager reviewRequired approval
  → immutable audit trail
```

**Suggested first seed (uses existing runtime signals):**  
Derive a **Yellow/Orange WORK** task when a CashShift open **ApprovalRequest** is created (already exists) — *or* a manual Manager-created task against an open CashShift/Order — **without** collapsing ApprovalRequest into Task until C-BO-04.

Safer first vertical (fewer Level C couplings):

1. Manager with existing POS/tenant grant (today: `identity_user` + permission) **or** OfficeSession if OFFICE1.1 ships first.
2. Manual `POST /tasks` with outlet scope + assignee + optional `reviewRequired`.
3. Dispatcher `GET /tasks/dispatcher`.
4. Assignee `POST .../complete`.
5. Manager `POST .../review` when required.
6. Read audit events.

### 5.2 Existing runtime reusable

| Piece | Reuse |
| --- | --- |
| Tenant/outlet/user principals | `027` Identity |
| Permission check pattern | `assertPermission` |
| Outbox notifications | `identity_notification_outbox` pattern → task outbox |
| Audit pattern | `identity_audit_event` pattern → `task_audit_event` |
| Manager-as-approver UX precedent | OpeningCashScreen + approval routes |

### 5.3 New contracts required

| Contract | Need |
| --- | --- |
| TaskService ADR (C-BO-02) | Accept before migration |
| Task schema + permissions | New migration after Accept |
| Dispatcher HTTP + minimal Office/Manager UI | New routes; web surface beyond cashier |
| Derivation ports (optional phase 1.1) | From cash/order/fiscal events |

### 5.4 Explicitly excluded from first vertical

Floor/Table, payroll, fiscal provider, employee biometrics, full Accounting, Chef/Bar specialty, Accountant multi-client mutations.

---

## 6. Five-cabinet compatibility

| Cabinet | Shared TaskService use | Separate concerns | Accepted PO vs proposed names |
| --- | --- | --- | --- |
| **Owner** | Assign tasks; **OWNER_APPROVAL** lane; mandatory approval requests | Bootstrap / LegalEntity (ADR-0039); entitlements | Keep `GlobalAccount`, `CreateBusinessBootstrap`; do not invent Notion DTO as Accepted |
| **Manager** | Four-color dispatcher; overrides; reviewRequired | Operational alerts vs work | `priorityDisplay` / `priorityFloor` are **Proposed** |
| **Accountant** | Per-client task inbox for client-scoped work | Multi-client **read** hub (ADR-0022); single-tenant mutations; memberships ∪ ClientAccessGrant (PR #82 issue #4) | `ClientAccessGrant` **Accepted** name |
| **Chef** | Production / recipe / stock / QA tasks | Recipes + production posting services already exist | Do not rename Recipe/ProductionBatch |
| **Bar Manager** | Shared workflows + specialized risk tasks | ml inventory / risk ops → C-BO-05 after Notion | Specialty fields **Proposed** until Accept |

Compatibility rule: one Task kernel; cabinet UIs are projections + permission packs — not separate task engines.

---

## 7. Dependency graph and small PR sequence

```text
PR-G0  Gate 0 + PO delta + Notion matrix (#83)     Level C docs  ── await PO merge auth
        │
        ├─► PR-82 OFFICE1.1 (independent)         Level C ── OPEN issues; no silent Accept
        │
        ▼
PR-T0  TaskService ADR-0041 (separate PR)         Level C docs  ── this next
        │
        ▼
PR-T1  Task schema + permissions + audit          Level B (after ADR Accept)
        │
        ▼
PR-M1  Manager dispatcher API + minimal UI        Level B
        │
        ├─► Channel B/C engines (Owner approval / compliance)
        ├─► PR-A1 Accountant hub (after Identity)
        ├─► PR-C1 Chef bindings
        └─► PR-B1 Bar specialty
```

**Recommended next PR:** **PR-T0** TaskService ADR (separate docs-only PR; do not duplicate #83). Do **not** merge #83 until separate PO merge authorization. No runtime / migrations / #82 edits.

---

## 8. Implementation gates

| Gate | Condition |
| --- | --- |
| G0-NOTION | Readable export or Notion access for all required pages |
| G0-PO | PO Accept/adjust this reconciliation + priority of PR-T0 vs PR-82 |
| G-OFFICE | PR #82 OPEN issues resolved + Accept Amendment A/ADR-0040 as decided + merge auth |
| G-TASK-ADR | TaskService ADR Accepted |
| G-MGR-V1 | PR-T1 + PR-M1 reviewed; no Floor/payroll/fiscal-provider/biometrics/Accounting bundled |
| G-PROVIDER | Legal/provider for live fiscal (separate) |

---

## 9. Independent reviews

Formal review packets (separate contexts — authoring agent did not self-approve):

| Review | Packet | Verdict |
| --- | --- | --- |
| Architecture | [`gate0-architecture-review.md`](../processes/review-packets/gate0-architecture-review.md) | **APPROVE** |
| Financial Security | [`gate0-financial-security-review.md`](../processes/review-packets/gate0-financial-security-review.md) | **APPROVE** |
| Privacy | [`gate0-privacy-review.md`](../processes/review-packets/gate0-privacy-review.md) | **APPROVE** |

FinSec residual (binds to future TaskService ADR C-BO-02, not Gate 0 rewrite): machine-checkable “override would skip a gate”; complete/revoke UX must not imply financial risk cleared.

---

## 10. Definition of done for this Gate 0 docs PR

- [x] Origin SHA + migration head recorded
- [x] PR #82 preserved; review issues filed separately
- [x] Notion inaccessibility reported page-by-page; archive requested via gate
- [x] Origin matrix produced with code paths (Notion matrix deferred)
- [x] TaskService proposed contract + Manager vertical + five-cabinet notes
- [x] Dependency graph + next PR recommendation
- [x] Independent reviews completed in separate contexts (all APPROVE)
- [x] PO APPROVE WITH CHANGES recorded; delta + Notion matrix applied
- [ ] Separate PO **merge authorization** for #83
- **STOP** before runtime, migration, merge, OFFICE1.1 Accept
- **Do not** arm merge-when-ready until PO merge authorization (Level C)
