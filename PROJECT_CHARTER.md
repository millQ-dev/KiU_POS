# MillQ Project Charter

This document is the governing charter for MillQ. It defines product direction, development principles, decision-making rules, scope boundaries, quality expectations, and AI-agent responsibilities. All contributors and agents must treat it as the highest-level project authority unless superseded by an explicitly approved charter revision.

## 1. Mission

MillQ exists to give restaurant businesses in Vietnam a reliable operating system for daily work and financial control. The mission is to replace fragmented and primitive local tooling with a coherent platform that records operations accurately, exposes true food cost and unit economics, and supports growth without sacrificing auditability or trust in the data.

## 2. Product Vision

MillQ will become a modular restaurant management platform covering the full operating cycle of a food business: sales, inventory, purchasing, production, costing, finance, analytics, people, CRM, and automation.

The vision is product-led, not technology-led. Long-term modules may include POS, inventory and warehouse accounting, ingredients and recipes, purchasing and goods receipt, production and write-offs, food cost control, finance and unit economics, analytics, employee management, CRM, and business automation. Technology choices remain deferred until architecture decisions are made deliberately and recorded.

## 3. Initial Target Market

The initial market is restaurant businesses operating in Vietnam.

The first focus is Russian-speaking founders and operators who already understand advanced restaurant management systems, but currently lack a local platform with comparable operational depth. Early product design should respect their expectations for inventory accuracy, costing, and process discipline while remaining practical for Vietnamese operating conditions, suppliers, and day-to-day restaurant workflows.

## 4. Core Product Principles

- **Operational accuracy over visual complexity.** Correct stock, cost, and sales data matter more than decorative UI.
- **Deep restaurant economics.** Every material flow should support trustworthy food cost and unit economics.
- **Simple daily workflows.** Frontline staff must complete routine tasks quickly with minimal training.
- **Reliable inventory accounting.** Stock movements must be complete, consistent, and reconcilable.
- **Auditability.** Financial and inventory changes must be traceable to who did what, when, and why.
- **Localization for Vietnam.** Language, tax/currency realities, supplier practices, and local operating patterns must be first-class.
- **Modular growth.** The platform should expand by coherent modules without forcing a rewrite.
- **Offline and unstable-network tolerance where required.** Critical operational flows must degrade gracefully under poor connectivity.
- **Security and data integrity.** Access control, validation, and durable records are non-negotiable.

## 5. Initial Product Vertical

The first complete business flow is:

Restaurant → Employee → Ingredient → Recipe → Goods Receipt → Sale → Automatic Write-off → Food Cost Report

This vertical is the proof that MillQ can connect people, materials, recipes, procurement, sales, and costing into one closed operational loop.

## 6. MVP Scope

The initial MVP includes only the capabilities required to execute and report on the first complete vertical end to end:

- restaurant and employee setup needed to operate the flow
- ingredient master data
- recipes linking ingredients to sellable items
- goods receipt into inventory
- sale recording
- automatic write-off of ingredients based on recipes and sales
- food cost reporting derived from the resulting movements

Anything not required to complete, verify, and trust this loop is deferred.

## 7. Out of Scope for the Initial MVP

The following are explicitly excluded from the initial MVP:

- marketplace
- delivery aggregator integrations
- payroll
- full CRM
- loyalty program
- advanced marketing automation
- franchise management
- microservices decomposition
- Kubernetes
- premature multi-country expansion

These items may be reconsidered later only through normal product and architecture decision processes.

## 8. Architecture Principles

- Start with a **modular monolith**.
- Keep the codebase in a **monorepo**.
- Define **API-first boundaries** between domains and clients.
- Maintain **clear domain ownership**.
- Preserve **transactional integrity** for inventory and financial operations.
- Require **idempotency** for critical operations that may be retried.
- Maintain an **audit trail** for financial and inventory events.
- **Avoid premature abstraction**.
- Record significant architecture decisions as **ADRs**.

This charter does not select frameworks, programming languages, cloud vendors, or infrastructure platforms.

## 9. Development Workflow

