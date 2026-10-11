# ADR-0039: Office Global Account, MFA & Owner Business Bootstrap

- **Status:** **Accepted** (PO **ACCEPT WITH DELTAS** 2026-10-11) — docs/architecture only; **Origin merge pending** explicit PO merge authorization
- **Date:** 2026-10-11
- **Revised:** 2026-10-11 (PO review deltas B1–B8; Brand #1 bootstrap delta after ADR-0038 canonical close)
- **Accepted:** 2026-10-11 (PO ACCEPT WITH DELTAS — ChatGPT remediation deltas approved; Brand bootstrap clarification for merge review)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0015; ADR-0022 (Professional Account preserved); ADR-0036 (POS auth preserved); domain-module-map Identity / Organization; Identity migration `027`
- **Autonomy:** Level **C** (docs / architecture / contracts only)
- **This PR:** Docs only. **No** runtime, **no** migrations applied. **Do not merge** until PO merge authorization.
- **Notion brief:** `https://app.notion.com/p/3f630d51715181faba65d6ffa13b909e` — **access limitation** (login wall); product requirements bound via PO B6 checklist in §B6 only; do not claim full Notion UI parity without readable brief.

---

## Context

Today Identity runtime is **tenant-bound** (`identity_user.tenant_id` required; POS PIN Session TERMINAL/MOBILE). Office needs pre-tenant registration, MFA, and owner bootstrap of a **new** business — without collapsing into POS PIN User or allowing tax-number claim of preexisting Tenants.

---

## Terminology (Accepted)

| Term | Meaning |
| --- | --- |
| **GlobalAccount** | Person principal independent of tenant membership; may have 0..N memberships |
| **TenantMembership** | GlobalAccount → Tenant ordinary membership + grants |
| **OfficePartialAuth** | Short-lived server challenge after password success — **not** a session |
| **OfficeSession** | Full Office audience session after second-factor success |
| **Workspace creator** | GlobalAccount that successfully ran CreateBusinessBootstrap |
| **Legally verified owner** | Legal/beneficial ownership after separate verification — **≠** workspace creator by default |

```text
GlobalAccount          ≠  tenant-bound identity_user (POS)
OfficePartialAuth      ≠  OfficeSession
OfficeSession          ≠  POS PIN Session (TERMINAL / MOBILE)
Passkey                ≠  password replacement
Employee               ≠  User / GlobalAccount
Workspace creator      ≠  legally verified owner
Tax number entry       ≠  ownership of preexisting Tenant
Professional grant     ≠  owner bootstrap
```

---

## Decision (Accepted — PO ACCEPT WITH DELTAS)

PO Accept binds: GlobalAccount independent of Tenant (0..N memberships); zero-business OfficeSession; password-first mandatory MFA (email OTP / optional passkey / mobile push); strict Office/POS session isolation; idempotent owner business bootstrap; LegalEntity-owned 1..N bank accounts; coexistence with existing tenant Identity; ADR-0022 Professional Account preserved.

### B1. GlobalAccount vs existing `identity_user` — resolved mapping

**Core architecture (not deferred):**

```text
identity_global_account     (NEW — person SoT for Office)
  ├─ 0..N identity_tenant_membership → Tenant (+ owner/bootstrap grants)
  ├─ 0..N Professional ClientAccessGrant (ADR-0022) — independent path
  └─ optional link(s) to tenant-scoped POS principals

identity_user (EXISTING — tenant-scoped POS)
  ├─ remains required for POS PIN / AccessGrant / TERMINAL|MOBILE Session
  ├─ Employee optional link unchanged (Employee ≠ User)
  └─ NOT replaced by GlobalAccount
```

#### B1.1 Coexistence / migration contract (binding direction)

| Rule | Contract |
| --- | --- |
| One GlobalAccount | May have **zero, one, or multiple** independent TenantMemberships |
| Professional access | Same GlobalAccount **may** hold ADR-0022 ClientAccessGrants **without** merging tenants |
| POS PIN Identity | Remains **tenant-scoped** `identity_user` + `identity_pin_credential` + `identity_session` channel TERMINAL/MOBILE |
| Linkage | When a person operates POS in a Tenant, a **TenantMembership-authorized** binding may associate GlobalAccount ↔ that tenant’s `identity_user` (exact FK table OPEN at schema time; cardinality: one GlobalAccount to many tenant Users across tenants; within one Tenant at most one active POS User link unless later Level C) |
| Bootstrap creates | New Tenant + new tenant `identity_user` (or equivalent POS principal stub) **only when** POS capability is provisioned — **not** at bare GlobalAccount signup |
| No fake Tenant at signup | Registering GlobalAccount creates **no** Tenant |
| ADR-0022 | Preserved; professional grants never implied by bootstrap |
| Employee ≠ User | Preserved (ADR-0036 / Workforce) |

**Forbidden collapses:** renaming `identity_user` into GlobalAccount; sharing POS Session cookie with Office; using PIN as Office password.

### B2. OfficeSession audience + partial auth

- OfficeSession channel = **`OFFICE`** only.
- Works with **zero** TenantMemberships (account settings / “create business” UX).
- Password success yields **only** `OfficePartialAuth` (limited MFA challenge token) — **no** OfficeSession cookie, **no** POS cookie.
- OfficeSession minted **only after** second-factor verification succeeds.
- Cookie/session confusion with TERMINAL/MOBILE **forbidden** (separate cookie name / audience claim / server validation).

### B3. MFA lifecycle

| Stage | Rule |
| --- | --- |
| First Office login (email not yet MFA-verified / first session) | password + **email OTP mandatory** → OfficeSession |
| Later logins | password then **passkey** OR **trusted signed KiU mobile push** OR **email OTP** |
| Passkey | Optional; enroll **after** first OfficeSession; **skip allowed**; second factor after password; **not** passwordless |
| WebAuthn | Server challenge; verify origin / RP ID / signature / sign count server-side |
| Push | Requires prior trusted device enrollment bound to GlobalAccount; challenge binding; signed accept/reject |
| Fail / cancel / expire / reject | **Never** creates OfficeSession; cancel allows alternate enrolled factor; **never** bypass |

Exact OTP length/TTL/limits **OPEN**. Push product phasing **OPEN** (architecture supports factor).

### B4. Business onboarding (includes first Brand)

Runtime invariant (existing schema): `outlet.brand_id NOT NULL` and references `brand(brand_id)`. Therefore bootstrap **must** create Brand #1 atomically — no phantom Brand, no borrowing Brand from another Tenant.

MFA-authenticated OfficeSession may call:

```text
CreateBusinessBootstrap (idempotency_key)
  → NEW Tenant
  → LegalEntity (tax/legal identity + legal address)
  → Brand #1 (this Tenant only)
  → Outlet #1 linked to Brand #1 AND LegalEntity
       (outlet physical/factual address ≠ LegalEntity legal address)
  → LegalEntityBankAccount[1..N]
  → owner TenantMembership + server-issued bootstrap owner grants
  → (optional later) tenant POS identity_user provisioning — not implied as fake Tenant at signup
```

#### B4.1 Brand name input

| Rule | Binding |
| --- | --- |
| Required | Confirmed Brand display name for Brand #1 |
| Default suggestion | UX **may** prefill Brand name from business display name |
| Confirmation | Owner must **confirm** the Brand name (explicit field or confirmed prefill) — server persists confirmed value only |
| Forbidden | Silent server invention of Brand without confirmed name; empty/whitespace name |

#### B4.2 Transaction / idempotency / concurrency / draft recovery

| Concern | Binding |
| --- | --- |
| Atomic success | All of Tenant + LegalEntity + Brand #1 + Outlet #1 + bank accounts + owner membership commit together **or** none become an authorized business |
| Partial failure | No partially authorized business (no usable owner membership / no operable Outlet without the full successful set) |
| Semantic idempotency | Same `idempotency_key` + same GlobalAccount returns the same bootstrap result; does not create a second Tenant |
| Concurrent duplicates | Concurrent distinct keys for the same intending owner creating “the same” first business ⇒ fail closed to one success or explicit conflict (**OPEN** exact conflict code); never two Tenants for one successful logical first bootstrap under one key |
| Safe draft recovery | If a resumable draft workflow is used: draft is **not** an authorized TenantMembership business; resume with same idempotency key; abandoned drafts must not leak cross-tenant Brand/Outlet/IDs |
| Cross-tenant Brand | **Forbidden** — Brand #1 is always newly created under the new Tenant |

#### B4.3 Other bootstrap rules

- Creates a **NEW** Tenant only — never attaches to preexisting Tenant by tax number / company code.
- IDs and grants **server-authored**; client cannot supply authoritative IDs.
- **Workspace creator** = GlobalAccount that completed bootstrap.
- **Legally verified owner** is a **separate** status (OPEN verification process) — bootstrap must **not** claim legal KYC ownership merely by form fill-in.
- Owner-only bootstrap in this ADR (invitations **OPEN** / out of Accept).

### B5. LegalEntity tax + bank accounts

- LegalEntity owns tax data and **1..N** BankAccounts.
- Legal address (LegalEntity) **≠** Outlet physical / factual address.
- Bank account data: masked in default reads; authorization-scoped; audited; no secrets in logs.
- Bank ownership KYC verification **OPEN**.

### B6. Notion product parity checklist

Reconciled against PO B6 (Notion page behind login for agent):

| Product requirement | Architecture |
| --- | --- |
| Register/login before business creation | B1 + B2 (zero memberships) |
| Initial email OTP obligatory | B3 |
| Optional post-first-login passkey enrollment with skip | B3 |
| Repeat: password then passkey/push/email OTP | B3 |
| Cancelled/expired/rejected challenge never creates session | B3 |
| BankAccounts[] per LegalEntity | B5 |
| Owner-only business bootstrap | B4 |
| First Brand + Outlet linkage (`outlet.brand_id` NOT NULL) | B4 |
| Cashier PIN auth unaffected | B1 + B2 |
| Invitations, recovery, country fields, exact OTP policies | **OPEN** — not invented |

**Notion access:** brief URL remains behind login for this agent — **parity not re-declared** beyond the B6 table above.

### B7. Security threat model (must be reviewed)

Implementation (later Level B) must adversarially cover at least:

- Office signup abuse / spam bootstrap;
- CSRF on Office cookie mutating routes;
- account enumeration (register/login/OTP);
- credential / OfficeSession theft;
- push approval phishing / device spoofing;
- MFA / WebAuthn replay;
- WebAuthn RP ID / origin mismatch;
- business duplication (idempotency failures);
- bank account confidentiality leakage;
- cross-tenant and professional scope confusion;
- legacy POS PIN non-regression (no audience mix).

### B8. Privacy & security control plane (ADR-0015 binding)

Office signup, MFA delivery, bootstrap PII, and bank/tax reads remain under Accepted ADR-0015:

| Binding | Rule |
| --- | --- |
| Residency | Vietnam-primary **preferred/default** for regulated/primary operational and personal data; cross-border processing requires **Egress Gate** — do not invent hosting certificates here |
| PII Vault / minimization | Email, legal/outlet addresses, bank identifiers are sensitive; access minimized, authorization-scoped, audited; vault is logical boundary (may remain in modular monolith) |
| Password credential | Secure KDF hash; pepper outside DB (discipline aligned with POS PIN); lockout/throttle required (exact limits **OPEN**) |
| Session | OfficeSession cookie HttpOnly (+ Secure / SameSite as appropriate); token stored as hash; **CSRF** on cookie-authenticated mutating Office routes |
| Anti-enumeration | Register / login / OTP responses and timing must not freely confirm account existence (exact copy **OPEN**) |
| Audit | Account create, MFA enroll/challenge/result, bootstrap create/resume, membership grant, sensitive bank/tax reads |
| No secrets in logs | OTP codes, password material, session secrets, full PANs/account numbers |

B5 masking/audit and B7 threats **complement** this section; they do not replace ADR-0015.

---

## Proposed API contracts (docs only)

```text
POST /api/v1/office/accounts/register
  { email, password, idempotencyKey } → { accountId }  # no Tenant

POST /api/v1/office/auth/password
  { email, password } → { partialAuthToken, mfaRequired: true }  # NOT OfficeSession

POST /api/v1/office/auth/mfa/email-otp/start|verify
POST /api/v1/office/auth/mfa/passkey/verify
POST /api/v1/office/auth/mfa/push/start + GET status
POST /api/v1/office/auth/mfa/cancel   # alternate factor; never bypass

# after OfficeSession:
POST /api/v1/office/auth/passkeys/register/options|verify  # skip allowed in UX
POST /api/v1/office/businesses/bootstrap
  {
    idempotencyKey,
    businessDisplayName,
    brand: { displayName },          # confirmed Brand #1 name (may equal businessDisplayName)
    legalEntity: { ... },            # tax/legal + legal address — required fields OPEN
    bankAccounts: [ { ... } ],       # 1..N
    firstOutlet: { ... }             # physical address; brandId/legalEntityId server-authored
  }
  → {
      tenantId, legalEntityId, brandId, outletId,
      bankAccountIds[], membershipId
    }  # all server-authored IDs
```

Reject bootstrap that asserts existing `tenantId` / foreign tax ownership / foreign `brandId`.

POS PIN routes remain under `/api/v1/identity/...` (ADR-0036) — separate.

---

## Proposed migration sketch (not applied)

Head today **031**. Later Identity/Organization Level B (illustrative):

1. `identity_global_account` + password credential + lockout  
2. MFA challenges, WebAuthn credentials, mobile device trust  
3. `identity_office_session` (OFFICE) — distinct from POS `identity_session`  
4. `identity_tenant_membership` + GlobalAccount↔`identity_user` link table  
5. LegalEntity tax/address fields; `legal_entity_bank_account`  
6. Bootstrap idempotency / resume / draft state (Brand+Outlet created only on successful finalize)

**Must not** drop POS PIN tables. This PR adds **no** SQL.

---

## Explicit OPEN (not invented)

Invitations/manager-accountant scope; password/factor-loss recovery; per-country tax field lists; OTP length/TTL/limits; bank KYC; OfficeSession TTL/remembered device; push ship phasing; roles beyond bootstrap owner; exact link-table DDL; exact concurrent-bootstrap conflict code when two distinct idempotency keys race; Notion UI-only fields beyond B6 (Notion brief not re-readable — login/access limitation).

---

## Consequences

- Humans exist before Tenants; Office MFA is mandatory for OfficeSession.
- POS PIN path remains; GlobalAccount is additive coexistence.
- Bootstrap creates new businesses only; tax-number claim forbidden.
- Workspace creator ≠ automatic legally verified owner.
- Runtime / migrations still require separate explicit Identity/Organization Level B launch after Origin merge authorization.

## Binding Accept checklist (PO / ChatGPT)

| Requirement | Binding |
| --- | --- |
| GlobalAccount independent of Tenant | B1 |
| Zero-business OfficeSession | B2 |
| Password-first mandatory MFA | B3 |
| Email OTP, optional passkey, mobile push | B3 |
| Strict Office/POS session isolation | B1, B2 |
| Idempotent owner business bootstrap (incl. Brand #1) | B4 |
| LegalEntity-owned multiple bank accounts | B5 |
| Compatibility with existing tenant Identity | B1 |
| Preserve Professional Account (ADR-0022) | B1, B4 |

## Alternatives considered

- Collapse GlobalAccount into `identity_user` — **rejected** (B1).
- Mint OfficeSession after password alone — **rejected** (B2/B3).
- Passwordless passkey — **rejected** (B3).
- Fake Tenant at signup — **rejected** (B4).
- Tax-number claim of preexisting Tenant — **rejected** (B4).

## Reviews required before merge authorization

- Identity / Security  
- Organization / Financial  
- Privacy / Architecture  
