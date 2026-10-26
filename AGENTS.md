# MillQ Agent Instructions

Operational rules for all AI agents working in the MillQ repository. This file is practical and enforceable. Product direction, scope, and governance live in `PROJECT_CHARTER.md` — do not treat this file as a substitute for the charter.

## 1. Authority and precedence

Resolve guidance in this order:

1. Explicit task instructions
2. `PROJECT_CHARTER.md`
3. Accepted ADRs
4. Product and architecture documentation
5. `AGENTS.md`
6. Existing repository conventions

Lower-level instructions must not contradict higher-level ones. If they conflict, follow the higher authority and escalate the conflict.

## 2. Before starting work

Before making changes, every agent must:

- read `PROJECT_CHARTER.md`
- inspect relevant documentation and existing code
- confirm the task scope and acceptance criteria
- identify assumptions, dependencies, and risks
- stop and escalate when business logic is unclear

Do not start implementation on ambiguous product rules. If the change is Level C and no owner decision exists, stop.

Classify the change as Level A, B, or C before editing (see `docs/processes/autonomous-development.md`). If unsure, use the stricter class. Unsure B vs C means C.

## 3. Scope discipline

- Modify only files necessary for the task.
- Do not perform unrelated refactoring.
- Do not introduce dependencies without justification.
- Do not change architecture silently.
- Do not generate speculative functionality.
- Do not invent business rules.

## 4. Architecture and domain rules

- Prefer a modular monolith first.
- Keep work within the monorepo structure.
- Preserve domain boundaries and ownership (Architecture v1.2 / ADR-0008).
- Catalog ≠ Menu Configuration ≠ POS Presentation ≠ Channel Menu.
- Inventory documents ≠ inventory movements; posting is DRAFT→POSTED→REVERSED/CORRECTED (ADR-0010).
- Critical inventory and financial operations require transactional integrity.
- Retried critical operations must be idempotent.
- Inventory and financial events must remain auditable.
- Significant architecture decisions require an ADR.
- Avoid premature abstraction.
- Do not treat `operational_fact_feed` as a central business ledger.

Do not select frameworks or languages unless an approved decision already exists.

## 5. Implementation rules

- Prefer small, reviewable changes.
- Keep code explicit and readable.
- Follow existing repository conventions.
- Validate inputs and failure cases.
- Handle rounding and monetary values deliberately.
- Preserve backward compatibility unless a breaking change is approved.
- Do not leave dead code or commented-out implementation.
- Never commit secrets or credentials.

## 6. Testing rules

Add or update tests relevant to the change.

When the change touches restaurant-domain behavior, cover applicable cases such as:

- rounding
- units of measurement and conversions
- inventory balances
- recipe write-offs
- returns and cancellations
- duplicate or retried operations
- concurrent operations
- offline/reconnect behavior

Agents must report what was tested and what was not tested.

## 7. Documentation rules

Update documentation when behavior, architecture, setup, API, or workflows change.

Use the intended docs layout:

- `docs/product/`
- `docs/architecture/`
- `docs/decisions/`
- `docs/processes/`
- `docs/glossary.md`

Do not let docs drift from implemented behavior.

## 8. Git and Pull Request rules

