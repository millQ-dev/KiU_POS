# ADR-0047: CASH1.3 CashDrawerMovement (mid-shift cash drawer)

- **Status:** **PROPOSED** (non-authoritative; does not change Accepted rules or runtime)
- **Date:** 2026-10-25
- **Package alias:** **CASH1.3**
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0002; ADR-0013; ADR-0036; ADR-0038; ADR-0046 (Accepted CASH1.2); **ADR-0048 Accepted WITH DELTAS 2026-10-27** (Payments Refund); domain-module-map Cash Management
- **Autonomy:** Level **C** docs only until Accept
- **Origin main at proposal:** `6b97f3dcb650882135d5e29450cdf14c622ab547`
- **Companion packets:** `docs/processes/review-packets/2026-10-25-cash13-refund-level-c-decision-packet.md`; F4Б reconciliation `docs/processes/review-packets/2026-10-25-cash13-refund-po-f4b-reconciliation.md`; ADR-0048 Accept stamp `docs/processes/review-packets/2026-10-27-adr-0048-po-accept-with-deltas.md`
- **Note (2026-10-25 / updated 2026-10-27):** ADR-0048 Accept does **not** change CashDrawerMovement ownership; CASH refund must **not** twin as CASH_OUT / CashDrawerMovement. ADR-0047 remains **PROPOSED**.

---

## Authority map (this ADR)

