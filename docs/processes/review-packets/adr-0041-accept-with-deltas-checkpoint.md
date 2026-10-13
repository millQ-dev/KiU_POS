# PR #84 — ADR-0041 ACCEPT WITH DELTAS checkpoint

- **PO verdict:** ACCEPT WITH DELTAS (2026-10-13)
- **PR:** [#84](https://cursor.com/codebase/millqdev/MillQ/pull/84)
- **Rule:** **Do not merge** until final ADR text is confirmed by targeted reviewers after D1–D4.
- **Independent of:** PR #82 (untouched); Gate 0 #83 already merged on Origin.

## Mandatory deltas applied

| ID | Clarification | ADR section |
| --- | --- | --- |
| **D1** | First Manager Dispatcher requires **OfficeSession**; POS PIN remains separate; future POS/Mobile task commands need explicit principal mapping | §5, §11 |
| **D2** | TaskService cannot independently approve regulated/financial ops; domain SoT authoritative; Task complete ≠ domain approval | §2 |
| **D3** | Absence reassignment only to authorized Manager with `task.dispatch`; no auto Owner escalate from Channel A; Channel C independent | §9 |
| **D4** | Do not invent reminder SLAs; do not enable broad auto-derive by default; allowlisted events/config only | §11, OPEN |

## Preserved accepted requirements

Four colors; unrestricted manual reprioritization with reason; immutable priority history; `originalSeverity` ≠ `displayPriority`; channels A/B/C/D; fail-closed scopes; idempotency + audit; `reviewRequired`; Privacy §8.1.

## Post-delta HEAD

`1a0e8c60a9b69a5431fc0f5fc6533b61a9d6549d`

## Targeted reviewer confirmation

| Review | Focus | Verdict |
| --- | --- | --- |
| Architecture | D1–D4 contract honesty | **APPROVE** @ `9f20f592777951e77656eb527c945ca941eaeac6` ([delta review](./adr-0041-delta-architecture-review.md)) |
| Financial Security | D2 gate non-substitution (+ D3 no auto Owner escalate) | **APPROVE** — [`adr-0041-delta-finsec-review.md`](./adr-0041-delta-finsec-review.md) @ `9f20f59…` |
| Privacy | §8.1 still holds; D1 session separation | **APPROVE** (`adr-0041-delta-privacy-review.md` @ `9f20f59…`) |

## Runtime stance

Separate **Level B authorization** required before schema/migrations/runtime. See [`taskservice-m1-runtime-implementation-plan.md`](../architecture/taskservice-m1-runtime-implementation-plan.md) (plan only).
