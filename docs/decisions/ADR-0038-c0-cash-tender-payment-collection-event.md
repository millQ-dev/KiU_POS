# ADR-0038: C0 Cash + Card PaymentCollectionEvent (FISC1.1 readiness)

- **Status:** **Accepted** (PO **ACCEPT WITH DELTAS** 2026-10-11)
- **Date:** 2026-10-11
- **Revised:** 2026-10-11 (PO review deltas A1–A8)
- **Accepted:** 2026-10-11 (PO ACCEPT WITH DELTAS — ChatGPT remediation deltas approved)
- **Runtime:** FISC1.1 Core Runtime implements narrow C0 CASH/CARD `PaymentCollectionEvent` + `ReceiveCash` under this ADR (migration `032`). Remaining A4 OPEN items: see `docs/processes/review-packets/fisc11-level-c-open-items.md`. LEGAL GATE G2 still required for Vietnam production go-live.
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0013 (Accepted + Chronology Delta 2026-10-11); ADR-0014 D13 / D32–D38 (Accepted; D37 superseded by this ADR for narrow C0 path); ADR-0016; ADR-0032; ADR-0036; ADR-0037 LC-08; CASH1.1 / PAY1.1 / FISC1.1 runtime
- **Autonomy (this ADR):** Level **C** (docs / architecture / contracts). Runtime implementation under Accepted ADRs is Level **B**.

---

## Context

Accepted Chronology Delta (ADR-0014 D32–D38 / ADR-0013) binds C0 fiscal business time to Payments-owned immutable `PaymentCollectionEvent.collected_at` from affirmed electronic-provider **collection** time, fail-closed, with no `received_at` / `satisfied_at` fallback. **D37** deferred CASH until a separate cash-receipt event.

PO **ACCEPT WITH DELTAS** (2026-10-11) binds:

- CASH and CARD as mandatory **core C0 tender capabilities**;
- authenticated `ReceiveCash` authorization and immutable collection evidence;
- exact tender/change Money calculation (gross ≠ Revenue/allocation/fiscal; change ≠ refund);
- immutable Payments-owned `PaymentCollectionEvent`;
- exactly one qualifying Payment + one fully covered Check (CASH XOR CARD);
- no fake fiscal success; no unsafe chronology fallback (`received_at` / `satisfied_at` / `created_at`);
- FISC Core staging ≠ finished C0 product release.

This ADR **supersedes ADR-0014 D37** for the narrow one-Payment / one-Check C0 path. Historical D37 text remains for chronology honesty.

---

## Decision (Accepted — PO ACCEPT WITH DELTAS)

### A1. Mandatory C0 tender capabilities vs FISC staging

```text
CASH  = mandatory core C0 tender capability
CARD  = mandatory core C0 tender capability (electronic provider-backed)
```

Product is **not C0 production-ready** if ordinary cash acceptance is unavailable.

**Do not confuse:**

| Track | Meaning |
| --- | --- |
| **FISC Core staging** | Narrow Fiscalization foundation (policy, document, gate, PaymentCollectionEvent consume) may land before full C0 release polish |
| **Finished C0 release** | Requires both CASH and CARD acceptance paths operational under Accepted rules |

Neither tender is a future/optional/premium add-on. Exact TenderDefinition codes remain configuration; architecture freezes instrument families and collection evidence rules.

### A2. Cash tender / change Money semantics (Accepted)

**Example (binding illustration):**

| Fact | Minor units (VND) |
| --- | --- |
| Payable / Check due | 65_000 |
| Cash tendered (gross) | 100_000 |
| Change returned | 35_000 |
| Net qualifying Payment / Check coverage | **65_000** |

**Rules:**

1. **Tendered gross must not** become Revenue, PaymentAllocation amount, or fiscal document amount.
2. **Net qualifying collection** for Payment / Settlement coverage = payable due (65_000), not tendered gross.
3. **Change must not** be modeled as a sale reversal, refund, compensating Payment, or negative Revenue.
4. Change is a **cash drawer / Cash-owned movement concern** (and/or operational UX fact), not a commercial sale mutation.
5. Fiscalization / Tax consume **payable / Tax snapshot** facts — never tendered gross as sale amount.

### A3. Authenticated `ReceiveCash`

Payments owns authenticated command:

```text
ReceiveCash
```

#### A3.1 Server-authoritative Money

