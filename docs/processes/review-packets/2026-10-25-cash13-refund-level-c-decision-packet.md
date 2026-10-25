# Level C decision packet — CASH1.3 CashDrawerMovement + Payments Refund

- **Status:** **Proposed** — awaiting PO / Architecture Accept (no runtime)
- **Date:** 2026-10-25
- **Autonomy:** Level **C** (docs / contracts only)
- **Baseline Origin main:** `6b97f3dcb650882135d5e29450cdf14c622ab547` (CASH1.2 ADR-0046 merged)
- **STOP:** Do **not** start CASH1.3 or Refund migrations/services until corresponding ADR(s) are **Accepted**. Do **not** expand CASH1.2 runtime beyond ADR-0046.

---

## 0. Baseline & sources checked

### Origin runtime (facts)

| Fact | Evidence |
| --- | --- |
| CashShift Open + Close only | mig `029`/`034`; `CashShiftService.openShift` / `closeShift` |
| Expected (CASH1.2) | `opening + Σ CASH PCE amount_collected_minor` via `payment_cash_collection_evidence.cash_shift_id` |
| ReceiveCash locks OPEN shift `FOR SHARE` | `receive-cash-service.ts` |
| Close locks shift `FOR UPDATE` | ADR-0046 / `closeShift` |
| No CashDrawerMovement table | absent in migrations |
| No Payment refund command / table | Payments lifecycle rejects SUCCEEDED→void regression without compensating architecture |
| Refunds RELEASE-BLOCKING OPEN | ADR-0038 A4; `fisc11-level-c-open-items.md` |

### Accepted ADRs (binding constraints)

| ADR | Constraint for this packet |
| --- | --- |
| **0002** | Exact minor-unit Money; no float; digit strings |
| **0013** | Non-custody; Cash drawer ≠ MillQ wallet; Payments owns PCE; tips ≠ custody |
| **0036** | Auth evidence / AccessGrant / Session; dangerous ops may need Approval |
| **0038** | Change ≠ refund; CASH PCE via ReceiveCash; cash refunds out until separate Accept |
| **0046** | Expected formula reserves `− Σ CASH refunds`; mid-shift in/out out of CASH1.2; CLOSED immutable |

### Notion / product anchors (not runtime)

