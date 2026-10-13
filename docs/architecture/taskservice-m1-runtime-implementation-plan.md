# TaskService M1 — minimal runtime implementation plan (Level B prep)

- **Status:** Plan only — **not** Level B authorization; **no** migrations/runtime until separate PO/Level B GO
- **Depends on:** Origin main with Gate 0 (#83 merged); ADR-0041 final text confirmed + PR #84 merge; OfficeSession capability (OFFICE1.1 path / ADR-0039 runtime)
- **Date:** 2026-10-13

## Goal (first usable vertical)

```text
Authorized Manager (OfficeSession)
  → live Dispatcher (4 colors)
  → Contextual Task (sourceRef)
  → Employee completion
  → Optional manager reviewRequired
  → Immutable audit
```

## Prerequisites (blockers)

1. ADR-0041 final text confirmed; PR #84 merged (docs).
2. Separate **Level B** authorization for schema/API.
3. **OfficeSession** authenticate/authorize path available for Manager (D1) — may sequence after or with OFFICE1.1 runtime; M1 must not ship on POS PIN.
4. Permission keys seeded: `task.dispatch`, `task.create`, `task.assign`, `task.complete`, `task.review`, `task.priority`, `task.escalate_owner` (final strings per ADR).

## Proposed Level B PR sequence (after GO)

| PR | Scope |
| --- | --- |
| **T1** | Migration: `task`, `task_priority_history`, `task_assignment`, `task_reminder`, `task_audit_event`, `task_outbox`; uniqueness `(tenant_id, derivation_key)`; fail-closed scope constraints |
| **T2** | TaskService domain module + idempotent create/priority/complete/review/revoke; §8.1 safe metadata outbox |
| **T3** | HTTP: dispatcher list + task commands; OfficeSession authn/z |
| **T4** | Minimal Manager Dispatcher UI (or API-only acceptance harness if UI deferred) |
| **T5** | Acceptance tests from ADR §13 (RED→YELLOW, authz denial, reviewRequired, no Owner auto-push, gate non-bypass, reminder dedupe, absence reassignment) |

## Explicit non-goals for M1

Floor/Table, payroll, bank execution, biometry, fiscal provider, full Accounting, broad auto-derive, invented reminder SLAs, POS-PIN Manager session, Q Place/Q Card.

## Channel stubs

- **A:** full M1 Task path.
- **B/C:** do not implement full engines in M1; ensure Task APIs cannot mark domain approvals satisfied (D2).
- **D:** minimal escalate-owner record + safe-metadata notify stub OK.

## STOP

Do not begin T1–T5 without separate Level B authorization after ADR-0041 confirmation.
