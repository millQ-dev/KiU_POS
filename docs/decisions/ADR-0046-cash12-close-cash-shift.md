# ADR-0046: CASH1.2 CloseCashShift (C0 cash drawer close)

- **Status:** **Accepted** (PO **ACCEPT WITH DELTAS** 2026-10-25)
- **Date:** 2026-10-25
- **Accepted:** 2026-10-25 (PO answers 1–7 + mandatory invariants; ChatGPT/agent Level C preflight)
- **Package alias:** **CASH1.2**
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002 (Money); ADR-0036 (CashShift lifecycle / auth evidence); ADR-0038 (CASH PCE / ReceiveCash; refunds RELEASE-BLOCKING OPEN); CASH1.1 Open (`029`); FISC1.1 PCE (`032`); domain-module-map Cash Management
- **Autonomy (this ADR):** Level **C**. Runtime under this Accepted ADR is Level **B**.
- **Origin main at Accept:** `d18063f0c53d97cb2562f980f49efd75007adf40`

---

## Context

CASH1.1 delivered canonical `cash_shift` + `OpenCashShift` only. Status enum already allows `CLOSED` / `RECONCILED` / `ACCEPTED`, but close columns, commands, and grants were absent. Gate0 and Manager Notion product behavior require close with immutable discrepancy evidence.

PO Level C preflight produced blockers on expected formula, state machine, shortage/surplus grants, and CASH-only scope. This ADR freezes the Accepted answers.

### Notion / PO product anchors

| Ref | Meaning |
| --- | --- |
| **PO 21А** | Expected cash = opening + confirmed CASH collections − confirmed CASH refunds; C0 refunds not implemented → implementable expected = opening + Σ qualifying CASH PCE (no fake refunds) |
| **PO 22Б** | State machine for CASH1.2 = `OPEN → CLOSED` only; RECONCILED/ACCEPTED deferred |
| Manager cabinet (ACCEPTED) | Close with count/reason; discrepancy immutable; no кассы “подгонка” |
| Backoffice shortage narrative | Shortage is an exception path — not cashier self-absolution |

---

## Decision (Accepted — PO ACCEPT WITH DELTAS)

### D1. Expected cash (PO #1 / 21А)

```text
expected = opening_amount_minor
         + SUM(amount_collected_minor of qualifying CASH PaymentCollectionEvents)
         − SUM(confirmed CASH refunds)   // C0: none exist; do not invent
```

**Implementable C0 formula (binding until refunds Accepted):**

```text
expected = opening_amount_minor
         + SUM(pce.amount_collected_minor)
```

where each PCE:

- `collection_evidence_kind = 'CASH_RECEIVE'`;
- joins `payment_cash_collection_evidence` with `cash_shift_id =` this shift;
- uses **`amount_collected_minor`** (net collected), **never** `amount_tendered_minor` / gross.

**Fail closed** if any included PCE/evidence has currency/exponent ≠ OPEN shift, or amount not a non-negative digit string.

CARD / VietQR / other instruments **must not** increase expected (PO #7 / Scope A).

Cash refunds and mid-shift cash-in/out are **out of CASH1.2**. Do not claim operational support.

### D2. State transition (PO #2 / 22Б)

```text
OPEN → CLOSED
```

only. `RECONCILED` / `ACCEPTED` remain reserved; no CASH1.2 command advances them.

### D3. Signed difference & actual (invariants)

```text
difference = actual − expected   // exact integer minor units (BigInt / numeric TEXT)
```

- `actualAmountMinor` ≥ 0 digit string; currency + exponent must match OPEN.
- Client may send `expectedAmountMinor` only for **conflict detection**; server expected wins. Client `difference` / `actor` / grants are never trusted.
- If `difference ≠ 0`, non-empty `reasonText` is **mandatory**.
- Variance kind (server): `BALANCED` | `SURPLUS` | `SHORTAGE`.

### D4. Permission matrix (PO #3–6)

| Case | Required grants (server-authoritative AccessGrant, outlet+terminal scope) |
| --- | --- |
| Balanced (`difference = 0`) | `pos.operate` **and** `cash_shift.close` |
| Surplus (`difference > 0`) | `pos.operate` **and** `cash_shift.close` + mandatory `reasonText` |
| Shortage (`difference < 0`) | `cash_shift.close.shortage` only (Manager/Owner path). **No** cashier bypass via `cash_shift.close` alone |

Reconciliation / accept permissions: **deferred**.

### D5. Command contract

```text
CloseCashShift {
  cashShiftId
  actualAmountMinor
  currencyCode
  minorUnitExponent
  reasonText?              // required iff server difference ≠ 0
  closeIdempotencyKey
  expectedAmountMinor?     // optional client echo; mismatch → EXPECTED_MISMATCH
}
```

Server writes immutable close evidence on the CashShift row (or equivalent 1:1 close evidence owned by Cash):

- expected, actual, signed difference, variance kind
- closed_by_user_id (+ optional employee snapshot)
- reasonText (nullable only when balanced)
- closed_at (server clock)
- close_idempotency_key
- expected_source_refs (PCE ids used in the sum)

### D6. Concurrency / idempotency

- Close locks `cash_shift` **`FOR UPDATE`**.
- Existing `ReceiveCash` locks the OPEN shift **`FOR SHARE`** — close waits for in-flight ReceiveCash; after CLOSED, ReceiveCash fails (`CASH_SHIFT_NOT_OPEN`).
- One close per shift. Idempotent retry: same `closeIdempotencyKey` + matching semantics → return existing CLOSED. Different semantics → `IDEMPOTENCY_CONFLICT`.
- Concurrent distinct close attempts: at most one winner.

### D7. Non-effects

Close **must not** create/mutate: Payment, Settlement, FiscalDocument, Revenue, Session, Inventory.

### D8. Schema (CASH1.2 migration)

Extend `cash_shift` with nullable-until-close columns; CHECK that `status = 'CLOSED'` implies close fields present and coherent; unique `(tenant_id, close_idempotency_key)` when key set; protect close history from mutation after CLOSED.

Insert permissions:

```text
cash_shift.close
cash_shift.close.shortage
```

---

## Consequences

### Positive

- Unblocks C0 drawer close under Accepted Money/PCE rules
- Separates cashier surplus/balanced close from shortage exception grant
- Preserves ReceiveCash concurrency model (SHARE vs UPDATE)

### Negative / follow-ups

- Expected ignores future refunds / cash-in/out until separate Level C + tests
- RECONCILED/ACCEPTED and accounting acceptance remain later packages
- UI (SH-02) not in this ADR runtime scope

### Explicitly out of scope

- Persistent DB migrate/deploy from this ADR alone
- Cash refund events; mid-shift cash movement; Document Engine; aggregators; PR #91
- Offline close (ADR-0045) without separate GO

---

## Acceptance checklist

- [x] Expected = opening + Σ CASH PCE `amount_collected_minor` (no fake refunds)
- [x] OPEN → CLOSED only
- [x] Shortage requires `cash_shift.close.shortage`
- [x] Surplus/balanced: `pos.operate` + `cash_shift.close`; reason if ≠ 0
- [x] Server-authoritative expected/difference/actor/grants
- [x] FOR UPDATE vs ReceiveCash FOR SHARE documented
- [x] No Payments/Settlement/Fiscal/Session mutation
- [x] PO 21А / 22Б cited

## STOP

Runtime Level B may proceed only under this Accepted ADR. New financial semantics → new Level C.