| Ref | Status | Meaning for packet |
| --- | --- | --- |
| Manager «Касса/инкассация» ([02 Manager](https://app.notion.com/p/3f821d5d348781d09e3ad589f2c07726)) | PO ACCEPTED product behavior | cash-in/out, expenses, collector handoff with **separate grants + Owner limits**; close with discrepancy immutable |
| KIU-MODE-001 | **DRAFT** | PersonalShift ≠ OperatorSession ≠ CashShift; CashShift owns float / in-out / close |
| ACC-CASH UI-125 | Spec Accepted / Figma Missing | Accountant cash-shift reconciliation screen — not CASH1.3 runtime |
| POS-REFUND UI-161 | Spec Accepted / Figma Partial | Review needs grant/risk-gate, separate refund, fiscal correction — **API/grants not Origin-verified** |
| PO 21А (via ADR-0046) | Accepted for CASH1.2 | Full expected = opening + collections − refunds (refunds deferred) |

### Proposed ADR numbers (docs only until Accept)

| Alias | Proposed ADR | Owns | File |
| --- | --- | --- | --- |
| **CASH1.3** | **ADR-0047** (**PROPOSED**) | CashDrawerMovement + expected extension | `docs/decisions/ADR-0047-cash13-cash-drawer-movement.md` |
| **PAY-REFUND-C0** | **ADR-0048** (**PROPOSED**) | Payments Refund evidence + CASH drawer effect hook | `docs/decisions/ADR-0048-payments-refund-c0.md` |

Prefer **two ADRs** (ownership boundary). Combined Accept with explicit module split is acceptable if PO prefers one decision event.

### Authority classes (docs PR)

| Class | Meaning |
| --- | --- |
| **EXISTING Accepted ADR** | Binding runtime/architecture today (0002/0013/0036/0038/0046/…) |
| **PO ACCEPTED** | Product behavior Accepted in Notion — **not** Origin runtime |
| **PROPOSED** | ADR-0047 / ADR-0048 / this packet — non-authoritative until Accept |
| **OPEN / BLOCKED** | C1–C6, R1–R9; runtime/migrations blocked |

---

## 1. Data ownership & minimal schema

### Ownership boundary (must not blur)

```text
Cash Management owns:  CashShift, CashDrawerMovement, close evidence, expected computation inputs from drawer
Payments owns:         Payment (immutable SUCCESS history), RefundCommand evidence, refund→original Payment link,
                       any RefundCollection / refund chronology fact (≠ mutating original PCE)
Fiscalization owns:    FiscalDocument / correction chains (separate Level C — not invented here)
Accounting / Bank:     bank deposit confirmation (≠ SAFE_DROP)
```

**Forbidden:** treating SAFE_DROP as bank receipt; rewriting original `payment` / PCE / Revenue / FiscalDocument on refund; inventing negative PCE as “refund”.

### CASH1.3 — proposed `cash_drawer_movement` (Cash-owned)

Immutable append-only row (no UPDATE of economic fields after insert):

| Column | Rule |
| --- | --- |
| `cash_drawer_movement_id` | UUID PK |
| `tenant_id`, `outlet_id`, `terminal_id` | Organization scope; must match OPEN CashShift |
| `cash_shift_id` | FK → OPEN shift at accept time |
| `movement_kind` | `CASH_IN` \| `CASH_OUT` \| `SAFE_DROP` |
| `amount_minor` | non-negative digit string (ADR-0002) |
| `signed_effect_minor` | server-authored: `+amount` for CASH_IN; `−amount` for CASH_OUT and SAFE_DROP |
| `currency_code`, `minor_unit_exponent` | must equal OPEN shift |
| `reason_text` | non-empty |
| `actor_user_id` (+ optional employee) | from Session — never client |
| `accepted_at` | server clock |
| `idempotency_key` | unique `(tenant_id, idempotency_key)` |
| `handoff_state` (SAFE_DROP only) | `RECORDED` → optional later `HANDOFF_CONFIRMED` **without** implying bank deposit |
| `counterparty_ref` | optional (collector / safe bag id) — opaque string, not bank ledger |

Indexes: `(cash_shift_id)`, unique idempotency.

**Not in CASH1.3:** bank deposit document; RECONCILED/ACCEPTED CashShift advance; expense GL posting; Document Engine.

### Payments Refund — proposed minimal evidence (Payments-owned)

| Column / aggregate | Rule |
| --- | --- |
| `payment_refund_id` | UUID PK |
| `original_payment_id` | FK → existing SUCCEEDED Payment (immutable original) |
| `tenant_id`, `legal_entity_id` | from original Payment |
| `instrument_family` | must match original for C0 narrow path (`CASH` first) |
| `amount_refunded_minor` | > 0; ≤ remaining refundable on original (PO decides partial — see §5) |
| `currency_code`, `minor_unit_exponent` | match original |
| `reason_text` | mandatory |
| `refunded_by_user_id` | Session actor |
| `accepted_at` | server clock |
| `idempotency_key` | unique per LE |
| `cash_shift_id` | **required for CASH** — CURRENT OPEN shift where cash leaves drawer; **null forbidden** for CASH |
| `status` | `SUCCEEDED` only on accept (no silent PENDING inventing drawer effect) |

**Non-effects (hard):**

- Do **not** UPDATE original Payment amounts / lifecycle to “un-succeed”
- Do **not** DELETE/mutate original PCE
- Do **not** create FiscalDocument / Revenue rewrite in this package
- Do **not** apply CASH refund against a **CLOSED** CashShift (fail closed)

CARD/VietQR refunds may be deferred to a later Accept (provider async) — see §5.

---

## 2. Permission matrix (proposed)

### CASH1.3

| Operation | Proposed grants (outlet+terminal scope unless noted) |
| --- | --- |
| CASH_IN | `pos.operate` **and** `cash_drawer.in` |
| CASH_OUT | `pos.operate` **and** `cash_drawer.out` |
| SAFE_DROP (record) | `pos.operate` **and** `cash_drawer.safe_drop` |
| SAFE_DROP handoff confirm (collector ack) | `cash_drawer.safe_drop.confirm` (Manager/Owner; **separate** from record) |
| Amount above Owner-configured limit | ApprovalRequest / Owner Mobile grant (Manager Notion) — **limit policy OPEN** (§5) |

Reuse ADR-0036 Approval path for over-limit if PO chooses; do not overload `cash_shift.open.approve`.

### Payments Refund (CASH)

| Operation | Proposed grants |
| --- | --- |
| Execute CASH refund ≤ limit | `payments.refund_cash` (+ `pos.operate` if on POS surface) |
| Above limit / after kitchen / sensitive | Owner Approval or `payments.refund_cash.approve` — **OPEN** (§5) |
| CARD refund | Deferred; do not reuse CASH grant silently |

Shortage close remains `cash_shift.close.shortage` (ADR-0046) — unrelated to refund grant.

---

## 3. Expected Cash formula (no double-count)

### Target formula (extends ADR-0046 / PO 21А)

```text
expected = opening_amount_minor
         + Σ PCE.amount_collected_minor          -- CASH_RECEIVE via evidence.cash_shift_id
         + Σ CashDrawerMovement.signed_effect_minor  -- CASH_IN (+), CASH_OUT/SAFE_DROP (−)
         − Σ CASH refund.amount_refunded_minor   -- Payments refund bound to this cash_shift_id
```

Exact BigInt / digit-string arithmetic (ADR-0002). Fail closed on currency/exponent mismatch or non-digit amounts.

### Anti double-count rules (binding design)

| Risk | Rule |
| --- | --- |
| ReceiveCash change | Already netted in PCE `amount_collected_minor` (= due). **Never** also post CASH_OUT for change |
| SAFE_DROP then “expense” | SAFE_DROP is one signed effect; do not also CASH_OUT same cash |
| Refund vs CASH_OUT | Refund is Payments-owned; must **not** insert a parallel CashDrawerMovement for the same cash leave |
| CARD collection | Still **must not** enter expected (ADR-0046 D7) |
| Closed shift | Expected frozen in close evidence; later refunds cannot retarget CLOSED shift |

### CASH1.2 continuity

Until ADR-0047/0048 Accepted, runtime expected remains:

```text
expected = opening + Σ CASH PCE amount_collected_minor
```

No fake movements/refunds.

---

## 4. Transactional & concurrency invariants

### Lock order (proposed — fail closed if violated)

```text
1) Settlement/Payment domain locks (as today for ReceiveCash / future Refund)
2) cash_shift FOR UPDATE   -- exclusive for Close, Movement, CASH Refund drawer effect
   ReceiveCash keeps FOR SHARE on OPEN shift (compatible: waits behind UPDATE)
```

All of **ReceiveCash**, **CloseCashShift**, **CashDrawerMovement accept**, **CASH Refund accept** must serialize on the same `cash_shift` row so expected cannot race.

### Per-command invariants

| Command | Invariants |
| --- | --- |
| CashDrawerMovement | Shift OPEN; currency match; reason; grants; idempotent key; one signed effect; no Payment/Fiscal writes |
| CloseCashShift | Existing ADR-0046; expected query includes movements + refunds **only after** those ADRs Accepted |
| CASH Refund | Original Payment SUCCEEDED + refundable; shift OPEN; grant; reason; idempotent; drawer effect once; original Payment/PCE/Fiscal unchanged |
| After CLOSED | Movement / CASH refund → `CASH_SHIFT_NOT_OPEN` / equivalent; close evidence immutable |

### Recovery

- Idempotent retry same key + same semantics → return existing
- Different semantics → conflict
- Partial TX failure → full rollback (no orphan movement without refund or vice versa for CASH refund path: **single TX** Payments+Cash)

---

## 5. Remaining PO decisions (STOP — Level C blockers for runtime)

Full matrices (options / recommendation / risks / pilot / module impact / requires PO?) live in:

- **C1–C6** → [ADR-0047](../../decisions/ADR-0047-cash13-cash-drawer-movement.md) § «PO decision matrix C1–C6»
- **R1–R9** → [ADR-0048](../../decisions/ADR-0048-payments-refund-c0.md) § «PO decision matrix R1–R9»

### Index (must answer before Accept)

| ID | Topic | Recommended default (still PROPOSED) |
| --- | --- | --- |
| C1 | Permission key names | `cash_drawer.in\|out\|safe_drop\|safe_drop.confirm` |
| C2 | Owner amount limits | Defer store **or** ApprovalRequest over limit |
| C3 | CASH_OUT semantics | Expense paid-out / opaque out; **no** change-as-out; **no** tip payout without tip model |
| C4 | SAFE_DROP vs Close | Record-only in pilot; confirm optional later |
| C5 | Terminal scope | Movement only on CashShift Terminal |
| C6 | Who CASH_IN | Cashier with `cash_drawer.in` (≠ Open float) |
| R1 | Partial refund | **PO ACCEPTED F4Б:** partial ≤ remaining (see F4Б reconciliation packet) |
| R2 | Open-shift only | Current OPEN required |
| R3 | Cross-shift | Forbidden in C0 |
| R4 | CARD/VietQR | Separate ADR after CASH |
| R5 | Voids | Distinct; defer voids |
| R6 | Fiscal correction | Out of PAY-REFUND package (separate FISC Level C) |
| R7 | Order commercial | Payment+drawer only (ADR-0028) |
| R8 | Refund grants | `payments.refund_cash` + approve/limit |
| R9 | vs Settlement abort | Strictly separate; no silent abort→refund |

### Explicitly deferred (do not invent)

- RECONCILED / ACCEPTED CashShift
- Bank deposit / инкассация bank confirmation
- Offline Edge refund / movement (ADR-0045)
- Gift cards / custody (ADR-0013)
- Document Engine / aggregators / PR #91
- Accounting Engine

### Recommended minimal pilot (after future Accept — not this docs PR)

Superseded in detail by `2026-10-25-cash13-refund-po-f4b-reconciliation.md` after **F4Б**:

1. **CASH1.3 slice:** CASH_IN + CASH_OUT (expense) + SAFE_DROP **record**; Terminal-scoped; no bank.
2. **Refund slice:** **Partial** CASH ≤ remaining on paid COMPLETED Order (F4Б); soft Order/line refs; payout from **current OPEN** (R3-D if PO confirms); no commercial/inventory rewrite; no CashDrawerMovement twin; no fake fiscal success.
3. **Pilot-complete gates:** VietQR refund capability verified; fiscal correction policy vs LEGAL GATE G2 named — not invented.
4. Extend Close expected only after both ADRs Accepted + double-count tests.

---

## 6. Minimal PR plan (after Accept only)

| PR | Autonomy | Scope | Depends |
| --- | --- | --- | --- |
| **P0** | C | Accept ADR-0047 (+ optionally 0048) text + Arch/DB/FinSec review | PO answers §5 |
| **P1** | B | mig CashDrawerMovement + grants + commands + expected helper includes movements; disposable tests; Close uses extended expected | ADR-0047 Accepted |
| **P2** | B | mig PaymentRefund (+ CASH path) + grants + single-TX drawer effect; expected includes refunds; adversarial + race tests with ReceiveCash/Close | ADR-0048 Accepted; ideally after P1 |
| **P3** | B | Optional: SAFE_DROP confirm command + close policy if C4 requires | P1 |
| **P4** | C→B | Fiscal correction / CARD refund — **separate** Level C | R4/R6 |

**CASH1.2:** no further PR unless bugfix under ADR-0046. No silent expected rewrite before P1/P2.

**Forbidden in all PRs:** persistent DB migrate/deploy without GO; expanding CASH1.2; fake refund events; mutating original Payment/PCE/Fiscal in refund path.

---

## 7. Recommendation to PO

1. Treat this packet as the **Level C preflight** for CASH1.3 + CASH Refund.
2. Answer §5 (C1–C6, R1–R9) or Accept proposed defaults called out in §2–§4.
3. After Accept → authorize P0 ADR merge, then P1/P2 Level B continuous cycle.
4. Keep POS-REFUND Figma / ACC-CASH UI out of runtime PRs until API contracts Accepted.

**Current verdict for agents:** **LEVEL_C_BLOCKER for CASH1.3 / Refund runtime** until ADR Accept. **CASH1.2** remains in-scope only as already Accepted/merged (`6b97f3d…`).
