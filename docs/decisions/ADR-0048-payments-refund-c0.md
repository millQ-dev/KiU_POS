# ADR-0048: Payments Refund (C0 CASH + VietQR pilot)

- **Status:** **Accepted WITH DELTAS** (PO **ACCEPT WITH DELTAS** 2026-10-27)
- **Date:** 2026-10-25 (proposed); **Accepted:** 2026-10-27
- **Package alias:** **PAY-REFUND-C0**
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002; ADR-0013; ADR-0014 (+ LEGAL GATE G2); ADR-0028; ADR-0032; ADR-0036; ADR-0038; ADR-0046; Proposed ADR-0047 (CashDrawerMovement — anti double-count); F4Б PO-20261025-C0-F4
- **Autonomy:** Level **C** (this Accept). Runtime under this Accepted ADR is Level **B** (separate authorization). Production deploy / persistent DB migrate / real payouts / G2 claim require **separate** PO GO.
- **Origin main at Accept baseline:** `c3ef13407d0ce77eb94c5a70eda638704b088954`
- **Companion packets:** `docs/processes/review-packets/2026-10-25-cash13-refund-level-c-decision-packet.md`; F4Б reconciliation `docs/processes/review-packets/2026-10-25-cash13-refund-po-f4b-reconciliation.md`; Accept stamp `docs/processes/review-packets/2026-10-27-adr-0048-po-accept-with-deltas.md`

---

## Authority map

| Class | Content |
| --- | --- |
| **EXISTING Accepted ADR** | 0013 non-custody + PCE; 0014 fiscal + G2; 0028 refund ≠ rewrite Order commercial; 0032 abort ≠ refund; 0036 grants; 0038 no compensating ReceiveCash-as-refund; 0046 Close immutable + expected may subtract confirmed CASH refunds |
| **PO ACCEPTED (product)** | **F4Б:** partial monetary refund after paid **COMPLETED** Order is **mandatory** for first pilot. POS-REFUND UI-161 Spec Accepted / Figma Partial — API not Origin-verified at Accept time |
| **THIS ACCEPT (architecture)** | Reservation / anti-over-refund; durable payout attempts; CASH human confirmation; VietQR per-attempt evidence rules; FinancialRefundStatus ⊥ FiscalCorrectionStatus; R1–R9 + Interview #37/#47 as recorded below |
| **OPEN / EXTERNAL (not closed by this Accept)** | R8 numeric thresholds + threshold-approval flow; VietQR merchant eligibility + per-attempt bank correlation evidence; LEGAL GATE G2; FiscalCorrectionPolicy contents; manual bank refund (needs separate Owner + legal GO); Accounting Engine |

**STOP:** This Accept freezes architecture. It does **not** authorize runtime merge by itself, production deploy, persistent production DB migrations, real CASH/VietQR payouts, test fiscal adapter in production, G2 clearance, VietQR adapter without contractual/technical evidence, CHRONO1.1 changes, or backup/rules/Automations changes.

---

## Context

Origin Payments at Accept baseline: `ReceiveCash` → immutable PCE + SUCCEEDED Payment; lifecycle refuses SUCCEEDED→void without compensating architecture; no PaymentRefund runtime; ADR-0046 expected documents `− Σ refunds` but migration 034 implements opening + Σ CASH PCE only.

Prior PROPOSED revisions (2026-10-25) and C0-REFUND FINAL REVIEW CORRECTIONS (reservation, CASH human confirmation, VietQR per-attempt reconciliation) are superseded by this Accepted text where they conflict.

---

## Decision (Accepted — PO ACCEPT WITH DELTAS)

### D1. Ownership

| Concern | Owner |
| --- | --- |
| RefundRequest, RefundAuthorization, RefundReservation, PayoutAttempt, FinancialRefundStatus, link to original Payment | **Payments** |
| CASH expected impact on **current OPEN** CashShift (once per confirmed CASH money effect); no twin CashDrawerMovement for same refund | **Cash** |
| FiscalDocument / correction chains; FiscalCorrectionStatus | **Fiscalization** |
| VietQR adapter I/O; never decides MONEY_RETURNED alone | **Integrations** |

