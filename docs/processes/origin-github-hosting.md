# Origin hosting and GitHub backup

This process implements [ADR-0004](../decisions/ADR-0004-origin-source-of-truth.md). Cursor Origin is the **only** source of truth. GitHub [`millQ-dev/KiU_POS`](https://github.com/millQ-dev/KiU_POS) is the sole backup mirror of Origin, not a workplace. Legacy URL `github.com/millQ-dev/MillQ` is a GitHub rename redirect to the same repository ID — do not treat it as a second mirror.

Agent autonomy, review, and auto-merge live in [`autonomous-development.md`](autonomous-development.md).

## Rule of thumb

| Action | Where |
| --- | --- |
| Clone, branch, commit, push | Origin |
| Open, review, merge pull requests | Origin |
| Start Cloud Agents | Origin repository |
| Track new work | Cloud Agent run and/or Origin pull request |
| Write GitHub `main` / tags after cutover | GitHub App **MillQ Origin Backup** only |
| File new GitHub issues or merge GitHub PRs | Do not |

Built-in Origin **Sync from GitHub** is the wrong direction. That mode makes GitHub the source and Origin the mirror. MillQ’s rule is the reverse.

**Dual-write is forbidden.** Developers and agents must not push the same commit to Origin and GitHub. Do not configure two push URLs on one remote.

## Remotes

Canonical (name this remote `origin` after cutover):

```text
https://origin.cursor.com/{owner}/MillQ.git
```

Browse: `https://cursor.com/codebase/{owner}/MillQ`

Backup only (name this remote `github`):

```text
https://github.com/millQ-dev/KiU_POS.git
```

Legacy redirect (same repo): `https://github.com/millQ-dev/MillQ.git` — prefer `KiU_POS` in all new docs and automation.

Replace `{owner}` with the claimed Origin codebase name. Confirm it in the Code dropdown at `cursor.com/codebase`.

Local setup after cutover:

```bash
git remote rename origin github   # only if origin still points at GitHub
git remote add origin https://origin.cursor.com/{owner}/MillQ.git
git fetch origin
git branch -u origin/main main
git remote set-url --push github no_push
```

`git remote set-url --push github no_push` is a local guard so a developer checkout cannot accidentally update the backup. The backup identity uses its own credentials and is the only writer to GitHub.

## GitHub backup model

Target path after every Origin merge:

`Origin main → GitHub App “MillQ Origin Backup” → GitHub main`

Also push **Origin tags** so GitHub reflects those tags.

**Scope:** Origin `main` and Origin tags only. Do **not** mirror other branches. Do **not** fetch or merge GitHub state into Origin.

### Backup identity and authentication

The writer is the GitHub App **MillQ Origin Backup**, installed on `millQ-dev/KiU_POS` (legacy install path may still show `millQ-dev/MillQ` after rename). It is the intended ruleset bypass identity. [`scripts/backup-origin-to-github.sh`](../../scripts/backup-origin-to-github.sh) authenticates as follows:

1. Read `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY` from the automation environment.
2. Sign a short-lived GitHub App JWT with the private key.
3. Exchange the JWT for an installation access token (`POST /app/installations/{id}/access_tokens`).
4. Push GitHub HTTPS using that token (`x-access-token` basic extraheader). Never anonymous HTTPS write. Never a PAT or personal-account login.

If those secrets are missing or token creation fails, the job must exit without pushing. Do not print the JWT, installation token, or private key.

### Who may write GitHub `main`

After cutover:

- The **MillQ Origin Backup** GitHub App is the only identity authorized to perform the direct backup write to GitHub `main` and to create/update/delete release/protected tags.
- Implementation agents, Review Agents, and normal human development identities **must not** receive this right and **must not** push to GitHub.
- Dual-write from a working clone is forbidden.

### Required GitHub rulesets

These protections apply to the **GitHub backup host only**. They do not weaken Origin `main`.

| Ruleset | Target | Policy | Bypass |
| --- | --- | --- | --- |
| Branch ruleset | `main` | Routine writes blocked | Backup identity **only** |
| Tag ruleset | release / protected tags | Creation, update, and deletion restricted | Backup identity **only** |

The same backup automation/service identity is the sole bypass actor on **both** rulesets. Implementation agents, Review Agents, and human developers receive neither bypass. The exception exists only for deterministic Origin→GitHub replication of `main` and of Origin tags (not other branches). It must never be used for development, hotfixes, or GitHub PRs.

A GitHub branch ruleset that blocks routine writes would also reject the backup job unless that backup identity is listed. The tag ruleset is the matching control so protected tags cannot be created, moved, or deleted except by the same backup path.

Do **not** copy these bypasses onto Origin `main`. Origin remains PR-only with independent review and no implementer bypass.

Repo-level rulesets on `millQ-dev/KiU_POS` were empty when last checked from this environment. Creating or confirming the two rulesets above is an owner/platform operation.

A local `git remote set-url --push github no_push` on developer clones is an extra guard. It does not replace the GitHub rulesets.

Job body: [`scripts/backup-origin-to-github.sh`](../../scripts/backup-origin-to-github.sh). Fast-forward only; no force-push of GitHub `main`. Pushes Origin `main` and Origin tags only. GitHub App installation token required; anonymous push is refused.

How to trigger it is an owner/platform choice once Origin is detached, for example:

- Origin webhook `pull_request.merged` (documented on the Origin API) calling the backup job
- a Cursor Automation on Origin PR merge, if available for this repo after cutover
- a scheduled job only as a drift-repair safety net, not as the primary path

Do not claim any of those triggers work until they have been tested after Detach.

Until that automation exists, Origin `main` and GitHub `main` can drift. That is an operational gap, not permission to dual-write from an agent.

## Cutover checklist

This is an **owner/platform operation**. A Cloud Agent cloned from `github.com/millQ-dev/KiU_POS` (or the legacy `MillQ` redirect) cannot Detach Origin, attach Cloud Agents to Origin, or prove backup automation.

Do not mark cutover complete until every step below has actually been done.

1. Finish the last governance PR of the old GitHub workflow (currently GitHub PR #13 on this hosting decision). Independent review still applies. Do not skip review by calling this “just docs”.
2. Confirm GitHub `main` contains that final agreed SHA.
3. Sync Origin to that same SHA (Origin copy of `main` matches GitHub `main` **before** Detach).
4. Compare SHAs. They must be identical before Detach.
5. In Cursor Origin **Settings → General → Danger Zone**, run **Detach from GitHub** if Origin is still a GitHub-sourced mirror. After Detach, Origin is the only canonical repository. Cursor will no longer pass pushes through to GitHub.
6. From this point, treat Origin as the only writable host.
7. Start a **test Cloud Agent against the Origin MillQ repo** (not GitHub).
8. Have that agent create a test branch and an Origin pull request (Level A, trivial, disposable) and **arm merge-when-ready** (`origin pr merge --auto`).
9. Run an **independent** Review Agent on that PR (`APPROVE` or `REQUEST CHANGES` from a separate context). The Review Agent must not be asked to merge.
10. Confirm CI/checks behaviour: either required checks run, or record that CI is not attached yet and is therefore not a merge gate.
11. Confirm unattended merge: after independent `APPROVE` and required checks, Origin merges without a human click. Direct push to Origin `main` must still be rejected. Immediate/unconditional merge by the Implementation Agent must still be rejected.
12. Confirm the test change is on Origin `main`.
13. Run backup: Origin `main` → GitHub `main` and Origin release/protected tags → GitHub via the **backup identity only**, using its bypass on **both** GitHub rulesets. Confirm a routine identity cannot push GitHub `main` and cannot create, update, or delete those tags.
14. Confirm GitHub `main` SHA equals Origin `main` SHA.
15. Declare cutover complete only after steps 1–14. After that, do not start implementation Cloud Agents on GitHub.

If step 5 is skipped while Origin remains a GitHub-sourced mirror, GitHub is still the real source despite this document. That is a failed cutover.

## Agents after cutover

- Start Cloud Agents from cursor.com/agents (or Cursor iOS / PWA) and **select the Origin MillQ repo**.
- Open PRs on Origin only.
- Follow [`autonomous-development.md`](autonomous-development.md) for levels, review, and auto-merge.
- Historical GitHub issue URLs in older ADRs stay as archive citations. Do not open new GitHub issues as the work queue.

## CI

Canonical Origin merge CI is **Depot**, defined in [`.depot/workflows/ci.yml`](../../.depot/workflows/ci.yml). Checks on GitHub are not the merge gate.

These files are **not** competing sources of truth. Keep the backup-script test step in lockstep when the Depot workflow changes, but do not treat GitHub Actions as attached Origin CI:

| File | Role |
| --- | --- |
| `.depot/workflows/ci.yml` | Origin merge CI (Depot) |
| `.github/workflows/ci.yml` | Dormant GitHub Actions copy for the backup remote only |
| `infrastructure/ci/github-actions-ci.yml` | Reference/legacy copy of that GitHub Actions definition |

See [`infrastructure/ci/README.md`](../../infrastructure/ci/README.md).

## What this process does not do

- It does not rename the Origin namespace (not allowed during Origin beta).
- It does not migrate GitHub Issues, Actions, or secrets into Origin.
- It does not enable Cursor’s GitHub→Origin mirror.
- It does not by itself create Origin rulesets, CI apps, webhooks, or the backup service account.
- Detach, rulesets, CI apps, Cloud Agent repo picker, and backup credentials are dashboard/platform actions.

## Remaining owner / platform actions

Not performed from the GitHub-cloned Cloud Agent that authored these docs:

1. Merge GitHub PR #13 after independent review (last GitHub-workflow governance PR).
2. Confirm Origin namespace `{owner}` and repo URL.
3. Equalize Origin `main` and GitHub `main` SHAs, then **Detach from GitHub**.
4. Protect Origin `main` (PR required, no direct push, independent review required, CI required when CI exists, merge-when-ready allowed). Do **not** give implementation agents a bypass on Origin `main`.
5. Attach Depot or Buildkite if CI should be a merge gate.
6. On GitHub, apply two rulesets and give **only** the backup identity bypass on each:
   - branch ruleset on `main`: routine writes blocked;
   - tag ruleset on release/protected tags: create/update/delete restricted.
   Do not give either bypass to developers or agents. Do not add an Origin `main` bypass.
7. Wire backup on each Origin merge; test SHA match; confirm a non-backup identity cannot push GitHub `main` or mutate protected tags.
8. Start the first Origin Cloud Agent and run the test PR: implementer arms merge-when-ready → independent review → automatic merge → backup (cutover steps 7–14).
9. Stop launching new implementation agents against GitHub.
