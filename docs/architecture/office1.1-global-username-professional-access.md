# OFFICE1.1 — Global Username & Professional Access (Architecture Preflight)

- **Status:** Level **C** docs-only preflight — **STOP BEFORE RUNTIME**
- **Date:** 2026-10-12
- **Canonical baseline:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e` (Origin `main` after FISC1.1 / migration **032**)
- **Autonomy:** Level C — owner Accept required before any schema/runtime PR
- **ADRs:** ADR-0015 / ADR-0022 / ADR-0039 (**Accepted**); Proposed [ADR-0039 Amendment A](../decisions/ADR-0039-amendment-A-phone-first-optional-email.md); Proposed [ADR-0040](../decisions/ADR-0040-office-username-invites-professional-grants.md)
- **Notion:** `https://app.notion.com/p/3f721d5d34878197bab3c0f34c6b3867`, `https://app.notion.com/p/3f721d5d348781c7b9deff2e48d040c4` — **agent access limited** (login/load). Product bindings below use the **PO ACCEPTED PRODUCT CONTRACT** from the preflight brief.

---

## 1. Architecture delta (vs Accepted ADR-0039 / 0022 / 0015)

| Area | Before (Accepted) | OFFICE1.1 delta (Proposed) |
| --- | --- | --- |
| Signup identity | Email-primary (ADR-0039 B3) | **Phone-first** verified via Zalo ZBS OTP; email optional + independent verify (Amendment A) |
| Human handle | Not specified | Mandatory globally unique `@username`; grants keyed by `GlobalAccountId` only (ADR-0040) |
| Professional activation | Grant model abstract (ADR-0022) | **Invitation lifecycle**; ACTIVE only after accept + authz checks |
| Accountant UX | Read aggregation allowed abstractly | Unified **read-only** cross-client inbox + explicit mutation Tenant context |
| POS | Isolated | Reaffirmed separate (no session/cookie mix) |

**Non-goals for this preflight:** schema apply, runtime PR, permission activation, merge to main without PO Accept, production Zalo integration, G2/fiscal, Recipes, Office UI implementation.

---

## 2. PO Accepted Product Contract vs remaining Level C OPEN

### 2.1 PO Accepted (binding product law for design)

1. Every KiU Office GlobalAccount has a mandatory, globally unique `@username`.
2. Immutable `GlobalAccountId` is the security principal; username changes never transfer grants.
3. Verified phone is the primary signup/contact identifier; **no SMS**; Zalo ZBS OTP accepted as product **direction**.
4. Email is optional; if present, independently verify.
5. Owner or authorized admin can find a professional by username, preview account, specify scoped grants, send invitation.
6. Access becomes active only after valid invitation acceptance and authorization checks.
7. One accountant GlobalAccount can hold multiple independent client grants across Tenants, LegalEntities, Outlets.
8. Accountant workspace has a unified cross-client **read-only** inbox for authorized documents, tasks, deadlines, exceptions.
9. Every mutation executes under exactly one explicitly selected and authorized Tenant context.
10. Existing POS PIN identities and sessions remain separate.

### 2.2 Remaining Level C OPEN (do not invent as Accepted)

| # | Question |
| --- | --- |
| O1 | Final username regex / Unicode / reserved-name list / retirement cooldown |
| O2 | Exact invitation TTL, max outstanding, reminder policy |
| O3 | Permission key(s) for invite / revoke professional |
| O4 | Professional role vocabulary + default scope templates |
| O5 | LegalEntity/Outlet scope defaults when arrays empty |
| O6 | Zalo ZBS vendor contract, templates, egress, OTP length/TTL/limits |
| O7 | Fallback when Zalo unavailable and email not verified (recovery) |
| O8 | Phone change cool-down / dual control |
| O9 | Mutation tenant-context transport (path vs signed header) |
| O10 | Accountant inbox item types / producers / retention |
| O11 | Employee (non-professional) invite share same aggregate? |
| O12 | ProfessionalOrganization timing / billing |
| O13 | Login identifier precedence (username vs phone vs verified email) anti-enumeration copy |
| O14 | Notion UI-only fields not captured in the Accepted Product Contract |

---

## 3. Conceptual data model (post-032; illustrative)

