# PR #84 — ADR-0041 PO decision packet (self-contained)

- **PR:** Origin [#84](https://cursor.com/codebase/millqdev/MillQ/pull/84)
- **Branch:** `docs/taskservice-adr-0041`
- **Base:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **Autonomy:** Level **C** docs-only — **not** merge/runtime authorization
- **STOP:** No schema, no runtime, no merge, do not modify PR #82

## Code / document references (Origin `main` baseline)

| Ref | Path / note |
| --- | --- |
| No TaskService runtime | confirmed absent on `main` |
| POS ApprovalRequest (separate) | `apps/api/migrations/027_identity_access_foundation.sql` (`identity_approval_request`); `apps/api/src/modules/identity/login-challenge-service.ts`; ADR-0036 |
| Permission pattern | `IdentityService.assertPermission` — `apps/api/src/modules/identity/identity-service.ts` |
| Notification outbox pattern | `apps/api/src/modules/identity/notification-port.ts`; `identity_notification_outbox` |
| Audit pattern | `identity_audit_event` in mig `027` |
| FISC1.1 Core (gates must not be bypassed by Task) | `apps/api/src/modules/fiscalization/`; mig `032`; ADR-0014 |
| Professional access | ADR-0022 Accepted |
| Gate 0 PO delta (priority/channels) | PR #83 docs (separate); durable handoff snapshot on #83 |
| OFFICE1.1 | PR #82 draft — independent; do not Accept here |

## Classification summary

See ADR §15 embedded below: **PO ACCEPTED** vs **Proposed technical** vs **Open Level C** vs **Runtime blockers** vs **Deferrable**.

## Independent reviews

| Review | Verdict | Packet |
| --- | --- | --- |
| Architecture | PENDING | `adr-0041-architecture-review.md` |
| Financial Security | PENDING | `adr-0041-finsec-review.md` |
| Privacy | PENDING | `adr-0041-privacy-review.md` |

## Final HEAD

_(set after push)_

---

## Complete proposed ADR-0041 wording

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

### 9. Manager absence, unavailable assignee, operational fallback

- If assignee unavailable (revoked grant, inactive, wrong outlet): **reassign** within Manager dispatch audience or leave OPEN unassigned with Manager-visible flag — **do not** silently notify Owner.
- If Manager on duty absent: fallback to **other Managers with `task.dispatch` on same outlet scope** (or tenant-wide only if explicit grant). If none: Task remains visible in outlet dispatcher for next authorized Manager session; optional outlet-level escalation list is **OPEN** config — still **not** Owner auto-push.
- Channel D remains the only Manager-initiated Owner path for ordinary operational Tasks.
- Permission **revalidation** on every mutate: cached UI grants are insufficient; server re-checks scope + capability at command time.

### 10. Event routing (role-aware, grant-enforced)

- Task created/assigned/priority-changed/completed/review → notify **assignees / Manager dispatch audience** per grants.
- **No** automatic Owner push for Channel A (including RED).
- Channel D creates Owner-visible escalation with task/context snapshot.
- Channel B/C use their own notification policies (Mobile Owner approve, statutory).
- Cross-tenant notify/read/write: **denied**.

### 11. First usable Manager vertical (runtime scope after Accept)

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

Accepting this ADR authorizes **design** of TaskService and subsequent Level B schema/API PRs under the above invariants. It does **not** authorize:

- merge of Gate 0 #83 without separate PO merge auth;
- OFFICE1.1 Accept;
- fiscal provider go-live;
- inventing Q Place/Q Card requirements.

### 15. Classification map (for PO decision)

| Class | Items |
| --- | --- |
| **Already PO ACCEPTED behavior** | Four colors; Manager may move any color with reason+audit; display ≠ gates; manager-only ops notify; manual Owner escalate; reviewRequired workflow; empty scope fail-closed; Task complete ≠ regulated approve; food-safety/legal gates independent; Q Place/Q Card out of this delivery |
| **Proposed technical choices** | Entity/DTO names; state enum; derivationKey composition; reminder keying; permission_key labels; HTTP shapes; SUPERSEDE rules; Manager-fallback to other `task.dispatch` holders |
| **Open Level C** | Reminder SLA defaults; OfficeSession vs POS principal; Channel B vs POS `identity_approval_request` table mapping; automation rule matrix; outlet escalation list when no Manager |
| **Runtime blockers (before M1 ship)** | ADR Accept; schema+API PR; Identity grants for `task.*`; independent reviews+tests §13 |
| **Deferrable** | Auto-derive from all domain events; Owner/Accountant/Chef/Bar full UIs; Floor/Table; payroll; bank; biometry; fiscal provider; OCR |

## Alternatives considered

- Overload `identity_approval_request` as four-color Task — **rejected** (channels must stay separate).
- `priorityFloor` forbidding RED→YELLOW — **rejected** by PO 2026-10-13.
- Auto-push all RED tasks to Owner — **rejected** (PO Manager policy).
- Per-cabinet separate task databases — **rejected** (shared kernel).
- Silent Owner notify on Manager absence — **rejected**.

## OPEN (do not invent)

- Exact reminder SLAs and automation rule matrix defaults.
- Final permission_key strings and HTTP paths.
- OfficeSession vs POS principal binding for Manager cabinet.
- Channel B schema vs reuse/extend POS approval tables.
- Selfie shift check-in retention (privacy) — out of M1.
- Outlet-level on-call escalation list when zero Managers available.

---

## PO decision request

Respond with: **ACCEPT** / **ACCEPT WITH DELTAS** / **REJECT**, listing any mandatory deltas before Accept. Runtime remains forbidden until Accept + separate Level B PRs + reviews.
