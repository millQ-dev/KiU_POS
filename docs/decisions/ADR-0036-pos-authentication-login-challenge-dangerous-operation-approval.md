# ADR-0036: POS Authentication, Login Challenge & Dangerous Operation Approval

- **Status:** Accepted
- **Date:** 2026-09-18
- **Accepted:** 2026-09-18 (PO ACCEPT WITH DELTAS; independent Identity/Security architecture re-review APPROVE)
- **Decision owners:** Product Owner and System Architect
- **Related:** Architecture v1.2 / v1.3; ADR-0002 (Money); ADR-0008; ADR-0015 (privacy/security); ADR-0018 (DeviceIdentity ≠ Terminal); ADR-0022 (Professional Account); ADR-0023 (Workforce); domain-module-map Identity / Workforce / Cash / Organization
- **Numbering note:** ADR-0034 and ADR-0035 are claimed by other Origin work. This decision is **ADR-0036**.
- **Autonomy:** Level **C**
- **This ADR PR scope:** Architecture / contracts only. **No** migrations, **no** runtime, **no** CashShift schema. **Do not merge** while Origin↔GitHub backup equality is unresolved.

---

## Context

Accepted architecture freezes Identity ownership of User, credentials, roles, permissions, AccessGrant, Session, devices, and `AuthorizeDangerousOperation`, but does **not** freeze POS-specific modes:

- Company ID locator → tenant login realm
- Employee PIN authentication (low-entropy secret)
- QR LoginChallenge + mobile confirmation
- Manager ApprovalRequest for dangerous operations (e.g. CashShift open)
- Exact second-person approval semantics (self-approval, operation fingerprint, evidence)

A Level B prototype branch (`feature/pos-auth-shift-open-foundation` @ `7256f08`) explored runtime ahead of Accepted architecture and was **BLOCKED**. This ADR freezes authentication / authorization architecture so Identity foundation (**ID1.1**) and later CashShift Open (**CASH1.1**, after **SEC-0**) can proceed under Level C Accept.

---

## Terminology (binding)

| Term | Meaning |
| --- | --- |
| **Company ID / `companyCode`** | User-facing stable tenant **locator**. Not a secret. Not authentication. Not authorization. Knowledge grants **no** operational access. |
| **Tenant login realm** | Server-side tenant context resolved from `companyCode`. Internal `tenant_id` UUID remains the canonical key and is **never** a public Company DTO field. |
| **User / Principal** | Identity-owned account that authenticates. POS authentication authenticates **User**, never Employee directly. |
| **Employee** | Workforce-owned person profile. May optionally link to one User. Does **not** own PIN, grants, sessions, or challenges. |
| **Candidate** | Pre-hire / recruiting subject (ADR-0023). **Candidate ≠ Employee ≠ User**. |
| **PIN credential** | Low-entropy tenant-scoped numeric secret that authenticates a User within a resolved tenant realm. Never plaintext/reversible. **Never described as high-entropy.** |
| **AccessGrant** | Server-side binding: User → permission → tenant → optional outlet/terminal scope. Source of authorization truth. |
| **Session** | Server-authoritative authenticated principal evidence for a channel (`TERMINAL` / `MOBILE` / future). |
| **Terminal** | Organization operational station (outlet-scoped). **Not** a DeviceIdentity. |
| **DeviceIdentity** | ADR-0018 installation/device identity. **≠ Terminal**. Must not be aliased — not even temporarily. |
| **LoginChallenge** | Short-lived, single-use, opaque QR challenge. Token possession proves challenge possession only — **not** User authentication. |
| **ApprovalRequest** | One-time dangerous-operation authorization for an **exact** operation fingerprint. Does **not** mutate permanent roles/grants. |
| **Authorization evidence** | Immutable historical refs recorded on the consuming command (e.g. future CashShift open). |

**Non-aliases (binding):**

```text
Company Identification  ≠  Authentication
Authentication          ≠  Authorization
Authorization           ≠  Dangerous Operation Approval
Dangerous Operation Approval  ≠  CashShift

Company ID / companyCode  ≠  authentication secret / credential
companyCode (public)      ≠  tenantId (internal only)
User / Principal          ≠  Employee
Candidate                 ≠  Employee ≠ User
Employee                  ≠  AccessGrant / Session / PIN
DeviceIdentity            ≠  Terminal   (no temporary alias)
LoginChallenge QR token   ≠  User authentication credential
ApprovalRequest           ≠  permanent permission grant
Session row               ≠  historical CashShift attribution
opening cash              ≠  Revenue / Payment / Settlement / Tax / Fiscal fact
```

