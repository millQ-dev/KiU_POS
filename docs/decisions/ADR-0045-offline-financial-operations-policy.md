# ADR-0045: Offline Financial Operations Policy (ADR-OFFLINE-003)

- **Status:** **Accepted WITH DELTAS** (PO 2026-10-19) — Level C docs only
- **Alias:** ADR-OFFLINE-003
- **Date:** 2026-10-19
- **Origin main reconciled:** `33dad072e014158c6658546abcda5de38e87f4b2`
- **Related:** ADR-0010, ADR-0013, ADR-0014, ADR-0018, ADR-0032, ADR-0037, ADR-0038, ADR-0043/0044; FISC1.1 runtime; INTEGRATIONS-0 §2A; OFF-01 PR #90
- **LEVEL B GO:** **NOT ISSUED**
- **OFFLINE CASH PRODUCTION GO:** **NOT ISSUED**
- **LEGAL GATE G2:** **NOT ISSUED**
- **STOP:** No runtime, migrations, G2 claim, or merge-as-implement from this Accept alone

## Context

### Runtime conflict (do not silently remove) — PO delta #1

`CheckoutOrchestrator.tryAdvanceCheckout()` blocks CompleteOrder when fiscal gate is `UNAVAILABLE` / `PENDING` / `REQUIRED_NOT_SATISFIED` (`apps/api/src/modules/checkout/checkout-orchestrator.ts`). C0 FiscalPolicy must not authorize CompleteOrder with fiscal pending (ADR-0014 D15 / ADR-0037).

**Binding:** Preserve this gate. **Do NOT remove or bypass it** for offline. Any change to the meaning of `CompleteOrder` requires a **new** explicit Level C approval beyond this Accept.

### Product direction (Accepted)