- Cursor Origin is the only source of truth after cutover. GitHub is a backup mirror only.
- Start Cloud Agents against the Origin repository, not GitHub.
- Create branches from Origin `main`. Open pull requests on Origin only.
- Work must be linked to a Cloud Agent run and/or an Origin pull request. Do not open new GitHub issues for the same work.
- Every PR must declare autonomy level **A**, **B**, or **C**.
- Allowed branch prefixes are `feature/`, `fix/`, and `chore/`.
- Commits must be atomic and use Conventional Commit style.
- Pull Requests must include summary, scope, testing, risks, linked work item, and autonomy level.
- **Do not push directly to Origin `main`.** Protection stays on. Autonomy is merge-when-ready after required Depot CI (and Level B process review), not an unprotected default branch.
- **No formal Origin non-author APPROVE gate (PO ACCEPT 2026-10-26).** There is no second Origin reviewer principal. Do not claim one. ChatGPT advises the PO only; it does not issue Origin `APPROVE`. See `docs/processes/origin-independent-review.md`.
- **Do arm merge-when-ready** on your own Level A/B Origin PR (`origin pr merge --auto`) after opening it. Required for unattended merge. Do not perform an immediate/unconditional merge, bypass Origin protections, or remove required Depot CI. Level C: arm merge-when-ready only after the owner decision is recorded.
- **Level gates:** **A** = Depot CI → auto-merge. **B** = Depot CI + Bugbot + substantive AI review (separate context) → auto-merge. **C** = separate PO ACCEPT for new architectural / financial / legal semantics before implementation merge. Production deploy and persistent-DB migrate need a **separate** PO GO.
- **Level A/B continuous cycle (PO 2026-10-24; review policy 2026-10-26):** when scope fits Accepted ADRs and current Notion PO decisions, run branch → tests → PR → (B: Bugbot + substantive AI review) → fixes → required Depot CI → merge-when-ready → GitHub backup without pausing for owner GO at each intermediate step. STOP on architecture conflict, Level C, material new risk, failed gates, or any need for bypass/force. Still no production deploy or persistent-DB migrate without a separate explicit GO.
- **Do not push to GitHub.** After cutover only the backup automation identity writes to GitHub. It is the sole bypass on the GitHub `main` branch ruleset and on the release/protected-tag ruleset. Implementation agents receive neither bypass. Dual-write is forbidden.
- Follow `docs/processes/origin-github-hosting.md`, `docs/processes/autonomous-development.md`, and ADR-0004. Do not use Origin’s Sync-from-GitHub mode (that keeps GitHub as source).

## 9. AI role separation

- Cursor is the primary interactive workstation and canonical Origin + Cloud Agent surface.
- Codex is for isolated autonomous tasks against Origin, not a second GitHub history.
- Implementation Agent, Review Agent, and Fix Agent are defined in `docs/processes/autonomous-development.md`.
- For Level **B**, implementation and substantive AI review for the same change must use separate **contexts** (not a second Origin account).
- Process review result is `APPROVE` or `REQUEST CHANGES` in PR notes. That is **not** a formal Origin approval-count gate.
- The Review Agent does not arm merge-when-ready. Human owner Origin review is not required on Level A or B PRs.
- Level C needs an owner decision (PO ACCEPT) on the proposal/ADR. After that, the Implementation Agent arms merge-when-ready; the owner does not have to merge.
- Strategic Product Owner review may happen in an external ChatGPT thread. ChatGPT does **not** issue Origin `APPROVE`. Cursor does not auto-sync to that thread.
- Before merge of a development block, the Cursor agent must produce a **safe ChatGPT review packet** (Russian, copy-paste ready) using `docs/processes/chatgpt-review-packet-template.md`.
- The packet must never include secrets, `.env` values, credentials, PII, or full Cursor chat history.

## 10. Definition of Done

A change is complete only when:

- acceptance criteria are met
- autonomy level is declared and correct
- Level C has a recorded owner decision
- relevant tests pass
- documentation is updated
- migrations are reviewed when applicable
- the PR is linked to the relevant Cloud Agent run and/or Origin work item
- Level B: Bugbot completed and substantive AI review recorded (process); blocking findings cleared
- unresolved blocking review threads are empty
- required Depot CI passes
- Level A/B PRs have merge-when-ready armed by the Implementation Agent (`origin pr merge --auto`)

## 11. Required completion report

At the end of every task, the agent must report:

- files changed
- decisions made
- assumptions
- tests performed
- known limitations or follow-up work
- autonomy level (A/B/C)
- whether substantive AI review / Bugbot was performed (Level B)
- whether merge-when-ready was armed (required for Level A/B; Level C only after owner decision)

At the end of every **merge-candidate development block** (and whenever the Product Owner asks), the agent must additionally end with a clearly marked section:

`=== ПАКЕТ ДЛЯ CHATGPT (безопасный handoff) ===` … `=== КОНЕЦ ПАКЕТА ===`

filled per `docs/processes/chatgpt-review-packet-template.md`. Optionally also save a copy under `docs/processes/review-packets/`.
