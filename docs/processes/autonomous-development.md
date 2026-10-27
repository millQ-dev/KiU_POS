# Autonomous development operating model

This process implements the charter’s agent workflow after Origin cutover. It exists so owners are **not** a manual bottleneck on every pull request.

Canonical hosting is Cursor Origin. GitHub is backup only. See [ADR-0004](../decisions/ADR-0004-origin-source-of-truth.md) and [`origin-github-hosting.md`](origin-github-hosting.md).

**Review policy (PO ACCEPT 2026-10-26):** there is no second Origin reviewer principal and no Origin ruleset requiring formal non-author `APPROVE`. See [`origin-independent-review.md`](origin-independent-review.md). ChatGPT advises the Product Owner; it does not issue Origin `APPROVE`.

## Review (process, not Origin APPROVE count)

Substantive review remains part of delivery quality. It may be performed by an authorized AI review **context** (separate conversation / agent run from implementation). It is **not** required to be a distinct Origin `user_*`, and it does **not** produce a formal Origin merge-gate `APPROVE`.

Rules:

- Do not claim a second independent Origin principal exists.
- Level **A**: Depot CI is the Origin merge gate.
- Level **B**: Depot CI (Origin gate) **plus** Bugbot **plus** substantive AI review (process gate) before treating the change as done.
- Level **C**: owner PO ACCEPT on the proposal/ADR before implementation proceeds to mergeable work. After ACCEPT, CI + review discipline apply; owner does not have to click merge.
- A review context returns guidance as `APPROVE` / `REQUEST CHANGES` **in process notes** (PR comment). That is not the old Origin approval-count gate.
- ChatGPT review packets are **PO consultation only** — not Origin reviews and not a required manual merge gate.

## Autonomy levels

Every change must declare a level in the pull request: **A**, **B**, or **C**.

If the level is unclear, choose the **stricter** class. If B vs C is unclear, treat it as **C** and stop for an owner decision.

### Level A — Autonomous

The agent may take the change from branch to merge without human approval.

Examples:

- ordinary bug fixes
- UI implementation inside an already approved design
- tests
- documentation that does not change governance
- safe refactors
- small implementation changes
- local improvements that do not change public contracts or architecture

Pipeline:

`Implementation Agent → Origin PR → arm merge-when-ready → mandatory Depot CI → automatic merge → Origin→GitHub backup`

### Level B — Guarded Autonomous

Human Origin `APPROVE` is **not** required. Bugbot and a substantive AI review (separate context) are required as process gates **before** arming merge-when-ready.

Examples:

- DB schema changes
- migrations (runtime/schema in repo; **persistent DB apply** still needs separate PO GO)
- API contracts
- domain logic
- inventory behaviour
- financial calculations
- offline/sync behaviour
- permissions/auth implementation
- cross-module changes
- production infrastructure (still no prod deploy without separate GO)

Pipeline:

`Implementation Agent → Origin PR → Bugbot + substantive AI review on HEAD → clear blockers → arm merge-when-ready → mandatory Depot CI → automatic merge → Origin→GitHub backup`

If HEAD changes after Bugbot or substantive AI review, **re-check affected findings** on the new HEAD before arming or re-arming merge-when-ready.

### Continuous Level A/B delivery (PO 2026-10-24; review gate updated 2026-10-26)

For Level **A** and **B**, when the change stays inside approved scope, Accepted ADRs, and current Notion PO decisions, the Implementation Agent runs the **full** cycle without stopping for owner GO at each intermediate step:

`Origin branch → implementation → tests → Origin PR → (A: arm MWR) / (B: Bugbot + substantive AI review → clear blockers → arm MWR) → mandatory Depot CI → merge → GitHub backup (MillQ Origin Backup App; see origin-github-backup-runbook.md)`

Do **not** pause for owner GO after PR open or after green CI alone, unless a gate fails or the work escalates. Do **not** arm Level B merge-when-ready before Bugbot + substantive AI review on the current HEAD.

Allowed: small accompanying fixes required to finish the same task (tests, CI mirrors, docs drift, review threads) **without** expanding business functionality.

**STOP** and escalate when: architecture conflict; Level **C** product/ADR/governance question; new material risk; required CI fail; unresolved blocking review / Bugbot finding; need for ruleset bypass / force-push.

Still forbidden on every level: production deploy; migrations on persistent / shared DBs unless a separate explicit owner GO names those environments.

### Level C — Owner decision required

The agent must **not** decide the product, architecture, or governance question.

Examples:

- architectural changes
- module-boundary changes
- historical truth / event-model changes
- money model
- inventory accounting model
- security architecture
- destructive migration strategy
- new external vendor or platform
- product behaviour that is not in approved requirements
- governance changes (charter, agent rules, autonomy levels, hosting)
- ADR-level decisions

Pipeline:

`Proposal / ADR → OWNER DECISION (PO ACCEPT) → Implementation Agent → Origin PR → Bugbot + substantive AI review as applicable on HEAD → arm merge-when-ready → CI/ruleset → automatic merge`

After the owner accepts the decision, implementation is autonomous again. The owner does not have to merge the implementation PR. Merge-when-ready may be armed only after that owner decision is recorded **and** applicable review gates on the current HEAD are satisfied.

Changing this file, `PROJECT_CHARTER.md`, `AGENTS.md`, or ADR-0004 is Level C.

## Agent roles

### Implementation Agent

- Read the charter, `AGENTS.md`, accepted ADRs, and this process.
- Classify the change as Level A, B, or C. Stop on Level C until an owner decision exists.
- Implement only the agreed scope on a branch from Origin `main`.
- Run relevant tests and update documentation.
- Open an Origin pull request. Declare the autonomy level.
- **Arm merge-when-ready** when the level allows (`origin pr merge --auto`):
  - **A:** right after opening the PR.
  - **B:** only after Bugbot + substantive AI review on the **current HEAD**, blocking findings cleared (re-check if HEAD moves).
  - **C:** only after PO ACCEPT is recorded, then after applicable review on current HEAD.
- Origin merges after **required Depot CI** (and other active rulesets), not after a formal non-author `APPROVE` count.
- Must **not**:
  - pretend a second Origin principal approved the change;
  - perform an immediate or unconditional merge;
  - bypass Origin branch protections;
  - remove required Depot CI checks;
  - force-push or direct-push Origin `main`;
  - push to GitHub.

### Review Agent (process context)

A separate **context** from the implementation run (not a second Origin account requirement).

Check:

- correctness
- scope discipline
- regressions
- architecture alignment
- tests
- migrations
- security and secrets
- money and inventory invariants when applicable
- backward compatibility
- documentation
- declared autonomy level (reject under-classified PRs)

Result in process notes: `APPROVE` or `REQUEST CHANGES`. The Review Agent does **not** arm merge-when-ready. That is the Implementation Agent’s job. Process `APPROVE` is **not** an Origin approval-count gate.

### Fix Agent (implementation continuation)

After process `REQUEST CHANGES` or blocking Bugbot:

- Address every unresolved thread / finding.
- Re-run tests.
- Push to the same Origin branch (HEAD moved).
- Re-run Bugbot / substantive AI review on the **new HEAD** as needed; clear blockers.
- Then re-arm merge-when-ready (`origin pr merge --auto`). Do not merge immediately.

## Auto-merge

Level A and Level B pull requests **must be able to merge automatically** once Origin requirements are met (mandatory Depot CI; push protection on `main`). No human merge click is required. Freedom comes from automation and rulesets, not from an unprotected `main`.

**Direct push to Origin `main` is forbidden.**

### Who arms merge-when-ready

| Actor | Arms `origin pr merge --auto`? | Formal Origin APPROVE? | Merges immediately? |
| --- | --- | --- | --- |
| Implementation Agent (and Fix Agent) | **Yes**, in level order: A after PR open; B after Bugbot + substantive AI review on current HEAD; C after PO ACCEPT then applicable review | **Not used** as merge gate (PO ACCEPT 2026-10-26) | **No** |
| Review Agent (process context) | No | N/A — process notes only | No |
| Owner | Not required for A/B | Not required for A/B. Level C: PO ACCEPT on proposal/ADR | Not required |
| ChatGPT | No | Never — PO consultation only; not a merge gate | No |

Arming merge-when-ready is not a substitute for required CI. The ruleset, not the implementer, performs the merge after required checks.

Merge actually happens only when all of the following are true:

- merge-when-ready was armed only after the level’s process gates (see above)
- required Depot CI / Origin checks pass
- no unresolved blocking review threads / Bugbot blockers for Level B (process) on the HEAD being merged
- the branch is current with `main` if the Origin ruleset requires it
- the change is not Level C without a recorded owner decision

Documented Origin mechanism:

```bash
origin pr merge --auto
```

That command means: merge once Origin requirements are met, then return. It must not be used as an immediate/unconditional merge. `--disable-auto` turns it off for that PR.

## Target Origin protections

Configure on Origin **Settings → Rules and Protections** (owner/platform operation):

1. Protect `main`: no direct pushes / non-FF / deletion (`Protect Origin main`) — **active**.
2. Require Depot CI checks (`MillQ Required Depot CI`) — **active**.
3. Allow merge-when-ready / auto-merge for PRs that meet those requirements.
4. Do **not** require formal non-author `APPROVE` unless a future owner decision reinstates it with a real second principal.
5. Do not allow bypass of Origin `main` protection for implementation agents or human developers for routine work.

The Origin CLI can list, view, create, update, and delete rulesets (`origin ruleset …`).

## GitHub

After cutover, GitHub is not a working remote. Developers and implementation agents must not push to it. Backup is a separate automation identity. Details: [`origin-github-hosting.md`](origin-github-hosting.md).