- Orders and local kitchen execution continue while Edge is operational.
- Never fabricate provider-confirmed card or bank-transfer success.
- Never fabricate electronic invoice acceptance.
- Preserve distinct **operational**, **payment**, and **fiscal** states.
- High-risk ops fail closed when required authority unavailable.
- Offline permissions must never bypass mandatory safety, financial, or legal gates.
- LEGAL GATE **G2** remains independent (PO delta #7).

## Decision (Accepted WITH DELTAS)

### D1. Three completion layers (compatible with existing gate)

| Layer | Meaning | Offline Edge |
| --- | --- | --- |
| **L1 Operational service completion** | Order fulfilled / kitchen done / guest served — **not** legal sale finalization | May advance under Edge writer + grants |
| **L2 Payment collection** | Tender collected with evidence | CARD/VietQR: never fabricate SUCCESS; CASH: see D3 |
| **L3 Authoritative final completion** | Today's `CompleteOrder` via CheckoutOrchestrator — requires Settlement SATISFIED **and** FiscalCheckoutGate `SATISFIED` \| `NOT_REQUIRED` | **Unchanged** — fiscal gate preserved |

**Accepted Compatible Separation:**

```text
OperationalClose   -- L1 (kitchen/service done); does NOT call completeOrder
CompleteOrder      -- L3; KEEPS CheckoutOrchestrator fiscal gate
FiscalFinalize     -- provider issue / evidence / SATISFIED (queued offline, never fabricated)
```

Historical APIs that say `CompleteOrder` keep L3 meaning. **Do not** overload `CompleteOrder` to mean kitchen-done.

### D2. Offline operations matrix

Legend: **ALLOW** = Edge may execute locally · **QUEUE** = capture pending external · **DENY** = fail closed · **ONLINE** = requires Cloud/WAN · **G2** = production fiscal legal gate · **A4-OPEN** = ADR-0038 A4 unresolved for authoritative cash

| Operation | Offline Edge | Notes |
| --- | --- | --- |
| Open / modify Orders | ALLOW | Shared Orders domain; writer epoch + idempotency |
| Kitchen / KDS / local print | ALLOW | No double tickets on replay |
| CashShift open / continuation / close | ALLOW* / policy | Exclusive open; fencing required for financial mutations (ADR-0044) |
| Physical CASH **local evidence** | ALLOW evidence only | **≠** authoritative PCE — see D3; A4 remains OPEN |
| Authoritative CASH PCE / Cloud ReceiveCash | **A4-OPEN** / ONLINE | No offline cash production GO |
| Card payment SUCCESS | DENY fabricate | QUEUE UNKNOWN/PENDING |
| VietQR / BANK_TRANSFER SUCCESS | DENY fabricate | Not C0 PCE until I1-C |
| Refunds / voids / high-risk | DENY / ONLINE | ApprovalRequest; no standing offline privilege |
| Stock / production posting | ALLOW* | ADR-0010; DRAFT local; ≠ L3 |
| Fiscal document issue | QUEUE | Never fabricate acceptance |
| Production fiscal SATISFIED | **G2** + evidence | Unchanged |

### D3. Offline cash evidence vs authoritative PCE (PO deltas #2–#3)

**Binding:** ADR-0038 offline / late cash **A4 remains OPEN**. This Accept does **not** close A4 and does **not** authorize offline cash production.

| Concept | Meaning | May become authoritative PCE? |
| --- | --- | --- |
| **OfflineCashEvidence** (local) | Immutable Edge record: actor, shift, terminal, amounts, business time, humanConfirmation, idempotency, writer epoch — operational/audit capture | **No** — not by itself |
| **PaymentCollectionEvent** (`CASH_RECEIVE`) | Payments-owned authoritative collection clock for fiscal chronology (ADR-0013/0014/0038) | Only via **Accepted** online/server path (or a **future** Level C that closes A4) |
| Fiscal `collected_at` | Consumes authoritative PCE only | Never from OfflineCashEvidence alone; never invent |

```text
OfflineCashEvidence  --local-->  sync queue
       │
       ✗ does not mint PaymentCollectionEvent
       ✗ does not open FiscalCheckoutGate
       ✗ does not satisfy CompleteOrder (L3)

Authoritative ReceiveCash / CASH_RECEIVE PCE  --Cloud/server Accept path only while A4 OPEN
FiscalFinalize / SATISFIED  -- verified evidence + G2 for production
```

Future `EdgeReceiveCash → PCE` designs remain **Proposed sketches only** until A4 is closed by a separate PO Accept + offline cash production GO. Money parity / humanConfirmation requirements of ADR-0038 still apply to any future authoritative path.

**Isolation honesty:** remote revoke of grants while Edge is offline may leave residual local evidence capture ≤ grant TTL — does not authorize PCE minting.

### D4. Payment / fiscal state machine (offline-aware)

```text
Payment:        CREATED → … → SUCCEEDED | FAILED | UNKNOWN
                UNKNOWN when provider unreachable (card/VietQR) — never fabricate SUCCESS

OfflineCashEvidence:  local append-only; syncable; ≠ PCE

PCE:            absent | present (CASH_RECEIVE | CARD_PROVIDER_COLLECTION on C0)
                minted only on authoritative path; A4 OPEN for offline CASH

Settlement:     OPEN → SATISFIED | ABORTED   (coverage — not fiscal)

FiscalAttempt:  NOT_STARTED → QUEUED → SUBMITTED → TIMEOUT
                → SATISFIED | FAILED | UNKNOWN
                Never jump to SATISFIED without verified evidence

OperationalClose (L1): independent of FiscalAttempt and of PCE
CompleteOrder (L3): Settlement SATISFIED + Fiscal gate SATISFIED|NOT_REQUIRED
                    -- FAIL CLOSED if fiscal PENDING/UNAVAILABLE (gate preserved)
```

### D5. Vietnam legal / fiscal — OPEN (PO deltas #6–#7)

**LEGAL INTERPRETATION / OPEN** — counsel clearance **not** granted by this Accept:

1. Offline cash collection + paper/local receipt with **delayed** e-invoice under Law 108 / NĐ 254 / TT 91 / máy tính tiền.  
2. Maximum delay between collection and e-invoice transmission.  
3. Non-fiscal guest receipt vs e-invoice claims.  
4. Transitional NĐ 70 vs 254/91.  
5. Provider deferred/queued issue semantics.

**LEGAL GATE G2** remains mandatory for production fiscal success — **independent**; **NOT ISSUED**.

### D6. High-risk fail-closed

Offline grants/permissions **never** bypass: allergen hard blocks, ApprovalRequest when required, fiscal fabrication bans, non-custody (ADR-0013), inventory posting integrity (ADR-0010), writer fencing (ADR-0044), CheckoutOrchestrator fiscal gate.

### D7. Acceptance scope

**Accepted WITH DELTAS** freezes L1/L3 separation, ops matrix honesty, and D3 evidence≠PCE / A4 OPEN.

Does **not** change `tryAdvanceCheckout` code. Runtime `OperationalClose` or any A4-closing cash path requires separate Level B / Level C GOs.

## Consequences

- Kitchen/order continuity offline without promising fiscal finalization or authoritative cash PCE.  
- ADR-0038 **A4 stays OPEN** — offline cash production GO not issued.  
- Counsel + G2 remain blockers for production fiscal claims.

## Alternatives considered

- Remove fiscal gate from CompleteOrder for offline — **rejected** (PO delta #1).  
- Close A4 via this Accept — **rejected** (PO delta #2).  
- Treat OfflineCashEvidence as PCE — **rejected** (PO delta #3).  
- Fabricate card/VietQR/fiscal SUCCESS — **rejected**.  
- Treat kitchen-done as CompleteOrder — **rejected**.
