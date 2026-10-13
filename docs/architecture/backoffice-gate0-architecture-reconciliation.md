# KiU Backoffice — GATE 0 / Architecture Reconciliation

- **Autonomy:** Level **C** (docs-only)
- **Date:** 2026-10-13
- **Canonical Origin baseline:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **Branch:** `docs/backoffice-gate0-reconciliation`
- **STOP:** No runtime, no migrations, no merge, no OFFICE1.1 Accept/merge, no Backoffice implementation without subsequent PO authorization.

---

## 0. Execution status and Notion access blocker

### 0.1 Notion pages — inaccessible (login wall)

Attempted URL (main index):  
https://app.notion.com/p/3f721d5d34878197bab3c0f34c6b3867

Browser result: Notion login modal for **«Илья Елизавета's Space»** (email / Google / Apple / Microsoft / Passkey / SSO). No authenticated session available to this agent. Background page content is blurred and unread.

**Pages that could not be read (all required children):**

| # | Page | Status |
| --- | --- | --- |
| 1 | Main index `3f721d5d34878197bab3c0f34c6b3867` | INACCESSIBLE — login wall |
| 2 | 00 Handoff index | INACCESSIBLE (child of index; not reachable) |
| 3 | Owner | INACCESSIBLE |
| 4 | Manager | INACCESSIBLE |
| 5 | Accountant | INACCESSIBLE |
| 6 | Chef | INACCESSIBLE |
| 7 | Bar Manager | INACCESSIBLE |
| 8 | Engineering Contracts | INACCESSIBLE |
| 9 | Implementation Roadmap | INACCESSIBLE |

### 0.2 Exported handoff archive

Searched local paths (`Downloads`, `Desktop`, `Documents`, MillQ tree, agent stores). **No** 13.10.2026 Backoffice handoff export (zip/md/html) found.

**Gate:** Requirement-by-requirement classification against the PO-accepted Notion handoff **cannot** be completed until PO provides a readable export (or Notion access). This document **does not invent** Notion page requirements.

### 0.3 What this Gate 0 *does* cover (allowed sources)

| Source | Use |
| --- | --- |
| Origin `main` @ `18316b8…` | Runtime / migration / route / test inventory |
| Accepted ADRs on main | Boundaries already decided |
| Gate 0 brief (this task) §§3–5 | Explicit TaskService / Manager vertical / five-cabinet constraints — treated as **brief-stated** requirements, not Notion paraphrases |
| Origin PR #82 (draft, tip `142adb26…`) | Preserve OFFICE1.1; record open review issues; **do not** Accept Amendment A / ADR-0040 |

**Q Place / Q Card** remains a separate discovery stream (out of scope).

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

Rows below classify **Origin runtime vs Accepted ADRs + Gate 0 brief**. They are **not** a line-by-line Notion handoff matrix. After the export is available, each Notion requirement must be re-classified without changing Accepted ADR boundaries unless PO re-opens them.

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

#### Task / Manager dispatcher (brief §§3–4)

| Capability | Class | Evidence |
| --- | --- | --- |
| Four-color TaskService | **MISSING** / **LEVEL C** (new domain ADR) | Zero matches for TaskService/dispatcher in repo |
| Manager overrides + immutable history | **MISSING** | ApprovalRequest is POS dangerous-op only — related pattern, not Task override |
| Operational alerts vs Owner approval vs legal/safety vs escalation lanes | **MISSING** | Only `DANGEROUS_OPERATION_APPROVAL_REQUESTED` outbox type |
| Priority bypass of safety/financial gates | **FORBIDDEN** (brief) | Must be encoded in TaskService ADR |

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
| **Display priority vs operational gates** | Brief forbids lowering display priority to bypass safety/financial gates — must be a hard invariant in Task ADR |
| **Empty scope semantics** | PR #82 issue #3 + existing grant indexes: empty LE/Outlet must not mean tenant-wide — Task scopes must follow same fail-closed rule |
| **DTO names vs Accepted ADRs** | Notion/Engineering Contracts names (unread) are **proposed labels** until Accept; do not rename Accepted ADR terms (`ClientAccessGrant`, `GlobalAccount`, PCE, etc.) |

### 3.2 Remaining Level C decisions (known without Notion)

