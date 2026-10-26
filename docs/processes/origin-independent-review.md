# Origin independent review — distinct principal (post #110 / #112)

**Status:** Binding process + Origin merge ruleset (Level A/B ops). Does not amend ADR-0004 / charter.  
**Incident #110 / #112:** PRs merged while Origin reported “Gates: none required” / no required approving review. Same Origin `user_*` cannot `--approve` its own PR. A separate chat under the **same** Cursor/Origin account is **not** an independent Approver. Bugbot is **not** a substitute unless listed as a required reviewer.

## Rule

1. **Implementation Agent** and **Review Agent** must use **different Origin principals** (`user_*` / Cursor account), not only different conversation contexts.
2. Same-account `--approve` is **invalid** even if the review content would have APPROVEd.
3. Posting an APPROVE-as-comment under the author account does **not** satisfy independent review.
4. Implementation Agent must **STOP** before treating merge-when-ready as complete if `origin pr requirements` shows missing non-author APPROVE — escalate for a second principal.

## Effective Origin rulesets (2026-10-26)

| Ruleset | Kind | Evidence |
| --- | --- | --- |
| Protect Origin main | `push_branch` | block direct updates / non-FF / deletion on `~DEFAULT_BRANCH` |
| MillQ Required Depot CI | `merge_branch` | require Depot `Typecheck, test, build` + `Disposable PostgreSQL P0 + migrator` |
| **MillQ Require non-author APPROVE** | `merge_branch` | `pull_request.requiredApprovingReviewCount=1` on `~DEFAULT_BRANCH` (`rs_01m5vbr0twf549p91kr7ddg4xw`) |

Origin also rejects author self-approve at the review API. Combined with the ruleset, merge-when-ready cannot land without a non-author APPROVE **and** required CI.

## Operator checklist

| Step | Who |
| --- | --- |
| Open Origin PR + arm `origin pr merge --auto` | Implementation Agent (author account) |
| `origin pr review N --approve` or `--request-changes` | Review Agent on a **second** Cursor/Origin identity with repo **Write** |
| Required CI (Depot) | Automation |
| Merge | Origin rulesets after non-author APPROVE + required checks |
| Origin→GitHub backup | MillQ Origin Backup App only (`scripts/backup-origin-to-github.sh`) |

## Owner / platform — remaining gap

**Ruleset:** done (require ≥1 approving review).  
**Second principal:** still open as of 2026-10-26.

`origin repo access list` currently shows a **single** Admin grant (`kuzmilman@gmail.com`). Until a distinct Review Agent identity has **Write** on `millqdev/MillQ`:

1. Create or invite a second Cursor/Origin account dedicated to review (or a team Write grant).
2. `origin repo access set -R millqdev/MillQ --user <reviewer> --role Write`
3. Launch Review Agents signed in as that principal.
4. Prove fail-closed: author-only PR cannot merge; after non-author APPROVE + green CI, MWR can merge.

Do **not** weaken rulesets, add author bypass, or treat Bugbot as the required Approver.

## Retrospective note (PR #112)

Merged PR #112 was **not** formally approved by a distinct Origin principal before merge. A post-merge retrospective code review may still return APPROVE/REQUEST CHANGES for product learning; that does **not** rewrite history as pre-merge formal APPROVE.

## What agents must not do

- Self-approve under the author account.
- Bypass Origin protections or push GitHub `main`.
- Start another sensitive financial PR while the second Review principal is missing (gate is active but no independent Approver can act).
- Treat Bugbot “neutral” / comment-only reviews as independent APPROVE unless Origin ruleset explicitly accepts that integration as a required reviewer.
