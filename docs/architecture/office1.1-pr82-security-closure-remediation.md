# OFFICE1.1 PR #82 — Level C Security Closure Remediation

- **Status:** **Proposed** — Level C docs only. **STOP BEFORE MERGE / RUNTIME / MIGRATIONS** until PO Accept.
- **Date:** 2026-10-13
- **PR:** Origin #82 (`docs/office1.1-global-username-professional-access`)
- **Canonical main:** `94f540ae64fc9c88bda50bf7c275ecec3f6f4909`
- **Do not re-review:** Gate 0 PR #83, ADR-0041 PR #84 (merged/closed).
- **Authority docs:** [Amendment B](../decisions/ADR-0039-amendment-B-office11-mfa-otp-trusted-device.md); [ADR-0040](../decisions/ADR-0040-office-username-invites-professional-grants.md) §5–§6–§9; [Amendment A](../decisions/ADR-0039-amendment-A-phone-first-optional-email.md); Accepted ADR-0039; Accepted ADR-0041 D1.

---

## Item 1 — Zalo OTP: one satisfaction for signup → first OfficeSession (R82-1)

### Exact Proposed ADR wording

See **Amendment B §B1** (`PhoneOtpSatisfactionProof`, purpose `SIGNUP_AND_FIRST_SESSION`).

Accept binds: one Zalo OTP verify may satisfy MFA for the **first** OfficeSession after password + PartialAuth when proof is unexpired, unconsumed, phone-bound, and PartialAuth-bound; atomic single consume; never session from proof alone.

### Security consequences

Preserves server-side MFA proof, challenge binding, single-use verification, anti-replay. Removes unnecessary second Zalo charge for the same verified transaction. Does **not** allow password-only OfficeSession.

### Implementation dependencies

Amendment A Accept; Amendment B Accept; Identity proof/challenge tables; Zalo adapter; register→PartialAuth→consume proof path.

### Targeted tests

1. One Zalo send for signup verify + first session via proof.
2. Replay consumed proof → reject.
3. Expired / phone mismatch / unbound PartialAuth → reject; new OTP.
4. Concurrent consume → one winner.
5. Proof alone or password alone → no OfficeSession.

### PO product conflict?

**None** with phone-first / no-SMS contract. Aligns with cost/abandonment concern from R82-1.

---

## Item 2 — Subsequent login without paid OTP every time (R82-2)

### Exact Proposed ADR wording

See **Amendment B §B2**. Explicit **ADR-0039 B3 deltas**:

| Accepted ADR-0039 B3 | Proposed Binding |
| --- | --- |
| Later: password then passkey OR push OR email OTP | Later: password → PartialAuth → **exactly one** of passkey \| **TrustedDevice** \| push \| Zalo phone OTP \| verified-email OTP |
| OPEN remembered device | TrustedDevice = cryptographic second factor; **not** “skip MFA”; **not** password-only |

Step-up (OTP/passkey required despite TrustedDevice): phone change; username change; recovery; MFA factor add/remove; CreateBusinessBootstrap; high-risk grant changes; revoke-other-devices. Exact money/outlet step-up list remains **OPEN** (do not invent).

### Security consequences

Sustainable login UX and Zalo cost control **without** silent password-only Office access. Device theft mitigated by revoke + step-up.

### Implementation dependencies

WebAuthn; TrustedDevice store; push enrollment; Amendment A/B Accept.

### Targeted tests

1. Password only → PartialAuth; no session.
2. Password + TrustedDevice → session; zero Zalo.
3. Password + passkey → session; zero Zalo.
4. Revoked device → reject.
5. Step-up (phone change) → TrustedDevice insufficient.

### PO product conflict?

**None** with MFA-mandatory PO/ADR-0039. Soft conflict only if PO expected “remember me = no second factor” — that interpretation is **rejected** here and must be flagged if asserted.

### Changes needed to ADR-0039 (explicit)

1. B3 later-login row: add TrustedDevice class; keep password-first + mandatory second factor.
2. Close “remembered device” OPEN by defining TrustedDevice (not session cookie alone).
3. Document step-up triggers (partial Accept; numerics OPEN).

Amendment A A2 “Later logins” must be read **together with** Amendment B §B2 after Accept.

---

## Item 3 — Empty / omitted LegalEntity / Outlet scope fail closed (R82-3)

### Exact Proposed ADR wording

See **ADR-0040 §5** (`scope_mode` enum; empty arrays never tenant-wide; TENANT_WIDE only via explicit authorized selection).

### Security consequences

Prevents silent privilege expansion. Aligns Gate 0 / ADR-0041 / mig 027 tenant-wide vs outlet indexes.

### Implementation dependencies

Invite/grant schema with `scope_mode`; authz evaluate; TaskService scope checks (ADR-0041).

### Targeted tests

1. Create grant with empty LE list + omitted mode → reject.
2. `LEGAL_ENTITY_SET` + empty ids → reject at write and evaluate.
3. `OUTLET_SET` + empty ids → reject.
4. `TENANT_WIDE` only when inviter explicitly selected and authorized.
5. Task mutate with empty outlet scope → deny (ADR-0041 §13.3).

### PO product conflict?