Payments remains the financial evidence owner for refund money effects. CashShift expected is a **derived consumer** of confirmed CASH refund facts — not a second money source of truth. Fiscal is independent.

### D2. Core concepts (binding)

1. **RefundAuthorization** — grant-checked permission to refund a specific amount against an original SUCCEEDED Payment in its related Settlement/sale context.
2. **RefundReservation** — reserved amount that reduces remaining capacity until released or converted to a confirmed money effect.
3. **PayoutAttemptIdentity** — durable unique attempt id plus client idempotency key (unique per LegalEntity); distinct keys = distinct attempts.
4. **ExecutionStatus / FinancialRefundStatus** — lifecycle of money-side refund (below).
5. **ConfirmedMoneyEffect** — MONEY_RETURNED only with instrument-specific verified evidence.
6. **ImmutableFinancialEvidence** — append-only authorization, reservation, attempt, confirmation, and reconcile records; no silent rewrite.

### D3. Capacity & reservation invariant (PO delta)

Refund capacity is computed **per original Payment** and the Settlement/sale obligation that Payment belongs to. Do **not** refund money attributable to other obligations.

```text
qualifying = original Payment qualifying collected amount (instrument-scoped)
consumed  = Σ ConfirmedMoneyEffect (MONEY_RETURNED) on that Payment
reserved  = Σ ActiveReservations on that Payment
invariant: consumed + reserved <= qualifying
remaining_capacity = qualifying − consumed − reserved
```

Partial amounts must be `> 0` and `≤ remaining_capacity`. Fail closed otherwise.

**Active reservation statuses** (amount stays reserved):

- AUTHORIZED
- EXECUTION_PENDING
- EXECUTION_UNKNOWN
- RECONCILE_BLOCKED

**Release reservation only when:**

- EXECUTION_FAILED with **proven non-payment**, or
- authorization cancelled/expired under policy **before** any payout attempt that could have paid, or
- reservation converted into MONEY_RETURNED (reserved → consumed; not double-counted)

**EXECUTION_UNKNOWN does not auto-release.** Reservation creation is **strictly atomic** with semantic idempotency-key check under exclusive Payment lock (e.g. `FOR UPDATE`). Same key → replay existing attempt/reservation; distinct keys → concurrent capacity check.

### D4. FinancialRefundStatus (Payments)

```text
REQUESTED
  → DENIED                         (terminal; no reservation)
  → AUTHORIZED                     (reservation active)
  → EXECUTION_PENDING              (durable attempt started)
       ├→ EXECUTION_UNKNOWN        (ambiguous; reservation held)
       ├→ RECONCILE_BLOCKED        (manual; reservation held)
       ├→ EXECUTION_FAILED         (release only if non-payment proven)
       └→ MONEY_RETURNED           (confirmed money effect)
```

### D5. FiscalCorrectionStatus (Fiscalization) — independent (R6)

```text
NOT_STARTED
  → REQUIRED_PENDING
  → SUBMITTED
       ├→ CONFIRMED
       ├→ REJECTED
       └→ UNKNOWN
```

**FiscalCorrectionPolicy** (separate Accept / Level C follow-up; required before production fiscal-safe claim) MUST define at least:

- REQUIRED, CONFIRMED, UNKNOWN, REJECTED
- confirmed **NOT_REQUIRED** (when lawfully applicable — never Vietnam restaurant shortcut abuse)
- **LEGAL_BLOCKED**
- timing, source fiscal documents, and allowed action sequences

Binding:

- FinancialRefundStatus ⊥ FiscalCorrectionStatus.
- MONEY_RETURNED **may** precede Fiscal CONFIRMED **only if** Vietnam counsel / G2 and accepted FiscalCorrectionPolicy permit that ordering.
- Production execution claiming fiscal-safe refund UX is **forbidden** until G2 **and** FiscalCorrectionPolicy.
- UI shows fiscal state separately when UNKNOWN / PENDING / REJECTED / LEGAL_BLOCKED.
- **Fiscal retries must never re-execute money payout.**

