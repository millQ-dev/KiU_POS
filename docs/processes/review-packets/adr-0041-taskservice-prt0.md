# PR-T0 — ADR-0041 TaskService (Level C docs)

- **Branch:** `docs/taskservice-adr-0041`
- **Base:** Origin `main` @ `18316b8f8aa2da6d045b04aebbde3c5434ea046e` (at branch creation)
- **Status:** Proposed ADR — **not Accepted**; no runtime; no migrations
- **Does not modify:** PR #82, Gate 0 #83 contents (separate PR; references Gate 0 PO delta by path after merge)

## Contract boundaries (summary)

- First vertical: Manager Dispatcher only (create, four-color priority+audit, reviewRequired, escalate-owner, authz denial, idempotency hooks).
- Channels A/B/C/D separated; Task complete ≠ payment/recipe/refund approve.
- No `priorityFloor` ban on RED→YELLOW; gates independent of color.
- Fail-closed empty scope; professional ≠ membership.
- Out: Floor/Table, payroll, bank exec, biometry, fiscal provider, Accounting, Q Place/Q Card.

## Reviews

Independent Architecture / FinSec / Privacy reviews **pending** after PR open (author must not self-approve).

## STOP

Await PO Accept of ADR-0041 before schema/runtime PRs. Do not merge without independent review + PO decision (Level C).