```text
identity_global_account
  global_account_id PK
  status ACTIVE|DISABLED|PENDING_PHONE
  created_at

identity_global_username
  global_account_id PK/FK
  username_normalized UNIQUE   -- active handle
  username_display
  changed_at

identity_username_retirement
  username_normalized PK
  retired_at, available_after, prior_global_account_id

identity_global_phone
  global_account_id PK/FK
  phone_e164 UNIQUE (among verified)
  verified_at NOT NULL
  verification_channel ZALO_ZBS

identity_global_email
  global_account_id PK/FK
  email_normalized UNIQUE (among verified) NULL until verified
  verified_at NULL

identity_global_password_credential
  global_account_id PK/FK
  password_hash, salt, kdf_version, failed_attempts, locked_until

identity_office_partial_auth / identity_office_mfa_challenge / identity_office_session
  -- ADR-0039; channel OFFICE only

identity_tenant_membership
  membership_id, global_account_id, tenant_id, status, role_flags...

identity_global_pos_user_link
  global_account_id, tenant_id, user_id  -- link to identity_user; unique (tenant_id, user_id)

identity_professional_profile
  global_account_id PK, status, display_trade_name?

identity_client_access_grant
  grant_id, global_account_id, tenant_id, role_code, status ACTIVE|REVOKED,
  legal_entity_scope[], outlet_scope[], accepted_invitation_id, activated_at, revoked_at

identity_office_invitation
  invitation_id, tenant_id, target_global_account_id, invited_by_global_account_id,
  role_code, scope_json, status, expires_at, accepted_at, idempotency_key UNIQUE(tenant,key)
```

PII fields live under ADR-0015 minimization/audit (phone/email in logical vault discipline even inside monolith).

### Migration plan after 032

1. **No migration in this PR.**
2. Next Identity Level B block starts at **033+** (coordinate with Organization bootstrap tables from ADR-0039 sketch).
3. Ordering recommendation: GlobalAccount + contacts + username → OfficeSession/MFA → memberships → professional profile/grants → invitations → read-model projections.
4. Expand POS `identity_session.channel` check only if needed for documentation; Office uses **separate** `identity_office_session` table (preferred) rather than overloading POS session.

---

## 4. Office Identity / Invites / Professional Grants API contracts

### 4.1 Auth & contacts (Amendment A)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/office/auth/phone-otp/start` | Zalo ZBS; purpose=SIGNUP\|MFA\|PHONE_CHANGE |
| POST | `/api/v1/office/auth/phone-otp/verify` | Returns short-lived phoneProof for register |
| POST | `/api/v1/office/accounts/register` | `{ username, phoneE164, phoneProof, password, email?, idempotencyKey }` |
| POST | `/api/v1/office/auth/password` | → PartialAuth only |
| POST | `/api/v1/office/auth/mfa/*/verify` | phone OTP / email OTP / passkey / push |
| POST | `/api/v1/office/contacts/email/verify/start\|confirm` | Independent email verify |

### 4.2 Username

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/office/usernames/availability` | Authenticated or proof-gated; anti-enumeration |
| PATCH | `/api/v1/office/accounts/me/username` | Renames; retires old handle; grants unchanged |

### 4.3 Lookup & invitations

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/office/tenants/{tenantId}/professionals/lookup` | `?username=`; requires invite permission; returns preview only |
| POST | `/api/v1/office/tenants/{tenantId}/invitations` | Scoped grant intent; binds target GlobalAccountId |
| GET | `/api/v1/office/invitations/inbox` | For target GlobalAccount |
| POST | `/api/v1/office/invitations/{invitationId}/accept` | Activates grant iff checks pass |
| POST | `/api/v1/office/invitations/{invitationId}/decline` | |
| POST | `/api/v1/office/tenants/{tenantId}/invitations/{invitationId}/revoke` | |

**Accept checks (fail closed):** invitation SENT & unexpired; target == session GlobalAccountId; inviter still authorized (or grant policy allows orphan accept **OPEN**); scopes still valid; no conflicting grant policy **OPEN**.

### 4.4 Grants

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/office/professional/grants` | List ACTIVE grants for me |
| POST | `/api/v1/office/tenants/{tenantId}/professional/grants/{grantId}/revoke` | Client-side revoke |

---

## 5. Accountant Workspace read-model contract

### 5.1 Clients strip

```text
GET /api/v1/office/accountant/clients
→ [{ tenantId, displayName, grantId, roleCode, scopeSummary, status }]
```

Only ACTIVE ClientAccessGrants. No data from non-granted tenants.

### 5.2 Unified inbox (read-only)

```text
GET /api/v1/office/accountant/inbox?cursor=&types=
→ {
    items: [{
      itemId, type: DOCUMENT|TASK|DEADLINE|EXCEPTION,
      tenantId, legalEntityId?, outletId?,
      title, summary, occurredAt|dueAt,
      severity?, href, authorizationFingerprint
    }],
    nextCursor?
  }
