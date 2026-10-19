# ADR-0045: Offline Financial Operations Policy (ADR-OFFLINE-003)

- **Status:** **Proposed** (Level C — docs only)
- **Alias:** ADR-OFFLINE-003
- **Date:** 2026-10-19
- **Origin main reconciled:** `33dad072e014158c6658546abcda5de38e87f4b2`
- **Related:** ADR-0010, ADR-0013, ADR-0014, ADR-0018, ADR-0032, ADR-0037, ADR-0038, Proposed ADR-0043/0044; FISC1.1 runtime; INTEGRATIONS-0 §2A
- **STOP:** No runtime, migrations, G2 claim, or merge-as-implement

## Context

### Runtime conflict (do not silently remove)

`CheckoutOrchestrator.tryAdvanceCheckout()` blocks CompleteOrder when fiscal gate is `UNAVAILABLE` / `PENDING` / `REQUIRED_NOT_SATISFIED` (`apps/api/src/modules/checkout/checkout-orchestrator.ts`). C0 FiscalPolicy must not authorize CompleteOrder with fiscal pending (ADR-0014 D15 / ADR-0037).

**Do NOT simply remove this gate.** Any change to the meaning of `CompleteOrder` requires **explicit Level C approval** (this ADR or a named Amendment).

### Product proposals (PO)

- Orders and local kitchen execution continue while Edge is operational.
- Physical CASH may be recorded locally with authorized actor, Shift, Terminal, amount, business time, immutable evidence, idempotency.
- Never fabricate provider-confirmed card or bank-transfer success.
- Never fabricate electronic invoice acceptance.
- Preserve distinct **operational**, **payment**, and **fiscal** states.
- High-risk ops fail closed when required authority unavailable.
- Offline permissions must never bypass mandatory safety, financial, or legal gates.
- LEGAL GATE **G2** remains independent.

## Decision (Proposed)

### D1. Three completion layers (compatible with existing gate)

| Layer | Meaning | Offline Edge |
| --- | --- | --- |
| **L1 Operational service completion** | Order fulfilled / kitchen done / guest served — **not** legal sale finalization | May advance under Edge writer + grants |
| **L2 Payment collection** | Tender collected with evidence (PCE when required) | CASH: local record per D3; CARD/VietQR: never fabricate SUCCESS |
| **L3 Authoritative final completion** | Today's `CompleteOrder` via CheckoutOrchestrator — requires Settlement SATISFIED **and** FiscalCheckoutGate `SATISFIED` \| `NOT_REQUIRED` | **Unchanged for C0** unless this ADR Accepts a named rename/split |

**Proposed Compatible Separation (requires Accept):**

```text
OperationalClose   -- NEW name for L1 (kitchen/service done); does NOT call completeOrder
CompleteOrder      -- REMAINS L3; keeps fiscal gate; may stay online-only for C0
FiscalFinalize     -- provider issue / evidence / SATISFIED (queued offline, never fabricated)
```

Historical documents and APIs that say `CompleteOrder` keep L3 meaning until an explicit migration Accept. **Do not** overload `CompleteOrder` to mean kitchen-done.

### D2. Offline operations matrix

Legend: **ALLOW** = Edge may execute locally · **QUEUE** = capture pending external · **DENY** = fail closed · **ONLINE** = requires Cloud/WAN · **G2** = production fiscal legal gate

| Operation | Offline Edge | Notes |
| --- | --- | --- |
| Open / modify Orders | ALLOW | Shared Orders domain; writer epoch + idempotency |
| Kitchen / KDS / local print | ALLOW | No double tickets on replay (scenario 19) |
| CashShift open | ALLOW* | *Exclusive open per Terminal/policy; concurrent open DENY (scenario 14) |
| CashShift continuation | ALLOW | Within OPEN shift + grants |
| CashShift close | ALLOW* / ONLINE | *If policy requires Cloud reconcile — Product; default proposal: local close with sync reconcile |
| Physical CASH collection | ALLOW | Immutable local evidence; see D3 |
| Card payment SUCCESS | DENY fabricate | QUEUE unknown / PENDING provider; no PCE until affirmed collection |
| VietQR / BANK_TRANSFER SUCCESS | DENY fabricate | Same; **not C0 PCE** until I1-C (INTEGRATIONS-0 §2A) |
| Refunds / voids / discounts | DENY high-risk / ALLOW limited | Dangerous ops need ApprovalRequest → typically ONLINE or pre-cached one-time grant (not standing privilege) |
| Compensating transactions | QUEUE | After sync; domain rules; no LWW |
| Stock / production posting | ALLOW* | *DRAFT local; POSTED rules per ADR-0010; provisional valuation OK offline |
| Owner ApprovalRequest | ONLINE* | *Unless pre-issued one-time grant consumed; no self-approval bypass |
| Manager approvals | ONLINE* | Same |
| Fiscal document issue | QUEUE | Never fabricate acceptance |
| Fiscal void / correction | ONLINE / QUEUE | Fail closed without authority + evidence |
| Fiscal reconciliation | ONLINE | After reconnect |
| Production fiscal SATISFIED | G2 + evidence | Unchanged |