---

## Decision

### 1. Domain ownership

| Owner | Owns |
| --- | --- |
| **Organization** | Tenant (incl. `companyCode`), Outlet, Terminal; public Company ID resolve (locator only) |
| **Identity** | User, credentials (incl. PIN), AccessGrant, Permission/Role, Session, LoginChallenge, ApprovalRequest (dangerous-op), authentication, dangerous-operation authorization **evidence**, audit, notification outbox port |
| **Workforce** | Employee profile + optional `userId` link; PersonalShift ≠ CashShift |
| **Cash** | CashShift lifecycle; consumes Identity authorization evidence; does **not** invent auth |
| **Clients** | UX only; never authoritative for tenant / role / permission / outlet / terminal scope |

Workforce **must not** own POS credentials or grants.

```text
Company Identification
≠ Authentication
≠ Authorization
≠ Dangerous Operation Approval
≠ CashShift
```

### 2. Company identification (locator only) — PO binding

```text
GET /api/v1/public/company/:companyCode

→ {
    companyCode,
    displayName
  }
```

**Binding rules:**

- Response **MUST NOT** contain `tenantId` (or other internal UUIDs / outlet / terminal / employee / capability dumps).
- `tenantId` remains internal; backend resolves `companyCode → tenant` server-side.
- `companyCode` is public/shareable locator — **not** secret, **not** authentication, **not** authorization.
- ASCII canonical normalization (trim + uppercase); uniform not-found; rate-limited; no side effects.
- Frontend pre-auth storage may hold `{ companyCode, displayName }` only — **not** authoritative `tenantId`.
- Subsequent authenticated APIs derive tenant from **server session** (or server-side realm binding). Client-submitted `tenantId` must never expand or switch authority.

### 3. Principal model

- Authentication authenticates **User / Principal**.
- Employee may optionally reference User.
- PIN success returns only next-step identity needed for UX (e.g. `userId`, optional `employeeId`, `displayName`) plus **server-computed** authorization summary for the intended scope — never client-asserted authority.
- Generic authentication failure; do not reveal whether a PIN / user / employee exists.

### 4. PIN credential security — PO decision

#### 4.1 Policy (production)

```text
numeric PIN
default length: 6 digits
configurable secure range: 4–12 digits
```

4 digits are allowed only as a real restaurant POS UX floor, and **only** with all compensating controls below.

**ADR binding:** PIN is **LOW ENTROPY**. Even when scrypt-protected, PIN must **never** be described as a high-entropy authentication secret.

#### 4.2 Mandatory compensating controls

| Control | Requirement |
| --- | --- |
| Server-only verification | Clients never verify PIN against authoritative store |
| Per-credential random salt | Unique salt per credential |
| Memory-hard KDF | scrypt (or later Argon2id) acceptable; **versioned** KDF parameters stored with credential |
| Server-side pepper | Secret-assisted protection stored **outside the DB** so DB-only compromise does not permit trivial complete PIN-space cracking |
| Generic failure | Single failure class for format / miss / lock |
| Rate limiting | Server-side; simultaneously across credential / company / device / network dimensions where practical |
| Atomic failed-attempt count | Server-authoritative; concurrency-safe (see §4.3) |
| Progressive cooldown / temporary lock | After threshold; not UI-only |
| Success path | Safely resets/reconciles failure state |
| Audit | Success/failure **without** PIN / hash / salt / pepper |
| Storage | No plaintext / reversible PIN; PIN never returned after set |

#### 4.3 PIN concurrency (lockout) — PO binding

Failed-attempt control **must** be concurrency-safe and server-authoritative.

**Forbidden pattern:**

```text
read failed_attempts → calculate in app → later update
```

such that parallel attempts bypass the counter.

**Required:** transaction / atomic DB update / equivalent authoritative mechanism so parallel failed requests cannot bypass `failed_attempts`, cooldown, or lock state. Do not rely on UI throttling.

### 5. Authorization / AccessGrant

```text
Authentication success ≠ Authorization
```

Authoritative path:

```text
User → active AccessGrant → tenant → role/permission → outlet / terminal scope
```

- Fail closed if grant missing / revoked / expired / wrong scope.
- Caller cannot authoritatively submit `tenantId`, role, permission, outlet scope, or terminal scope to expand authority.
- Employee permissions remain separate from SalesContext / Menu / POS Presentation.

