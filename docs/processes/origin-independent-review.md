# Origin review policy (PO ACCEPT 2026-10-26)

**Status:** Binding process after Product Owner ACCEPT. Supersedes the post-#110/#112 interim rule that required a second Origin `user_*` and formal non-author `APPROVE`.  
**Does not** amend ADR-0004 hosting SoT. Charter / `AGENTS.md` / this file / `autonomous-development.md` must stay aligned.

## Owner decision (recorded)

The project has **no** second independent Origin reviewer principal. Therefore:

1. The Origin ruleset **MillQ Require non-author APPROVE** (`requiredApprovingReviewCount=1`, formerly `rs_01m5vbr0twf549p91kr7ddg4xw`) is **removed** by owner decision.
2. Agents must **not** claim that a second Origin principal exists or that ChatGPT issues a formal Origin `APPROVE`.
3. ChatGPT remains the **strategic / technical reviewer for the Product Owner** via safe review packets. That is PO advice, not an Origin merge gate.
4. **Protect Origin main** (no direct push) and **MillQ Required Depot CI** stay active.
5. Production deploy and persistent DB migrations still need a **separate explicit PO GO**.

## Merge gates by autonomy level

| Level | Origin merge gate (ruleset) | Process gate (agents must satisfy before treating delivery complete) |
| --- | --- | --- |
| **A** | Mandatory **Depot CI** green → merge-when-ready may land | Docs/tests for the change; no fabricated independence claims |
| **B** | Mandatory **Depot CI** green → merge-when-ready may land | **Bugbot** completed on the PR head **and** a **substantive AI review** (separate review context: correctness, scope, invariants, security, level honesty). Result recorded on the PR as comment / review notes. Not a formal Origin `APPROVE` count. |
| **C** | Same CI protection as above once implementation is allowed | **Separate PO ACCEPT** on the proposal/ADR **before** implementing mergeable work that introduces new architectural, financial, or legal semantics. After ACCEPT: implement → PR → Level B-quality review discipline where applicable → CI → MWR |

Unresolved blocking Bugbot findings or a review context that returns **REQUEST CHANGES** still stop merge-when-ready until fixed (process), even though Origin no longer counts formal approvals.

## Effective Origin rulesets (2026-10-26, after PO ACCEPT)

| Ruleset | Kind | Status |
| --- | --- | --- |
| Protect Origin main | `push_branch` | **active** — block direct updates / non-FF / deletion on `~DEFAULT_BRANCH` |
| MillQ Required Depot CI | `merge_branch` | **active** — Depot `Typecheck, test, build` + `Disposable PostgreSQL P0 + migrator` |
| MillQ Require non-author APPROVE | `merge_branch` | **removed** (owner decision; ID was `rs_01m5vbr0twf549p91kr7ddg4xw`) |

## Operator checklist

| Step | Who |
| --- | --- |
| Open Origin PR + arm `origin pr merge --auto` | Implementation Agent (Level A/B; Level C only after PO ACCEPT) |
| Substantive AI review (Level B; recommended on material Level A) | Separate review **context** — comment/`REQUEST CHANGES` discipline; **not** a second Origin account requirement |
| Bugbot (Level B) | Cursor Bugbot on the PR |
| Required CI (Depot) | Automation — **merge ruleset** |
| Merge | Origin after required checks; no formal APPROVE count |
| Origin→GitHub backup | MillQ Origin Backup App only (`scripts/backup-origin-to-github.sh`) |
| Strategic PO packet | Implementation Agent fills ChatGPT packet; PO uses ChatGPT as advisor |

## What agents must not do

- Invent or claim a second independent Origin reviewer principal.
- Treat ChatGPT output as Origin `APPROVE`.
- Re-create `requiredApprovingReviewCount` without a new owner decision.
- Bypass Protect Origin main, remove Depot CI requirements, force-push, or push GitHub `main`.
- Arm merge-when-ready on Level C before PO ACCEPT is recorded.
- Deploy to production or migrate persistent DBs without a separate PO GO.
- Open paid Automations or new accounts to fake “independent APPROVE”.

## Historical note

PRs #110 / #112 exposed that “Gates: none required” allowed merge without formal APPROVE. An interim ruleset required non-author APPROVE, but the namespace had only one Write/Admin principal, so the gate could not be satisfied honestly. PO ACCEPT 2026-10-26 replaces that interim with level-based CI + Bugbot + substantive AI review, without pretending a second Origin principal exists.
