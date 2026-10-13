# PR #84 — ADR-0041 Privacy review (independent)

- **Subject:** ADR-0041 TaskService Manager Dispatcher @ exact PR #84 HEAD
- **Reviewed HEAD:** `863d3df4d9d6c33b05ec5453bba0daf6985d5813` (post-remediation; §8.1 landed in `1eb631bc67cc8a4e100e4495cf196d5f75a2cadf`)
- **Branch:** `docs/taskservice-adr-0041`
- **Base:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **Autonomy of subject:** Level C docs-only — **not** Accept, merge, or runtime authorization
- **Reviewer context:** independent Privacy Review Agent (re-review after REQUEST CHANGES @ `79b1073`)
- **Reviewed:** 2026-10-13
- **STOP:** No merge, no runtime, no #82 edits

## Prior verdict (pre-remediation)

On `79b107386b72f0d5a0f835c27d2fe1f025045333`: **REQUEST CHANGES** — Gate 0 deferred safe-metadata rule was not locked in ADR-0041 text (outbox / Channel D / attachment metadata).

## Remediation verified

ADR §8.1 **Safe display metadata (ADR-0015 — mandatory)** present at this HEAD:

- Scope: Task outbox events, Channel D escalation payloads, reminder pushes, Task comment/attachment **metadata** → **safe display fields only**
- Forbidden: PIN, session tokens, password hashes, OTP codes, raw payment credentials, private e-sign keys, unrestricted PII dumps
- Attachment bytes → Privacy Control Plane / retention (ADR-0015); Task stores references + non-sensitive descriptors
- Rule **not optional** for Accept; retention TTLs remain OPEN for Level B schema
- Aligns with Identity pattern `notification-port.ts` / `DANGEROUS_OPERATION_APPROVAL_REQUESTED`
- Classification map §15 lists §8.1 under Proposed technical choices (mandatory under ADR-0015)

## Checklist (post-remediation)

- [x] No cross-tenant Task/read/notify merge (ADR-0015 / ADR-0022) — §7, §10, §13.3
- [x] Professional ≠ membership; Accountant single-tenant mutation — §5, §12, ADR-0022
- [x] No silent Owner notify (RED / absence / delivery failure); Channel D only — §2, §8, §9, §10
- [x] Biometry/selfie out of M1; Q Place/Q Card excluded — §11, §14, OPEN selfie retention out of M1
- [x] Outbox / Channel D / attachment **safe display metadata** locked (no PIN/session/secrets) — **§8.1**

## Findings (≤5)

1. **Prior gap closed:** §8.1 locks safe display metadata for the exact surfaces called out in REQUEST CHANGES (outbox, Channel D, reminders, comment/attachment metadata).
2. **Forbidden secrets list is explicit** and matches Identity outbox posture (PIN/session/OTP/hashes/credentials/keys; no unrestricted PII dumps).
3. **Attachment handling is privacy-safe for docs Accept:** bytes under Privacy Control Plane; Task row holds references + non-sensitive descriptors only.
4. **Tenant / notify boundaries remain sound:** cross-tenant denied; fail-closed empty scope; no silent Owner path; Channel D is the only Manager→Owner escalation for ordinary Tasks.
5. **Residual (non-blocking for this docs ADR):** exact retention TTLs and Level B payload field allowlists stay OPEN for schema/API PRs — correctly deferred, not left as Accept-optional.

## Verdict (on `863d3df`)

Privacy posture of Proposed ADR-0041 is adequate for Level C docs-only Accept path after §8.1 remediation. Does not authorize runtime, Gate 0 #83 merge, OFFICE1.1 Accept, or schema Go-live.

```text
VERDICT: APPROVE
```
