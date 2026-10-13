# OFFICE1.1 / Origin PR #82 — Open review issues (Gate 0 record)

- **Status:** OPEN — **not** Accepted; **not** resolved by Gate 0
- **PR:** Origin #82 draft — `docs(office): OFFICE1.1 Global Username & Professional Access preflight`
- **PR tip:** `142adb26632526d06e9e63f8160335f4cd918477`
- **Base:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **Rule:** Do not merge PR #82 or Accept Amendment A / ADR-0040 until these are decided by PO. Gate 0 must not reimplement OFFICE1.1 docs.

---

## Issue list

### R82-1 — Duplicate Zalo OTP (signup + first session)

**Problem:** Signup MFA and immediate first OfficeSession must not force an unnecessary second Zalo OTP when the first factor proof is still fresh and bound.

**Needs:** Explicit TTL / binding rule for “signup OTP satisfies first session” vs when a new OTP is mandatory.

**Blocks:** Phone-first OFFICE1.1 UX cost and abandonment.

---

### R82-2 — Trusted-device / repeat-login MFA UX and costs

**Problem:** Repeat login MFA burden and Zalo/provider cost need a trusted-device (or equivalent) policy: enrollment, revocation, step-up triggers, and what “remembered” means without weakening ADR-0039 MFA.

**Needs:** PO Accept on trusted-device semantics, lifetime, and step-up events (new outlet, money movement, recovery, etc.).

**Blocks:** Sustainable Office login UX.

---

### R82-3 — Empty LegalEntity / Outlet scope must not mean tenant-wide

**Problem:** Empty or omitted LE/Outlet scope must **fail closed**, never silently expand to tenant-wide authority (aligns with `identity_access_grant` tenant-wide vs outlet unique indexes on mig `027`).

**Needs:** Contract wording + future schema checks: `NULL` scope ≠ wildcard.

**Blocks:** Safe TaskService scopes, professional grants, Manager/Owner assignments.

---

### R82-4 — Internal Accountant memberships ∪ professional clients in one read hub

**Problem:** Unified Accountant read hub must list **both**:

- ordinary internal `TenantMembership` accountant roles; and
- independently granted ADR-0022 `ClientAccessGrant` clients;

without conflating paths or inheriting scopes across clients.

**Needs:** Read-model union rules; mutation still single-tenant explicit context (ADR-0022 §4).

**Blocks:** Accountant cabinet multi-client inbox.

---

### R82-5 — Username recycling, phone loss, recovery security rules

**Problem:** `@username` recycling after release, phone-number loss, and account recovery need explicit security rules (cooldown, tombstone, proof-of-possession, support break-glass).

**Needs:** ADR-0040 (or successor) Accept text covering recycling cooldown, phone re-bind, and recovery step-up.

**Blocks:** Safe GlobalAccount identity lifecycle before Backoffice scale.

---

## Relation to Backoffice Gate 0

| Issue | Backoffice impact |
| --- | --- |
| R82-1, R82-2 | OfficeSession availability for all cabinets |
| R82-3 | Task + grant scoping fail-closed |
| R82-4 | Accountant cabinet |
| R82-5 | Account recovery / takeover risk |

Gate 0 TaskService design **assumes** R82-3 fail-closed scope; it does **not** Accept OFFICE1.1 proposals.