Permissions for this contour (repository-canonical names may be finalized in ID1.1; conceptual requirement is explicit, grant-backed permission — **not** `manager=true`):

- open CashShift (e.g. `cash_shift.open` / `cash.shift.open`)
- approve CashShift open requests (e.g. `cash_shift.open.approve` / `cash.shift.open.approve`)

### 6. Session security — PO binding

Authentication success creates a **server-authoritative Session**.

Mandatory:

- Cryptographically random session secret (high entropy; ≥ 192-bit)
- Persist **hash only** server-side when a bearer secret is issued (token/hash separation)
- Expiry + revocation
- Bind User (+ optional employee link snapshot) + tenant / grant scope + channel
- Rotation where channel design requires it
- Never log session secret; never put in URL / outbox / analytics

**Production browser POS:**

```text
do NOT store bearer authentication secret in localStorage or sessionStorage
```

Preferred browser direction:

```text
HttpOnly
Secure
SameSite policy appropriate to deployment
server-revocable session
```

Native mobile secure OS storage is separate implementation work.

Until an Accepted terminal/browser secure-session design is implemented, **production frontend auth completion is not launch-ready**. Backend Identity foundation may proceed independently after this ADR is Accepted.

### 7. DeviceIdentity ≠ Terminal — PO binding (no temporary alias)

ADR-0018 remains binding.

- Session / LoginChallenge / ApprovalRequest / future CashShift bind to **`terminalId`** where relevant.
- Until DeviceIdentity runtime exists:

```text
terminalId = authoritative Terminal
deviceId   = absent / NULL / deferred
```

- **Forbidden even temporarily:** `device_id = terminal_id`; fake DeviceIdentity UUID; copying Terminal ID into a device field; any DB / API / domain / audit claim that Terminal UUID **is** DeviceIdentity.

### 8. LoginChallenge semantics

QR LoginChallenge token:

| Property | Rule |
| --- | --- |
| Opaque | Non-meaningful to clients |
| Entropy | ≥ 192-bit |
| At rest | Hash only (e.g. SHA-256 or stronger) |
| Lifetime | Short TTL; unique; single-use |
| Transition | Atomic PENDING → CONFIRMED / EXPIRED / REJECTED / CANCELLED; later CONSUMED by authorized consumer when policy requires |
| Logging | No raw token in logs / analytics / outbox |
| Scope | Authoritative tenant + outlet + terminal + target user/principal + nonce/expiry |

**Binding:** token possession alone **NEVER** authenticates a User.

```text
qrToken
+ authenticated mobile principal
+ scope / target match
+ unexpired
+ unused
→ confirmation
```

### 9. Mobile confirm — PO binding

Confirmation requires **all** of:

- valid `qrToken`
- already authenticated mobile User/Principal session
- scope/target match
- not expired
- not consumed

**Without authenticated mobile principal evidence: NO cashier Session may be created.**

If independent mobile authentication runtime does not yet exist:

- schema/contracts may exist under ID1.1 as supported by this ADR;
- **production QR login completion remains unavailable**.

### 10. ApprovalRequest (dangerous operation)

Minimum frozen fields / evidence:

- requester
- authorizer (on decision)
- tenant, outlet, terminal
- operation type
- **exact operation fingerprint**
- createdAt, expiresAt
- decision, decisionAt
- audit evidence
- loginChallenge binding when challenge is part of the flow

Approver must hold explicit server-authoritative approve permission in correct tenant/outlet scope (conceptual `cash.shift.open.approve` / repository equivalent). No generic `manager=true`.

#### 10.1 Self-approval — PO decision

If policy requires second-person authorization:

```text
requester != authorizer
```

**SELF-APPROVAL IS FORBIDDEN.**

Admin/manager status does **not** bypass this.

If a role may perform an operation **without** second-person approval, that is a **separate authorization policy path** (permanent AccessGrant such as open permission) — **not** self-approval of an ApprovalRequest.

#### 10.2 Exact-operation fingerprint — Cash integration contract

For future `OpenCashShift`, operation fingerprint includes **at least**:

```text
operationType
tenant
outlet
terminal
requester
openingCash.amountMinor
openingCash.currencyCode
openingCash.minorUnitExponent
```

Any change → prior approval **invalid**.

Approval is **not**: “this user may open some shift later”.

#### 10.3 State machine

Conceptual states:

```text
PENDING
APPROVED
REJECTED
EXPIRED
CANCELLED
```

- Decision is atomic and single-use; no second decision; no ordinary reopen.
- When policy requires consumption, approved evidence is single-use and race-safe (atomic with the consuming command).