| Fact | Rule |
| --- | --- |
| `amount_due_minor` | From Settlement/Check payable (server SoT) |
| `amount_tendered_minor` | Validated tendered cash (≥ due when change allowed; see A4 for no-change / invalid cases) |
| `change_minor` | Server-computed `tendered − due` when overpay path allowed; never client-trusted |
| Net Payment amount | Equals due (coverage), **not** tendered gross |

Client may propose tendered amount for UX; server validates and persists authoritative values.

#### A3.2 Human confirmation

Successful `ReceiveCash` requires authenticated operator confirmation that:

- physical cash was received; and
- change (if any) was returned / handled per frozen semantics.

Confirmation is part of the command acceptance evidence — not a client-only checkbox that invents SUCCESS without server accept.

#### A3.3 Context binding

Must bind:

- authenticated POS Session / actor (ADR-0036);
- Outlet + Terminal from Session/Organization scope;
- **OPEN CashShift** for that Terminal (CASH1.1);
- SettlementCheck / LegalEntity match.

#### A3.4 Semantic idempotency + immutable evidence

- Idempotency key scoped to LegalEntity (+ Check); duplicate **same key** returns same Payment / `PaymentCollectionEvent` (PAY1.1 semantic idempotency pattern).
- On success: Payment (CASH) to qualifying SUCCESS; immutable cash collection evidence; immutable `PaymentCollectionEvent`.
- Same Check must not generate duplicate qualifying Payments / collection events (A6).
- Runtime must enforce **durable uniqueness** for active qualifying CASH collection per Check (DB unique constraint and/or `IDEMPOTENCY_CONFLICT` / domain conflict — not best-effort only). Concurrent distinct keys for the same Check ⇒ fail closed to a single success.

#### A3.5 Cash `collected_at` clock

```text
PaymentCollectionEvent.collected_at (CASH)
  = server acceptance event clock of successful ReceiveCash
```

Document separately from any purported earlier physical hand-over time. Client **cannot** supply trusted `collected_at`. Client **cannot** fake SUCCESS / verification / Fiscal gate.

Purported earlier physical time (if ever captured for UX/diagnostics) is **non-authoritative** for fiscal business time.

### A4. Release-blocking / explicit OPEN matrix

Items below are either **frozen here** or marked **RELEASE-BLOCKING OPEN** — must not be silently invented at runtime, and must not be bypassed via manager role / ApprovalRequest backdoor.

| Topic | Status in this Accepted ADR |
| --- | --- |
| Cash authorization permission (dedicated ReceiveCash / tender permission) | **RELEASE-BLOCKING OPEN** (exact key name); manager role alone ≠ cash accept |
| Tendered/change validity (tendered ≥ due; non-negative; currency match) | **Frozen direction:** server validates; invalid ⇒ reject |
| No-change case (tendered == due) | **Frozen:** `change_minor = 0`; allowed |
| Exact overpay upper bounds / denomination UX | **RELEASE-BLOCKING OPEN** |
| Tips in same ReceiveCash | **RELEASE-BLOCKING OPEN** (default: tips ≠ fiscal due; ADR-0013 allocation if Accepted later) |
| Partial cash acceptance (tendered < due) | **RELEASE-BLOCKING OPEN** — default proposal: **reject** for FISC1.1 one-Payment shape |
| Cash refunds / voids / compensating ReceiveCash | **RELEASE-BLOCKING OPEN** — out of FISC1.1 |
| Concurrency (double ReceiveCash) | **Frozen direction:** serialize / fail closed → single success |
| Retries / idempotent replay | **Frozen:** semantic idempotency (A3.4) |
| Late / offline cash collection | **RELEASE-BLOCKING OPEN** — default proposal: production fail closed without server accept |
| CompleteOrder without fiscal evidence | **Frozen forbidden** (ADR-0037 / ADR-0014) |
| Manager ApprovalRequest as cash SUCCESS / fiscal SATISFIED backdoor | **Frozen forbidden** |
| ApprovalRequest / manager role as substitute for ReceiveCash permission | **Frozen forbidden** — dangerous-op approval ≠ tender acceptance credential |

### A5. CARD / provider collection time

Unchanged strict rule:

```text
PaymentCollectionEvent.collected_at (CARD)
  = provider_occurred_at of VERIFIED SUCCEEDED outcome
    that affirms ACTUAL COLLECTION/CAPTURE (receipt of funds)
```

