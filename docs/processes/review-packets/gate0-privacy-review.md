# Gate 0 — Privacy independent review

- **Subject:** Gate 0 TaskService / cabinet readiness vs ADR-0015 / ADR-0022
- **Baseline:** Origin `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **Autonomy of subject:** Level C docs-only
- **Reviewer context:** independent of the authoring agent (Privacy Review Agent)
- **Reviewed:** 2026-10-13
- **Sources:** `backoffice-gate0-architecture-reconciliation.md`, `office1.1-pr82-open-review-issues.md`, ADR-0015, ADR-0022

## Invariants to check

- [x] No cross-tenant Task or read-hub merge; Accountant multi-client = authorized aggregation only (ADR-0022)
- [x] Task attachments/comments called out under privacy controls; no secrets in payloads
- [x] Employee biometrics explicitly out of first vertical; no new biometric requirement introduced
- [x] Notification/outbox events remain safe display metadata (no PIN/session tokens) — pattern preserved
- [x] Username/phone recovery issues (R82-5) recorded as OPEN, not weakened
- [x] Professional vs membership paths not conflated in proposed Accountant hub (R82-4)

## Findings

1. **Cross-tenant isolation:** Task entity is single-`tenantId`; §4.6 forbids cross-tenant Tasks; Accountant multi-client = authorized single-tenant reads only (ADR-0022 §5); mutations remain single-tenant and multi-client mutations excluded from first vertical.
2. **Accountant hub (R82-4):** §6 and open-issues R82-4 require membership ∪ `ClientAccessGrant` union **without** path conflation or cross-client scope inheritance — aligns with ADR-0022 §1–§4; left OPEN, not Accepted by Gate 0.
3. **Biometrics:** Employee biometrics classified MISSING / privacy-constrained (ADR-0015 no default biometric voice ID); explicitly out of first Manager vertical and G-MGR-V1; no new biometric surface introduced.
4. **Attachments / PII:** `TaskComment` / `TaskAttachment` proposed under ADR-0015 privacy controls; “no secrets in task payload” stated; detail deferred to TaskService ADR (appropriate for Proposed Gate 0).
5. **R82-5 + outbox:** Username recycling / phone loss / recovery remain OPEN on PR #82 (C-BO-03); Gate 0 does not Accept ADR-0040 or weaken recovery. Task outbox reuses `identity_notification_outbox` pattern with event-type names only and no secrets in payloads — display-metadata safety preserved by reference (payload schema to be locked in Task ADR).

## Verdict

**APPROVE** — Gate 0 docs preserve ADR-0015 / ADR-0022 privacy invariants; no Accept of OFFICE1.1 proposals; no privacy-weakening invent.

```text
VERDICT: APPROVE
```

## Non-scope

- No runtime / migration changes
- No ADR Accept (Amendment A / ADR-0040 / TaskService ADR)
- Notion handoff unread — privacy of unread Notion DTOs not assessed