- **Cursor Origin is the only source of truth** for code, reviews, and project history after cutover.
- **GitHub is a backup mirror only.** After cutover, only backup automation may write to GitHub. Do not open primary pull requests or new issues there. Dual-write is forbidden.
- Work is planned and tracked through **Cursor Cloud Agent runs** and **Origin pull requests**.
- Implementation happens on **feature branches** from Origin `main`.
- Use branch naming conventions `feature/*`, `fix/*`, and `chore/*`.
- Changes land through **Pull Requests on Origin**. Direct push to `main` is forbidden.
- The **main branch is protected** by rulesets. Agent freedom comes from automation and review, not from removing protection.
- Prefer **small atomic changes** over large mixed commits.
- There is **no** formal Origin non-author `APPROVE` merge gate (PO ACCEPT 2026-10-26). There is no second Origin reviewer principal. ChatGPT advises the Product Owner only; it does not issue Origin `APPROVE` and is not a manual merge gate.
- **Level B** still requires Bugbot and a **substantive AI review** in a **separate context** from implementation (process gate, not an Origin approval count). If HEAD changes after that review, re-check affected findings before arming merge-when-ready.
- The **Implementation Agent arms merge-when-ready** (`origin pr merge --auto`) only when the level’s process gates allow it (see table below). That is not a substitute for required Depot CI. Immediate/unconditional merge and bypass of Origin `main` are forbidden.
- **Required Depot CI must pass before merge**. Canonical CI is attached to Origin, not to the GitHub backup. Protect Origin `main` stays on.
- **Level A and Level B** pull requests merge unattended when their process gates and Depot CI are met. No human merge click. See [`docs/processes/autonomous-development.md`](docs/processes/autonomous-development.md).
- Hosting and cutover steps live in [`docs/processes/origin-github-hosting.md`](docs/processes/origin-github-hosting.md) and [ADR-0004](docs/decisions/ADR-0004-origin-source-of-truth.md).

### Autonomy levels

| Level | Human owner on each PR? | Process review | When to arm merge-when-ready | Origin merge |
| --- | --- | --- | --- | --- |
| **A — Autonomous** | No | Optional / light; not a formal Origin APPROVE | Immediately after opening the PR | Ruleset merges after **Depot CI** |
| **B — Guarded Autonomous** | No | **Bugbot** + **substantive AI review** (separate context; invariants required). Re-check if HEAD moves | Only after Bugbot + substantive AI review on the **current HEAD**, with blocking findings cleared | Ruleset merges after **Depot CI** |
| **C — Owner decision** | Yes, on the **decision** (ADR/proposal), not necessarily on merge | PO ACCEPT first; then Level B-quality review discipline where applicable | Only after **PO ACCEPT** is recorded, then after applicable review gates on current HEAD | Ruleset merges after **Depot CI** |

Level A: ordinary bug fixes, UI inside an approved design, tests, documentation, safe refactors, small implementation changes that do not change public contracts or architecture.

Level B: schema, migrations, API contracts, domain logic, inventory, financial calculations, offline/sync, auth/permissions implementation, cross-module work, production infrastructure.

Level C: architecture, module boundaries, historical-truth/event model, money model, inventory accounting model, security architecture, destructive migrations, new vendor/platform, unapproved product behaviour, governance, ADR-level decisions.

If classification is unclear, use the stricter level. Unclear B vs C is C: stop and request an owner decision. After an owner accepts a Level C decision, implementation proceeds autonomously.

## 10. AI Agent Operating Model

MillQ uses specialized AI-agent roles. A single person or tool may support multiple roles across the project. For Level **B**, **implementation and substantive AI review for the same change must use separate contexts**. Review may be an authorized agent context. It is not required to be a human owner on every PR, and it is **not** required to be a second Origin account.

**PO ACCEPT 2026-10-26:** Origin does **not** require formal non-author `APPROVE`. There is no second Origin reviewer principal. Merge gates: Level **A** = mandatory Depot CI; Level **B** = Depot CI + Bugbot + substantive AI review (process); Level **C** = separate PO ACCEPT for new architectural, financial, or legal semantics before mergeable implementation. Production deploy and persistent DB migrations need a **separate** PO GO. ChatGPT advises the Product Owner strategically/technically and does **not** issue Origin `APPROVE`.

