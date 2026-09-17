# Vietnam Fiscalization — Forge UX Scenarios (2026)

**Baseline:** `1390758879e3764557c0b6930fe640b00547b749`  
**Scope:** Future UX scenario set only — **no runtime or API promises**  
**Labels:** `VERIFIED P0` | `FUTURE` | `LEGAL UNKNOWN`

---

## Scenario set

| ID | Scenario | Cashier / Forge surface (conceptual) | Label |
| --- | --- | --- | --- |
| UX-01 | Fiscal not required | Gate `NOT_REQUIRED`; CompleteOrder allowed by policy | VERIFIED P0 (architecture) |
| UX-02 | Generating invoice | Spinner / “Issuing e-invoice…” when FiscalPolicy requires issue at this step (often after Settlement SATISFIED; not a fixed universal moment) | VERIFIED P0 |
| UX-03 | Issued | Show fiscal reference / CQT code / lookup QR if provided | VERIFIED P0 |
| UX-04 | Provider pending | “Waiting for e-invoice provider…” | VERIFIED P0 |
| UX-05 | Tax-authority pending | “Waiting for tax authority code / acceptance…” (có mã / transmission) | VERIFIED P0 |
| UX-06 | Retrying | Auto/manual retry after timeout; show attempt identity | VERIFIED P0 |
| UX-07 | Failed retryable | Error + Retry; do not claim issued | VERIFIED P0 |
| UX-08 | Configuration missing | LegalEntity MST / series / terminal / credentials missing | VERIFIED P0 |
| UX-09 | Customer requests company (B2B) invoice | Collect buyer name + MST (+ address); hold issue until captured | VERIFIED P0 |
| UX-10 | Invoice already issued | Idempotent view of existing FiscalDocument; no second issue | VERIFIED P0 |
| UX-11 | Correction required | Block silent edit; route to adjustment/replacement workflow | FUTURE (ops) |
| UX-12 | Offline / deferred submission | Queue locally if law/provider allows; never show as tax-accepted | LEGAL UNKNOWN |
| UX-13 | Payment OK, fiscal pending — CompleteOrder blocked | Policy fail-closed: stay on order / “cannot close until fiscal…” | VERIFIED P0 (default until policy) |
| UX-14 | Payment OK, fiscal pending — CompleteOrder allowed | Policy-allowed continue; badge “fiscal deferred” | LEGAL UNKNOWN / FUTURE FiscalPolicy |
| UX-15 | Provider unavailable | Fail-closed or deferred per policy; clear UNAVAILABLE | VERIFIED P0 |
| UX-16 | Refund after issued sale | Trigger compensating fiscal flow (future Refund block) | FUTURE |
| UX-17 | Household-business-only UI | **Do not** ship as default for corporate merchants | VERIFIED P0 (negative) |

---

## Golden permanent acceptance path (future)

Conceptual permanent path (exact fiscal ↔ CompleteOrder ordering is **FiscalPolicy-owned**, ADR-0032 — do not hardcode):

```
Order
→ commercial accepted (C1.1)
→ Settlement + Check (S1.1)
→ Payment → Settlement SATISFIED (PAY1.1)
→ required FiscalDocument issue + authoritative success evidence
  (before and/or after CompleteOrder per FiscalPolicy / JurisdictionProfile)
→ Checkout CompleteOrder (when gate permits)
→ inventory once (ADR-0025)
→ reporting once (ADR-0028; fiscal ≠ Revenue SoT)
```

### Failure drills (future acceptance)

| Code | Failure | Expected architecture behaviour |
| --- | --- | --- |
| F-A | Payment success + fiscal pending | Gate PENDING; CompleteOrder per FiscalPolicy only |
| F-B | Duplicate Issue retry | Same merchant request identity → one legal invoice |
| F-C | Provider timeout but invoice issued | Status inquiry recovers provider/tax truth |
| F-D | Duplicate callback | Idempotent apply |
| F-E | Provider unavailable | Queue or fail-closed; never fabricate acceptance |
| F-F | Correction after completed sale | New correction/replacement document; no silent mutate |

---

## Notes

- Presentation (print / email / SMS / QR) ≠ legal issuance.  
- Do not promise Forge APIs in this packet.  
- Tax fields UX (rate display) depends on **Tax architecture** — blocked until that ADR.
