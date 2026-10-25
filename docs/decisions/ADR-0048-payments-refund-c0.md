# ADR-0048: Payments Refund (C0 CASH path) — Proposed

- **Status:** **PROPOSED** (non-authoritative; does not change Accepted rules or runtime)
- **Date:** 2026-10-25
- **Package alias:** **PAY-REFUND-C0**
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002; ADR-0013; ADR-0014 (fiscal correction chains — separate); ADR-0028 (refund ≠ rewrite Order commercial); ADR-0032 (abort ≠ refund); ADR-0036; ADR-0038 (refunds RELEASE-BLOCKING OPEN); ADR-0046; Proposed ADR-0047 (CashDrawerMovement)
- **Autonomy:** Level **C** docs only until Accept
- **Origin main at proposal:** `6b97f3dcb650882135d5e29450cdf14c622ab547`
- **Companion packet:** `docs/processes/review-packets/2026-10-25-cash13-refund-level-c-decision-packet.md`

---

## Authority map (this ADR)

| Class | Content |
| --- | --- |
| **EXISTING Accepted ADR** | 0013 non-custody + PCE ownership; 0038 cash refunds out of FISC1.1 / compensating ReceiveCash forbidden as refund; 0046 expected reserves `− Σ refunds` but implements none; 0028 refund alone must not rewrite Order commercial; 0032 abort ≠ void/refund |
| **PO ACCEPTED (product)** | Manager: cancellations/returns/discounts within grant/limit, above → Owner approval; close discrepancy immutable. POS-REFUND UI-161 Spec Accepted / Figma Partial — **API not Origin-verified** |
| **PROPOSED (this document)** | Payments-owned refund evidence linked to original Payment; CASH drawer effect once via `cash_shift_id`; no historical Payment/PCE/Fiscal/Revenue mutation |
| **OPEN / BLOCKED** | R1–R9; CARD/VietQR provider refund; fiscal correction TX coupling; voids; Accounting |

**STOP:** PROPOSED merge ≠ Accept. No refund runtime/migrations until Accepted revision + PO GO.

---

## Context

Origin Payments today:

- `ReceiveCash` → immutable PCE + SUCCESS Payment
- Lifecycle refuses SUCCEEDED → void without compensating architecture
- ADR-0038 lists cash refunds as RELEASE-BLOCKING OPEN
- ADR-0046 expected formula documents `− Σ confirmed CASH refunds` but CASH1.2 must not invent them

Product needs returns that leave cash from the **current OPEN drawer** without rewriting sale history or fiscal facts.

---

## Proposed decision (non-binding until Accept)

### D1. Ownership

**Payments** owns refund acceptance evidence and link to **original** Payment.  
**Cash** owns expected impact when instrument is CASH (via refund row’s `cash_shift_id` — **not** a parallel `CashDrawerMovement`).  
**Fiscalization** owns any fiscal correction document — **not** invented by this ADR’s Accept alone (R6).

### D2. Command sketch

```text
RecordCashRefund {
  originalPaymentId
  amountRefundedMinor
  currencyCode
  minorUnitExponent
  reasonText
  refundIdempotencyKey
  // cash_shift_id derived from Session Terminal OPEN shift — never client-trusted actor
}
```

### D3. Hard non-effects

- Do **not** UPDATE/DELETE original Payment amounts or SUCCEEDED lifecycle
- Do **not** mutate original PCE
- Do **not** rewrite Revenue / Order commercial (ADR-0028)
- Do **not** create/alter FiscalDocument in this package unless R6 Accept says otherwise
- Do **not** insert `CashDrawerMovement` for the same cash leave (ADR-0047 anti double-count)
- Do **not** apply CASH refund to a **CLOSED** CashShift

### D4. Expected impact (after Accept)

```text
− Σ amount_refunded_minor of SUCCEEDED CASH refunds where cash_shift_id = this shift
```

Exactly once. Exact minor units (ADR-0002).

### D5. Concurrency

Single transaction: lock original Payment `FOR UPDATE` → lock OPEN `cash_shift` `FOR UPDATE` → insert refund evidence → commit. Compatible with ReceiveCash `FOR SHARE` (waits) and Close `FOR UPDATE` (serialize). Idempotent key unique per LegalEntity.

### D6. Proposed permission

`payments.refund_cash` (+ `pos.operate` on POS). Over-limit / approve key — R8.

---

## PO decision matrix R1–R9

### R1 — Partial CASH refunds

| | |
| --- | --- |
| **Options** | (a) Full original amount only; (b) Partial ≤ remaining refundable; (c) Partial only with Manager grant |
| **Recommendation** | **(b)** with remaining tracked on refund ledger sum; pilot may start **(a)** to shrink surface |
| **Risks** | Partial without remaining invariant → over-refund; commercial line return deferred (ADR-0028 §13) |
| **Pilot** | Prefer **(a)** same-day full CASH refund of one Payment |
| **Impact** | Payments; Cash expected; Settlement coverage semantics TBD; Fiscal if R6 |
| **Requires PO?** | **Yes** |

### R2 — Open-shift only for CASH

| | |
| --- | --- |
| **Options** | (a) Current OPEN CashShift required; (b) Allow targeting prior OPEN/CLOSED with correction; (c) Allow closed-shift refund into next OPEN |
| **Recommendation** | **(a)** — matches ADR-0046 CLOSED immutable |
| **Risks** | (b)/(c) rewrite closed expected / forensic hole |
| **Pilot** | Same-shift refund only |
| **Impact** | Payments + Cash; not Fiscal by itself |
| **Requires PO?** | **Yes** if any exception to (a) |