| Class | Content |
| --- | --- |
| **EXISTING Accepted ADR** | 0002 Money; 0013 non-custody / drawer ≠ wallet; 0036 grants/session; 0038 change ≠ refund; 0046 Close + CASH-only expected (refunds/in-out deferred) |
| **PO ACCEPTED (product, not runtime)** | Manager «Касса/инкассация»: cash-in/out, expenses, collector handoff with **separate grants + Owner limits**; close discrepancy immutable ([02 Manager](https://app.notion.com/p/3f821d5d348781d09e3ad589f2c07726)) |
| **PROPOSED (this document)** | CashDrawerMovement aggregate, permission keys, expected extension for movements, concurrency with ReceiveCash/Close |
| **OPEN / BLOCKED** | C1–C6 below; bank deposit / Accounting Engine; RECONCILED/ACCEPTED; offline Edge movements |

**STOP:** Merging this file as PROPOSED must **not** be treated as Accept. Runtime/migrations require a later **Accepted** revision + PO GO.

---

## Context

CASH1.2 delivers Open + Close with:

```text
expected = opening + Σ CASH PCE amount_collected_minor
```

Mid-shift physical drawer events (float top-up, paid-out, safe drop) are product-required but have **no** Origin table/command. Mixing them into Payments PCE or inventing negative collections would violate ADR-0038 / 0013.

---

## Proposed decision (non-binding until Accept)

### D1. Ownership

Cash Management owns immutable **`CashDrawerMovement`**. Payments / Settlement / Fiscal / Accounting do **not** own these rows.

### D2. Movement kinds

| Kind | Signed effect on expected | Meaning |
| --- | --- | --- |
| `CASH_IN` | `+amount` | Physical cash added to drawer (not a sale) |
| `CASH_OUT` | `−amount` | Physical cash removed (paid-out / expense — exact semantics C3) |
| `SAFE_DROP` | `−amount` | Cash moved from drawer to safe / collector bag |

**SAFE_DROP ≠ bank deposit.** Bank confirmation is out of CASH1.3 (Accounting / bank document later).

### D3. Expected extension (after Accept; not live now)

```text
expected = opening
         + Σ CASH PCE amount_collected_minor
         + Σ CashDrawerMovement.signed_effect_minor
         − Σ CASH refunds          -- only after ADR-0048 Accepted
```

Anti double-count: ReceiveCash change already netted in PCE collected; must **not** post CASH_OUT for change. CASH refund (ADR-0048) must **not** also insert CashDrawerMovement.

### D4. Concurrency

Accept movement while locking `cash_shift` **`FOR UPDATE`** (same exclusive class as Close). ReceiveCash keeps **`FOR SHARE`**. Serialize with CloseCashShift so expected cannot race. CLOSED shift → reject. Close evidence remains immutable (ADR-0046).

### D5. Minimal schema (sketch)

See companion packet §1. Immutable economic fields; unique `(tenant_id, idempotency_key)`; currency/exponent = OPEN shift; mandatory `reason_text`; server actor + `accepted_at`.

### D6. Proposed permission keys (C1)

| Operation | Proposed key |
| --- | --- |
| CASH_IN | `cash_drawer.in` (+ `pos.operate` on POS) |
| CASH_OUT | `cash_drawer.out` (+ `pos.operate`) |
| SAFE_DROP record | `cash_drawer.safe_drop` (+ `pos.operate`) |
| SAFE_DROP handoff confirm | `cash_drawer.safe_drop.confirm` |

---

## PO decision matrix C1–C6

Each row: options → **recommendation** → risks → pilot impact → module impact → **requires PO?**

### C1 — Exact permission key names

| | |
| --- | --- |
| **Options** | (a) Proposed keys above; (b) prefix `cash_shift.*`; (c) collapse in/out into one `cash_drawer.move` + kind |
| **Recommendation** | **(a)** — mirrors Manager “separate grants”; distinct confirm grant |
| **Risks** | (c) loses grant separation; (b) confuses with open/close lifecycle |
| **Pilot** | Wire AccessGrant UI once; renaming later is migration churn |
| **Impact** | Identity permission catalog; Cash HTTP; no Payments/Fiscal |
| **Requires PO?** | **Yes** if rejecting (a); else Accept (a) as default |

### C2 — Owner amount limits

| | |
| --- | --- |
| **Options** | (a) Hard deny over limit; (b) ApprovalRequest over limit; (c) soft warn only; (d) defer limits to later ADR |
| **Recommendation** | **(b)** for CASH_OUT / SAFE_DROP; **(d)** acceptable for first pilot if Owner sets high grants and no soft limit table yet |
| **Risks** | (c) audit theater; (a) without Approval blocks ops; inventing limit store without policy SoT |
| **Pilot** | Prefer (d) + Manager grant only, or (b) reusing ADR-0036 Approval |
| **Impact** | Cash + Identity Approval; not Settlement/Fiscal |
| **Requires PO?** | **Yes** — limit storage + enforcement mode |

### C3 — CASH_OUT semantics

| | |
| --- | --- |
| **Options** | (a) Operating expense paid-out only; (b) also tip payout; (c) also change correction; (d) opaque “cash left drawer” only |
| **Recommendation** | **(a)** or **(d)** for pilot; **forbid (c)** (change already in PCE); tip payout needs tip model (ADR-0038 tips out) |
| **Risks** | Tip payout without tip allocation → custody smell (0013); change as CASH_OUT → double-count |
| **Pilot** | Expense paid-out + reason text; no tip/change |
| **Impact** | Cash only; Accounting GL link **out**; Payments tip path out |
| **Requires PO?** | **Yes** — what kinds of outflows are legal in C0 cafe |

### C4 — SAFE_DROP confirm before Close

| | |
| --- | --- |
| **Options** | (a) Block Close if unconfirmed SAFE_DROP; (b) warn only; (c) no confirm command in CASH1.3 (record-only) |
| **Recommendation** | **(c)** for minimal pilot; add confirm in follow-up if Manager handoff UX needs it |
| **Risks** | (a) ops stuck if collector late; (c) weaker collector audit |
| **Pilot** | Record SAFE_DROP with reason; Accountant bank later |
| **Impact** | Cash Close gate if (a); else Cash only |
| **Requires PO?** | **Yes** if Close gate; else Accept (c) |

### C5 — Terminal / shared drawer scope

| | |
| --- | --- |
| **Options** | (a) Movement only on CashShift’s Terminal (current one-OPEN-per-Terminal); (b) allow cross-terminal drop into shared safe with outlet-only scope |
| **Recommendation** | **(a)** — keep ADR-0036/0046 Terminal binding |
| **Risks** | (b) expected attribution ambiguity; race across terminals |
| **Pilot** | Per-terminal CashShift only |
| **Impact** | Cash + Organization Terminal; not Payments |
| **Requires PO?** | **Yes** only if multi-till shared float is in-scope |

### C6 — Who may CASH_IN mid-shift

| | |
| --- | --- |
| **Options** | (a) Cashier with `cash_drawer.in`; (b) Manager-only; (c) Cashier ≤ limit, Manager above |
| **Recommendation** | **(a)** or **(c)** aligned with C2; Opening float remains OpenCashShift (not CASH_IN) |
| **Risks** | Blurring Open float vs mid-shift top-up |
| **Pilot** | (a) with reason; document ≠ Open |
| **Impact** | Cash + Identity grants |
| **Requires PO?** | **Yes** for role policy |

---

## Consequences if Accepted later

### Positive

- Honest expected for mid-shift drawer events without fake PCE
- Aligns Manager product behavior with Cash ownership
- Preserves Close atomicity / FOR UPDATE model

### Negative / follow-ups

- Close expected query must be extended carefully (tests for double-count)
- SAFE_DROP → bank still needs Accounting package
- UI ACC-CASH / Manager cash screens separate

### Explicitly out

- Runtime until Accept; persistent migrate/deploy; Accounting Engine; Document Engine; refunds (ADR-0048)

---

## Acceptance checklist (for future Accept only)

- [ ] PO answers C1–C6 recorded
- [ ] Status flipped to Accepted with Accept date + main SHA
- [ ] Independent Arch/DB/FinSec review of Accepted text
- [ ] Level B runtime authorized separately

## STOP

**PROPOSED ≠ Accepted.** No CASH1.3 migration/service under this file alone.