**YES — flagged.** Prior PR #82 Proposed ADR-0040 text and packet **O5** treated empty arrays as tenant-wide / “tenant-policy default OPEN”. That **conflicts** with R82-3 and Accepted ADR-0041 fail-closed. Remediation **supersedes** the old empty-default; PO must Accept the fail-closed wording deliberately.

---

## Item 4 — Accountant hub: membership ∪ ClientAccessGrant reads only (R82-4)

### Exact Proposed ADR wording

See **ADR-0040 §6** read hub union with `authorizationSource`; mutation still single command class; no permission union.

### Security consequences

One UX hub without inheriting mutation privileges across paths or clients. ADR-0022 isolation preserved.

### Implementation dependencies

Read-model query union; per-item `authorizationSource`; mutation APIs unchanged (path tenant + command class).

### Targeted tests

1. Membership accountant tenant appears in clients/inbox with `MEMBERSHIP`.
2. ClientAccessGrant client appears with `PROFESSIONAL`.
3. Mutation using membership perms under PROFESSIONAL class → deny.
4. Revoke grant → membership rows unchanged and vice versa.
5. Cross-tenant mutation still denied.

### PO product conflict?

**Soft conflict — flagged.** Prior architecture §5.1 / packet §5 said clients strip = ClientAccessGrants **only**. R82-4 **extends read** to include membership accountant roles. PO contract #8 (unified read-only inbox) is preserved; mutation contract #9 preserved. PO should Accept the read-union extension explicitly.

---

## Item 5 — Recovery: username retirement, phone loss, no mandatory email (R82-5)

### Exact Proposed ADR wording

See **ADR-0040 §9** + **Amendment B §B3**.

### Security consequences

Prevents owner/accountant takeover via username recycle or SIM/phone reassignment; recovery without forcing email (phone-first product).

### Implementation dependencies

Username retirement table; phone quarantine; multi-factor re-bind; session revoke on phone change; optional support break-glass (OPEN).

### Targeted tests

1. Rename → old username unclaimable during quarantine; grants unchanged.
2. Phone re-bind password-only → reject.
3. Phone re-bind password + passkey/trusted-device + new Zalo OTP → success; old phone quarantine; sessions revoked.
4. Recovery cannot change GlobalAccountId or move grants.
5. No email on account → recovery still possible via phone factors / passkey / trusted-device (not email-mandatory).

### PO product conflict?

**None** with optional-email product. Aligns Amendment A. Support break-glass remains OPEN (not invented as default).

---

## Item 6 — M1 dependency: employee Task complete via OfficeSession (R82-M1)

### Exact Proposed wording (M1 binding note)

```text
M1 first vertical (Accepted ADR-0041 D1 / §11):
  - Manager Dispatcher: OfficeSession + task.dispatch (and related) — unchanged.
  - Employee Task completion in M1: authorized OfficeSession principal with
    TenantMembership (or explicit mapped grant) holding task.complete on the
    Task’s outlet/tenant scope — fail-closed empty scope.
  - KiU Mobile / POS task-command principal mapping: DEFERRED to a later
    Approved Level C/B slice; not required to ship M1 Manager Dispatcher +
    Office employee complete.
  - POS PIN session remains forbidden as Manager Dispatcher and is not the
    M1 employee-complete principal.
```

### Security consequences

Unblocks M1 without waiting for Mobile identity integration. Keeps POS PIN isolation. Future Mobile must get its own explicit principal mapping (ADR-0041 OPEN retained).

### Implementation dependencies

OFFICE1.1 OfficeSession runtime; `task.complete` grant seed; ADR-0041 Level B schema/API. **Does not** require PR #82 Accept for ADR-0041 design (already Accepted), but **does** require OfficeSession capability before M1 ship.

### Targeted tests

1. OfficeSession + `task.complete` on outlet → complete succeeds.
2. OfficeSession without `task.complete` → deny.
3. POS PIN session → deny Manager dispatch and M1 employee complete.
4. Empty outlet scope → deny.
5. Mobile principal absent in M1 → no silent fallback to POS PIN.

### PO product conflict?

**None** with ADR-0041 D1 (“Employee complete via explicitly mapped principal (Office or future Mobile)”). Choosing **Office for M1** and **Mobile later** is an explicit sequencing decision, not a silent product change. Flag if PO required Mobile employee-complete in the same M1 ship — that would be a **new** requirement and a blocker.

---

## Summary Accept matrix

| ID | Doc | Action needed from PO |
| --- | --- | --- |
| R82-1 | Amendment B §B1 | Accept |
| R82-2 | Amendment B §B2 + ADR-0039 B3 delta | Accept (no password-only) |
| R82-3 | ADR-0040 §5 | Accept fail-closed; **supersede** old empty=OPEN / O5 |
| R82-4 | ADR-0040 §6 | Accept read union; confirm mutation non-union |
| R82-5 | ADR-0040 §9 + Amendment B §B3 | Accept direction; OPEN numerics OK |
| R82-M1 | ADR-0041 note / M1 plan | Accept OfficeSession employee complete for M1; Mobile later |

## Remaining blockers (non-exhaustive)

- PO Accept / Accept-with-deltas on Amendment A, Amendment B, ADR-0040 (with §5–§6–§9).
- Independent Architecture / FinSec / Privacy review of this remediation tip.
- O1–O4, O6–O13 numerics still OPEN for runtime (do not invent).
- No runtime, migrations, or merge until PO MERGE GO.
