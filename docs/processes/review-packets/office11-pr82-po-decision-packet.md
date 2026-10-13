# OFFICE1.1 PR #82 — Self-Contained PO Decision Packet

- **STATUS:** PO REVIEW HOLD — **DO NOT MERGE OR IMPLEMENT**
- **Date:** 2026-10-12
- **PR:** https://cursor.com/codebase/millqdev/MillQ/pull/82 (draft)
- **Base:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e`
- **HEAD:** `d0b81869a1ebea9a86de3bd239f4b5f4ba6ae307`
- **Independent reviews (acknowledged):** Identity/Security APPROVE · Architecture APPROVE · Privacy APPROVE

Sources on HEAD (line ranges refer to files at this commit):

| Doc | Path |
| --- | --- |
| Amendment A | `docs/decisions/ADR-0039-amendment-A-phone-first-optional-email.md` |
| ADR-0040 | `docs/decisions/ADR-0040-office-username-invites-professional-grants.md` |
| Architecture | `docs/architecture/office1.1-global-username-professional-access.md` |
| Accepted ADR-0039 B3 (conflict baseline) | `docs/decisions/ADR-0039-office-global-account-mfa-owner-bootstrap.md` L88–L97 |
| Accepted ADR-0022 | `docs/decisions/ADR-0022-professional-account-cross-business-access.md` |

---

## 0. PO Accepted Product Contract (Notion-verified by PO)

1. Mandatory globally unique `@username` per Office GlobalAccount.
2. Immutable `GlobalAccountId` is security principal; username change never transfers grants.
3. Verified phone primary signup/contact; no SMS; Zalo ZBS OTP = product direction.
4. Email optional; if present, independently verify.
5. Owner/admin find by username → preview → scoped grants → invitation.
6. Access ACTIVE only after valid invitation acceptance + authorization checks.
7. One accountant GlobalAccount → multiple independent client grants (Tenant / LE / Outlet).
8. Unified cross-client **read-only** accountant inbox (documents, tasks, deadlines, exceptions).
9. Every mutation under exactly one explicitly selected authorized Tenant context.
10. POS PIN identities/sessions remain separate.

---

## 1. ADR-0039 Amendment A — complete Proposed wording

**File:** `docs/decisions/ADR-0039-amendment-A-phone-first-optional-email.md`  
**Status on HEAD:** Proposed (not Accepted). Until PO Accepts, Accepted ADR-0039 **B3 email-primary** remains binding.

### Full Proposed text (L1–L138)

```markdown
# ADR-0039 Amendment A: Phone-First Signup, Optional Email, Subsequent MFA

- **Status:** **Proposed** (OFFICE1.1 Level C preflight — **not Accepted**)
- **Date:** 2026-10-12
- **Decision owners:** Product Owner and System Architect
- **Amends:** ADR-0039 (Accepted)
- **Related:** ADR-0015; ADR-0022; Proposed ADR-0040
- **Autonomy:** Level **C** (docs only). **STOP BEFORE RUNTIME.**
- **Canonical baseline:** 18316b8f8aa2da6d045b04aebbde3c5434ea046e

## Why amend (not replace)

ADR-0039 Accepted B3 assumed email as primary register/login identifier and email OTP as the mandatory first second-factor.

OFFICE1.1 PO Accepted Product Contract requires:
1. Verified phone as primary signup/contact identifier.
2. No SMS. Initial verification via Zalo ZBS OTP is accepted as product direction.
3. Email optional; if present, independently verify.
4. Mandatory globally unique @username (detailed in ADR-0040).
5. Preserve ADR-0039 security plane: password-first, mandatory MFA before OfficeSession,
   OfficePartialAuth ≠ OfficeSession, OFFICE ≠ POS.

This amendment updates contact/signup identifiers and first-factor delivery channel.
It does not remove MFA, passkey rules, push rules, bootstrap rules, or POS isolation.

## Binding deltas (Proposed — require PO Accept)

### A1. Signup identifiers