### D6. Hard non-effects (R7)

- Do not UPDATE/DELETE original Payment amounts or SUCCEEDED lifecycle.
- Do not mutate original PCE, Order commercial snapshot / Revenue Basis, or GoodsIssue from refund alone.
- Soft optional `order_id` / line refs only.
- Do not invent Fiscal CONFIRMED/SATISFIED from money SUCCESS.
- Do not insert CashDrawerMovement for the same CASH refund payout (ADR-0047 anti double-count).
- Do not apply CASH payout to a CLOSED CashShift; do not rewrite CLOSED expected / close evidence.
- Do not create a parallel customer wallet / custody balance (ADR-0013).

### D7. Instrument & outlet restrictions

- **Interview #37 (binding):** refund execution path must match **original Payment tender** (CASH→CASH; VietQR→VietQR). No cross-tender substitution in this Accept.
- **Interview #47 (binding):** authorization and payout only at the **original sale Outlet**.

### D8. CASH payout protocol (human confirmation)

Stages must not collapse into “insert row = paid”:

1. Authorization (actor + Owner-issued scoped grant)
2. Financial intent / RefundRequest
3. Reservation (capacity lock)
4. Physical cash handover intent on **current OPEN** CashShift
5. **Explicit employee confirmation** of exact amount handed over (immutable actor_id, confirmed_at, amount, reason, attempt_id, cash_shift_id)
6. ConfirmedMoneyEffect → MONEY_RETURNED
7. CashShift expected consumes that confirmed amount **exactly once**

Rules:

- Actor + scoped grant; original Outlet; current OPEN CashShift of Session Terminal (server-derived; never client-trusted actor for shift binding).
- UNKNOWN / reload / retry must **not** automatically repeat physical payout.
- Uncertain physical handover → RECONCILE_BLOCKED until `payments.refund.reconcile`.
- A database row alone is **not** proof that cash reached the guest — confirmation evidence is required.
- No duplicate CashDrawerMovement; CLOSED shifts immutable.

### D9. VietQR execution protocol (per-attempt reconciliation)

Layers (not one atomic PostgreSQL + bank API transaction):

```text
KiU RefundRequest
  → KiU RefundReservation
  → durable ProviderRefundAttempt
  → Provider HTTP response (evidence only)
  → Provider inquiry
  → VerifiedRefundEvidence → MONEY_RETURNED
```

Rules:

- HTTP `SUCCESS` is **not** automatic guest credit confirmation.
- Public Check Transaction aggregates (`refundCount`, `amountRefunded`) on the original payment are **insufficient alone** to prove a specific KiU attempt when multiple refunds may exist.
- **Single-flight is not sufficient proof of payout.** Without unambiguous correlation of the specific attempt to a confirmed bank effect → **RECONCILE_BLOCKED**, not MONEY_RETURNED; no further external Refund calls until cleared.
- Prefer unique provider refund reference bound 1:1 to attempt_id (confirm with provider). Store any returned reference; never log secrets.
- Timeout-after-success → EXECUTION_UNKNOWN → inquire; never blind re-POST Refund.
- `multiTimes`: set on first refund attempt when multiple partials are required; do not change multiTimes semantics for the same original transaction without confirmed provider procedure.
- Secrets server-side only; redact sensitive material from logs.
- VietQR **runtime adapter remains blocked** until contractual + technical provider evidence (eligibility, secrets issuance, per-attempt correlation model, sandbox).

### D10. Manual bank refund

