# OFFICE1.1 PR #82 — Final Product & Security Closure — PO Decision Packet

- **STATUS:** PO REVIEW HOLD — **DO NOT MERGE / RUNTIME / MIGRATIONS**
- **Date:** 2026-10-13
- **Autonomy:** Level **C**
- **PR:** Origin #82 — `docs/office1.1-global-username-professional-access`
- **Canonical main (do not re-review #83/#84):** `94f540ae64fc9c88bda50bf7c275ecec3f6f4909`
- **Remediation HEAD:** `712df9817339163794312acbcb3ce5caca184388`
- **FinSec-fix content:** `6cb613be86b07ef105cf0de0aba62762f9a14938`
- **Prior preflight packet:** `office11-pr82-po-decision-packet.md` (2026-10-12) — still valid for Amendment A body; **O5 empty-scope and clients-strip-only are superseded** by this closure where flagged.

---

## 0. Scope of this packet

Targeted remediation for six closure items only. Does **not** re-open Gate 0 or ADR-0041 Accept. Does **not** authorize runtime.

| ID | Topic | Authority |
| --- | --- | --- |
| R82-1 | One Zalo OTP satisfaction signup→first session | Amendment B §B1 |
| R82-2 | Subsequent login MFA without paid OTP every time; ADR-0039 B3 deltas | Amendment B §B2 |
| R82-3 | Empty LE/Outlet fail closed; TENANT_WIDE explicit | ADR-0040 §5 |
| R82-4 | Accountant read hub membership ∪ grant; no mutation union | ADR-0040 §6 |
| R82-5 | Username retirement / phone loss / recovery without mandatory email | ADR-0040 §9 + Amendment B §B3 |
| R82-M1 | Employee Task complete via OfficeSession in M1; Mobile later | M1 plan + ADR-0041 D1 note |

Full item text: `docs/architecture/office1.1-pr82-security-closure-remediation.md`.

---

## 1. Exact Proposed Accept wording (summary)

### 1.1 R82-1 — PhoneOtpSatisfactionProof

Signup Zalo OTP verify creates server-side `PhoneOtpSatisfactionProof` (purpose `SIGNUP_AND_FIRST_SESSION`) bound to phone + challenge nonce. After password → PartialAuth, first OfficeSession **may** consume the unexpired unconsumed proof **instead of a second Zalo send**. Atomic single consume; never session from proof or password alone.

### 1.2 R82-2 — ADR-0039 B3 deltas (no password-only)

Later logins: password → PartialAuth → **exactly one** of: passkey | TrustedDevice | trusted push | Zalo OTP | verified-email OTP. TrustedDevice is a cryptographic second factor, **not** skip-MFA. Step-up on phone/username/recovery/MFA changes/bootstrap/high-risk grants/revoke-other-devices (money/outlet list OPEN).

### 1.3 R82-3 — Fail-closed scope

`scope_mode` required: `TENANT_WIDE` | `LEGAL_ENTITY_SET` | `OUTLET_SET`. Empty/omitted LE or outlet arrays **reject**. Tenant-wide only via **explicit authorized** `TENANT_WIDE` selection.

### 1.4 R82-4 — Read union only

Accountant clients/inbox **may union** accountant-class TenantMembership and ClientAccessGrant, each tagged `authorizationSource`. Mutating commands use **one** command class; **must not** union privileges.

### 1.5 R82-5 — Recovery / retirement

Username retirement quarantine (recommend 90d). **In-possession phone change** challenges current primary (TrustedDevice alone insufficient). **Lost-phone** rejects password+TrustedDevice+new-phone alone; requires password+passkey (or verified-email OTP / break-glass); delayed cutover recommended; old phone quarantine (recommend 30d); no mandatory email; never change GlobalAccountId or silently move grants; support break-glass OPEN.

### 1.6 R82-M1 — OfficeSession employee complete

M1 employee Task complete via OfficeSession + `task.complete` (fail-closed scope). KiU Mobile identity integration deferred. POS PIN forbidden. Compatible with Accepted ADR-0041 D1.

---

## 2. Flagged conflicts with previously accepted / prior packet product behavior

| Conflict | Prior | Proposed | Required PO action |
| --- | --- | --- | --- |
| **C1 (hard)** | ADR-0040 draft + packet O5: empty LE/Outlet = tenant-wide / “tenant-policy default OPEN” | Fail-closed `scope_mode`; empty rejects | **Accept supersession** or reject R82-3 |
| **C2 (soft)** | Architecture §5.1 / packet §5: clients = ClientAccessGrants only | Read hub includes membership accountant tenants | **Accept read-union extension** or keep grants-only |
| **C3 (none)** | ADR-0039 MFA mandatory | TrustedDevice as MFA class | Confirm **no** password-only |
| **C4 (none)** | Amendment A phone-first optional email | Recovery without mandatory email | Confirm |
| **C5 (none if sequencing)** | ADR-0041 “Office or future Mobile” employee complete | Office in M1; Mobile later | Confirm sequencing; flag if Mobile required in same M1 ship |

**Do not change Accepted ADR-0041 / Gate 0 without flagging** — none of R82-1…5 reopen those Accepts. R82-M1 is sequencing only.

---

## 3. Security consequences (condensed)

| Item | If Accept | If Reject / defer |
| --- | --- | --- |
| R82-1 | One charge per signup→first session; anti-replay preserved | Double OTP cost / abandonment |
| R82-2 | Sustainable MFA login | Either password-only risk **or** OTP every login cost |
| R82-3 | No silent tenant-wide grants | Privilege expansion (unacceptable with ADR-0041) |
| R82-4 | Usable accountant hub | Split UX or unsafe mutation union if mis-implemented |
| R82-5 | Takeover resistance without email mandate | Account lockout **or** takeover via recycle |
| R82-M1 | M1 unblocked on Office path | M1 blocked on Mobile identity |

---

## 4. Implementation dependencies (after Accept — not now)

Amendment A+B Accept; ADR-0040 Accept with §5–§6–§9; Identity proofs/TrustedDevice/username retirement/phone quarantine; Zalo adapter; accountant read-model union; OfficeSession runtime before M1; **no migrations in this PR**.

---

## 5. Targeted test cases (Accept binds Level B later)

See remediation doc per item. Minimum gate set:

1. Signup→first session one Zalo send; proof replay fails.
2. Password-only never mints OfficeSession; TrustedDevice/passkey succeed without Zalo.
3. Empty scope_mode / empty LE|outlet arrays reject; TENANT_WIDE only explicit.
4. Read hub shows membership∪grant; mutation privilege union denied.
5. Username quarantine; phone re-bind multi-factor; no GlobalAccountId transfer.
6. OfficeSession `task.complete` OK; POS PIN denied; Mobile not required for M1.

---

## 6. Required independent reviews (this tip)

| Review | Scope | Result |
| --- | --- | --- |
| Architecture | Remediation + ADR-0040 §5–§6–§9 + Amendment B + M1 sequencing | **APPROVE** @ `ccacece` (holds on additive FinSec recovery fix @ `712df98`) |
| FinSec / Identity-Security | OTP proof, TrustedDevice, recovery, fail-closed scope, no password-only | **APPROVE** @ `712df98` (prior REQUEST CHANGES @ `ccacece` closed) |
| Privacy | Phone/OTP metadata, retirement, accountant hub labels (no PII expansion) | **APPROVE** @ `ccacece` (holds; recovery split is privacy-positive) |

Implementation agent must **not** self-approve. Review Agent: APPROVE or REQUEST CHANGES only.

### FinSec findings closed @ `6cb613b` / tip `712df98`

1. **High closed:** In-possession vs lost-phone split; reject password+TrustedDevice+attacker-new-phone alone.
2. **Med closed:** Invalidate unconsumed `SIGNUP_AND_FIRST_SESSION` proofs on first OfficeSession (any MFA).
3. **Med closed:** Amendment A A2 Later logins includes TrustedDevice with B2.
4. **Low closed:** Architecture §5.3 mutation wording aligned to ADR-0040 §6.

---

## 7. Remaining blockers

1. PO decision on C1–C5 (especially **C1 hard** fail-closed supersession).
2. ~~Independent reviews~~ — Architecture / FinSec / Privacy **APPROVE** recorded; PO Accept still required.
3. Amendment A still Proposed (phone-first) — required with B for coherent Accept.
4. Runtime OPEN numerics (OTP TTL, retirement days, TrustedDevice max, delayed cutover, break-glass) — may defer past docs Accept but block Identity Level B prod.
5. **STOP:** no merge, no migrations, no runtime until PO MERGE GO after Accept.

---

## 8. PO decision checklist

- [ ] Accept Amendment B §B1 (one Zalo satisfaction)
- [ ] Accept Amendment B §B2 / ADR-0039 B3 deltas (TrustedDevice; no password-only)
- [ ] Accept ADR-0040 §5 fail-closed (**supersede** empty=OPEN / O5)
- [ ] Accept ADR-0040 §6 read union (**extend** clients strip)
- [ ] Accept ADR-0040 §9 + Amendment B §B3 recovery direction
- [ ] Accept R82-M1 OfficeSession employee complete; Mobile later
- [ ] MERGE GO or HOLD for PR #82 docs

**STOP BEFORE MERGE / RUNTIME / MIGRATIONS.**