| Field | Binding |
| GlobalAccountId | Immutable security principal (unchanged) |
| @username | Mandatory at GlobalAccount create; globally unique; see ADR-0040 |
| Phone | Mandatory; E.164-normalized; verified before GlobalAccount usable for Office login |
| Phone verification channel | Zalo ZBS OTP (direction Accepted). SMS forbidden as product channel |
| Email | Optional. If supplied, must be independently verified before use as recovery or MFA factor |
| Password | Still required for Office (password-first; unchanged from ADR-0039) |

Forbidden: creating an Office-capable GlobalAccount with unverified phone;
treating unverified email as verified contact; using SMS OTP as the designed primary channel.

### A2. MFA lifecycle (replaces ADR-0039 B3 table rows that assume email-primary)

| Stage | Binding |
| Signup | phone Zalo OTP verify → create GlobalAccount + @username + password credential (no Tenant) |
| Password success | OfficePartialAuth only (unchanged) |
| First OfficeSession | password + mandatory second factor. Preferred: phone OTP via Zalo ZBS when phone is the
  verified primary contact. If a verified email exists, email OTP remains an allowed second factor.
  Never mint OfficeSession after password alone |
| Later logins | password then passkey OR trusted signed KiU mobile push OR phone OTP (Zalo)
  OR email OTP (only if email verified) |
| Passkey | Unchanged: optional; enroll after first OfficeSession; skip allowed; not passwordless |
| Fail / cancel / expire / reject | Unchanged: never creates OfficeSession; never bypass |

Not silently replaced: mandatory MFA before OfficeSession; PartialAuth ≠ Session;
WebAuthn server verification; push trust binding; CSRF / cookie isolation vs POS.

### A3. Zalo unavailable / fallback (OPEN bounds)

| Rule | Binding |
| Primary channel | Zalo ZBS OTP for phone verification and phone second-factor |
| When Zalo delivery fails | Fail closed for that attempt; allow retry; do not auto-switch to SMS |
| Alternate verified channel | If email is independently verified, email OTP may be used as MFA alternate
  (not as phone substitute for signup identity) |
| Long outage / no email | Recovery path OPEN (must not invent silent SMS or support break-glass as default) |

Exact Zalo provider contract, OTP length/TTL/rate limits, and outage playbook remain OPEN.

### A4. Recovery & takeover protection (direction; details OPEN)

| Direction | Binding |
| Phone change | Requires strong re-auth (active OfficeSession + fresh second factor);
  cool-down / dual-control OPEN |
| Username change | Never transfers grants (ADR-0040); does not change GlobalAccountId |
| Email add/verify | Independent verification; does not replace phone as primary contact unless PO later Accepts |
| Account takeover signals | Throttle, lockout, anti-enumeration (ADR-0039 B8); exact copy/limits OPEN |

### A5. API surface delta (docs only)

POST /api/v1/office/accounts/register
  { username, phoneE164, password, email?, idempotencyKey }
  → requires prior phone OTP proof; creates GlobalAccount (no Tenant)

POST /api/v1/office/auth/phone-otp/start|verify   # Zalo ZBS; signup + MFA
POST /api/v1/office/auth/password
  { usernameOrPhoneOrEmail, password } → { partialAuthToken, mfaRequired: true }

POST /api/v1/office/contacts/email/verify/start|confirm

Login identifier resolution order and anti-enumeration copy OPEN.

## Explicit non-changes (still Accepted ADR-0039)

- GlobalAccount ≠ identity_user; OFFICE ≠ TERMINAL/MOBILE.
- CreateBusinessBootstrap still MFA-authenticated OfficeSession only; new Tenant only; Brand #1 atomic.
- ADR-0022 Professional path independent of bootstrap.
- ADR-0015 privacy / residency / audit plane.
- No runtime / migrations in this amendment PR.

## Remaining OPEN (Amendment A)

1. Exact OTP length, TTL, attempt limits, lockout windows.
2. Zalo ZBS vendor contract, templates, egress (ADR-0015 Egress Gate), residency of OTP delivery metadata.
3. Signup identifier collision UX (phone already registered) without enumeration leak.
4. Password/factor-loss recovery when Zalo unavailable and email absent.
5. Whether verified email may later become an optional login alias (direction lean yes; Accept needed).
6. Phone country allow-list / VN-first policy.
7. Notion UI-only fields beyond the PO Accepted Product Contract.

## Accept checklist / Alternatives