```

| Invariant | Binding |
| --- | --- |
| Authorization | Item visible iff grant covers tenant (+ LE/Outlet scope) |
| No merge | Items remain labeled by `tenantId`; no combined ledger balances |
| Mutation | Inbox endpoints are **GET-only**; actions deep-link into tenant-scoped mutating APIs with explicit context |
| Producers | Which modules emit inbox items **OPEN** (Tax/Fiscal/Settlement/Reporting projections later) |

### 5.3 Mutation context

```text
POST /api/v1/office/tenants/{tenantId}/... 
# or OPEN: signed header X-MillQ-Tenant-Context: { tenantId, grantId?, membershipId? }
```

Server rejects if session GlobalAccount lacks membership **or** professional grant for that tenant for the command class.

---

## 6. Security threat model (must review)

| ID | Threat | Mitigation direction |
| --- | --- | --- |
| T1 | Username enumeration via availability/lookup | Authz-gated lookup; availability rate-limit + non-distinct responses where possible |
| T2 | Invite retarget via username rename | Invitation stores GlobalAccountId at send |
| T3 | Grant transfer via username reuse | Retirement quarantine; grants never keyed by username |
| T4 | Accept invite as different account | Session GlobalAccountId must equal target |
| T5 | Scope widening on accept | Accept cannot add scopes; new invite required |
| T6 | Cross-tenant mutation | Explicit tenant context + per-grant allow; deny default |
| T7 | Cross-tenant data leak via inbox | Per-item authz filter; no unscoped queries |
| T8 | Phone takeover / SIM issues | Zalo channel + re-auth for phone change; cool-down OPEN |
| T9 | SMS downgrade / OTP phishing | No SMS product channel; OTP never in logs |
| T10 | MFA bypass | PartialAuth ≠ Session; cancel never elevates |
| T11 | Office/POS session confusion | Separate cookies/tables/audiences |
| T12 | Stale invite after admin demotion | Re-check authz at accept (**OPEN** exact policy if inviter lost rights) |
| T13 | Professional/employee path confusion | Explicit authorization path in command metadata |
| T14 | Zalo egress / PII | ADR-0015 Egress Gate; minimize phone disclosure to provider |
| T15 | Bootstrap spam | Unchanged ADR-0039 B7 + verified phone raises cost |

---

## 7. Adversarial / acceptance test matrix (Level B later)

| ID | Case | Expect |
| --- | --- | --- |
| X1 | Duplicate username (case variants) | Reject |
| X2 | Reserved username | Reject |
| X3 | Rename then old handle claim inside quarantine | Reject |
| X4 | Rename does not move ClientAccessGrant | Grants still on GlobalAccountId |
| X5 | Invite by username; rename before accept | Accept still works for same GlobalAccountId |
| X6 | Accept with different GlobalAccount session | Reject |
| X7 | Expired / revoked invite accept | Reject |
| X8 | Two clients, revoke one | Other grant unaffected |
| X9 | Mutation without tenant context | Reject |
| X10 | Mutation with tenant not in grant | Reject |
| X11 | Inbox never returns other-tenant items | Assert empty for unganted |
| X12 | Concurrent accept same invite | One ACTIVE grant (idempotent) |
| X13 | POS PIN login does not create OfficeSession | Isolated |
| X14 | OfficeSession cannot call POS PIN routes | Isolated |
| X15 | Unverified email cannot be MFA factor | Reject |
| X16 | Register without phone proof | Reject |
| X17 | SMS OTP endpoint | Absent / forbidden |
| X18 | Lookup without invite permission | 403; no existence leak beyond policy |

---

## 8. Module map touchpoints

Identity & Access owns: GlobalAccount, username, invites, ProfessionalProfile, ClientAccessGrant, OfficeSession.

Organization owns: Tenant/LegalEntity/Outlet targets of scope (not grant rows).

Reporting / future Tax-Fiscal projections may **produce** inbox items; they do not own authorization.

Workforce Employee ≠ GlobalAccount (unchanged).

---

## 9. Reviews required (before PO Accept / any runtime)

1. **Identity / Security** — MFA amendment, invites, grant activation, POS isolation, OTP/Zalo.
2. **Architecture** — module boundaries, read-model vs Core truth, migration sequencing after 032.
3. **Privacy** — phone/email PII, Zalo egress, search privacy, audit minimums (ADR-0015).

---

## 10. STOP

No schema migration, runtime PR, permission activation, or merge to `main` without:

1. PO Accept (or Accept-with-deltas) of Amendment A + ADR-0040;
2. Independent reviews APPROVE;
3. Separate Level B launch authorization.
