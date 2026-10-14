# ADR-0039 Amendment A: Phone-First Signup, Optional Email, Subsequent MFA

- **Status:** **Accepted WITH DELTAS** (OFFICE1.1 PR #82)
- **Accepted:** 2026-10-13 — PO **ACCEPT WITH DELTAS**; docs merge `e83a02b8933947a80d4ceb0cf50d84e44c5aaf0f` (PR #82; parents `94f540a…` + `ea9ae99…`)
- **Date (authored):** 2026-10-12
- **Decision owners:** Product Owner and System Architect
- **Amends:** [ADR-0039](ADR-0039-office-global-account-mfa-owner-bootstrap.md) (**Accepted**)
- **Related:** ADR-0015; ADR-0022; [ADR-0040](ADR-0040-office-username-invites-professional-grants.md) (**Accepted WITH DELTAS**); [Amendment B](ADR-0039-amendment-B-office11-mfa-otp-trusted-device.md) (**Accepted WITH DELTAS** — read together)
- **Autonomy:** Level **C** design Accept. **STOP BEFORE RUNTIME / migrations / production activation** until separate **Level B** authorization (IDENTITY-B\* slices).
- **Canonical Accept merge:** `e83a02b8933947a80d4ceb0cf50d84e44c5aaf0f`
- **Notion:** PO pages `3f721d5d34878197bab3c0f34c6b3867`, `3f721d5d348781c7b9deff2e48d040c4` — **agent access limited** (login/load wall). Product bindings use the **PO ACCEPTED PRODUCT CONTRACT** from the OFFICE1.1 preflight brief.

---

## Why amend (not replace)

ADR-0039 Accepted B3 assumed **email as primary register/login identifier** and **email OTP as the mandatory first second-factor**.

OFFICE1.1 PO Accepted Product Contract requires:

1. **Verified phone** as primary signup/contact identifier.
2. **No SMS.** Initial verification via **Zalo ZBS OTP** is accepted as **product direction**.
3. **Email optional**; if present, **independently verify**.
4. Mandatory globally unique `@username` (detailed in ADR-0040).
5. Preserve ADR-0039 security plane: password-first, **mandatory MFA before OfficeSession**, OfficePartialAuth ≠ OfficeSession, OFFICE ≠ POS.

This amendment **updates contact/signup identifiers and first-factor delivery channel**. It does **not** remove MFA, passkey rules, push rules, bootstrap rules, or POS isolation.

---

## Binding deltas (Accepted WITH DELTAS)

### A1. Signup identifiers

| Field | Binding |
| --- | --- |
| `GlobalAccountId` | Immutable security principal (unchanged) |
| `@username` | **Mandatory** at GlobalAccount create; globally unique; see ADR-0040 |
| Phone | **Mandatory**; E.164-normalized; **verified** before GlobalAccount becomes usable for Office login |
| Phone verification channel | **Zalo ZBS OTP** (direction Accepted). **SMS forbidden** as product channel |
| Email | **Optional**. If supplied, must be **independently verified** before use as recovery or MFA factor |
| Password | Still required for Office (password-first; unchanged from ADR-0039) |

**Forbidden:** creating an Office-capable GlobalAccount with unverified phone; treating unverified email as verified contact; using SMS OTP as the designed primary channel.

### A2. MFA lifecycle (replaces ADR-0039 B3 table rows that assume email-primary)

| Stage | Binding |
| --- | --- |
| Signup | phone Zalo OTP verify → create GlobalAccount + `@username` + password credential (no Tenant) |
| Password success | **OfficePartialAuth only** (unchanged) |
| First OfficeSession | password + **mandatory second factor**. Preferred: **phone OTP via Zalo ZBS** when phone is the verified primary contact. If a **verified email** exists, **email OTP remains an allowed second factor**. Never mint OfficeSession after password alone |
| Later logins | password then **exactly one** of: **passkey** OR **TrustedDevice** OR **trusted signed KiU mobile push** OR **phone OTP (Zalo)** OR **email OTP (only if email verified)** — see Amendment B §B2; **never password-only** |
| Passkey | Unchanged: optional; enroll after first OfficeSession; skip allowed; not passwordless |
| Fail / cancel / expire / reject | Unchanged: never creates OfficeSession; never bypass |

**Not silently replaced:** mandatory MFA before OfficeSession; PartialAuth ≠ Session; WebAuthn server verification; push trust binding; CSRF / cookie isolation vs POS.

### A3. Zalo unavailable / fallback (OPEN bounds)

| Rule | Binding |
| --- | --- |
| Primary channel | Zalo ZBS OTP for phone verification and phone second-factor |
| When Zalo delivery fails | Fail closed for that attempt; allow retry; **do not** auto-switch to SMS |
| Alternate verified channel | If **email is independently verified**, email OTP may be used as MFA alternate (not as phone substitute for signup identity) |
| Long outage / no email | Recovery path **OPEN** (must not invent silent SMS or support break-glass as default) |

Exact Zalo provider contract, OTP length/TTL/rate limits, and outage playbook remain **OPEN**.

### A4. Recovery & takeover protection (direction; details OPEN)

| Direction | Binding |
| --- | --- |
| Phone change | Requires strong re-auth (active OfficeSession + fresh second factor); cool-down / dual-control **OPEN** |
| Username change | Never transfers grants (ADR-0040); does not change `GlobalAccountId` |
| Email add/verify | Independent verification; does not replace phone as primary contact unless PO later Accepts |
| Account takeover signals | Throttle, lockout, anti-enumeration (ADR-0039 B8); exact copy/limits OPEN |

### A5. API surface delta (docs only)

Supersede register/password identity fields in ADR-0039 proposed APIs:

```text
POST /api/v1/office/accounts/register
  { username, phoneE164, password, email?, idempotencyKey }
  → requires prior phone OTP proof; creates GlobalAccount (no Tenant)

POST /api/v1/office/auth/phone-otp/start|verify   # Zalo ZBS; signup + MFA
POST /api/v1/office/auth/password
  { usernameOrPhoneOrEmail, password } → { partialAuthToken, mfaRequired: true }

# email OTP routes remain for verified-email MFA / email verification only
POST /api/v1/office/contacts/email/verify/start|confirm
```

Login identifier resolution order and anti-enumeration copy **OPEN**.

---

## Explicit non-changes (still Accepted ADR-0039)

- GlobalAccount ≠ `identity_user`; OFFICE ≠ TERMINAL/MOBILE.
- CreateBusinessBootstrap still MFA-authenticated OfficeSession only; new Tenant only; Brand #1 atomic.
- ADR-0022 Professional path independent of bootstrap.
- ADR-0015 privacy / residency / audit plane.
- No runtime / migrations in this amendment PR.

---

## Remaining OPEN (do not invent as Accepted)

1. Exact OTP length, TTL, attempt limits, lockout windows.
2. Zalo ZBS vendor contract, templates, egress (ADR-0015 Egress Gate), residency of OTP delivery metadata.
3. Signup identifier collision UX (phone already registered) without enumeration leak.
4. Password/factor-loss recovery when Zalo unavailable and email absent.
5. Whether verified email may later become an optional login alias (direction lean yes; Accept needed).
6. Phone country allow-list / VN-first policy.
7. Notion UI-only fields beyond the PO Accepted Product Contract (Notion not re-readable).

---

## Accept checklist (for PO)

| Requirement | Binding |
| --- | --- |
| Phone-first verified signup | A1 |
| No SMS as designed channel | A1, A3 |
| Zalo ZBS OTP direction | A1, A2, A3 |
| Email optional + independent verify | A1, A2 |
| Mandatory MFA before OfficeSession preserved | A2 |
| Password-first + PartialAuth preserved | A2 |
| POS isolation preserved | Explicit non-changes |

## Alternatives considered

- Replace MFA with phone-only passwordless — **rejected** (weakens ADR-0039).
- Keep email-mandatory signup — **rejected** (conflicts with PO Accepted Product Contract).
- SMS fallback as silent default — **rejected** (PO: no SMS).
- Soft-delete ADR-0039 B3 without amendment — **rejected** (silent contract replace forbidden).