(See file L121–L138: phone-first, no SMS, Zalo direction, optional email, MFA preserved,
password-first+PartialAuth, POS isolation; rejected passwordless MFA removal, email-mandatory,
silent SMS fallback, soft-delete of B3 without amendment.)
```

### Trusted devices / passkey / push (how Amendment A treats them)

Amendment A **does not rewrite** ADR-0039 passkey/push rules. It **preserves**:

- Passkey: optional; enroll after first OfficeSession; skip allowed; second factor after password; not passwordless (Accepted B3 L93–L94; Amendment A2).
- Push: trusted signed KiU mobile push after prior device enrollment bound to GlobalAccount (Accepted B3 L93, L96; Amendment A2 “Later logins”).
- First session second factor preference shifts from **email OTP mandatory** → **phone Zalo OTP preferred**, with verified-email OTP still allowed (A2).

### Accepted ADR-0039 B3 being amended (conflict baseline, L88–L97)

```text
First Office login → password + email OTP mandatory → OfficeSession
Later logins → password then passkey OR push OR email OTP
Passkey optional after first OfficeSession; skip allowed; not passwordless
Fail/cancel/expire/reject never creates OfficeSession
```

---

## 2. ADR-0040 — complete Proposed decisions

**File:** `docs/decisions/ADR-0040-office-username-invites-professional-grants.md`  
**Status on HEAD:** Proposed (not Accepted).

### Full Proposed decision body (condensed verbatim structure; see file L26–L130)

**§1 Username (L28–L40)**  
Mandatory active `@username`; globally unique on normalized form; **`GlobalAccountId` only** is security principal; rename never transfers TenantMemberships / ClientAccessGrants / invitations / sessions; normalize lowercase ASCII strip `@`; format proposed `^[a-z][a-z0-9_]{2,29}$` (OPEN final); reserved deny-list OPEN; retirement quarantine OPEN (propose 90 days); invite lookup = minimal preview for authorized inviters only; no public directory.

**§2 Identity bindings (L42–L56)**  
Immutable GlobalAccountId; mutable username; verified phone primary; optional verified email; password; 0..N TenantMembership; optional ProfessionalProfile → 0..N ClientAccessGrant; optional POS `identity_user` links without shared sessions.

**§3 Membership vs professional (L58–L66)**  
TenantMembership = ordinary in-business path; ProfessionalProfile + ClientAccessGrant = professional path; may coexist; **must not union scopes across clients for mutation**.

**§4 Invitation lifecycle (L68–L89)**  
DRAFT→SENT→ACCEPTED/(EXPIRED|REVOKED|DECLINED); owner/admin invite; find by username; payload binds **GlobalAccountId at send**; rename does not retarget; ACTIVE only after accept + authz; expiry required (TTL OPEN, propose 7–14d); revoke SENT independently; revoke ACTIVE grant per client; forbid auto-activate on send / accept-as-other / scope widen on accept.

**§5 Scope model (L91–L104)**  
Per grant: required tenant_id; optional LE/Outlet subsets (empty = tenant-policy default **OPEN**); required role_code (vocab OPEN); optional permissions[] else role expands server-side.

**§6 Accountant multi-client + workspace (L106–L114)**  
Many independent grants; unified **read-only** inbox; no shared Core truth; exactly one authorized Tenant context per mutation.

**§7 Effective permission checks (L116–L124)**  
OfficeSession → explicit command class → professional path uses ClientAccessGrant for selected tenant OR membership path uses TenantMembership+RBAC → deny by default.

**§8 POS isolation (L126–L130)**  
PIN users/sessions separate; cookies never cross; Office login does not mint POS sessions.

(Migration sketch L134–L148 and API summary L152–L181 are illustrative docs-only; Explicit OPEN L185–L196.)

---

## 3. Every still-open Level C decision

Legend — **Blocks:** DocsMerge = merge of PR #82 docs · IdRuntime = GlobalAccount/MFA/username Level B · InviteRuntime = invitations/grants · AcctRuntime = accountant inbox/workspace.

| ID | Open question | Recommended default (Cursor proposal — **not PO-Accepted**) | Security / UX trade-off | If deferred | Blocks |
| --- | --- | --- | --- | --- | --- |
| O1 | Username regex / Unicode / reserved / retirement cooldown | ASCII `^[a-z][a-z0-9_]{2,29}$`; reserved: admin,root,kiu,support,system,null,me,office,accountant; **90-day** retirement | ASCII simpler + fewer spoofing vectors; Unicode better UX for VN names | Docs can merge with Proposed marker; IdRuntime needs O1 | DocsMerge: no · IdRuntime: **yes** · Invite: soft · Acct: no |
| O2 | Invite TTL / max outstanding / reminders | TTL **14 days**; max **20** SENT per tenant; no auto-remind in MVP | Longer TTL ↑ takeover window if inbox compromised; shorter ↑ friction | InviteRuntime blocked | DocsMerge: no · Invite: **yes** |
| O3 | Permission key invite/revoke | `office.professional.invite` / `office.professional.revoke` (owner role implies both) | Fine-grained vs owner-only simplicity | InviteRuntime blocked | DocsMerge: no · Invite: **yes** |
| O4 | Professional role vocabulary + default scopes | MVP roles: `EXTERNAL_ACCOUNTANT_READ`, `EXTERNAL_ACCOUNTANT_PREPARE` (mutations still single-tenant); scopes default tenant-wide until LE/Outlet narrowed | Read-only safer; prepare needs clear mutation allow-list | Invite/Acct blocked for real grants | DocsMerge: no · Invite: **yes** · Acct: **yes** |
| O5 | Empty LE/Outlet arrays meaning | Empty = **entire Tenant** under grant role (explicit “tenant-wide”) | Convenient; risk of over-broad grants if inviter forgets to narrow | Must not ship InviteRuntime with silent ambiguous empty | DocsMerge: no · Invite: **yes** |
| O6 | Zalo vendor/egress/OTP limits | Egress Gate record required before prod; OTP 6 digits / 5 min / 5 attempts / progressive lockout (align ADR-0039 OPEN) | Stronger limits ↓ abuse ↑ lockouts | Can Accept Amendment A as direction; IdRuntime prod needs O6 | DocsMerge: no · IdRuntime prod: **yes** |
| O7 | Recovery when Zalo down + no email | See §6 recommended recovery ladder | Without email, recovery is hard by design (security) | Account lockouts without recovery path | DocsMerge: no · IdRuntime: **yes** for GAOL |
| O8 | Phone change cool-down / dual control | 24h cool-down; require password + current-phone OTP + new-phone OTP; revoke other sessions | UX friction vs SIM-swap resistance | Phone-takeover residual | DocsMerge: no · IdRuntime: **yes** for phone change |
| O9 | Mutation tenant-context transport | Prefer **path** `/api/v1/office/tenants/{tenantId}/...` as sole authority; optional audit header | Path harder to forge than loose header | Soft — pick before Invite/Acct mutation APIs | DocsMerge: no · Invite/Acct mutation: **yes** |
| O10 | Inbox item taxonomy / producers / retention | Types DOCUMENT/TASK/DEADLINE/EXCEPTION; producers deferred; retention = source system | Empty inbox OK for MVP shell | AcctRuntime product value deferred | DocsMerge: no · Acct shell: soft · Acct product: **yes** |
| O11 | Employee invites same aggregate? | **Separate** employee membership invite aggregate from professional invitation | One table simpler; separation prevents role mix bugs | Soft for professional-only MVP | DocsMerge: no · Invite employee path: later |
| O12 | ProfessionalOrganization / billing | Out of OFFICE1.1; ADR-0022 future | — | No block | none for this PR |
| O13 | Login id precedence + anti-enumeration | Accept username OR verified phone OR verified email; responses generic; timing padded | Generic copy ↓ enum ↑ support confusion | IdRuntime login UX | DocsMerge: no · IdRuntime: **yes** |
| O14 | Notion UI-only fields | None invented; PO supplies deltas if any | — | — | only if PO asserts missing Accept item |
| A-OPEN4 / §6 | Recovery without mandatory email | See §6 | — | IdRuntime | IdRuntime: **yes** |
| T12 | Accept if inviter lost rights | Prefer **re-check inviter still authorized OR tenant owner still endorses**; else expire invite | Fail-closed may strand accepts | InviteRuntime | Invite: **yes** |
| Amend A OPEN5 | Verified email as login alias | **Yes** after verify (recommendation) | Convenience vs phone-primary clarity | Soft | DocsMerge: no · IdRuntime login: soft |

**Docs merge of PR #82:** can proceed as **Proposed** docs after PO Accept-with-deltas **or** remain draft until Accept — PO chooses. No OPEN item **must** be closed to keep docs Proposed. Several OPENs **block Identity / Invite / Accounting runtime**.

---

## 4. Explicit conflict check

| Source | Claim | OFFICE1.1 Proposed | Conflict? |
| --- | --- | --- | --- |
| ADR-0039 B3 Accepted | First login email OTP mandatory | A2 phone OTP preferred; email OTP only if verified | **Intentional conflict** — requires PO Accept of Amendment A; until then B3 wins |
| ADR-0039 B3 | Email as register identifier | A1 phone-primary; email optional | **Intentional** — Amendment A |
| ADR-0039 B2/B3 | PartialAuth ≠ Session; MFA mandatory | Preserved A2 | No |
| ADR-0039 B1 | GlobalAccount ≠ identity_user; POS separate | Preserved §8 ADR-0040 | No |
| ADR-0039 B4 | Bootstrap MFA OfficeSession; new Tenant only | Explicit non-change | No |
| ADR-0022 §1–2 | Membership vs professional separate; independent grants | ADR-0040 §3, §7 | No — strengthened |
| ADR-0022 §4–5 | Single-tenant mutation; cross-client read OK | ADR-0040 §6 | No |
| ADR-0022 §6 | Client grant/revoke independent | ADR-0040 §4 revoke per client | No |
| ADR-0015 | No shared tenant; PII minimize; egress | Zalo under Egress Gate OPEN; isolation preserved | No silent weaken |
| PO contract 1–10 | See §0 | Designed to match; Notion not re-read by agent | PO independently verified Notion |

---

## 5. Proof: TenantMembership Accountant ≠ ClientAccessGrant Accountant (no accidental inheritance)

### Binding rules (ADR-0040 §3 + §7; ADR-0022 §1)

1. **Separate rows:** `identity_tenant_membership` vs `identity_client_access_grant` (architecture data model).
2. **Explicit command class** on every Office mutating command: `MEMBERSHIP` or `PROFESSIONAL`.
3. **Evaluation does not union:**
   - PROFESSIONAL → only ACTIVE `ClientAccessGrant` for selected `tenantId` + Role/Scope.
   - MEMBERSHIP → only `TenantMembership` + tenant RBAC/`AccessGrant` for that tenant.
4. **Independent lifecycle:** revoking a ClientAccessGrant for Client A does not touch membership on Tenant B (or even membership on A if both exist).
5. **Invite activation** creates/activates **ClientAccessGrant only** (professional path), not TenantMembership — unless a future separate employee-invite product (O11) is Accepted.
6. **Inbox** lists only ACTIVE professional grants’ tenants (architecture §5.1) — membership-only tenants do not appear as “clients” unless also granted.

### Required Level B tests (architecture X8, X10, X13–X14 + add)

- Same GlobalAccount: membership on Tenant M with permission P; professional grant on Tenant C without P → mutation on C with P **denied**.
- Professional grant on C; no membership on C → membership-only admin APIs on C **denied**.
- Revoke grant C → membership M unchanged.
- Session cannot present membership permissions when command class=PROFESSIONAL.

### Failure mode to forbid in implementation

“Effective permissions = membershipPermissions ∪ allGrantPermissions for selected tenant” — **rejected by ADR-0040 §7**.

---

## 6. Exact recommended model: recovery / phone reassignment / compromised account

> Label: **Cursor-recommended defaults for PO decision** (mostly OPEN in Amendment A A3–A4 / O7–O8). Not yet PO-Accepted.

### 6.1 Recovery without mandatory email

**Ladder (fail closed; no SMS):**

1. **In-session recovery** (still has OfficeSession): enroll passkey; add/verify email; change phone via §6.2.
2. **Out-of-session, password known:** password → PartialAuth → second factor via **current verified phone Zalo OTP** OR **verified email OTP** OR **enrolled passkey** OR **trusted push device**.
3. **Out-of-session, Zalo unavailable, email verified:** email OTP as MFA alternate (Amendment A3).
4. **Out-of-session, Zalo unavailable, no verified email, no passkey/push:** **no self-serve recovery** in MVP. Account remains locked to password+phone path. Optional later: time-delayed **support break-glass** under ADR-0015 (reason, scoped, audited) — **not** default; requires separate PO Accept.
5. **Password lost + factors lost:** same as (4) — no silent SMS; no username-only reset.

### 6.2 Phone reassignment / recycling

1. Require active OfficeSession + password re-entry + OTP to **current** phone (Zalo) + OTP to **new** phone (Zalo).
2. If current phone unreachable: require verified-email OTP + password; if no email → blocked pending support Accept.
3. On success: old E.164 enters **phone retirement quarantine** (recommend **30 days**) before another GlobalAccount may verify it; audit event; revoke all other OfficeSessions; revoke PartialAuth tokens; require re-MFA.
4. Pending invitations remain bound to GlobalAccountId (unaffected). Grants unaffected (not keyed by phone).

### 6.3 Compromised account — revocation

**Victim or admin actions (recommended):**

| Action | Effect |
| --- | --- |
| Disable GlobalAccount | All OfficeSessions revoked; PartialAuth invalid; login denied |
| Rotate password | Immediate; revoke sessions |
| Revoke passkeys / push devices | Factor list updated; audit |
| Revoke all ClientAccessGrants | Per-client or bulk by principal |
| Tenant owner revoke grant / membership | Independent per tenant |
| Username retire (optional) | Quarantine handle; does not transfer anything |

**Client side after compromise of professional:** revoke that ClientAccessGrant only — other clients unaffected (ADR-0022 / ADR-0040).

**POS:** compromising Office does not mint POS sessions; POS PIN rotate is separate tenant `identity_user` operation.

---

## 7. Material details added by Cursor (not directly in PO 10-point contract)

| Addition | Where | Why |
| --- | --- | --- |
| Username format regex ASCII 3–30 | ADR-0040 §1 | Needed for implementability; marked OPEN |
| Reserved-name examples | ADR-0040 §1 | Security hygiene; list OPEN |
| 90-day username retirement | ADR-0040 §1 | Anti-takeover after rename; OPEN |
| Invitation state machine DRAFT/SENT/… | ADR-0040 §4 | Operational clarity |
| Proposed invite TTL 7–14d | ADR-0040 §4 | OPEN |
| Scope tuple LE/Outlet arrays | ADR-0040 §5 | Implements PO #7; empty-default OPEN |
| Explicit command-class authz order | ADR-0040 §7 | Prevents membership∪grant bug |
| Separate `identity_office_session` table preference | Architecture §3 | Prefer not overload POS session |
| API path catalogue | Amendment A5, ADR-0040 APIs, Arch §4–5 | Docs contracts |
| Threat model T1–T15 + test matrix X1–X18 | Architecture §6–7 | Review requirements |
| Recovery ladder §6 of this packet | A3/A4 were OPEN | PO asked for exact model now |
| Phone quarantine 30d / session revoke on phone change | This packet §6.2 | Extends A4 OPEN |
| Permission key names | O3 recommendation | Not in PO list |
| Role codes EXTERNAL_ACCOUNTANT_* | O4 recommendation | Not in PO list |
| Path-based tenant context preference | O9 | OPEN transport choice |

**Not added / rejected:** SMS fallback; passwordless Office; username as principal; auto-activate on invite send; shared accountant tenant; cross-tenant mutation; public username directory.

---

## 8. Recommendation to PO (not a merge)

1. Decide Amendment A Accept / Accept-with-deltas / Request changes (especially first MFA = phone OTP).
2. Decide ADR-0040 Accept / Accept-with-deltas.
3. Close or explicitly defer O1–O5, O7–O9, T12, recovery §6 before any Identity/Invite runtime launch.
4. Keep PR #82 **draft** until Accept; or merge as Proposed docs only if PO wants Origin archival without Accept — product law still requires Accept before runtime.

**STOP BEFORE PO ACCEPT / MERGE / IMPLEMENTATION.**
