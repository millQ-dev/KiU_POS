# ADR-0040: Office Username, Invitations & Professional Client Grants

- **Status:** **Proposed** (OFFICE1.1 Level C preflight — **not Accepted**)
- **Date:** 2026-10-12
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0015 (**Accepted**); ADR-0022 (**Accepted**); ADR-0039 (**Accepted**); Proposed [ADR-0039 Amendment A](ADR-0039-amendment-A-phone-first-optional-email.md)
- **Autonomy:** Level **C** (docs only). **STOP BEFORE RUNTIME / migrations.**
- **Canonical baseline:** `94f540ae64fc9c88bda50bf7c275ecec3f6f4909` (Origin `main` after Gate 0 #83 + ADR-0041 #84)
- **Related amendments:** Proposed [ADR-0039 Amendment B](ADR-0039-amendment-B-office11-mfa-otp-trusted-device.md) (OTP satisfaction / trusted device / recovery)
- **Notion:** PO pages behind login for agent; bindings use **PO ACCEPTED PRODUCT CONTRACT** from OFFICE1.1 preflight brief.
- **Security closure (2026-10-13):** §5 empty-scope fail-closed, §6 accountant read hub union, §9 recovery — see Remediation R82-3/4/5. Prior draft “empty = tenant-policy default OPEN” is **superseded by Proposed Accept wording below** (conflict flagged vs earlier PR #82 packet O5).

---

## Context

ADR-0039 introduced Office GlobalAccount + MFA + owner bootstrap. ADR-0022 froze Professional Account / ClientAccessGrant isolation. OFFICE1.1 adds:

- mandatory globally unique `@username`;
- owner/admin invite-by-username with scoped grants;
- activation only after invitation acceptance;
- multi-client accountant grants + unified read-only inbox;
- explicit single-Tenant mutation context;
- strict separation from POS PIN identities.

---

## Decision (Proposed)

### 1. Username

| Rule | Binding |
| --- | --- |
| Mandatory | Every Office GlobalAccount has exactly one **active** `@username` |
| Globally unique | Unique across all GlobalAccounts (case-insensitive normalized form) |
| Security principal | **`GlobalAccountId` only**. Username is a mutable handle, never the grant subject |
| Rename | Allowed under policy; **never** transfers TenantMemberships, ClientAccessGrants, invitations, or sessions |
| Normalization | Lowercase ASCII; strip leading `@` for storage; display may show `@handle` |
| Format (proposed) | `^[a-z][a-z0-9_]{2,29}$` (3–30 chars after normalize) — **OPEN** final regex if PO requires Unicode/locale handles |
| Reserved names | Server deny-list (e.g. `admin`, `root`, `kiu`, `support`, `null`, `me`, …) — **OPEN** exact list |
| Retired handles | On rename or retire: old normalized username enters **retirement quarantine**; cannot be claimed until cooldown — **OPEN** duration (propose 90 days) |
| Search privacy | Owner/admin **username lookup for invite** returns **minimal preview** (display name + `@username` + verification badges) only when searcher is authorized to invite; no public directory; anti-enumeration on anonymous endpoints |

### 2. Identity bindings (immutable vs mutable)

```text
GlobalAccountId          IMMUTABLE principal
  ├─ username (active)   MUTABLE handle (unique while active)
  ├─ phone (verified)    PRIMARY contact (Amendment A)
  ├─ email? (verified)   OPTIONAL contact
  ├─ password credential
  ├─ 0..N TenantMembership (employee/owner ordinary path)
  ├─ optional ProfessionalProfile
  │     └─ 0..N ClientAccessGrant (independent per client)
  └─ optional links → tenant identity_user (POS) — never shares sessions
```

**Secure account-linking (POS):** GlobalAccount ↔ tenant `identity_user` only under authorized TenantMembership and explicit link command; unlink does not delete GlobalAccount; POS PIN credentials stay on `identity_user`.

### 3. Employee membership vs ProfessionalProfile / ClientAccessGrant

| Path | Meaning |
| --- | --- |
| **TenantMembership** | Ordinary in-business membership (owner/employee). Grants are tenant RBAC / AccessGrant style |
| **ProfessionalProfile** | Marks GlobalAccount as eligible professional principal (ADR-0022) |
| **ClientAccessGrant** | Independent professional grant to one client Tenant (+ Role + Scope). **No** inheritance across clients |

A GlobalAccount **MAY** hold both paths simultaneously. Authorization evaluation must **not** union scopes across clients for mutation.

### 4. Invitation lifecycle

```text
DRAFT → SENT → ACCEPTED → (grants ACTIVE)
              → EXPIRED
              → REVOKED
              → DECLINED
```

| Rule | Binding |
| --- | --- |
| Who may invite | Owner or **authorized administrator** of the inviting Tenant (permission key **OPEN**) |
| Find professional | By `@username` (authorized search); preview intended account before send |
| Payload | Target GlobalAccountId (resolved server-side from username at send time), inviter, Tenant, Role, Scope (Tenant and/or LegalEntity and/or Outlet set), expiry, idempotency key |
| Binding at send | Invitation stores **GlobalAccountId**, not username string as authority |
| Username rename after send | Does **not** retarget invitation; still bound to GlobalAccountId |
| Activation | Access **ACTIVE only after** valid acceptance **and** authorization checks (invite still valid, inviter still authorized, scopes still legal, principal still eligible) |
| Expiry | Required; exact TTL **OPEN** (propose 7–14 days) |
| Revocation | Inviter/admin may revoke SENT; revoke ACTIVE ClientAccessGrant independently per client |
| Audit | create/send/accept/decline/expire/revoke + effective Role/Scope |

**Forbidden:** auto-activating grants on send; accepting for a different GlobalAccount; widening scope on accept without new invite.

### 5. Scope model (per ClientAccessGrant) — **fail closed (R82-3)**

Proposed scope tuple (refine at schema time):

```text
ClientAccessGrant
  tenant_id                 REQUIRED
  scope_mode                REQUIRED enum: TENANT_WIDE | LEGAL_ENTITY_SET | OUTLET_SET
  legal_entity_ids[]        REQUIRED non-empty when scope_mode=LEGAL_ENTITY_SET; else empty/absent
  outlet_ids[]              REQUIRED non-empty when scope_mode=OUTLET_SET; else empty/absent
  role_code                 REQUIRED (professional role vocabulary OPEN)
  permissions[]             OPTIONAL fine-grained; else role expands server-side
```

**Proposed Accept wording (binds R82-3):**

1. **Empty or omitted** `legal_entity_ids` / `outlet_ids` **never** means tenant-wide authority.
2. Tenant-wide access requires **`scope_mode = TENANT_WIDE`** set by an **explicit authorized selection** at invite/grant time (inviter must choose it; UI must not default silently).
3. `scope_mode = LEGAL_ENTITY_SET` with empty/null LE list → **reject** at write and at authz evaluate.
4. `scope_mode = OUTLET_SET` with empty/null outlet list → **reject** at write and at authz evaluate.
5. Omitting `scope_mode` → **reject** (fail closed).
6. Same fail-closed rule applies to TenantMembership / AccessGrant outlet·LE scopes used for Office Task and Manager commands (align ADR-0041 / mig 027 tenant-wide vs outlet unique indexes).

**Conflict flag vs prior PR #82 draft:** earlier Proposed text said `empty = tenant-policy default OPEN` and packet O5 recommended empty = entire Tenant. That **conflicts** with Gate 0 / ADR-0041 fail-closed and this R82-3 Accept wording. **Do not silently keep the old default.**

Enforcement: every professional **read** filtered by grant + scope_mode; every **mutation** requires selected `tenantId` ∈ grant, explicit scope match, and action allowed by Role/Scope.

### 6. Accountant multi-client + workspace (R82-4)

| Rule | Binding |
| --- | --- |
| Multi-client | One accountant GlobalAccount may hold many independent ClientAccessGrants across Tenants / LegalEntities / Outlets |
| **Read hub union** | Accountant **clients/inbox read models** MAY **union** rows from (a) ACTIVE `TenantMembership` with accountant-class role on a Tenant and (b) ACTIVE `ClientAccessGrant` clients — each row tagged with `authorizationSource: MEMBERSHIP \| PROFESSIONAL` |
| **No mutation union** | Union is **read-only presentation**. Evaluating a mutating command still uses **exactly one** command class (`MEMBERSHIP` or `PROFESSIONAL`) and **must not** combine membership permissions with ClientAccessGrant permissions |
| Unified inbox | Cross-source **read-only** aggregation of authorized documents, tasks, deadlines, exceptions (still labeled by `tenantId`) |
| No shared truth | Inbox is a **read model**; does not merge ledgers/inventory/orders Operational Core |
| Mutation context | Exactly **one** explicitly selected and authorized Tenant context per mutating command |
| Context switch | UX may switch clients; server rejects missing/forged/unauthorized `tenantId` |

**Conflict flag vs earlier packet §5.1:** prior architecture said clients strip = ClientAccessGrants only. R82-4 **extends** the read hub to include authorized membership accountant tenants. Mutation/isolation rules unchanged.

### 7. Effective permission checks

Order (conceptual):

1. Valid OfficeSession for GlobalAccountId.
2. Command class: ordinary membership vs professional grant path (explicit).
3. For professional mutation: resolve ClientAccessGrant for selected `tenantId` → ACTIVE → Role/Scope allows action.
4. For membership mutation: TenantMembership + tenant AccessGrant/RBAC allows action.
5. Deny by default; audit allow/deny for sensitive ops.

### 8. POS isolation (reaffirm)

- Existing POS PIN `identity_user` / TERMINAL|MOBILE sessions **remain separate**.
- Office cookies/sessions never authorize POS PIN routes and vice versa.
- Username/phone Office login does not mint POS sessions.

---

## Proposed migration plan (after 032 — **not applied**)

Illustrative numbering (actual filenames assigned at Level B launch):

| Step | Objects |
| --- | --- |
| 033+ Identity Office core | `identity_global_account`, password/lockout, MFA challenges, `identity_office_session` (OFFICE), phone/email contacts |
| Username | `identity_global_username` active unique + `identity_username_retirement` |
| Membership | `identity_tenant_membership`, GlobalAccount↔`identity_user` link |
| Professional | `identity_professional_profile`, `identity_client_access_grant`, grant scope tables |
| Invites | `identity_office_invitation` (+ events/audit) |
| Bootstrap / org | LegalEntity tax/bank as ADR-0039 sketch (may share Organization migrations) |
| Read models | Projection tables or query layer for accountant inbox — **no** cross-tenant physical merge |

**Must not** drop POS tables (027+). **Must not** apply migrations in this docs PR.

---

## Proposed API contracts (docs only)

See architecture preflight for full shapes. Summary:

```text
# Username / account
POST   /api/v1/office/usernames/availability
GET    /api/v1/office/accounts/me
PATCH  /api/v1/office/accounts/me/username

# Authorized invite search (admin/owner)
GET    /api/v1/office/tenants/{tenantId}/professionals/lookup?username=

# Invitations
POST   /api/v1/office/tenants/{tenantId}/invitations
POST   /api/v1/office/invitations/{id}/accept|decline
POST   /api/v1/office/tenants/{tenantId}/invitations/{id}/revoke
GET    /api/v1/office/invitations/inbox

# Grants
GET    /api/v1/office/professional/grants
POST   /api/v1/office/tenants/{tenantId}/professional/grants/{id}/revoke

# Accountant workspace (read)
GET    /api/v1/office/accountant/inbox
GET    /api/v1/office/accountant/clients

# Mutations always carry explicit tenant context
POST   /api/v1/office/tenants/{tenantId}/...   # path or header X-MillQ-Tenant-Context — OPEN exact transport
```

---

### 9. Username retirement & recovery (R82-5) — Proposed Accept direction

Pairs with [Amendment B §B3](ADR-0039-amendment-B-office11-mfa-otp-trusted-device.md).

| Topic | Proposed binding |
| --- | --- |
| Username rename | Allowed; old normalized handle → `identity_username_retirement`; **never** transfers memberships/grants/invites/sessions |
| Retirement cooldown | Recommend **90 days** before reclaim (**OPEN** exact); during quarantine, claim attempts fail closed |
| Retire without rename | Owner may retire handle under policy; GlobalAccount must set a new unique active username in same transaction or enter `USERNAME_PENDING` (login by phone only until set) — **OPEN** exact status |
| Phone change / loss | Split flows per Amendment B §B3: **in-possession** challenges current primary; **lost-phone** rejects password+TrustedDevice+new-phone alone; delayed cutover recommended; old phone quarantine (recommend **30 days**) |
| No mandatory email | Recovery must work without email (phone-first product); email is optional alternate factor only when verified |
| Takeover prevention | Recovery cannot change `GlobalAccountId`; cannot silently move TenantMembership or ClientAccessGrant; support break-glass **OPEN**, audited, dual-control — not default |

## Explicit OPEN (Level C — not invented)

1. Final username regex / Unicode policy / reserved list.
2. Username retirement cooldown duration (recommend 90d).
3. Invitation TTL and max outstanding invites.
4. Professional role vocabulary and default scopes.
5. Exact permission key for “invite professional”.
6. Whether employee (non-professional) invites share the same invitation aggregate.
7. Accountant inbox item taxonomy (document/task/deadline/exception types).
8. Transport for mutation tenant context (path vs signed header).
9. ProfessionalOrganization MVP timing (ADR-0022 future).
10. Billing / commercial relationship for accountants.
11. Support break-glass procedure for phone-loss without alternate factors.
12. Exact accountant-class membership role codes that qualify for read-hub inclusion.

---

## Consequences

- Handles are searchable within authorized invite UX without becoming security principals.
- Accountants get multi-client read convenience without cross-tenant mutation or shared ledgers.
- Read hub may surface membership∪professional sources; mutation privileges stay non-union (R82-4).
- Empty LE/Outlet scope fail closed; tenant-wide requires explicit `scope_mode=TENANT_WIDE` (R82-3).
- ADR-0022/0015 isolation strengthened with invitation activation gate.
- Runtime requires separate PO Accept of this ADR + Amendment A + Amendment B, then Level B launch.

## Alternatives considered

- Username as security principal — **rejected**.
- Auto-activate access on invite send — **rejected**.
- Shared tenant for accountant clients — **rejected** (ADR-0015/0022).
- Cross-client domain mutation — **rejected**.
- Public username directory — **rejected**.
