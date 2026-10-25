# Origin → GitHub backup runbook

**Canonical:** Origin `millqdev/MillQ` `main`  
**Backup:** GitHub `millQ-dev/KiU_POS` `main` (legacy `millQ-dev/MillQ` redirect)  
**Writer:** GitHub App **MillQ Origin Backup** only (ruleset bypass Integration).  
**Script:** [`scripts/backup-origin-to-github.sh`](../../scripts/backup-origin-to-github.sh)

## Drift incident (#110)

After Origin PR #110 merged to `802b70d…`, GitHub `main` remained at `5b590fa…` (#109). Cause: merge webhook / backup job not wired or secrets not present in the automation environment. Agents without App credentials must **not** dual-write.

## One-shot restore (owner / backup automation)

Required env (never commit):

```bash
export ORIGIN_URL='https://origin.cursor.com/millqdev/MillQ.git'
export GITHUB_APP_ID='…'                 # MillQ Origin Backup App
export GITHUB_APP_INSTALLATION_ID='…'    # install on millQ-dev/KiU_POS
export GITHUB_APP_PRIVATE_KEY='-----BEGIN …'  # PEM; \n escaped OK
bash scripts/backup-origin-to-github.sh
```

Verify:

```bash
# Origin tip
git ls-remote "$ORIGIN_URL" refs/heads/main
# GitHub tip must match
gh api repos/millQ-dev/KiU_POS/commits/main --jq .sha
```

Fast-forward only. Force-push of GitHub `main` is forbidden.

## Ongoing trigger (owner/platform)

Wire **one** primary trigger after Detach (see `origin-github-hosting.md`):

1. Origin `pull_request.merged` → backup job with App secrets, or
2. Cursor Automation “MillQ Origin→GitHub backup” with the same secrets, or
3. Scheduled drift-repair (safety net only).

Until wired, every Origin merge must end with an explicit backup SHA check in the agent completion report.

## Agent policy

| Actor | May run backup script with App secrets? | May `git push` GitHub main as user/PAT? |
| --- | --- | --- |
| MillQ Origin Backup App automation | Yes | N/A (uses installation token) |
| Implementation / Review agents | Only if App secrets are injected into that automation env | **No** |
| Human developer identities | No (unless operating the App automation) | **No** |
