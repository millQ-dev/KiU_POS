# Origin independent review — distinct principal (post #110)

**Status:** Binding process clarification (Level A/B ops). Does not amend ADR-0004 / charter.  
**Incident:** Origin PR #110 merged with Depot CI green while formal `origin pr review --approve` failed: *Pull request authors cannot approve their own pull request* (same Origin `user_*` as author). A separate chat context under the **same** Cursor/Origin account is **not** an independent Approver.

## Rule

1. **Implementation Agent** and **Review Agent** must use **different Origin principals** (`user_*` / Cursor account), not only different conversation contexts.
2. Same-account `--approve` is **invalid** even if the review content would have APPROVEd.
3. Posting an APPROVE-as-comment under the author account does **not** satisfy independent review.
4. Implementation Agent must **STOP** before treating merge-when-ready as complete if `origin pr requirements` shows no required approving review from a non-author — escalate to owner/platform to enable the gate, or obtain APPROVE from a second principal.

## Operator checklist

| Step | Who |
| --- | --- |
| Open Origin PR + arm `origin pr merge --auto` | Implementation Agent (author account) |
| `origin pr review N --approve` or `--request-changes` | Review Agent on a **second** Cursor/Origin identity with repo Write |
| Required CI (Depot) | Automation |
| Merge | Origin ruleset after non-author APPROVE + required checks |
| Origin→GitHub backup | MillQ Origin Backup App only (`scripts/backup-origin-to-github.sh`) |

## Owner / platform (required to close the gap)

1. Grant a dedicated review identity Write on `millqdev/MillQ` (team member or bot account).
2. On Origin `main` ruleset: **require** at least one approving review from a non-author (so “Gates: none required” cannot merge again).
3. Prefer launching Review Agents from that second identity (Cloud Agent / local session signed in as the review principal).

## What agents must not do

- Self-approve under the author account.
- Bypass Origin protections or push GitHub `main`.
- Treat Bugbot “neutral” / comment-only reviews as independent APPROVE unless Origin ruleset explicitly accepts that integration as a required reviewer.
