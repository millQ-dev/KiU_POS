# PR #84 — ADR-0041 PO decision packet (ACCEPT WITH DELTAS)

- **PR:** [#84](https://cursor.com/codebase/millqdev/MillQ/pull/84)
- **PO verdict:** **ACCEPT WITH DELTAS** (2026-10-13) — D1–D4 applied below
- **STOP:** Do **not** merge until final ADR text confirmed by targeted reviewers
- **#82:** untouched · **#83:** merged on Origin `16c026a…` (authorized `a4fbb0d…`)

## Deltas D1–D4 (mandatory)

| ID | Requirement |
| --- | --- |
| D1 | OfficeSession for first Manager Dispatcher; POS PIN separate; future POS/Mobile task commands need explicit principal mapping |
| D2 | TaskService cannot independently approve regulated/financial ops; domain SoT authoritative |
| D3 | Reassign only to authorized Manager with `task.dispatch`; no auto Owner escalate from Channel A |
| D4 | No invented reminder SLAs; no broad auto-derive by default |

## Targeted reviews (post-delta)

| Review | Verdict |
| --- | --- |
| Architecture | **APPROVE** @ `9f20f59…` |
| Financial Security | **APPROVE** @ `9f20f59…` |
| Privacy | **APPROVE** @ `9f20f59…` |

## Final HEAD

`1a0e8c60a9b69a5431fc0f5fc6533b61a9d6549d`

---

## Complete ADR-0041 wording (post-delta)

# ADR-0041: TaskService & Manager Dispatcher (four-color tasks)

- **Status:** **Accepted WITH DELTAS** (PO 2026-10-13) — final ADR text on this PR tip pending targeted reviewer confirmation; **not** runtime authorization; **do not merge PR #84** until final text confirmed
- **Date:** 2026-10-13
- **Accepted (WITH DELTAS):** 2026-10-13
- **Decision owners:** Product Owner and System Architect
- **Autonomy:** Level **C**
- **Related:** Architecture v1.3 / ADR-0008; ADR-0015; ADR-0022; ADR-0036 (POS ApprovalRequest — separate); ADR-0039; Gate 0 merged via Origin PR #83 @ `16c026a…` / authorized tip `a4fbb0d…`; Notion handoff Manager + Engineering Contracts 13.10.2026
- **This PR:** Docs only. **No** migrations, **no** runtime. Independent of OFFICE1.1 PR #82 (do not Accept Amendment A / ADR-0040 here).
- **First implementation target (after final ADR confirmation + separate Level B authorization):** narrow **Manager Dispatcher** vertical only.
- **PO deltas applied:** D1 Identity (OfficeSession), D2 ApprovalRequest non-substitution, D3 Manager absence reassignment, D4 no invented SLAs / no broad auto-derive defaults.

---

## Context

KiU Backoffice Manager’s killer feature is a live four-color dispatcher (RED / ORANGE / YELLOW / WHITE) with contextual tasks. Gate 0 and the 13.10.2026 PO handoff require a shared Task kernel usable later by Owner / Accountant / Chef / Bar cabinets, without collapsing Owner approvals, compliance/safety incidents, or manual escalations into “task completed.”

Origin `main` @ Gate 0 baseline has **no** TaskService. POS `identity_approval_request` (mig `027`, ADR-0036) covers dangerous-operation approval only and must remain a **separate lifecycle**.

## Decision

### 1. Module ownership

Introduce Core module **Task** (operations dispatcher):

- **Owns:** Task, TaskPriorityHistory, TaskAssignment, TaskReminder, TaskComment/Attachment metadata, task audit/outbox, OwnerEscalation (Channel D linkage).
- **Does not own:** inventory/financial ledgers; Payment/Settlement/Fiscal satisfaction; recipe publish authority; bank execution; POS PIN sessions.
- **Must not** mark domain gates satisfied by Task completion or priority change.

### 2. Four channels (separate lifecycles)

| ID | Channel | Lifecycle |
| --- | --- | --- |
| **A** | Ordinary Manager Task | This ADR’s Task aggregate |
| **B** | Owner ApprovalRequest | Separate aggregate (recipe publish, threshold payment/expense, hire/fire, etc.). Completing a Task **never** approves these |
| **C** | Compliance / safety incident | Separate; statutory/food-safety/legal; not suppressible by UI preference or task color |
| **D** | Manual Owner escalation | Explicit Manager “Send to Owner”; not automatic on RED |

Manager operational notifications → **Manager only** by default. Owner receives B, mandated C, or D — not automatic dispatcher push.

**D2 — ApprovalRequest / domain SoT (Accepted WITH DELTAS):** TaskService **cannot** independently approve regulated or financial domain operations. Domain-specific authorization and source-of-truth state machines (Payments, Settlement, Fiscal, Recipe publish, inventory posting, POS dangerous-op ApprovalRequest, etc.) remain **authoritative**. Task completion, priority change, or review **never** substitutes for domain approval.

Mapping of existing POS `identity_approval_request` into Office Channel B (or keeping it POS-only beside Office Channel B) remains **OPEN** for schema design; until then, **do not** overload `identity_approval_request` rows as four-color Tasks.

### 3. Priority model (PO ACCEPTED)

- `displayPriority ∈ {RED, ORANGE, YELLOW, WHITE}` — Manager may move to **any** color, including **RED→YELLOW**.
- Every manual change **requires:** nonempty explanation; actor; previous priority; new priority; timestamp; append-only `TaskPriorityHistory`.
- `originalSeverity` — immutable snapshot at create/derive (system or creator initial). **Not** a prohibition on display reclassification.
- `displayPriority` ≠ `originalSeverity` ≠ backend safety/financial/legal/operational **gates**.
- Changing priority **must never** disable a mandatory gate.

**Rejected:** `priorityFloor` as a rule that forbids PO-approved red-to-yellow (or any four-color) reclassification.

### 4. Task aggregate (PROPOSED names — not frozen API)

```text
Task
  taskId, tenantId
  scope: { outletId?, legalEntityId?, warehouseId?, stationId? }
       -- omitted/empty fields do NOT mean tenant-wide (fail-closed)
  displayPriority, originalSeverity
  status: OPEN | IN_PROGRESS | AWAITING_REVIEW | COMPLETED | CANCELLED | REVOKED | SUPERSEDED
  reviewRequired: boolean
  sourceRef: { type, id, eventId? }   -- contextual link
  assignees[], deadlineAt?
  derivationKey?                      -- idempotent system derive
  createdBy, createdAt, ...
```

**reviewRequired:**

- `false`: assignee complete → COMPLETED.
- `true`: assignee complete → AWAITING_REVIEW; Manager approve → COMPLETED or reopen with comment.

Reminders: on overdue and while AWAITING_REVIEW (exact timing defaults **OPEN** — configurable later).

### 5. Authorization

- Every mutation server-checked; **denied by default**.
- Empty LegalEntity/Outlet (or other scope dimensions) **fail-closed** — never silent tenant-wide.
- Explicit tenant-wide grant: authorized capability + confirmation + audit.
- Manager Dispatcher (M1) audience: **OfficeSession** principal + grants (D1). POS PIN session is not a substitute.
- Proposed permission keys (modeling labels, not final strings): `task.dispatch`, `task.create`, `task.assign`, `task.complete`, `task.review`, `task.priority`, `task.escalate_owner`.
- Professional `ClientAccessGrant` path remains independent of employee membership (ADR-0022).

### 6. State machine and `reviewRequired` (Channel A)

```text
OPEN
  → IN_PROGRESS          (assignee starts / system marks active)
  → AWAITING_REVIEW      (assignee completes AND reviewRequired=true)
  → COMPLETED            (assignee completes AND reviewRequired=false
                          OR manager approves review)
  → OPEN / IN_PROGRESS   (manager rejects review / reopen + comment)
  → CANCELLED            (authorized cancel)
  → REVOKED              (grant/membership/outlet leave / explicit revoke)
  → SUPERSEDED           (idempotent re-derive replaces prior open task)
```

- Terminal for reminder purposes: COMPLETED, CANCELLED, REVOKED, SUPERSEDED.
- Priority changes allowed in non-terminal states; history append-only; never implies gate clearance.

### 7. Idempotent `derivationKey` (boundaries + concurrency)

- **Uniqueness scope:** `(tenantId, derivationKey)` — derivationKey **must not** be unique only globally across tenants.
- **Recommended key content (PROPOSED):** stable hash/string of `{sourceType, sourceId, eventId|occurrenceId, ruleId}` within the tenant. Do not include mutable displayPriority.
- **Retry / reconnect:** same key → return existing Task (same taskId); no second open Task.
- **Concurrency:** insert under uniqueness constraint; loser reads winner; never two OPEN rows for same key.
- **SUPERSEDE:** only when rule explicitly replaces prior open Task (e.g. corrected source event); prior → SUPERSEDED + audit; new Task new taskId with link to prior.
- **Cross-tenant:** derivationKey from tenant A never creates/reads Task in tenant B.

### 8. Reminders, notification failure, deduplication

- Reminder rows keyed by `(taskId, reminderKind, dueSlot)` (PROPOSED) so scheduler retries do not spam duplicates.
- Kinds (PROPOSED): `DEADLINE_APPROACHING`, `OVERDUE`, `AWAITING_REVIEW`.
- Delivery via outbox: PENDING → SENT | FAILED; FAILED may retry with backoff; **dedupe on reminder key**, not on raw push attempts.
- Notification failure **must not** mutate Task status or clear gates; must not escalate to Owner as a side effect of Channel A delivery failure.
- Reminders **stop** once Task is terminal (§6). Exact SLA timings remain **OPEN**.

### 8.1 Safe display metadata (ADR-0015 — mandatory)

Align with existing Identity notification pattern (`notification-port.ts` / `DANGEROUS_OPERATION_APPROVAL_REQUESTED`):

- Task outbox events, Channel D escalation payloads, reminder pushes, and Task comment/attachment **metadata** must carry **safe display fields only**.
- **Forbidden** in payloads: PIN, session tokens, password hashes, OTP codes, raw payment credentials, private e-sign keys, unrestricted PII dumps.
- Attachment **bytes** (if any) follow Privacy Control Plane / retention rules (ADR-0015); Task row stores references + non-sensitive descriptors, not secrets.
- This rule is **not optional** for Accept; exact retention TTLs remain OPEN for Level B schema.

### 9. Manager absence, unavailable assignee, operational fallback (**D3**)

- If assignee unavailable (revoked grant, inactive, wrong outlet): **reassign** only to another **authorized** actor with the appropriate capability for that action, or leave OPEN unassigned with Manager-visible flag — **do not** silently notify Owner.
- If Manager on duty absent: reassignment / fallback **only** to another authorized Manager with **`task.dispatch`** (and matching outlet/tenant scope; tenant-wide only if explicit grant). If none: Task remains visible in outlet dispatcher for the next authorized Manager session — **still not** Owner auto-push.
- **No automatic Owner escalation** from the operational Manager Task channel (Channel A), including RED and Manager-absence cases.
- Statutory, compliance, and safety notifications (Channel C) remain **independent** of Manager-absence fallback.
- Channel D remains the only **manual** Manager-initiated Owner path for ordinary operational Tasks.
- Permission **revalidation** on every mutate: cached UI grants are insufficient; server re-checks scope + capability at command time.

### 10. Event routing (role-aware, grant-enforced)

- Task created/assigned/priority-changed/completed/review → notify **assignees / Manager dispatch audience** per grants.
- **No** automatic Owner push for Channel A (including RED).
- Channel D creates Owner-visible escalation with task/context snapshot.
- Channel B/C use their own notification policies (Mobile Owner approve, statutory).
- Cross-tenant notify/read/write: **denied**.

### 11. First usable Manager vertical (runtime scope after Accept) — **D1 / D4**

**D1 — Identity:** The first Manager Dispatcher vertical **requires an authorized `OfficeSession`**. POS PIN authentication (`identity_user` / TERMINAL/MOBILE sessions per ADR-0036/0039) **must remain separate** and must **not** be used as the Manager Dispatcher principal for this vertical. Future POS/Mobile **task commands** (e.g. employee complete-from-Mobile) need their **own explicit principal mapping and scope validation** — not silent reuse of POS PIN session as Office Manager.

**D4 — Defaults:** Do **not** invent reminder SLA numeric defaults in this ADR. Do **not** enable broad automated task derivation by default. Initial runtime must use **explicitly approved** events and configurations only (allowlisted derive rules + configured reminder policies when Level B ships).

**In:**

1. Authorized Manager via **OfficeSession** + `task.dispatch` (and related) grants on scoped outlet/tenant.
2. Live dispatcher read model (four columns).
3. Manual contextual Task create with sourceRef, assignee, deadline, displayPriority, reviewRequired.
4. Priority change any color + history.
5. Employee complete (+ optional review) via explicitly mapped principal (Office or future Mobile mapping — not POS PIN Manager session).
6. Manual Owner escalation (Channel D stub OK if Owner inbox deferred).
7. Immutable audit.
8. Tests listed in §13.

**Out of first vertical:** Floor/Table, payroll, bank execution, biometry/selfie shift, fiscal provider, full Accounting, Chef/Bar specialty, OCR, Q Place/Q Card, **broad** automatic derivation, invented reminder SLAs, POS-PIN-as-Manager-Dispatcher.

### 12. Five-cabinet compatibility

One Task kernel; cabinets are projections + permission packs. Owner uses Channel B/D + task assign; Accountant client-scoped tasks after Identity grants (ADR-0022 single-tenant mutation); Chef/Bar attach production/QA/ml-stock sources — without separate task engines. Shared invariants: fail-closed scope, channel separation, gate non-bypass.

### 13. Concrete tests (required before runtime merge of Task PRs)

1. **RED→YELLOW** without explanation → reject; with explanation → history append; Owner **not** auto-notified.
2. **Manual escalation (D)** → Owner-targeted notification/record; Task Channel A remains distinct.
3. **Authorization denial:** actor without outlet grant cannot create/complete/priority-change; empty scope rejected; cross-tenant denied; permission revalidation on mutate.
4. **reviewRequired:** complete → AWAITING_REVIEW; approve/reopen works; reminders stop only when terminal.
5. **Idempotent derive:** duplicate `(tenantId, derivationKey)` under concurrency → one Task.
6. **Gate non-bypass:** completing Task / changing priority does not create Payment/Fiscal/RecipePublish approval side effects.
7. **Assignee unavailable:** reassign/unassign Manager-visible; no silent Owner notify.
8. **Reminder dedupe:** repeated scheduler ticks do not create duplicate reminder deliveries for same `(taskId, kind, dueSlot)`.

### 14. Acceptance consequences

**Accept WITH DELTAS** (this text, after targeted review confirmation) authorizes **design** of TaskService and subsequent Level B schema/API PRs under the above invariants. It does **not** authorize:

- TaskService **runtime** or migrations without a **separate Level B authorization**;
- OFFICE1.1 Accept / merge of PR #82;
- fiscal provider go-live;
- inventing Q Place/Q Card requirements;
- merge of PR #84 until final ADR text is confirmed.

Gate 0 PR #83 is already merged on Origin (`16c026a…`).

### 15. Classification map (post-delta)

| Class | Items |
| --- | --- |
| **PO ACCEPTED behavior (incl. D1–D4)** | Four colors; unrestricted manual reprioritization with reason + immutable history; `originalSeverity` ≠ `displayPriority` ≠ gates; channels A/B/C/D; fail-closed scopes; idempotency + audit; `reviewRequired`; Privacy §8.1; **OfficeSession** for first Manager Dispatcher; POS PIN separate; Task never substitutes domain approval; absence reassignment only to authorized `task.dispatch` Managers; no auto Owner escalate from Channel A; no invented reminder SLAs; no broad auto-derive by default |
| **Proposed technical choices** | Entity/DTO names; state enum; derivationKey composition; reminder keying; permission_key labels; HTTP shapes; SUPERSEDE rules; Mobile/POS **future** task-command principal mapping (must be explicit when designed) |
| **Open Level C / design** | Exact reminder SLA numbers (when configured); Channel B vs POS `identity_approval_request` table mapping; Mobile employee-complete principal mapping ADR note; allowlisted derive-event catalog for first ship |
| **Runtime blockers (before M1 ship)** | Final ADR text confirmation + PR #84 merge; separate Level B auth; OfficeSession runtime (OFFICE1.1 path); schema+API; `task.*` grants; tests §13 |
| **Deferrable** | Broad auto-derive; Owner/Accountant/Chef/Bar full UIs; Floor/Table; payroll; bank; biometry; fiscal provider; OCR |

## Alternatives considered

- Overload `identity_approval_request` as four-color Task — **rejected** (channels must stay separate).
- `priorityFloor` forbidding RED→YELLOW — **rejected** by PO 2026-10-13.
- Auto-push all RED tasks to Owner — **rejected** (PO Manager policy).
- Per-cabinet separate task databases — **rejected** (shared kernel).
- Silent Owner notify on Manager absence — **rejected** (D3).
- POS PIN session as Manager Dispatcher principal for M1 — **rejected** (D1).
- Broad auto-derive / invented reminder SLAs by default — **rejected** (D4).

## OPEN (do not invent)

- Exact reminder SLA numeric values **when** a configured policy is later approved (D4 forbids inventing defaults now).
- Final permission_key strings and HTTP paths.
- Explicit Mobile/POS **task-command** principal mapping (future; not M1 Manager Dispatcher).
- Channel B schema vs reuse/extend POS approval tables.
- Allowlisted derive-event catalog for first Level B ship (empty/default = no auto-derive).
- Selfie shift check-in retention (privacy) — out of M1.