| ID | Decision | Blocks |
| --- | --- | --- |
| C-BO-01 | Consume / Accept Notion Backoffice handoff export (page-level requirements) | Full requirement matrix |
| C-BO-02 | TaskService domain ADR (priorities, lanes, override, reviewRequired, idempotent derivation) | Manager vertical + all cabinets |
| C-BO-03 | OFFICE1.1 OPEN issues on PR #82 (OTP, trusted device, empty scope, unified hub, recovery) | Office Identity for cabinets |
| C-BO-04 | Whether POS `identity_approval_request` remains a separate lane vs becomes a Task subtype | Avoid double models |
| C-BO-05 | Bar ml-inventory / specialized risk ops (after Notion) | Bar Manager vertical |
| C-BO-06 | Fiscal production provider selection / legal | Live fiscal beyond Core staging |
| C-BO-07 | Q Place / Q Card stream boundary confirmation | Keep separate |

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
Task
  taskId, tenantId
  outletId?                    -- null only if explicitly tenant-scoped grant allows; empty ≠ tenant-wide
  priorityDisplay: RED|ORANGE|YELLOW|WHITE
  priorityFloor: RED|ORANGE|YELLOW|WHITE   -- immutable min from derivation rules; display may raise, never lower below floor
  lane: OPERATIONAL_ALERT | OWNER_APPROVAL | LEGAL_SAFETY | MANUAL_ESCALATION | WORK
  status: OPEN | IN_PROGRESS | COMPLETED | CANCELLED | REVOKED | SUPERSEDED
  reviewRequired: boolean
  reviewStatus?: PENDING_REVIEW | APPROVED | REJECTED
  source: { type, id, eventId? }   -- contextual link
  assignees: ActorRef[]
  deadlineAt?
  createdBy, createdAt
  derivationKey?               -- for idempotent system-derived tasks
  revokedAt?, revokeReason?

TaskOverrideEvent              -- immutable
  taskId, actorId, at
  fromPriorityDisplay, toPriorityDisplay
  explanation (mandatory, non-empty)
  -- REJECT if toPriorityDisplay < priorityFloor OR if override would skip a gate

TaskComment / TaskAttachment / TaskReminder
TaskAssignmentHistory          -- assign, reassign, revoke, stale
```

### 4.3 Invariants

1. **Priority floor:** system-derived `priorityFloor` cannot be reduced by Manager display override.
2. **No gate bypass:** completing/overriding a Task must not mark fiscal/inventory/payment gates satisfied.
3. **Idempotent derivation:** same `(tenantId, derivationKey)` → same Task (or SUPERSEDE with audit), safe under reconnect/retry.
4. **Lane separation:** Owner approval requests and legal/safety events are not mixed into ordinary White work without explicit escalation rules.
5. **Permissions:** create/assign/complete/review/override scoped by Tenant + Outlet + actor grants; fail closed on empty scope.
6. **Audit:** every state change, override, review decision, revoke → immutable audit (extend or parallel `identity_audit_event` pattern; prefer task-owned audit table).
7. **Stale assignment / revocation:** on membership revoke or outlet leave, open assignments become REVOKED or require reassign; no silent keep.

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
POST   /api/v1/tasks/:taskId/override-priority  -- mandatory explanation; floor checked
POST   /api/v1/tasks/:taskId/revoke
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
[GATE] Notion export readable
        │
        ▼
PR-G0  Gate 0 reconciliation docs (this)          Level C docs  ── STOP for PO
        │
        ├─► PR-82 OFFICE1.1 Accept/merge          Level C ── only after OPEN issues closed by PO
        │         │
        │         ▼
        │    PR-ID Office GlobalAccount runtime   Level B/C mix per ADR
        │
        ▼
PR-T0  TaskService ADR (C-BO-02)                  Level C docs
        │
        ▼
PR-T1  Task schema + permissions + audit          Level B
        │
        ▼
PR-M1  Manager dispatcher API + minimal UI vertical Level B
        │
        ├─► PR-O1 Owner approval lane bindings
        ├─► PR-A1 Accountant read hub (after Identity grants)
        ├─► PR-C1 Chef task bindings to recipes/production
        └─► PR-B1 Bar specialty (after C-BO-05)
```

**Recommended next PR after this Gate 0:**  
**Not** runtime. Either (a) PO delivers Notion export → Gate 0 addendum matrix PR, or (b) PO authorizes TaskService ADR draft PR (**PR-T0**) **after** confirming Notion-critical Manager requirements.  
**Do not** start OFFICE1.1 runtime or Backoffice implementation without PO authorization.

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
- [ ] PO decision on G0-NOTION / G0-PO
- **STOP** before runtime, migration, merge, OFFICE1.1 Accept
- **Do not** arm merge-when-ready until PO records G0-PO (Level C)
