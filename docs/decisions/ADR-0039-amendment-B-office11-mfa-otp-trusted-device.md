# ADR-0039 Amendment B: Signup OTP Satisfaction, Trusted Device & Recovery (OFFICE1.1)

- **Status:** **Accepted WITH DELTAS** (OFFICE1.1 PR #82 security closure)
- **Accepted:** 2026-10-13 — PO **ACCEPT WITH DELTAS**; docs merge `e83a02b8933947a80d4ceb0cf50d84e44c5aaf0f` (PR #82)
- **Date (authored):** 2026-10-13
- **Decision owners:** Product Owner and System Architect
- **Amends:** [ADR-0039](ADR-0039-office-global-account-mfa-owner-bootstrap.md) (**Accepted**); [Amendment A](ADR-0039-amendment-A-phone-first-optional-email.md) (**Accepted WITH DELTAS**)
- **Related:** ADR-0015; [ADR-0040](ADR-0040-office-username-invites-professional-grants.md) (**Accepted WITH DELTAS**); ADR-0041 (**Accepted**)
- **Autonomy:** Level **C** design Accept. **STOP BEFORE RUNTIME / migrations / production activation** until separate **Level B** authorization. Open numeric MFA/recovery policies remain production blockers (see IDENTITY-B1 security parameter table).
- **Canonical Accept merge:** `e83a02b8933947a80d4ceb0cf50d84e44c5aaf0f`

---

## Why amend

OFFICE1.1 PR #82 review closed on product: avoid duplicate Zalo OTP charges for the same verified signup→first-session transaction; allow subsequent login without paid OTP every time **without** password-only OfficeSession; define phone-loss recovery without mandatory email.

This amendment does **not** remove ADR-0039 mandatory MFA, PartialAuth ≠ Session, or POS isolation.

---

## B1. Single Zalo OTP satisfaction for signup → first OfficeSession (R82-1)

### Accept wording (binds)

```text
PhoneOtpSatisfactionProof
  proofId, globalAccountId? (or signupDraftId), phoneE164
  purpose: SIGNUP_AND_FIRST_SESSION
  challengeNonce (server-issued)
  verifiedAt, expiresAt
  consumedAt? , consumePurpose?
  providerRef (Zalo delivery id — audit only; not a second secret)
```

1. Signup phone verification via Zalo ZBS OTP produces a server-side **`PhoneOtpSatisfactionProof`** bound to `(phoneE164, challengeNonce)` with purpose `SIGNUP_AND_FIRST_SESSION`.
2. Proof is **single-use for MFA satisfaction toward the first OfficeSession** after successful password + `OfficePartialAuth`, **if and only if**:
   - proof not expired;
   - proof not consumed;
   - phone still matches the GlobalAccount’s verified primary phone;
   - PartialAuth token is bound to the same GlobalAccount (or signup completes atomically into that account);
   - client presents proofId + PartialAuth under CSRF/cookie rules.
3. Consuming the proof for first OfficeSession **does not** require a second Zalo OTP send for the same satisfaction transaction.
4. Consuming the proof is **atomic** (row lock / unique consume): concurrent attempts → one winner; loser must start a new OTP challenge.
5. If proof expired, revoked, phone changed, or PartialAuth unbound → **fail closed**; require a **new** OTP challenge (new charge allowed).
6. Anti-replay: nonce + single consume + TTL; proof never stored client-side as a bearer equivalent to a session; never mint OfficeSession from proof alone (password + PartialAuth still required).
7. When the GlobalAccount’s **first OfficeSession** is minted by **any** MFA path (satisfaction-proof consume, fresh Zalo OTP, verified-email OTP, passkey, push), **invalidate all unconsumed** `SIGNUP_AND_FIRST_SESSION` proofs for that account/draft. Stale proofs must not remain usable as a leftover second factor.

**Preserved:** MFA before OfficeSession; never password-only; server-side challenge binding; single-use verification.

**Does not change Accepted PO product:** phone-first Zalo direction (Amendment A).

### Security consequences

| Risk | Mitigation |
| --- | --- |
| Stolen proof reuse | Single consume + short TTL + PartialAuth binding |
| Skip password | Forbidden — PartialAuth still requires password success |
| Double-charge UX | One satisfaction covers signup verify + first session MFA only |
| Provider replay | Ignore client-supplied OTP after consume; server state authoritative |

### Implementation dependencies

- Amendment A Accept (phone-first); Identity Office schema for proofs/challenges; Zalo adapter; no SMS.

### Targeted tests

1. Signup OTP verify → register → password → first session using proof → **one** Zalo send; OfficeSession minted; proof consumed.
2. Reuse same proof → reject; require new OTP.
3. Expired proof → reject; new OTP required.
4. Password alone / proof alone / unbound PartialAuth → **no** OfficeSession.
5. Concurrent consume → exactly one session path succeeds.

---

## B2. Subsequent login without paid OTP every time (R82-2) — ADR-0039 B3 delta

### Changes required to Accepted ADR-0039 B3

| ADR-0039 Accepted row | Proposed Amendment B binding |
| --- | --- |
| Later logins: password then passkey **OR** trusted signed KiU mobile push **OR** email OTP | Later logins: password → `OfficePartialAuth` → **exactly one** of: **passkey** \| **trusted-device attestation** \| **trusted signed KiU mobile push** \| **phone OTP (Zalo)** \| **email OTP (verified email only)** |
| (OPEN) OfficeSession TTL / remembered device | **Trusted device** becomes an explicit second-factor class (below) — not “remember me = skip MFA” |

### Accept wording (binds)

1. **Password alone never yields OfficeSession** (ADR-0039 unchanged).
2. After first successful OfficeSession, user **may enroll**:
   - WebAuthn **passkey** (skip allowed at enroll UX; not passwordless login); and/or
   - **TrustedDevice** credential: server-issued device key bound to GlobalAccount + device attestation metadata; refreshable; revocable.
3. Subsequent login MFA preference order (UX hint, not security downgrade): passkey → trusted-device → push → Zalo OTP → verified-email OTP.
4. **TrustedDevice** is a **second factor**, cryptographically verified server-side (challenge/response). It is **not** a long-lived OfficeSession cookie substitute and **not** password-only.
5. **Step-up** (force OTP or passkey even if trusted-device present) on Proposed triggers: phone change; username change; recovery flows; add/remove MFA factors; CreateBusinessBootstrap; grant of high-risk permissions; explicit “revoke other devices”; **OPEN** exact money-movement/outlet list (must not invent).
6. Trusted-device lifetime / idle revoke / max devices per account: **OPEN** numerics (propose defaults only after Accept of class).

**Conflict flag:** None with PO “no password-only”. Soft conflict with cost-minimization if step-up list is too aggressive — call out at Accept.

### Security consequences

| Risk | Mitigation |
| --- | --- |
| “Remember me” = password-only | Forbidden |
| Device theft | Revoke list; step-up on recovery/phone change; optional short TTL |
| Push phishing | Existing ADR-0039 push trust binding retained |

### Implementation dependencies

- WebAuthn store; TrustedDevice table; push enrollment; Amendment A phone OTP.

### Targeted tests

1. Login with password only → PartialAuth; **no** OfficeSession.
2. Password + enrolled trusted-device proof → OfficeSession; **zero** Zalo send.
3. Password + passkey → OfficeSession; no Zalo.
4. Revoked trusted-device → reject; OTP/passkey required.
5. Step-up event (phone change) → trusted-device insufficient; OTP/passkey required.

---

## B3. Phone loss / recovery without mandatory email (pairs with ADR-0040 R82-5)

### Accept wording (binds)

1. Email remains **optional** (Amendment A). Recovery **must not** require email.
2. **Split flows — do not conflate:**

   **A. In-possession phone change** (caller still controls current primary phone):
   - Require active OfficeSession **or** password → PartialAuth → step-up MFA where OTP/challenge destination is the **current primary phone** (TrustedDevice **alone is insufficient** — aligns B2 step-up on phone change).
   - Then fresh Zalo OTP on the **new** phone.
   - On success: old phone quarantine; revoke other sessions/PartialAuth; invalidate leftover signup proofs.

   **B. Lost-phone recovery** (current primary unreachable):
   - Password + TrustedDevice + new-phone Zalo **alone is insufficient** (device-theft takeover path — **rejected**).
   - Require proof of GlobalAccount control via **stronger set**: password **and** enrolled **passkey** (preferred), **or** password + verified-email OTP (if email verified), **or** password + active OfficeSession established before loss + passkey enroll path, **or** audited dual-control support break-glass (**OPEN**, not default).
   - TrustedDevice may count as **one** supporting factor only when combined with passkey or verified-email OTP — never as the sole second factor for lost-phone cutover.
   - On Accept success: **delayed cutover** recommended (OPEN duration, propose notify-attempt to old phone / session revoke immediately, primary swap after delay); fresh Zalo on new phone; old phone quarantine; revoke all other sessions and TrustedDevices optionally forced re-enroll (**OPEN**).

3. Recovery never silently transfers TenantMemberships/ClientAccessGrants to a different GlobalAccountId.
4. Support break-glass is **exceptional**, fully audited, and **OPEN** for legal/ops procedure — not an agent-invented default.

### Security consequences

In-possession change challenges the **current** primary. Lost-phone path blocks password+device+attacker-phone takeover. Cool-down + delayed cutover mitigate SIM recycle. No email mandate preserves PO phone-first product.

### Targeted tests

1. In-possession: password + current-phone OTP + new-phone OTP → success; TrustedDevice alone insufficient for phone change.
2. Lost-phone: password + TrustedDevice + new-phone Zalo only → **reject**.
3. Lost-phone: password + passkey + new-phone Zalo (+ delayed cutover) → success; old phone quarantine; sessions revoked.
4. Phone re-bind with password only → reject.
5. Recovery cannot change GlobalAccountId or silently move grants.
6. First session via passkey invalidates unconsumed signup satisfaction proofs.

---

## Explicit non-changes

- GlobalAccount ≠ `identity_user`; OFFICE ≠ POS.
- CreateBusinessBootstrap MFA-authenticated only.
- ADR-0015 privacy / egress for OTP metadata.

## Accept checklist

| Item | Section |
| --- | --- |
| One Zalo satisfaction for signup→first session | B1 |
| No password-only OfficeSession | B2 |
| Trusted device / passkey / push as MFA classes | B2 |
| Phone recovery without mandatory email | B3 |
