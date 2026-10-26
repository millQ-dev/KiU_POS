# Origin → GitHub backup runbook

**Canonical:** Origin `millqdev/MillQ` `main`  
**Backup:** GitHub `millQ-dev/KiU_POS` `main` (legacy `millQ-dev/MillQ` redirect)  
**Writer:** GitHub App **MillQ Origin Backup** only (ruleset bypass Integration).  
**Script:** [`scripts/backup-origin-to-github.sh`](../../scripts/backup-origin-to-github.sh)

## Proven restore (2026-10-26, post #112)

| Host | SHA |
| --- | --- |
| Origin `main` | `343487819aa669798dbe1c38426d03c7f6023c2a` |
| GitHub `KiU_POS` `main` | `343487819aa669798dbe1c38426d03c7f6023c2a` |

Restore used the MillQ Origin Backup App installation token (fast-forward only). Personal PAT / `millQ-dev` user push was not used. GitHub ruleset logged *Bypassed rule violations* for the App only.

## Drift incident (#110 / #112)

After Origin merges, GitHub can lag when the post-merge backup job is not triggered or App secrets are absent from the automation environment. Agents without App credentials must **not** dual-write.

## One-shot restore (owner / backup automation)

Required env (never commit; never print in chat/logs):

```bash
export ORIGIN_URL='https://origin.cursor.com/millqdev/MillQ.git'
export GITHUB_URL='https://github.com/millQ-dev/KiU_POS.git'
export GITHUB_APP_ID='…'                 # MillQ Origin Backup App
export GITHUB_APP_INSTALLATION_ID='…'    # install on millQ-dev / KiU_POS
export GITHUB_APP_PRIVATE_KEY='-----BEGIN …'  # PEM; \n escaped OK
bash scripts/backup-origin-to-github.sh
```

Verify:

```bash
git ls-remote "$ORIGIN_URL" refs/heads/main
git ls-remote "$GITHUB_URL" refs/heads/main
# tips must be identical
```

Fast-forward only. Force-push of GitHub `main` is forbidden.

## Ongoing trigger (owner/platform)

Wire **one** primary trigger (secrets stay in the automation vault, not in git):

1. Origin `pull_request.merged` → backup job with App secrets, or
2. Cursor Automation “MillQ Origin→GitHub backup” with the same secrets (preferred interactive path), or
3. Scheduled drift-repair (safety net only).

**Status 2026-10-26:** one-shot restore after #112 proved App path. Persistent Automation trigger still must keep App secrets loaded so the next Origin merge auto-FF without agent intervention. Until that is verified on a subsequent merge, every Origin merge completion report must include Origin/GitHub SHA equality.

## Agent policy

| Actor | May run backup script with App secrets? | May `git push` GitHub main as user/PAT? |
| --- | --- | --- |
| MillQ Origin Backup App automation | Yes | N/A (uses installation token) |
| Implementation / Review agents | Only if App secrets are injected into that automation env | **No** |
| Human developer identities | No (unless operating the App automation) | **No** |