### R3 — Cross-shift cash refund

| | |
| --- | --- |
| **Options** | (a) Forbidden in C0; (b) Manager exception with new correction aggregate; (c) Force reopen CLOSED (forbidden under 0046) |
| **Recommendation** | **(a)** |
| **Risks** | (c) breaks close immutability; (b) new Level C |
| **Pilot** | Next-day cash return = out of scope / manual out-of-system until later ADR |
| **Impact** | Cash Close invariants |
| **Requires PO?** | **Yes** only to override (a) |

### R4 — CARD / VietQR refund

| | |
| --- | --- |
| **Options** | (a) Same ADR with provider async; (b) Separate ADR after CASH path; (c) Out of C0 entirely |
| **Recommendation** | **(b)** — CASH drawer path first; electronic refund ≠ drawer expected |
| **Risks** | Mixing provider async with cash TX locks; claiming parity without provider GO |
| **Pilot** | CASH only |
| **Impact** | Payments + Integrations; Cash expected unchanged for CARD |
| **Requires PO?** | **Yes** for sequencing |

### R5 — Voids vs refunds

| | |
| --- | --- |
| **Options** | (a) Distinct commands (void pre-SUCCESS vs refund post-SUCCESS); (b) One “reverse payment” umbrella; (c) Defer voids |
| **Recommendation** | **(a)** + **(c)** for first pilot (refund SUCCESS only; void stays lifecycle reject) |
| **Risks** | Umbrella blurs Settlement abort (0032) and fiscal |
| **Pilot** | Refund SUCCEEDED CASH Payment only |
| **Impact** | Payments lifecycle; Settlement abort unchanged |
| **Requires PO?** | **Yes** if voids in same package |

### R6 — Fiscal correction coupling

| | |
| --- | --- |
| **Options** | (a) Same TX as refund; (b) Async fiscal correction required before refund SUCCEEDED; (c) Out of PAY-REFUND — separate FISC Level C; (d) Vietnam NOT_REQUIRED cafe path may omit until G2 |
| **Recommendation** | **(c)** for architecture purity; product may require **(b)** before claiming fiscal-safe refund UX |
| **Risks** | Shipping refund without fiscal plan → illegal e-invoice state; inventing FiscalDocument in Payments |
| **Pilot** | Explicit “fiscal follow-up OPEN” label; no fake fiscal success |
| **Impact** | Fiscalization ADR-0014; Payments must not own FiscalDocument |
| **Requires PO?** | **Yes** — blocking for finished C0 refund claim |

### R7 — Order / commercial rewrite

| | |
| --- | --- |
| **Options** | (a) Payment+drawer only (no Order mutation) — ADR-0028; (b) Line return + commercial correction same package; (c) Soft link OrderId without rewrite |
| **Recommendation** | **(a)** or **(c)**; **(b)** separate Level C |
| **Risks** | Silent Order rewrite breaks audit |
| **Pilot** | (a) |
| **Impact** | Orders out; Payments + Cash in |
| **Requires PO?** | **Yes** if merchandise return in-scope |

### R8 — Permission + over-limit

| | |
| --- | --- |
| **Options** | (a) `payments.refund_cash` only; (b) + `payments.refund_cash.approve` / Owner Approval over limit; (c) reuse Manager generic approval |
| **Recommendation** | **(b)** aligned with Manager Notion limits |
| **Risks** | Cashier unlimited refunds; overloading Task complete as approve (Gate0 forbid) |
| **Pilot** | (a) with Manager-only grant composition, or (b) if Approval ready |
| **Impact** | Identity + Payments; not TaskService payment approve |
| **Requires PO?** | **Yes** for keys + thresholds |

### R9 — Refund vs Settlement abort / unpaid cancel

| | |
| --- | --- |
| **Options** | (a) Strictly separate from Settlement abort (0032); (b) Abort may trigger auto-refund if cash already collected; (c) Conflate cancel UX |
| **Recommendation** | **(a)**; if cash already collected, require explicit RecordCashRefund — no silent abort→refund |
| **Risks** | Double money motion; orphan coverage |
| **Pilot** | Documented separate POS flows |
| **Impact** | Settlement + Payments + Cash |
| **Requires PO?** | **Yes** for abort+collected edge |

---

## Consequences if Accepted later

### Positive

- Closes ADR-0038 refund OPEN for narrow CASH path without fake compensating ReceiveCash
- Makes ADR-0046 expected subtraction real
- Preserves immutable Payment/PCE/Close evidence

### Negative / follow-ups

- Fiscal/CARD/partial commercial still Level C
- Cross-shift cash returns unsupported under R2/R3 recommendation
- UI POS-REFUND still needs API contract after Accept

### Explicitly out

- Accounting Engine; custody/wallet; gift cards; Document Engine; offline refund (0045)

---

## Acceptance checklist (for future Accept only)

- [ ] PO answers R1–R9 recorded
- [ ] Status → Accepted with date + main SHA
- [ ] Arch/DB/FinSec review of Accepted text
- [ ] Coordination with ADR-0047 Accept if expected includes both terms
- [ ] Level B runtime separately authorized

## STOP

**PROPOSED ≠ Accepted.** No PaymentRefund migration/service under this file alone. No change to live expected formula until Accept + Level B.