### D3. Offline CASH evidence (Proposed — conflicts with ADR-0038 A4 OPEN)

ADR-0038 A4: late/offline cash **RELEASE-BLOCKING OPEN**; default proposal was fail closed without server accept. This ADR proposes (PO Accept required):

```text
EdgeReceiveCash {
  actor_id, cash_shift_id, terminal_id, edge_installation_id,
  legal_entity_id, settlement_check_or_payment_binding,
  -- ADR-0038 Money parity (server/Edge domain compute — not bare client amount alone):
  amount_due, amount_tendered, change_computed,
  currency,
  humanConfirmation,   -- required (ADR-0038 A3.2); operator attestation
  business_time,       -- Edge trusted clock: rollback + forward-skew bounds (ADR-0043)
  idempotency_key = {terminalId}:{clientCommandId},
  semantic_fingerprint,
  evidence_hash, writer_epoch, fencing_token
}
→ local Payment + CASH_RECEIVE PCE candidate (kinds unchanged until Accept)
→ collected_at = Edge-affirmed collection business time under clock policy
→ sync to Cloud ingest (must validate all of):
   fencing/epoch continuity, OPEN shift, LE/Check binding,
   Money parity, humanConfirmation present, fingerprint match,
   idempotent dedupe (scenarios 11–12)
```

Cloud must **not** invent a second cash effect on replay. Client-supplied `collected_at` remains forbidden on Cloud-only ReceiveCash path (runtime today).

**Revocation window honesty:** With revoke-on-next-sync, a remote revoke may leave up to grant TTL of local CASH possible — Product Accept of 72h must acknowledge this residual risk (scenario 3).

**Fiscal:** Local CASH PCE does **not** imply FiscalCheckoutGate SATISFIED offline. Fiscal remains queued / pending until provider evidence (and G2 for production).

**Inventory / write-off:** Offline stock/production posting remains ADR-0010-disciplined. `offline-foundation.md` “queue write-off” does **not** imply L3 CompleteOrder or revenue finalization — L1 OperationalClose ≠ L3.

### D4. Payment / fiscal state machine (offline-aware)

```text
Payment:        CREATED → … → SUCCEEDED | FAILED | UNKNOWN
                UNKNOWN reserved when provider unreachable (card/VietQR)

PCE:            absent | present (CASH_RECEIVE | CARD_PROVIDER_COLLECTION only on C0)
                BANK_TRANSFER_* forbidden until I1-C Accept

Settlement:     OPEN → SATISFIED | ABORTED   (coverage — not fiscal)

FiscalAttempt:  NOT_STARTED → QUEUED → SUBMITTED → TIMEOUT
                → SATISFIED | FAILED | UNKNOWN
                Never jump to SATISFIED without verified evidence

OperationalClose (Proposed): independent of FiscalAttempt
CompleteOrder (L3): requires Settlement SATISFIED + Fiscal gate SATISFIED|NOT_REQUIRED
                    -- C0: keep fail-closed if fiscal PENDING/UNAVAILABLE
```

### D5. Vietnam legal / fiscal — unresolved (counsel required)

**LEGAL INTERPRETATION / OPEN** — do not invent permissions:

1. Whether offline **cash collection + paper/local receipt** with **delayed** e-invoice under Law 108 / NĐ 254 / TT 91 / máy tính tiền is permissible for KiU merchants.
2. Maximum delay between collection and e-invoice transmission.
3. Whether Edge may print a non-fiscal guest receipt without claiming e-invoice.
4. Interaction with transitional NĐ 70 cohort vs future-only 254/91.
5. Provider (e.g. Viettel) confirmation of deferred/queued issue semantics.

**LEGAL GATE G2** remains mandatory for production fiscal success — independent of this ADR.

### D6. High-risk fail-closed

Offline grants/permissions **never** bypass: allergen hard blocks (where configured), ApprovalRequest when required, fiscal fabrication bans, non-custody (ADR-0013), inventory posting integrity (ADR-0010), writer fencing (ADR-0044).

### D7. Acceptance scope

Accepting this ADR:

- Freezes L1/L2/L3 separation language and the ops matrix.
- Does **not** by itself change `tryAdvanceCheckout` code.
- Runtime change to introduce `OperationalClose` or alter CompleteOrder requires a **follow-on Level B** after Accept + tests.

## Consequences

- Product can promise kitchen/order continuity offline without promising fiscal finalization.
- ADR-0038 A4 offline cash OPEN must be closed by Accept or explicit reject of D3.
- Counsel package required before production Edge fiscal claims.

## Alternatives considered

- Remove fiscal gate from CompleteOrder for offline — **rejected** without Level C + legal evidence.
- Fabricate card/VietQR SUCCESS offline — **rejected**.
- Treat kitchen-done as CompleteOrder — **rejected** (semantic overload).
- Wait for always-online only — rejected for Edge product tier.
