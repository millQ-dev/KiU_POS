# PR #84 — ADR-0041 architecture review (independent)

- **Subject:** ADR-0041 TaskService Manager Dispatcher @ exact PR #84 HEAD
- **Reviewed HEAD:** `79b107386b72f0d5a0f835c27d2fe1f025045333` (content tip `1977443784848396dbba82617f946e3bf0ce62ab` + packet HEAD stamp)
- **Branch:** `docs/taskservice-adr-0041`
- **Base:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **Autonomy of subject:** Level C docs-only — **not** Accept, merge, or runtime authorization
- **Reviewer context:** independent of authoring agent
- **Reviewed:** 2026-10-13 (Architecture Review Agent — separate context; no Accept, no merge, no runtime edits)

## Checklist

- [x] State machine + `reviewRequired` (§4, §6): OPEN→IN_PROGRESS / complete→COMPLETED or AWAITING_REVIEW; manager approve/reopen; terminal set stops reminders
- [x] Four colors any-move + audit (§3): RED/ORANGE/YELLOW/WHITE incl. RED→YELLOW; nonempty reason + append-only `TaskPriorityHistory`; `priorityFloor` ban rejected
- [x] `originalSeverity` vs `displayPriority` (§3): immutable snapshot ≠ mutable display ≠ domain gates
- [x] Channels A–D (§2): separate lifecycles; Task complete ≠ Owner approve; no auto Owner push on RED; POS `identity_approval_request` not overloaded
- [x] Fail-closed scope (§5): empty LE/Outlet never silent tenant-wide; deny-by-default mutations
- [x] `derivationKey` tenant/concurrency (§7): uniqueness `(tenantId, derivationKey)`; loser-reads-winner; cross-tenant denied
- [x] Reminder dedupe (§8): key `(taskId, reminderKind, dueSlot)`; outbox retries without spam; failure does not mutate status/gates/Owner
- [x] Manager absence without Owner auto-push (§9): peer `task.dispatch` fallback or stay in outlet dispatcher; Channel D only for Owner path
- [x] Gate non-bypass (§1, §3, §13.6): Task complete/priority never satisfies Payment/Fiscal/RecipePublish/safety gates
- [x] Five-cabinet compatibility (§12): one kernel + projections/permission packs; ADR-0022 Accountant single-tenant mutation preserved
- [x] Classification map §15: PO ACCEPTED vs Proposed technical vs Open Level C vs blockers vs deferrable — honest and usable for PO
- [x] Docs-only: 7 files under `docs/` only (+499/−0); no migrations/runtime
- [x] No #82 edits: references only; no Amendment A / ADR-0040 Accept; OFFICE1.1 stays independent

## Adequacy

| Axis | Adequate? | Note |
| --- | --- | --- |
| Level C honesty | **Yes** | Status Proposed; Accept authorizes design only; STOP on merge/runtime/#82 |
| Gate 0 PO delta alignment | **Yes** | Matches #83 PO delta: any-color moves, three-way inequality, channels A–D, fail-closed, no Owner auto-push |
| Module boundaries | **Yes** | Task owns dispatcher aggregates + Channel D linkage; does not own ledgers/fiscal/recipe/PIN; domain-module-map row Proposed-only |
| Runtime readiness claim | **Yes** | First vertical scoped; §13 tests required before Task runtime merge; Open items not invented |

## Findings

1. **Contract is Accept-ready as design:** Invariants required by Gate 0 PO are encoded without collapsing channels or inventing Q Place/Q Card / OFFICE1.1 Accept.
2. **Priority model correct:** `displayPriority` any-move with audit; `originalSeverity` immutable; gates independent — `priorityFloor` correctly rejected.
3. **Operational fallback safe:** Manager absence and assignee unavailability reassign within Manager audience or leave Manager-visible — never silent Owner notify; Channel D remains explicit.
4. **Idempotency + reminders:** Tenant-scoped `derivationKey` uniqueness and reminder-key dedupe are sufficient Proposed technical rules for schema PRs; SLAs correctly left OPEN.
5. **Docs-only / isolation held:** Diff is documentation only; PR #82 untouched.

## Non-blocking residuals (not REQUEST CHANGES)

- §11 item 8 cross-ref says “Tests listed in §10” — should be **§13** (editorial).
- Schema PR must make SUPERSEDE compatible with `(tenantId, derivationKey)` uniqueness (partial unique on non-terminal, or versioned key) — Proposed technical, not Accept blocker.

## Verdict

ADR-0041 is architecturally adequate as Level C Proposed design for PO decision. Independent Architecture review: **APPROVE**. Does not Accept the ADR, arm merge, or authorize runtime.

```text
VERDICT: APPROVE
```

**Not done by this reviewer:** ADR Accept, merge-when-ready, runtime/migration changes, FinSec/Privacy/PO decisions, edits to PR #82/#83.
