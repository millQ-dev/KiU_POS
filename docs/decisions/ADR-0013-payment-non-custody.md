# ADR-0013: Payment Non-Custody Boundary

- **Status:** Accepted (Architecture v1.3) — **PaymentCollectionEvent Chronology Delta Accepted**
- **Date:** 2026-09-04
- **Accepted:** 2026-09-12 (PO ACCEPT WITH MVP BOUNDARY)
- **Accepted (Chronology Delta):** 2026-10-11 (PO ACCEPT WITH DELTAS — companion to ADR-0014 D32–D38; docs only)
- **Decision owners:** Product Owner and System Architect
- **Related:** Architecture v1.3, Payments module, ADR-0014, ADR-0016, ADR-0032, ADR-0037

## Context

Restaurant POS systems record tenders. Becoming a payment intermediary or custodian of merchant/customer funds creates regulatory and operational scope MillQ must not enter on MVP.

Fiscalization (ADR-0014) requires a trustworthy **PAYMENT COLLECTION EVENT** clock for C0. That clock is Payments-owned evidence of actual collection — not Settlement orchestration time and not MillQ ingest time.

## Decision

### MVP non-custodial freeze

- **MillQ MVP is non-custodial.**
- MillQ does **not** hold merchant funds or customer funds.
- MillQ does **not** provide a **wallet** or **internal money balance** as product SoT.
- MillQ does **not** act as a payment intermediary / money transmitter on MVP.
- Payments module records **provider outcomes, allocations, reconciliation evidence, and references only** (`TenderDefinition`, `Payment`, `PaymentAllocation`, statuses, external refs).
- Provider settlement happens at the payment provider / acquirer / merchant account; MillQ does not custody those funds.

Cash in drawer remains Cash Management documents (in/out), not a MillQ wallet balance of customer money.

### Accepted Chronology Delta — `PaymentCollectionEvent` (2026-10-11)

Payments owns immutable **`PaymentCollectionEvent`**:

- authoritative `collected_at` = time of actual payment **collection**;
- immutable reference to proving evidence (for electronic provider tenders: VERIFIED `SUCCEEDED` `payment_provider_outcome` whose `provider_occurred_at` is affirmed as **collection** time — not authorization, not operation-create);
- Fiscalization consumes this event; Payments does not invent fiscal SATISFIED.

**Forbidden as `collected_at`:** `received_at` (KiU learned), `settlement_group.satisfied_at` (coverage complete), `payment.created_at`, bare DB `NOW()`, fiscal submission/ACK clocks.

**Missing trustworthy collection time:** no `PaymentCollectionEvent` → Fiscalization fail closed (ADR-0014 D35).

**CASH:** provider collection chronology is **not** universal. CASH needs a separate Accepted cash-receipt / drawer collection event before it may drive `collected_at`. Out of FISC1.1 until then.

**FISC1.1 shape (Payments side):** support creating at most one `PaymentCollectionEvent` path for C0 electronic tender where exactly one Payment fully covers exactly one SettlementCheck. Multi-payment / split → explicit blocked (no fabricated collection event).

This Chronology Delta is **docs only**. It does not create runtime tables in this PR.

### Explicitly in / out of MVP scope

| Topic | MVP stance |
| --- | --- |
| **Tips** | May be represented/accounted as **payment allocation**. MillQ does **not** custody tip funds. |
| **Deposits / prepayments** | May be **recorded** when funds are received through an **external** provider / merchant account. **No** MillQ-held balance. |
| **Gift cards / stored-value instruments** | **OUT OF SCOPE** pending a **separate ADR + legal/accounting** decision. |
| **Marketplace settlement / collecting funds for later distribution** | **OUT OF SCOPE** pending a **separate ADR + legal** review. |

## Consequences

- Architecture must not introduce customer wallet ledgers or merchant balance accounts as Core SoT for MVP.
- QR/card flows are adapter + Payment records.
- Tips/deposits modeling must not smuggle custody or internal balances.
- Gift cards and marketplace collection require future ADRs before design or implementation.
- C0 fiscal business time binds to Payments `PaymentCollectionEvent.collected_at` (ADR-0014 D32–D38); ingest and Settlement clocks remain non-authoritative for that fact.
- Future FISC1.1 / Payments runtime must not invent `collected_at` when provider evidence cannot affirm actual collection.

## Alternatives considered

- In-app wallet / escrow — rejected for MVP.
- MillQ as payment aggregator / marketplace collector — rejected for MVP (separate ADR if ever revisited).
- Gift cards as MVP Payments feature — rejected (separate ADR/legal/accounting).
- Use `received_at` or `satisfied_at` as fiscal collection time — rejected (PO ACCEPT WITH DELTAS 2026-10-11).
- Treat provider collection time as universal for CASH — rejected (separate cash-receipt event required).