**Not** auto-authorized by this Accept. Requires a **separate Owner + legal GO** and proven compatibility with original-tender (#37) and original-outlet (#47) rules, using the same reservation/attempt/evidence invariants.

### D11. CashShift expected impact (CASH)

After Level B runtime under this ADR:

```text
expected = opening_float
         + Σ CASH PCE amount_collected_minor
         − Σ ConfirmedMoneyEffect CASH refunds for this cash_shift_id
```

Apply subtraction **once** per MONEY_RETURNED CASH effect. Historical Payment may predate current shift (R3-D); payout shift is always current OPEN at original Outlet.

### D12. Permissions (R8 — Accepted keys; thresholds OPEN)

Owner-issued scoped grants (job title alone grants nothing):

| Key | Purpose |
| --- | --- |
| `payments.refund_cash` | Execute CASH refund path when Owner-assigned |
| `payments.refund_vietqr` | Execute VietQR refund path when Owner-assigned **and** provider gate open |
| `payments.refund.approve` | Sensitive / future over-limit approve (thresholds **not** set by this Accept) |
| `payments.refund.reconcile` | Clear RECONCILE_BLOCKED / UNKNOWN with audited decision |

**First slice:** only explicitly Owner-authorized actors; limited by `remaining_capacity`. Numeric limits and additional threshold-approval flow are **not** invented here — remain OPEN for later Owner config.

Also require `pos.operate` (or equivalent) when executing on POS surface.

### D13. R9

Refund commands are strictly separate from Settlement Abort (ADR-0032). No silent abort→refund.

---

## PO decision matrix R1–R9 (Accepted 2026-10-27)

| ID | Decision | Status |
| --- | --- | --- |
| **R1** | Partial monetary refunds ≤ `remaining_capacity` (confirmed + active reservations) | **ACCEPTED** (F4Б + this Accept) |
| **R2** | CASH payout only from current OPEN CashShift | **ACCEPTED** |
| **R3** | Option **D**: historical Payment allowed; pay from current OPEN at **original Outlet**; CLOSED CashShift immutable | **ACCEPTED** |
| **R4** | CASH + VietQR in pilot target scope; CARD deferred; VietQR execution blocked until provider evidence | **ACCEPTED** |
| **R5** | Void is independent; out of first refund slice | **ACCEPTED** |
| **R6** | Financial ⊥ Fiscal; money-before-fiscal only after counsel/G2 + FiscalCorrectionPolicy | **ACCEPTED** (policy contents OPEN) |
| **R7** | Original Payment / PCE / OrderCommercialSnapshot / GoodsIssue immutable; no auto stock reversal | **ACCEPTED** |
| **R8** | Scoped keys above; Owner assigns; no invented numeric thresholds | **ACCEPTED** (thresholds OPEN) |
| **R9** | Refund ≠ Settlement Abort | **ACCEPTED** |
| **#37** | Original tender only | **ACCEPTED** |
| **#47** | Original outlet only | **ACCEPTED** |

---

## Consequences

### Positive

- Closes ADR-0038 cash-refund architectural OPEN for a narrow pilot shape without fake compensating ReceiveCash.
- Prevents over-refund under concurrent distinct idempotency keys via reservations.
- Separates money proof from fiscal proof and from UI/HTTP optimism.

### Negative / follow-ups

- Level B runtime still required (schema, CASH path, tests).
- VietQR adapter gated on provider evidence; may remain RECONCILE_BLOCKED without per-attempt correlation.
- FiscalCorrectionPolicy + G2 remain external before production fiscal-safe claim.
- ADR-0047 remains PROPOSED; refund must not twin as CashDrawerMovement.

### Explicitly out of this Accept

- Accounting Engine; custody/wallet; gift cards; QR claim codes; mixed-tender proportional first slice; offline refund SUCCESS; DeviceIdentity; CHRONO1.1 changes; Floor/Table; aggregators; production deploy; persistent production migrate; real payouts; test fiscal adapter in production.

---

## Acceptance checklist

- [x] PO answers R1–R9 + #37/#47 recorded (ACCEPT WITH DELTAS 2026-10-27)
- [x] Status → Accepted WITH DELTAS + baseline Origin main SHA
- [ ] Level B runtime separately authorized (next)
- [ ] FiscalCorrectionPolicy Accept + LEGAL GATE G2 before production fiscal-safe claim
- [ ] VietQR provider evidence before adapter execution
- [ ] Coordination with ADR-0047 if/when Accepted (no double drawer effect)

## STOP

Accepted architecture ≠ Level B merge authorization by this file alone. No production deploy / persistent production DB migrate / real payouts / G2 claim from this Accept.
