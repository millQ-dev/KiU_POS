# Level C reconciliation — ADR-0047/0048 vs PO-20261025-C0-F4 / F4Б

- **Status:** **PROPOSED** reconciliation (docs only; ADRs remain **PROPOSED**, not Accepted)
- **Date:** 2026-10-25
- **Baseline Origin main:** `fcf7632d3638c8b74f342ec689e07c4a459d1659` (PR #106 docs)
- **PO product source:** [PO-20261025-C0-F4 / F4Б](https://app.notion.com/p/40430d51715181d1b2adf41282cc41db) — **PO ACCEPTED:** partial monetary refund after paid **COMPLETED** Order is **mandatory** for first pilot  
  *(Notion MCP fetch returned 404 for this integration — content taken from PO direction in this task; re-verify access before Accept.)*
- **STOP:** Do **not** mark ADR-0047/0048 Accepted. No runtime / persistent migrate / deploy.

---

## 1. Authority classes

| Class | What |
| --- | --- |
| **EXISTING Accepted ADR** | 0002 Money; 0013 non-custody; 0014 fiscal boundary + G2; 0028 refund ≠ rewrite commercial; 0032 abort ≠ refund; 0036 grants; 0038 refunds OPEN / change ≠ refund; 0046 Close immutable + expected reserves refunds |
| **PO ACCEPTED (product)** | Manager cash-in/out/инкассация; **F4Б partial monetary refund after paid COMPLETED Order = mandatory for first pilot** |
| **PROPOSED (architecture)** | ADR-0047/0048 text + this reconciliation + 15-row review-candidate matrix below |
| **OPEN / BLOCKED** | Genuine remaining owner choices §4; external LEGAL GATE G2 + VietQR provider capability gate |

The 15-row matrix is a **review candidate from architecture**, **not** a new owner Accept.

---

## 2. Mandatory deltas from F4Б (product Accepted → architecture must track)

| ID | Prior PROPOSED recommendation (#106) | After F4Б |
| --- | --- | --- |
| **R1** | Pilot full-only (a) | **Superseded.** Implementable target = **partial ≤ remaining refundable** (b). Full-only no longer a valid pilot shrink. |
| **R3** | Forbid cross-shift (a) | Add **option D** (PROPOSED): original Payment may be historical; **cash leaves current OPEN CashShift**; original CLOSED shift **immutable** (expected not rewritten). |
| **R4** | CARD deferred (b) | CARD still deferred; **verified VietQR refund capability/method** is a **pilot-complete gate** (external), not silent “CASH-only done”. |
| **R6** | Separate FISC ownership (c) | Keep Fiscalization ownership; name exact Vietnam gate/workflow (**LEGAL GATE G2**, ADR-0014 correction chains). **Never invent fiscal success.** |
| **R7** | (a)/(c) soft link | Prefer **(c)**: Order/line **reference** without historical commercial or inventory mutation (ADR-0028 / GoodsIssue). |

**Preserved (unchanged):** Cash owns drawer movements; Payments owns refund evidence; SAFE_DROP ≠ bank; refund ≠ parallel CASH_OUT; CloseCashShift atomicity + immutable evidence + `FOR UPDATE` vs ReceiveCash `FOR SHARE`.

---

## 3. Fifteen-row recommendation matrix (review candidate)

Legend: **Auth** = EXISTING Accepted ADR | PO ACCEPTED | PROPOSED | OPEN

| # | ID | Topic | Review-candidate choice | Auth | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | C1 | Permission keys | `cash_drawer.in\|out\|safe_drop\|safe_drop.confirm` | PROPOSED | Aligns Manager separate grants |
| 2 | C2 | Amount limits | ApprovalRequest over limit **or** defer store for first movement slice | OPEN | Genuine PO |
| 3 | C3 | CASH_OUT semantics | Expense/opaque out; **forbid** change-as-out; no tip payout w/o tip model | PROPOSED | ADR-0038 change rule |
| 4 | C4 | SAFE_DROP vs Close | Record-only; confirm optional later | PROPOSED | |
| 5 | C5 | Terminal scope | Movement on CashShift Terminal only | PROPOSED | Matches 0046 |
| 6 | C6 | Who CASH_IN | Cashier + `cash_drawer.in` (≠ Open float) | OPEN | Soft PO |
| 7 | R1 | Partial refund | **Partial ≤ remaining** | **PO ACCEPTED (F4Б)** | Supersedes full-only pilot |
| 8 | R2 | Drawer for payout | Cash must leave **current OPEN** shift | PROPOSED | Compat with R3-D |
| 9 | R3 | Historical Payment | **Option D:** historical Payment OK; pay from current OPEN; CLOSED immutable | PROPOSED | Needs PO confirm |
| 10 | R4 | CARD / VietQR | CARD deferred; **VietQR refund method verified before pilot complete** | OPEN + **external gate** | Provider capability |
| 11 | R5 | Voids | Distinct; defer voids | PROPOSED | |
| 12 | R6 | Fiscal | Fiscal owns corrections; **G2 / correction policy OPEN**; no fake success | OPEN + **LEGAL GATE G2** | ADR-0014 |
| 13 | R7 | Order link | Soft Order/line ref; **no** commercial/inventory rewrite | PROPOSED | Bound by 0028 |
| 14 | R8 | Refund grants | `payments.refund_cash` + approve/limit | OPEN | Thresholds |
| 15 | R9 | vs Settlement abort | Strictly separate; no silent abort→refund | PROPOSED | ADR-0032 |

---

## 4. Remaining genuine owner choices (only)

After F4Б, these still need PO (or explicit Accept of PROPOSED defaults):

| ID | Ask |
| --- | --- |
| **C2** | Limit storage + hard deny vs ApprovalRequest vs defer |
| **C6** | Cashier vs Manager-only mid-shift CASH_IN |
| **R3** | Confirm **option D** (vs keep forbid-all cross-shift semantics) |
| **R8** | Exact refund permission keys + over-limit thresholds |
| **R5** | Confirm voids out of first refund package |

### External / legal / provider gates (not inventable in ADR Accept alone)

| Gate | Meaning |
| --- | --- |
| **LEGAL GATE G2** | Vietnam fiscal production clearance (ADR-0014 D30) — required before claiming fiscal-safe refund go-live |
| **Fiscal correction workflow** | When correction FiscalDocument is required relative to RecordCashRefund (before / after / async); Payments never owns FiscalDocument |
| **VietQR refund capability** | Verified provider method/API + fail-closed behavior before declaring **first pilot complete** (even if CARD runtime deferred) |

---

## 5. R3 option D — precise contract (PROPOSED)

```text
RecordCashRefund:
  - original_payment_id may reference Payment from a prior (possibly CLOSED) CashShift
  - cash_shift_id := CURRENT OPEN CashShift of Session Terminal (server)
  - expected of CURRENT shift decreases by amount_refunded_minor once
  - CLOSED shift close evidence / expected_source_refs NEVER rewritten
  - no CashDrawerMovement twin for the same refund
```

Fails closed if no OPEN shift on terminal. Concurrent with Close/ReceiveCash via existing lock model.

---

## 6. R6 Vietnam fiscal gate map (identification only)

| Layer | Owner | Policy |
| --- | --- | --- |
| Refund money + Payment link | Payments | Immutable refund evidence |
| Drawer expected | Cash | −refund on **current** OPEN shift |
| FiscalDocument / correction chain | Fiscalization | ADR-0014; explicit correction docs |
| Production go-live | Legal | **LEGAL GATE G2** |
| Execution | PROPOSED default | Refund may SUCCEEDED for money/drawer **without** fabricating fiscal SATISFIED; UI must not claim e-invoice corrected until Fiscal evidence exists |

**Forbidden:** invent fiscal success; mutate historical FiscalDocument; Payments writing Fiscal tables.

---

## 7. Recommended pilot scope (post-Accept — not authorized now)

1. **CASH1.3:** CASH_IN / CASH_OUT / SAFE_DROP record (Terminal-scoped).  
2. **Refund:** Partial CASH ≤ remaining on paid COMPLETED Order path (F4Б); soft Order/line refs; payout from current OPEN (R3-D if PO confirms); no inventory/commercial rewrite.  
3. **Pilot-complete checklist:** VietQR refund capability **verified** (even if not implemented); fiscal correction policy documented against G2 — no fake fiscal UX.

---

## 8. Docs follow-up in this reconciliation

- Patch ADR-0048 matrices (R1/R3/R4/R6/R7) + authority map for F4Б  
- ADR-0047 unchanged economically; cross-link this packet  
- ADRs stay **Status: PROPOSED**

**Verdict for agents:** Runtime still **LEVEL_C_BLOCKER** until ADR Accept after remaining §4 choices (+ external gates for pilot-complete claims).
