# ADR-0048: Payments Refund (C0 CASH path) — Proposed

- **Status:** **PROPOSED** (non-authoritative; does not change Accepted rules or runtime)
- **Date:** 2026-10-25
- **Package alias:** **PAY-REFUND-C0**
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002; ADR-0013; ADR-0014 (fiscal correction chains — separate); ADR-0028 (refund ≠ rewrite Order commercial); ADR-0032 (abort ≠ refund); ADR-0036; ADR-0038 (refunds RELEASE-BLOCKING OPEN); ADR-0046; Proposed ADR-0047 (CashDrawerMovement)
- **Autonomy:** Level **C** docs only until Accept
- **Origin main at proposal:** `6b97f3dcb650882135d5e29450cdf14c622ab547`
- **Companion packets:** `docs/processes/review-packets/2026-10-25-cash13-refund-level-c-decision-packet.md`; **F4Б reconciliation** `docs/processes/review-packets/2026-10-25-cash13-refund-po-f4b-reconciliation.md`
- **Revised (PROPOSED delta):** 2026-10-25 — reconcile R1/R3/R4/R6/R7 with PO-20261025-C0-F4 / F4Б (partial refund mandatory for pilot)

---

## Authority map (this ADR)

| Class | Content |
| --- | --- |
| **EXISTING Accepted ADR** | 0013 non-custody + PCE ownership; 0014 fiscal + LEGAL GATE G2; 0038 cash refunds out of FISC1.1 / compensating ReceiveCash forbidden as refund; 0046 expected reserves `− Σ refunds` but implements none; 0028 refund alone must not rewrite Order commercial; 0032 abort ≠ void/refund |
| **PO ACCEPTED (product)** | Manager: cancellations/returns/discounts within grant/limit, above → Owner approval; close discrepancy immutable. POS-REFUND UI-161 Spec Accepted / Figma Partial — **API not Origin-verified**. **PO-20261025-C0-F4 / F4Б:** partial monetary refund after paid **COMPLETED** Order is **mandatory** for first pilot ([Notion](https://app.notion.com/p/40430d51715181d1b2adf41282cc41db)) |
| **PROPOSED (this document)** | Payments-owned refund evidence linked to original Payment; CASH drawer effect once via **current OPEN** `cash_shift_id`; no historical Payment/PCE/Fiscal/Revenue mutation; R3 option D; soft Order/line refs |
| **OPEN / BLOCKED** | Remaining owner choices (R3 Accept D, R5, R8, …); VietQR refund capability gate; LEGAL GATE G2 + fiscal correction execution policy; Accounting |

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
`cash_shift_id` is always the **current OPEN** shift that pays out cash (see R3-D) — never a rewrite of a CLOSED shift’s frozen expected.

### D4b. Remaining refundable (after Accept; F4Б)

```text
remaining = original_payment_qualifying_amount
          − Σ SUCCEEDED refunds on that payment
```

Partial refund amounts must be `> 0` and `≤ remaining`. Fail closed otherwise.

### D5. Concurrency

Single transaction: lock original Payment `FOR UPDATE` → lock **current OPEN** `cash_shift` `FOR UPDATE` → insert refund evidence → commit. Compatible with ReceiveCash `FOR SHARE` (waits) and Close `FOR UPDATE` (serialize). Idempotent key unique per LegalEntity. Do **not** lock or mutate CLOSED shift rows for expected rewrite.

### D6. Proposed permission

`payments.refund_cash` (+ `pos.operate` on POS). Over-limit / approve key — R8.

---

## PO decision matrix R1–R9

### R1 — Partial CASH refunds

| | |
| --- | --- |
| **Options** | (a) Full original amount only; (b) Partial ≤ remaining refundable; (c) Partial only with Manager grant |
| **Authority** | **PO ACCEPTED (F4Б)** supersedes prior pilot-(a) shrink |
| **Recommendation** | **(b)** mandatory for first pilot — remaining = original qualifying − Σ SUCCEEDED refunds; optional Manager grant composition is R8, not a substitute for partial |
| **Risks** | Partial without remaining invariant → over-refund; do not invent line commercial return here (R7) |
| **Pilot** | Partial monetary refund on paid COMPLETED Order path (F4Б) |
| **Impact** | Payments; Cash expected on **current** OPEN shift; Fiscal if R6 |
| **Requires PO?** | **No further** for “partial vs full-only” — F4Б closed that ask. Thresholds → R8 |

### R2 — Drawer payout shift (OPEN required)

| | |
| --- | --- |
| **Options** | (a) Cash leaves **current OPEN** CashShift only; (b) Rewrite prior CLOSED expected; (c) Pay into next OPEN without binding current |
| **Recommendation** | **(a)** — required for R3-D; matches ADR-0046 CLOSED immutable |
| **Risks** | (b) forensic hole; (c) unbound drawer |
| **Pilot** | Always bind refund.cash_shift_id to current OPEN |
| **Impact** | Payments + Cash |
| **Requires PO?** | Only if rejecting (a) |

### R3 — Historical original Payment / cross-shift

| | |
| --- | --- |
| **Options** | (a) Forbidden if Payment’s collection shift ≠ current OPEN; (b) Manager correction aggregate; (c) Force reopen CLOSED (**forbidden** under 0046); **(d)** Historical original Payment **allowed**; CASH paid from **current OPEN**; original CLOSED shift **immutable** |
| **Recommendation** | **(d)** — enables post-close customer return without rewriting closed expected; pairs with F4Б |
| **Risks** | Operator confusion (which drawer lost cash); must not double-count or touch CLOSED evidence |
| **Pilot** | Allow refund of yesterday’s Payment from today’s OPEN drawer |
| **Impact** | Cash Close immutability preserved; Payments links historical Payment |
| **Requires PO?** | **Yes** — confirm **(d)** vs keep **(a)** |

### R4 — CARD / VietQR refund

| | |
| --- | --- |
| **Options** | (a) Same ADR with provider async; (b) Separate ADR after CASH path; (c) Out of C0 entirely |
| **Recommendation** | **(b)** for CARD **runtime**; **pilot-complete gate:** verified VietQR refund **capability/method** documented fail-closed (external provider) before declaring first pilot complete — even if implementation is a later ADR |
| **Risks** | Claiming pilot complete with unverified VietQR refund; mixing provider async into cash TX |
| **Pilot** | CASH path implements; VietQR capability **verified** as checklist item |
| **Impact** | Payments + Integrations; Cash expected unchanged for electronic |
| **Requires PO?** | Sequencing + pilot-complete definition **Yes** |

### R5 — Voids vs refunds

| | |
| --- | --- |
| **Options** | (a) Distinct commands (void pre-SUCCESS vs refund post-SUCCESS); (b) One “reverse payment” umbrella; (c) Defer voids |
| **Recommendation** | **(a)** + **(c)** for first pilot (refund SUCCESS only; void stays lifecycle reject) |
| **Risks** | Umbrella blurs Settlement abort (0032) and fiscal |
| **Pilot** | Refund SUCCEEDED Payment only (partial per R1) |
| **Impact** | Payments lifecycle; Settlement abort unchanged |
| **Requires PO?** | **Yes** if voids in same package |

### R6 — Fiscal correction coupling

| | |
| --- | --- |
| **Options** | (a) Same TX as refund; (b) Async fiscal correction required before refund SUCCEEDED; (c) Out of PAY-REFUND — separate FISC Level C; (d) Omit until G2 |
| **Recommendation** | **Ownership (c):** Fiscalization owns FiscalDocument / correction chains (ADR-0014). **Execution policy OPEN:** name Vietnam **LEGAL GATE G2** + correction workflow before claiming fiscal-safe refund UX. Money/drawer refund MUST NOT invent fiscal SATISFIED |
| **Risks** | Illegal e-invoice state; Payments writing Fiscal tables; fake success UX |
| **Pilot** | Explicit fiscal-follow-up OPEN; no fabricated fiscal success |
| **Impact** | Fiscalization; Legal G2; Payments non-owner |
| **Requires PO?** | **Yes** for execution timing; **G2** is external legal gate |

### R7 — Order / commercial / inventory

| | |
| --- | --- |
| **Options** | (a) Payment+drawer only (no Order fields); (b) Line return + commercial/inventory correction same package; (c) Soft OrderId / line refs **without** rewriting historical commercial or inventory |
| **Recommendation** | **(c)** — supports F4Б COMPLETED Order context without ADR-0028 / GoodsIssue mutation |
| **Risks** | (b) silent rewrite; (a) weaker audit trail for “which order” |
| **Pilot** | Store optional `order_id` / line refs on refund evidence; no CompleteOrder reverse; no stock reverse in this package |
| **Impact** | Payments refs; Orders/Inventory **read-only** |
| **Requires PO?** | **Yes** only if merchandise/inventory return in same package |

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