### 11. Notification boundary

`NotificationPort` → Identity notification outbox is acceptable. No push vendor required.

Delivery success/failure does **not** change authorization truth.

Outbox payload **MUST NEVER** contain:

```text
PIN
PIN hash
pepper
raw qrToken
session token / secret
credential material
```

Event such as `CASH_SHIFT_OPEN_APPROVAL_REQUESTED` may contain opaque request identity + safe display metadata only.

### 12. Integration contract with Cash (boundary only — no Cash schema in this ADR)

Cash remains owner of CashShift lifecycle (`OPEN → CLOSED → RECONCILED → ACCEPTED`).

This ADR **does not** implement CashShift. It freezes auth/approval evidence Cash may later consume under **CASH1.1** (only after **SEC-0**).

#### 12.1 Authorization evidence for future OpenCashShift

Open must require successful authorization evidence equivalent to:

1. User has open permission **and** required confirmations for this attempt (e.g. valid mobile-confirmed LoginChallenge when QR path is used); **or**
2. Valid consumed one-time ApprovalRequest matching the **exact** operation fingerprint (incl. opening Money) **and** required challenge semantics when applicable.

Opening cash / cash count is a **Cash** step after auth — not part of PIN/QR/approval identity UX.

#### 12.2 Opening Cash Money — PO binding (integration)

Future opening Cash Money must be full ADR-0002 Money:

```text
amountMinor
currencyCode
minorUnitExponent
```

- `openingCash >= 0`
- No JS `Number` for authoritative arithmetic
- Meaning: physical drawer opening float
- **Not** automatically Revenue, Payment, Settlement, Tax, or Fiscal fact
- Do not create fake Payment to represent opening cash

#### 12.3 Concurrency — PO MVP decision

```text
ONE OPEN CashShift per Terminal
```

on MVP. Future CASH1.1 must enforce at DB level where practical (prefer partial unique constraint on live/open state). Concurrent `OpenCashShift` commands → at most one live OPEN shift.

Multiple simultaneous drawers per Terminal require a future explicit architecture change — do not silently choose.

#### 12.4 Historical auth evidence

Future CashShift must preserve durable historical attribution equivalent to:

```text
openedByUserId
authMode
terminalId
openedAt
approvalRequestId? / loginChallengeId?
operation fingerprint / evidence refs as required
```

Expiry/revocation of a Session later must **not** erase historical CashShift attribution.

#### 12.5 Auth mode invariants (conceptual)

Future Cash integration must define valid evidence combinations. Conceptually:

| Path | Required evidence |
| --- | --- |
| Permission path | Authenticated Session + required confirmations per policy (e.g. mobile-confirmed challenge when QR confirmation is required) |
| Approval path | Valid approved exact-operation ApprovalRequest (+ required challenge semantics) |

No arbitrary mixed/mismatched identifiers. Exact DB CHECK constraints are **CASH1.1** implementation scope.

### 13. Cross-tenant / outlet / terminal isolation

Permanent requirements (non-exhaustive):

- Company code cannot grant authority
- Foreign `tenantId` injection cannot switch tenant
- AccessGrant from Tenant A cannot authorize Tenant B
- LoginChallenge scope cannot cross tenant/outlet/terminal
- ApprovalRequest cannot cross tenant/outlet/terminal
- Employee/User link must respect tenant relationship
- Authenticated principal cannot consume foreign challenge/approval
- Client IDs never override server authority
- Prefer composite FK / DB integrity for durable scope relationships where practical

### 14. Canonical CashShift schema gap (governance note)

A prototype migration on the blocked runtime branch may technically create `cash_shift` on a clean migrate. That does **not** make it Accepted canonical Cash foundation.

- Do **not** treat prototype `028` (orphan-derived semantics, including any `device_id = terminal_id` alias) as Accepted CashShift schema.
- Because that runtime branch is **unmerged**, it may be removed/reworked safely before any canonical merge.
- Do **not** import orphan `019/020/022_counter_service_*` into canonical history.
- First canonical CashShift table is **CASH1.1** work under Cash ownership after SEC-0.

### 15. Implementation split — PO decision

```text
restore backup equality
        ↓
ADR-0036 docs-only Accepted + merged + backed up
        ↓
ID1.1 — Identity / POS Auth Foundation
        ↓
independent security review
        ↓
SEC-0 Financial Core Adversarial Review
        ↓
CASH1.1 — CashShift Open
        ↓
financial FUNCTIONAL + ARCHITECTURE + SECURITY gates
```

