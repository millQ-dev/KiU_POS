# ADR-0041: TaskService & Manager Dispatcher (four-color tasks)

- **Status:** **Proposed** (Level C — docs only; **not Accepted**; **not** runtime authorization)
- **Date:** 2026-10-13
- **Decision owners:** Product Owner and System Architect
- **Autonomy:** Level **C**
- **Related:** Architecture v1.3 / ADR-0008; ADR-0015; ADR-0022; ADR-0036 (POS ApprovalRequest — separate); ADR-0039; Gate 0 [`backoffice-gate0-po-delta-2026-10-13.md`](../architecture/backoffice-gate0-po-delta-2026-10-13.md) (PO APPROVE WITH CHANGES on #83); Notion handoff Manager + Engineering Contracts 13.10.2026
- **This PR:** Docs only. **No** migrations, **no** runtime. Independent of OFFICE1.1 PR #82 (do not Accept Amendment A / ADR-0040 here).
- **First implementation target (after Accept + separate runtime PRs):** narrow **Manager Dispatcher** vertical only.

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

Mapping of existing POS `identity_approval_request` into Channel B (or keeping it POS-only beside Office Channel B) is **OPEN** for a follow-up Accept note; until then, **do not** overload `identity_approval_request` rows as four-color Tasks.

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
- Proposed permission keys (modeling labels, not final strings): `task.dispatch`, `task.create`, `task.assign`, `task.complete`, `task.review`, `task.priority`, `task.escalate_owner`.
- Professional `ClientAccessGrant` path remains independent of employee membership (ADR-0022).

### 6. Idempotency, reconnect, revocation

- System-derived tasks: unique `(tenantId, derivationKey)`; retries/reconnect → same Task or SUPERSEDE + audit.
- Outbox delivery ACK / retry must not duplicate Tasks.
- On grant/membership revoke or outlet leave: open assignments REVOKED or require reassign — no silent keep.
- Stale assignee handling: configuration OPEN; must not leave orphaned ACTIVE without audit.

### 7. Event routing (role-aware, grant-enforced)

- Task created/assigned/priority-changed/completed/review → notify **assignees / Manager dispatch audience** per grants.
- **No** automatic Owner push for Channel A (including RED).
- Channel D creates Owner-visible escalation with task/context snapshot.
- Channel B/C use their own notification policies (Mobile Owner approve, statutory).

### 8. First usable Manager vertical (runtime scope after Accept)

**In:**

1. Authorized manager context (existing tenant `identity_user` + grants **or** OfficeSession when OFFICE1.1 ships — dual-stack must be explicit, not silent forever).
2. Live dispatcher read model (four columns).
3. Manual contextual Task create with sourceRef, assignee, deadline, displayPriority, reviewRequired.
4. Priority change any color + history.
5. Employee complete (+ optional review).
6. Manual Owner escalation (Channel D stub OK if Owner inbox deferred).
7. Immutable audit.
8. Tests listed in §10.

**Out of first vertical:** Floor/Table, payroll, bank execution, biometry/selfie shift, fiscal provider, full Accounting, Chef/Bar specialty, OCR, Q Place/Q Card, automatic derivation from all domain events (optional thin derive from one existing signal later — not required for M1).

### 9. Five-cabinet compatibility

One Task kernel; cabinets are projections + permission packs. Owner uses Channel B/D + task assign; Accountant client-scoped tasks after Identity grants; Chef/Bar attach production/QA sources — without separate task engines.

### 10. Concrete tests (required before runtime merge of Task PRs)

1. **RED→YELLOW** without explanation → reject; with explanation → history append; Owner **not** auto-notified.
2. **Manual escalation (D)** → Owner-targeted notification/record; Task Channel A remains distinct.
3. **Authorization denial:** actor without outlet grant cannot create/complete/priority-change; empty scope rejected; cross-tenant denied.
4. **reviewRequired:** complete → AWAITING_REVIEW; approve/reopen works; reminders stop only when truly COMPLETED.
5. **Idempotent derive** (when derive API exists): duplicate derivationKey → one Task.
6. **Gate non-bypass:** completing Task does not create Payment/Fiscal/RecipePublish approval side effects.

### 11. Acceptance consequences

Accepting this ADR authorizes **design** of TaskService and subsequent Level B schema/API PRs under the above invariants. It does **not** authorize:

- merge of Gate 0 #83 without separate PO merge auth;
- OFFICE1.1 Accept;
- fiscal provider go-live;
- inventing unread Q Place/Q Card requirements.

## Alternatives considered

- Overload `identity_approval_request` as four-color Task — **rejected** (channels must stay separate).
- `priorityFloor` forbidding RED→YELLOW — **rejected** by PO 2026-10-13.
- Auto-push all RED tasks to Owner — **rejected** (PO Manager policy).
- Per-cabinet separate task databases — **rejected** (shared kernel).

## OPEN (do not invent)

- Exact reminder SLAs and automation rule matrix defaults.
- Final permission_key strings and HTTP paths.
- OfficeSession vs POS principal binding for Manager cabinet.
- Channel B schema vs reuse/extend POS approval tables.
- Selfie shift check-in retention (privacy) — out of M1.
