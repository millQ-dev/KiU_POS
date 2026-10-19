# ADR-0043: Offline Edge Authorization (ADR-OFFLINE-001)

- **Status:** **Proposed** (Level C — docs only)
- **Alias:** ADR-OFFLINE-001
- **Date:** 2026-10-19
- **Origin main reconciled:** `33dad072e014158c6658546abcda5de38e87f4b2`
- **Related:** ADR-0015, ADR-0018, ADR-0036, ADR-0039/0040/0041; Proposed ADR-0042 on Identity PR #87 (not on main); `offline-foundation.md`
- **STOP:** No runtime, migrations, secrets, or merge-as-implement

## Context

KiU is a **Hardware-Optional Hybrid SaaS**:

| Tier | Runtime | Offline promise |
| --- | --- | --- |
| Cloud-only POS | Cloud API + browser/clients | **None** — internet required |
| Embedded POS Edge | Local Runtime on compatible POS hardware | Local auth + local ops per policy |
| Dedicated Edge Hub | Shared local Runtime for multiple terminals | Same |
| Customer PC Edge | Local Runtime on certified compatible hardware | Same |

Cloud-only and Edge are **differentiated product tiers**. One shared domain implementation must serve both profiles — **no fork** of pricing, tax, Orders, Payments, Inventory, or Production logic.

ADR-0018 Accepted offline multi-platform **boundaries** but did not freeze Edge enrollment, offline PIN, signed grants, or Edge POS session. ADR-0036 Session / LoginChallenge / ApprovalRequest are **cloud-online** aggregates and must **not** be reused as offline unlock or standing privilege. PIN pepper + lockout today are server-side (`identity_pin_credential` + API pepper). DeviceIdentity is Accepted in ADR-0018 / ADR-0036 text but **runtime deferred**.

## Decision (Proposed)

### D1. Authority chain

```text
Cloud authorization authority
  → signed local grants snapshot (versioned, expiry, policyVersion)
  → Edge authentication + authorization
  → local Edge POS session (scoped)
```

Cloud remains the **policy authority**. Edge may authenticate and authorize **only** within a previously issued, still-valid signed grants snapshot. Edge does **not** become a second permanent identity SoT.

### D2. Online enrollment

When WAN is available, Cloud (or Edge acting as enrolled agent with Cloud) must:

1. Identify **EdgeInstallation**, **Tenant**, **LegalEntity**, **Outlet**, **Terminal**, **Employee** (Identity user / AccessGrant principal).
2. Verify employee permission for Edge POS operate + device trust binding.
3. Provision a **protected offline PIN verifier** via secure enrollment — **not** a copy of:
   - raw PIN;
   - existing `identity_pin_credential` hashes;
   - Cloud pepper.
4. Bind a **device-/Edge-specific** key strategy:
   - Prefer **TPM / secure keystore** where available;
   - Restricted support for **certified hardware without TPM** (software-isolated keystore + stronger re-enrollment / shorter grant TTL — Product + FinSec).
5. Sync **signed, versioned permission snapshots** with explicit `expiresAt` and `policyVersion`.
6. Preserve **audit** of enroll/rotate/revoke and **independent device revocation** (DeviceIdentity / EdgeInstallation revoke ≠ Terminal UUID).

### D3. Offline login

1. Employee authenticates against the **local Edge service** (not Cloud Session mint).
2. Edge verifies: offline credential, installation trust, scope (Tenant/LE/Outlet/Terminal), active locally known grants, expiry, persisted rate limits / lockout.
3. Edge issues a **scoped local Edge POS session** (not `OfficeSession`, not Cloud Identity elevation, not cross-tenant).
4. **Forbidden offline:** new employee enrollment; broader permission changes; Professional cross-client mutation (ADR-0018 §9); minting Cloud Session.
5. **KiU Mobile QR login** remains independent (ADR-0036; Proposed ADR-0042 on #87). **Offline QR is not required** for first Edge release.

### D4. Numerical proposals (PO proposals until Arch/FinSec/Privacy APPROVE)

| Parameter | Proposed value |
| --- | --- |
| Signed offline-grant validity | Up to **72 hours** since last **trusted** policy refresh |
| Local Edge POS session max | **12 hours**, and **never** beyond grant expiry |
| Remote revocation | Enforced on **next successful synchronization** |
| Local suspension | **Immediate** on Edge |
| Grace via clock rollback / reinstall / restart / restored backup | **None** — automatic extension forbidden |

### D5. Rate limits, PIN lifecycle, storage, encryption

| Topic | Proposed rule |
| --- | --- |
| Rate limit / lockout | Persisted on Edge (durable); progressive backoff; lockout survives restart; sync may tighten but not silently clear without Cloud authority |
| PIN lifecycle | Enroll / rotate / revoke only when online (or via constrained recovery procedure — separate Level C); offline verify-only |
| Credential storage | Offline verifier material in TPM/keystore or certified software vault; encrypted at rest; never plaintext PIN |
| Session revocation | Local logout/suspend immediate; Cloud revoke → next sync; session ≤ grant expiry |
| Clock rollback protection | Monotonic Edge security clock / last-seen trusted time; rollback fails closed for grant/session validity (no extension) |
| Backup restore | Restored older DB snapshot must not extend grants; detect generation/epoch mismatch → require re-enrollment |

### D6. Non-reuse of ADR-0036 aggregates

| Aggregate | Offline use |
| --- | --- |
| Cloud Session | Forbidden as Edge offline session |
| LoginChallenge | Forbidden as offline unlock / QR offline |
| ApprovalRequest | Forbidden as standing offline privilege or cash/fiscal SUCCESS backdoor (ADR-0038) |
| Cloud PIN hash/pepper | Forbidden to replicate to Edge |

### D7. Acceptance scope

Accepting this ADR freezes **Edge auth architecture**. It does **not** implement enrollment, TPM, sync, or sessions.

## Consequences

- Edge product tier can enroll offline verifiers without forking Identity domain model.
- Cloud-only tier remains internet-required (no offline promise).
- Requires ADR-0044 (writer/fencing) and ADR-0045 (ops/fiscal) for full Hybrid Edge.

## Alternatives considered

- Reuse Cloud PIN hashes offline — rejected (pepper leakage / hash reuse).
- Offline LoginChallenge confirm — rejected (requires online mobile principal).
- Unlimited offline grants — rejected (revocation / compromise window).
- Cloud-only forever — rejected (product tiers require Edge option).