| Package | May contain | Must not contain |
| --- | --- | --- |
| **ADR-0036** | This document only | Migrations / runtime |
| **ID1.1** | `companyCode`, Terminal, User, PIN foundation, AccessGrant, Session, Employee↔User link, audit, LoginChallenge/ApprovalRequest as supported by Accepted ADR | `OpenCashShift` mutation; canonical CashShift table; opening cash Money mutation; fake DeviceIdentity; production QR login completion without authenticated mobile principal |
| **SEC-0** | Adversarial financial/security review | — |
| **CASH1.1** | Canonical CashShift foundation + Open with Money + evidence + one-OPEN-per-Terminal | Auth mode invention; DeviceIdentity fake |

**CASH1.1 must not start before SEC-0 closes.** Identity runtime may proceed after ADR acceptance and normal security review.

### 16. Explicitly out of scope for this ADR

- Final POS / mobile visual UI
- Concrete push vendor
- QR **payment** flows
- DeviceIdentity runtime
- Production cookie/session storage implementation (direction frozen; implementation separate)
- CashShift schema/runtime (CASH1.1 after SEC-0)
- Merging blocked runtime prototype
- Any merge while Origin↔GitHub backup equality unresolved

---

## Consequences

### Positive

- Unblocks focused Identity foundation (ID1.1) under Accepted auth semantics
- Separates locator, authentication, authorization, confirmation, and dangerous-op approval
- Preserves ADR-0018 without temporary Terminal/Device alias
- Keeps Cash as owner of CashShift while requiring Identity evidence
- Makes low-entropy PIN threat model explicit (pepper + atomic lockout required)

### Negative / follow-ups

- Blocked Level B prototype must not merge as-is; rework under ID1.1 / CASH1.1 split
- Public Company DTO must drop `tenantId` in ID1.1
- Browser HttpOnly session design required before production web POS auth launch
- Mobile authenticated session runtime required before production QR login completion
- SEC-0 must close before CASH1.1
- Origin↔GitHub backup equality must be restored before any merge of this contour

---

## Security notes (architecture)

- PIN offline brute-force resistance depends on **pepper + KDF + rate limit + atomic lockout**, not KDF alone.
- Challenge/approval are capability tokens only within authenticated principal flows.
- Approval is not a standing privilege.
- Notification outbox is not an auth channel.
- Cross-tenant isolation is fail-closed and server-authoritative.

---

## Acceptance checklist

### PO deltas (must all be PASS before Accepted)

- [x] Public Company DTO: `{ companyCode, displayName }` only — **no `tenantId`**
- [x] PIN policy: numeric; default 6; range 4–12; explicitly **low entropy**
- [x] Pepper + versioned KDF + compensating controls listed
- [x] Lockout atomic / concurrency-safe (no read-calc-later-update race)
- [x] Browser: no production auth secret in localStorage/sessionStorage; HttpOnly+Secure+SameSite direction
- [x] DeviceIdentity ≠ Terminal; `deviceId` NULL/absent/deferred — **no temporary alias**
- [x] qrToken possession alone insufficient; mobile authenticated principal required
- [x] No cashier Session without mobile principal evidence
- [x] Approval fingerprint includes opening Money fields
- [x] Self-approval forbidden when second-person policy applies
- [x] ONE OPEN CashShift per Terminal (MVP integration expectation)
- [x] Opening cash = full Money; ≥ 0; not Revenue/Payment/Settlement/Tax
- [x] Historical auth evidence survives Session expiry
- [x] Notification outbox never carries secrets listed in §11
- [x] Cross-tenant isolation explicit
- [x] Cash runtime deferred to CASH1.1 + SEC-0
- [x] Prototype 028 not Accepted canonical CashShift foundation

### Independent re-review

- [x] Independent Identity/Security architecture review: **APPROVE** (2026-09-18; checklist 1–20 PASS; no blockers)
- [x] PO deltas incorporated prior to that APPROVE

### Merge governance

- [ ] Origin main SHA == GitHub main SHA (backup equality)
- [ ] ChatGPT independent equality verification
- [ ] Only then: merge docs-only ADR PR + backup

---

## STOP (merge)

- Runtime prototype remains **BLOCKED** — do not merge; do not resume as Level B combined runtime.
- ADR-0036 is **Accepted** architecturally.
- **Docs-only merge remains blocked** until Origin↔GitHub backup equality is restored and independently verified.
