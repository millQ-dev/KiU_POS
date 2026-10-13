# OFFICE1.1 / Origin PR #82 — Open review issues (Gate 0 record + Security Closure)

- **Status:** Remediation **Proposed** 2026-10-13 — **not** Accepted; **not** merged
- **PR:** Origin #82 draft — `docs(office): OFFICE1.1 Global Username & Professional Access preflight`
- **Canonical main:** `94f540ae64fc9c88bda50bf7c275ecec3f6f4909`
- **Remediation authority:** [office1.1-pr82-security-closure-remediation.md](office1.1-pr82-security-closure-remediation.md); [ADR-0039 Amendment B](../decisions/ADR-0039-amendment-B-office11-mfa-otp-trusted-device.md); ADR-0040 §5–§6–§9
- **Rule:** Do not merge PR #82 or Accept Amendment A/B / ADR-0040 until PO decides. Do not re-review merged #83/#84.

---

## Issue list

### R82-1 — Duplicate Zalo OTP (signup + first session)

**Problem:** Signup MFA and immediate first OfficeSession must not force an unnecessary second Zalo OTP when the first factor proof is still fresh and bound.

**Proposed remediation:** Amendment B §B1 — `PhoneOtpSatisfactionProof` purpose `SIGNUP_AND_FIRST_SESSION`.

**Blocks:** Phone-first OFFICE1.1 UX cost and abandonment — until PO Accept.

---

### R82-2 — Trusted-device / repeat-login MFA UX and costs

**Problem:** Repeat login MFA burden and Zalo/provider cost need a trusted-device (or equivalent) policy without weakening ADR-0039 MFA.

**Proposed remediation:** Amendment B §B2 — TrustedDevice / passkey / push / OTP; **password-only forbidden**; explicit ADR-0039 B3 deltas.

**Blocks:** Sustainable Office login UX — until PO Accept.

---

### R82-3 — Empty LegalEntity / Outlet scope must not mean tenant-wide

**Problem:** Empty or omitted LE/Outlet scope must **fail closed**, never silently expand to tenant-wide authority.

**Proposed remediation:** ADR-0040 §5 — required `scope_mode`; empty arrays reject; `TENANT_WIDE` only via explicit authorized selection.

**Conflict:** Supersedes prior Proposed “empty = tenant-policy default OPEN” and packet O5.

**Blocks:** Safe TaskService scopes, professional grants — until PO Accept.

---

### R82-4 — Internal Accountant memberships ∪ professional clients in one read hub

**Problem:** Unified Accountant read hub must list both TenantMembership accountant roles and ClientAccessGrant clients without combining mutation privileges.

**Proposed remediation:** ADR-0040 §6 — read union with `authorizationSource`; mutation single command class.

**Conflict (soft):** Extends prior “clients = grants only” architecture §5.1.

**Blocks:** Accountant cabinet multi-client inbox — until PO Accept.

---

### R82-5 — Username recycling, phone loss, recovery security rules

**Problem:** Username recycling, phone loss, recovery without mandatory email; prevent owner/accountant takeover.

**Proposed remediation:** ADR-0040 §9 + Amendment B §B3.

**Blocks:** Safe GlobalAccount identity lifecycle — until PO Accept (numerics may remain OPEN).

---

### R82-M1 — Employee Task complete vs Mobile identity (dependency)

**Problem:** Resolve whether M1 employee Task completion can use OfficeSession, deferring KiU Mobile identity.

**Proposed remediation:** OfficeSession + `task.complete` in M1; Mobile principal mapping later (ADR-0041 D1 compatible).

**Blocks:** M1 sequencing clarity — until PO confirms; does not reopen #84.

---

## Relation to Backoffice Gate 0 / ADR-0041

| Issue | Backoffice impact |
| --- | --- |
| R82-1, R82-2 | OfficeSession availability for all cabinets |
| R82-3 | Task + grant scoping fail-closed (assumed by Gate 0 / ADR-0041) |
| R82-4 | Accountant cabinet |
| R82-5 | Account recovery / takeover risk |
| R82-M1 | M1 employee complete principal |

Gate 0 TaskService design **assumes** R82-3 fail-closed scope; it does **not** Accept OFFICE1.1 proposals. ADR-0041 is **Accepted WITH DELTAS** on main — do not re-litigate.