Adapter must record provenance: `COLLECTION_OR_CAPTURE` vs `AUTHORIZATION` vs `UNKNOWN`. Only collection/capture may mint `PaymentCollectionEvent`.

**Never fallback to:** `received_at`, `settlement_group.satisfied_at`, `payment.created_at`, `payment.updated_at`, bare DB `NOW()`, fiscal ACK time.

Missing/untrusted ⇒ fail closed (no fiscalization).

### A6. Initial C0 narrow shape

```text
exactly one qualifying Payment (CASH XOR CARD)
+ exactly one SettlementCheck
+ Check fully covered by that Payment’s qualifying allocation
+ PaymentCollectionEvent present for that Payment
```

- **Not** cash+card together on the same Check in this scope.
- Multi-tender / split ⇒ **explicit blocked** fiscal state (not `NOT_REQUIRED`). Separate Level C.
- The same Check must **not** generate duplicate Payments / `PaymentCollectionEvent`s / fiscal intents for the same collection.

This Accept **amends** ADR-0014 D36/D37 for the narrow path (CASH in scope via `ReceiveCash`).

### A7. Ownership, drawer, gate, production policy

| Rule | Binding |
| --- | --- |
| Fiscalization | **Consumes** Payments-owned `PaymentCollectionEvent`; **never** creates Payment truth |
| Cash drawer movements | **Cash-owned**; must not double-count as Revenue / Payment / Fiscal amount |
| Cash accepted | **≠** FiscalCheckoutGate `SATISFIED` |
| Payment / collection recorded | CompleteOrder still blocked until fiscal gate satisfied |
| C0 FISC production | **ONLINE-ONLY** |
| LEGAL GATE G2 | Still required for Vietnam fiscal production go-live |
| Opening float | ≠ Payment / Revenue / Tax / Fiscal / `PaymentCollectionEvent` (ADR-0036) |

### A8. DEV / test cash evidence — production forbid

Aligned with ADR-0014 D28 / SEC-0:

- No production route may mint verified cash SUCCESS, fake `PaymentCollectionEvent`, or fiscal SATISFIED evidence.
- DEV/simulator cash paths (if any) must be **unregistered in production** (`NODE_ENV=production`); `ALLOW_DEV_*` must not re-enable them.
- Test fixtures may create evidence only inside test DB / non-production — never as a production HTTP surface.

---

## Proposed runtime / migration note (not in this PR)

Later Level B (after explicit Accept + FISC1.1 / Payments launch):

- Migration head today remains **031**; first unused remains **`032`**.
- May add `payment_collection_event`, cash collection evidence, provider provenance — **not in this PR**.

---

## Consequences

- D37 “CASH out of FISC1.1” superseded for the narrow one-Payment XOR path.
- C0 release readiness requires CASH+CARD capabilities; FISC Core staging alone ≠ finished C0.
- Tendered gross / change cannot corrupt Revenue, allocation, or fiscal amounts.
- RELEASE-BLOCKING OPEN items must be closed before claiming C0 cash production-ready.
- Runtime / migration `032` / FISC1.1 implementation still require separate explicit launch after Origin merge authorization.

## Alternatives considered

- Stage FISC Core and call C0 done without cash — **rejected** (A1).
- Treat tendered gross as Payment/Revenue — **rejected** (A2).
- Client-supplied `collected_at` / SUCCESS — **rejected** (A3).
- Manager role backdoor for cash/fiscal — **rejected** (A4).
- CARD fallback to `received_at` / `satisfied_at` — **rejected** (A5 / Accepted Chronology).
- Silent multi-tender — **rejected** (A6).

## Binding Accept checklist (PO / ChatGPT)

| Requirement | Binding |
| --- | --- |
| CASH + CARD mandatory C0 tenders | A1 |
| ReceiveCash authorization + evidence | A3, A4, A8 |
| Exact Money tender/change | A2 (`due` / `tendered` / `change`; net coverage = due) |
| Immutable PaymentCollectionEvent | A3.4, A5, A7 |
| One Payment / one fully covered Check | A6 (XOR; no duplicates) |
| No fake fiscal success | A4, A7, A8 |
| No unsafe chronology fallback | A5 (CARD); A3.5 (CASH server clock) |

## Reviews required before merge authorization

- Architecture
- Financial / Domain
- Security
