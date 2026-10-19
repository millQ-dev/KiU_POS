# Edge Auth & Offline Financial Policy — Level C Package

- **Status:** Level **C** proposal — **STOP BEFORE RUNTIME / migrations / merge-as-GO**
- **Date:** 2026-10-19
- **Priority:** P0
- **Origin main (verified):** `33dad072e014158c6658546abcda5de38e87f4b2`
- **Note:** Historical audit snapshot equals current main at verification time; always re-fetch Origin before implement.
- **ADRs:** Proposed ADR-0043 (OFFLINE-001) · ADR-0044 (OFFLINE-002) · ADR-0045 (OFFLINE-003)
- **Identity #87 / ADR-0042:** Independent; Proposed only on PR branch — **not** on main; offline QR not required for first Edge release

---

## 1. Code & ADR evidence (reconciled SHA)

### 1.1 Existing Accepted offline surface

| Artifact | Status | Gap vs Hybrid Edge |
| --- | --- | --- |
| ADR-0018 | Accepted | Boundaries only; no Edge enrollment / writer / offline PIN |
| `offline-foundation.md` | Foundation | Employee sign-in deferred; fiscal offline deferred |
| ADR-OFFLINE-001/002/003 files | **Missing** | This package introduces aliases via ADR-0043/44/45 |
| DeviceIdentity runtime | Deferred | Terminal ≠ DeviceIdentity |
| Sync Local Store / Outbox / Inbox | Concepts only | Only `identity_notification_outbox` exists |
| Edge packaging | Missing | `apps/api` + `apps/web` only |

### 1.2 Auth / session (must not misuse)

| Ref | Fact |
| --- | --- |
| ADR-0036 | Session server-authoritative; LoginChallenge needs online mobile; ApprovalRequest one-time |
| PIN | `identity_pin_credential` + server pepper — not Edge-safe to copy |
| ADR-0042 | Proposed on #87 only; “No offline unlock” for QR login class |

### 1.3 Financial / fiscal

| Ref | Fact |
| --- | --- |
| `CollectionEvidenceKind` | `CARD_PROVIDER_COLLECTION` \| `CASH_RECEIVE` only |
| ReceiveCash | Client `collectedAt` forbidden; server `NOW()` acceptance clock |
| ADR-0038 A4 | Offline/late cash RELEASE-BLOCKING OPEN |
| CheckoutOrchestrator | Fiscal UNAVAILABLE/PENDING → block CompleteOrder |
| ADR-0014 D15 / ADR-0037 | C0 online-only CompleteOrder; no fiscal pending complete |
| G2 | Required for production fiscal SATISFIED |
| INTEGRATIONS-0 §2A | VietQR ≠ C0 PCE |

### 1.4 Critical runtime excerpt

```22:58:apps/api/src/modules/checkout/checkout-orchestrator.ts
  async tryAdvanceCheckout(raw: { ... }) {
    // Settlement must be SATISFIED
    // fiscal UNAVAILABLE → CHECKOUT_FISCAL_PREREQUISITE_UNAVAILABLE
    // fiscal PENDING | REQUIRED_NOT_SATISFIED → CHECKOUT_FISCAL_PREREQUISITE_PENDING
    // NOT_REQUIRED | SATISFIED → permit completeOrder
  }
```

**Design rule:** Do not remove this gate. Introduce `OperationalClose` (L1) separately if Accept ADR-0045.

---

## 2. Product tiers (binding)

Shared domain code; differentiated **deployment profile** and **offline promise**:

1. Cloud-only POS — internet required; no offline availability promise  
2. Embedded POS Edge  
3. Dedicated Edge Hub  
4. Customer PC Edge  

---

## 3. Deliverable index

| # | Deliverable | Location |
| --- | --- | --- |
| 1 | Origin SHA + code evidence | This §1 |
| 2 | Offline authorization ADR | `ADR-0043` / OFFLINE-001 |
| 3 | Device/credential trust | ADR-0043 D2–D5 |
| 4 | Grants / revocation | ADR-0043 D4–D5 |
| 5 | Single-writer / fencing | `ADR-0044` / OFFLINE-002 |
| 6 | Ops matrix | `ADR-0045` D2 |
| 7 | Payment/fiscal transitions | ADR-0045 D4 |
| 8 | VN legal OPEN | ADR-0045 D5 |
| 9 | GAP matrix | §4 below |
| 10 | OFF-01…OFF-10 plan | §5 |
| 11 | Review requirements | §6 |
| 12 | PO packet | `docs/processes/review-packets/edge-auth-offline-po-decision-packet.md` |

---

## 4. GAP matrix → ADR-OFFLINE-001/002/003

| GAP | Today | Closes via |
| --- | --- | --- |
| No Edge offline PIN / grants | Cloud PIN only | OFFLINE-001 (0043) |
| No DeviceIdentity / EdgeInstallation | Deferred | OFFLINE-001 |
| No signed permission snapshot | N/A | OFFLINE-001 |
| No single-writer / fencing | Cloud always writer | OFFLINE-002 (0044) |
| No LAN terminal→Edge auth | N/A | OFFLINE-002 |
| No sync outbox/inbox/cursor | Notification outbox only | OFFLINE-002 + OFF-03+ |
| CompleteOrder = fiscal-gated L3 | Runtime gate | OFFLINE-003 (0045) L1/L3 split — **Accept required** |
| Offline CASH OPEN (ADR-0038 A4) | Fail-closed tendency | OFFLINE-003 D3 Accept or reject |
| Card/VietQR fabricate ban | Docs + missing adapters | OFFLINE-003 + INTEGRATIONS |
| Edge packaging / local Postgres | Missing | OFF-02+ |
| VN offline fiscal counsel | OPEN | OFFLINE-003 D5 + G2 |
| ADR-0042 offline QR | PR-only Proposed | Out of first Edge auth release |

