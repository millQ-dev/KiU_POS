# Autonomous development operating model

This process implements the charter’s agent workflow after Origin cutover. It exists so owners are **not** a manual bottleneck on every pull request.

Canonical hosting is Cursor Origin. GitHub is backup only. See [ADR-0004](../decisions/ADR-0004-origin-source-of-truth.md) and [`origin-github-hosting.md`](origin-github-hosting.md).

## Independent review

Independent review is **mandatory**. It may be performed by an **authorized independent agent**. It does not have to be a human owner.

Rules:

- The author of a change must not approve that change.
- Implementation context and review context must be independent (separate Cloud Agent run, or a distinct authorized review agent).
- Level C requires an **owner decision** on the proposal or ADR. After that decision, implementation, review, CI, and merge proceed autonomously. Owner decision is not the same as owner merge.

A reviewer returns exactly one of:

- `APPROVE`
- `REQUEST CHANGES`

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

`Implementation Agent → Origin PR + merge-when-ready → Independent Review Agent → CI/ruleset → automatic merge → Origin→GitHub backup`

### Level B — Guarded Autonomous

Human approval is **not** required on each PR. An independent **specialist** review is required, and that reviewer must explicitly check the relevant invariants.

Examples:

- DB schema changes
- migrations
- API contracts
- domain logic
- inventory behaviour
- financial calculations
- offline/sync behaviour
- permissions/auth implementation
- cross-module changes
- production infrastructure

Pipeline:

`Implementation Agent → Origin PR + merge-when-ready → Specialist Review Agent → CI/ruleset → automatic merge → Origin→GitHub backup`

### Continuous Level A/B delivery (PO 2026-10-24)

For Level **A** and **B**, when the change stays inside approved scope, Accepted ADRs, and current Notion PO decisions, the Implementation Agent runs the **full** cycle without stopping after each intermediate gate:

`Origin branch → implementation → tests → Origin PR → independent reviews (distinct Origin principal) → fixes → mandatory Depot CI → merge-when-ready → GitHub backup (MillQ Origin Backup App; see origin-github-backup-runbook.md)`

Do **not** pause for owner GO after PR open, after green CI alone, or after content APPROVE, unless a gate fails or the work escalates.

Allowed: small accompanying fixes required to finish the same task (tests, CI mirrors, docs drift, review threads) **without** expanding business functionality.

**STOP** and escalate when: architecture conflict; Level **C** product/ADR/governance question; new material risk; required CI fail; unresolved blocking review; Bugbot blocking finding; need for ruleset bypass / force-push / self-approval.

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

`Proposal / ADR → OWNER DECISION → Implementation Agent → Origin PR + merge-when-ready → Independent Review Agent → CI/ruleset → automatic merge`

After the owner accepts the decision, implementation is autonomous again. The owner does not have to merge the implementation PR. Merge-when-ready may be armed only after that owner decision is recorded.

Changing this file, `PROJECT_CHARTER.md`, `AGENTS.md`, or ADR-0004 is Level C.

## Agent roles

### Implementation Agent

- Read the charter, `AGENTS.md`, accepted ADRs, and this process.
- Classify the change as Level A, B, or C. Stop on Level C until an owner decision exists.
- Implement only the agreed scope on a branch from Origin `main`.
- Run relevant tests and update documentation.
- Open an Origin pull request. Declare the autonomy level.
- **Arm merge-when-ready** on that PR when allowed (`origin pr merge --auto`). This is required for unattended Level A/B delivery. It is **not** self-approval: Origin rulesets must still require an independent `APPROVE` and required CI/checks before the merge happens.
- Level C: arm merge-when-ready only after the owner decision is recorded on the PR.
- Must **not**:
  - self-approve;
  - perform an immediate or unconditional merge;
  - bypass Origin branch protections;
  - remove required reviews or checks;
  - force-push or direct-push Origin `main`;
  - push to GitHub.

### Review Agent

A separate context from the implementation run.

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

Result: `APPROVE` or `REQUEST CHANGES`. The Review Agent does **not** arm merge-when-ready. That is the Implementation Agent’s job.

Self-approval is invalid even if the same person launches both agents. The **contexts** must be independent **and** the Origin principal (`user_*`) must differ from the PR author. Same-account `--approve` is rejected by Origin and is not a substitute. See [`origin-independent-review.md`](origin-independent-review.md).

### Fix Agent (implementation continuation)

After `REQUEST CHANGES`:

- Address every unresolved thread.
- Re-run tests.
- Push to the same Origin branch.
- Request review again. Do not approve the follow-up yourself.
- Re-arm merge-when-ready if it was disabled (`origin pr merge --auto`). Do not merge immediately.

## Auto-merge

Level A and Level B pull requests **must be able to merge automatically** once all merge requirements are met. No human merge click is required. Freedom comes from automation and rulesets, not from an unprotected `main`.

**Direct push to Origin `main` is forbidden.**

### Who arms merge-when-ready

| Actor | Arms `origin pr merge --auto`? | Approves the PR? | Merges immediately? |
| --- | --- | --- | --- |
| Implementation Agent (and Fix Agent) | **Yes** — required on Level A/B after opening or updating the PR. Level C only after the owner decision is recorded | **No** | **No** |
| Review Agent | No | Yes (`APPROVE` / `REQUEST CHANGES`) | No |
| Owner | Not required for A/B | Not required for A/B. Level C: decides the proposal/ADR | Not required |

Arming merge-when-ready is not self-approval. The ruleset, not the implementer, performs the merge after independent approval and required checks.

Merge actually happens only when all of the following are true:

- required tests pass
- required CI / Origin checks pass (when CI exists; until CI exists, the Review Agent must record that CI is not yet a merge gate)
- required independent review is `APPROVE`
- no unresolved review threads (`origin pr thread list --unresolved` is empty)
- the branch is current with `main` if the Origin ruleset requires it
- the change is not Level C without a recorded owner decision
- the implementation agent is not the approving reviewer

Documented Origin mechanism (verified in public CLI docs, not verified against this repo’s dashboard):

```bash
origin pr merge --auto
```

That command means: merge once Origin requirements are met, then return. It must not be used as an immediate/unconditional merge. `--disable-auto` turns it off for that PR.

Until Origin Rules and Protections are configured for this repository, auto-merge is the **target** behaviour, not a verified live gate. See remaining owner actions in [`origin-github-hosting.md`](origin-github-hosting.md).

## Target Origin protections

Configure on Origin **Settings → Rules and Protections** (owner/platform operation; not applied from this GitHub checkout):

1. Protect `main`: pull request required; no direct pushes.
2. Require an independent approving review. The author cannot satisfy this requirement.
3. Require CI checks once CI is attached (Depot or Buildkite on an Origin-hosted repo; they do not apply to GitHub-mirrored repos).
4. Allow merge-when-ready / auto-merge for PRs that meet those requirements.
5. Do not allow bypass of Origin `main` protection for implementation agents, review agents, or human developers.

The Origin CLI can **list and view** rulesets (`origin ruleset list`). Creating or editing them is a dashboard operation. This repository does not contain a fabricated ruleset file.

## GitHub

After cutover, GitHub is not a working remote. Developers and implementation agents must not push to it. Backup is a separate automation identity. Details: [`origin-github-hosting.md`](origin-github-hosting.md).