Minimum delivery roles:

| Role | Responsibility |
| --- | --- |
| Implementation Agent | Classify autonomy level, implement agreed scope on an Origin branch, test, document, open Origin PR, **arm merge-when-ready** when the level allows (A: after PR open; B: after Bugbot + substantive AI review on current HEAD; C: after PO ACCEPT, then applicable review). Must not merge immediately, bypass Origin protections, remove required Depot CI, or push to GitHub. |
| Review Agent | Separate context (process). Checks correctness, scope, regressions, architecture, tests, migrations, security, money/inventory invariants, compatibility, docs, and declared level. Returns process `APPROVE` or `REQUEST CHANGES` in PR notes — not an Origin approval-count gate. Does not arm merge-when-ready. |
| Fix Agent | Same implementation identity after `REQUEST CHANGES` / blocking Bugbot: fix, re-test, push; for Level B re-run review on new HEAD before re-arming merge-when-ready. Must not merge immediately. |

Specialist roles (Product Analyst, System Architect, QA, Security, Documentation, and others) may act as the Review Agent when the change is Level B in their domain.

Operating rules:

- Agents must **not invent business logic**.
- Agents must **not edit unrelated files**.
- Agents must **explain assumptions**.
- Agents must **classify each change as Level A, B, or C** and stop on Level C until an owner decision exists.
- **Level B: implementation and substantive review must use separate contexts** (not a second Origin principal requirement).
- Agents must **not claim** a second independent Origin reviewer principal exists.
- **Cursor** is the primary workstation for interactive development and the canonical hosting surface (Origin + Cloud Agents).
- **Codex** is used for isolated autonomous tasks against the Origin repository, not against a separate GitHub history.
- **GitHub** is a backup mirror of Origin. After cutover, only the backup automation identity may write to it. That identity is the sole bypass on the GitHub `main` branch ruleset (routine writes blocked) and on the GitHub tag ruleset for release/protected tags (create/update/delete restricted). No developer or implementation agent receives those bypasses.

## 11. Definition of Done

A task is complete only when all of the following are true:

- acceptance criteria are met
- Level A: required Depot CI green; Level B: Depot CI + Bugbot + substantive AI review (process) complete with blockers cleared
- tests pass
- documentation is updated where relevant
- migrations are checked when schema changes are involved
- the Pull Request is linked to the relevant Cloud Agent run and/or tracked Origin work item and declares autonomy level A, B, or C
- required Depot CI passes
- Merge-when-ready armed per level order (A after PR open; B after Bugbot + substantive AI review on current HEAD; C after PO ACCEPT then applicable review); required Depot CI green

## 12. Decision-Making

- **Product decisions** belong to product ownership (Level C until decided).
- **Architecture decisions** require an ADR and owner acceptance (Level C).
- **Uncertain business logic** must be escalated rather than invented (Level C).
- **Irreversible decisions** require explicit owner approval.
- **Reversible decisions** should prefer speed and simplicity (Level A or B when they fit those classes).
- After an owner accepts a Level C decision, agents implement, arm merge-when-ready, apply Level B review discipline where applicable, and let required CI rulesets merge. The owner does not have to click merge.

## 13. Documentation Hierarchy

Intended documentation structure:

- `PROJECT_CHARTER.md` — governing project charter
- `README.md` — repository orientation
- `AGENTS.md` — rules for AI agents
- `docs/product/` — product specs and scope artifacts
- `docs/architecture/` — system design and domain boundaries
- `docs/decisions/` — Architecture Decision Records
- `docs/processes/` — engineering and delivery processes
- `docs/glossary.md` — shared terminology

Lower-level documents must not contradict this charter. If they conflict, the charter prevails until revised.

## 14. Change Control

Changes to this charter must be made through a dedicated Pull Request with a clear rationale. Editorial corrections may be small; changes to mission, scope, principles, workflow, autonomy levels, or decision rights are **Level C** and require an owner decision (PO ACCEPT) before mergeable implementation. After ACCEPT, required Depot CI and process review discipline apply; formal Origin non-author `APPROVE` is not a merge gate (PO ACCEPT 2026-10-26).