---

## 5. Source-specific reuse analysis

| Module | Reuse without invariant change? | Notes |
| --- | --- | --- |
| IdentityService / PIN | Partial | New offline verifier path; do not export pepper/hashes |
| LoginChallenge | No for offline unlock | Keep online QR/dangerous-op |
| CashShiftService | Yes with Edge profile | Same exclusivity/idempotency; fencing token on commands |
| OrdersService | Yes | Shared domain; Edge writer |
| CheckoutOrchestrator | Keep gate | Add OperationalClose beside it — do not gut tryAdvanceCheckout |
| Settlement | Yes | Coverage ≠ fiscal |
| PaymentsService / PCE | Extend carefully | Offline CASH needs ADR-0045 Accept; CARD/VietQR no fabricate |
| FiscalService | Yes | Queue/pending; never fabricate SATISFIED |
| Inventory / Production | Yes | ADR-0010 posting states |
| Outbox | Pattern reuse | New sync outbox ≠ identity_notification_outbox |
| KiU Mobile | Independent | Online MFA/QR; not first offline login |

---

## 6. Adversarial test scenarios (design-required; not run)

| # | Scenario | Expect |
| --- | --- | --- |
| 1 | WAN lost during login | Offline path if enrolled; else DENY |
| 2 | WAN lost immediately after authorization | Local session continues ≤ grant/session TTL |
| 3 | Manager revokes employee remotely while Edge offline | Local grants until sync; then revoke; no Cloud elevation |
| 4 | Employee suspended locally | Immediate deny |
| 5 | Offline grant expires | Deny new session; end session at expiry |
| 6 | Device clock rolled back | Fail closed; no grant extension |
| 7 | DB backup restored older snapshot | Epoch/generation mismatch → re-enroll; no silent resume |
| 8 | Installation cloned / moved Outlet | Trust fail; require Cloud re-bind |
| 9 | PIN brute-force | Persisted lockout |
| 10 | Two terminals same command | Idempotent one effect |
| 11 | Cash received, ACK lost | Replay safe; one cash effect |
| 12 | Cloud receives same cash twice | Dedupe |
| 13 | Edge + Cloud conflicting writes | Epoch fencing; no LWW |
| 14 | Concurrent CashShift open | One wins; other DENY |
| 15 | Card/VietQR provider unavailable | UNKNOWN/PENDING; no SUCCESS/PCE fabricate |
| 16 | Fiscal sent, ACK unknown | TIMEOUT/UNKNOWN; not SATISFIED |
| 17 | LAN up, WAN down | Terminals→Edge continue |
| 18 | Edge server/DB fails | Local fail closed; no silent Cloud dual-write |
| 19 | KDS/print local | No double tickets on replay |
| 20 | Reconnect | Replay, reconcile, compensate per domain; audit |
| 21 | Forward clock skew on business_time / collected_at | Reject unbounded future |
| 22 | Grant forgery / signature rollback | Deny; audit |
| 23 | One-time offline grant replay | Deny second consume |
| 24 | L1 OperationalClose without L2/L3 | No revenue/fiscal finalization side effects |

### Sync egress categories (minimum — UNKNOWN until OFF-06)

| Direction | Likely categories | Certainty |
| --- | --- | --- |
| Cloud → Edge grants | Permission/scope codes, installation ids, policyVersion, expiry | PARTIAL — minimize per ADR-0043 |
| Edge → Cloud sync | Order/payment/cash/shift/inventory command facts; actor/terminal ids; business chronology; **not** Cloud PIN material | PARTIAL — Egress Gate or UNKNOWN+collect before live |

---

## 7. OFF-01 … OFF-10 minimal PR plan (dependency order)

| PR | Autonomy | Scope | Depends |
| --- | --- | --- | --- |
| **OFF-01** | C | This package Accept (0043/44/45) + counsel kickoff | — |
| **OFF-02** | B | Edge Runtime packaging skeleton + local Postgres migrate profile (no prod) | OFF-01 |
| **OFF-03** | B | DeviceIdentity / EdgeInstallation + enrollment APIs | OFF-01 |
| **OFF-04** | B | Offline PIN verifier + signed grants sync + Edge session | OFF-01, OFF-03 |
| **OFF-05** | B | WriterEpoch / fencing + LAN terminal auth | OFF-01, OFF-02, **OFF-03** |
| **OFF-06** | B | Sync outbox/inbox/cursor + idempotent ingest | OFF-05 |
| **OFF-07** | B | OperationalClose (L1) + keep CompleteOrder gate | OFF-01 Accept 0045 |
| **OFF-08** | B | EdgeReceiveCash + sync dedupe (if D3 Accepted) | OFF-04, OFF-06, 0045 |
| **OFF-09** | C/B | Fiscal queue/reconcile UX; still no fabricate; G2 separate | OFF-06, counsel |
| **OFF-10** | B | Adversarial suite 1–20 + chaos reconnect | OFF-06–09 |

Each implement PR: independent Architecture · FinSec · Privacy. **STOP** until PO GO per slice.

---

## 8. Review requirements

Before PO Accept of ADR-0043/44/45:

1. **Architecture** — ownership, L1/L3 split, fencing, shared domain, no CompleteOrder silent change  
2. **Financial Security** — cash/PCE, no fabricate card/VietQR/fiscal, idempotency, epoch, backup restore  
3. **Privacy (ADR-0015)** — Edge PII at rest, grant snapshots, TPM/keystore, egress when syncing  

---

## 9. STOP

No runtime, migrations, vendor activation, G2 claim, or merge as implementation authorization from this package alone.
