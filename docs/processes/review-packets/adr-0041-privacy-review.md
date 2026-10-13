# PR #84 — ADR-0041 Privacy review (independent)

- **Subject:** ADR-0041 @ HEAD `79b107386b72f0d5a0f835c27d2fe1f025045333` (pre-remediation)
- **Reviewer context:** independent Privacy Review Agent
- **Reviewed:** 2026-10-13

## Checklist (pre-remediation)

- [x] No cross-tenant Task/read/notify merge (ADR-0015 / ADR-0022)
- [x] Professional ≠ membership; Accountant single-tenant mutation
- [x] No silent Owner notify (RED / absence / delivery failure); Channel D only
- [x] Biometry/selfie out of M1; Q Place/Q Card excluded
- [ ] Outbox / Channel D / attachment **safe display metadata** locked (no PIN/session/secrets)

## Findings

1–4 OK as above.
5. **Gap:** Gate 0 deferred safe-metadata rule was not locked in ADR-0041 text at `79b1073`.

## Verdict (on `79b1073`)

```text
VERDICT: REQUEST CHANGES
```

## Remediation (author follow-up — not self-approve)

ADR §8.1 added: mandatory safe display metadata for task outbox, Channel D, reminders, comment/attachment metadata under ADR-0015; forbidden secrets list; attachment bytes via Privacy Control Plane. **Re-review required on post-remediation HEAD** before Privacy APPROVE.
