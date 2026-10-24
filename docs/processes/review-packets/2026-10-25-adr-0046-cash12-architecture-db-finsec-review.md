# Independent Architecture / DB / FinSec review — ADR-0046 CASH1.2

- **Date:** 2026-10-25
- **Subject:** `docs/decisions/ADR-0046-cash12-close-cash-shift.md` (Accepted WITH DELTAS)
- **Reviewer role:** Architecture + DB + Financial Security (separate from Implementation Agent)
- **Baseline:** Origin `main` `d18063f0c53d97cb2562f980f49efd75007adf40`
- **Verdict:** **APPROVE** — no new Level C blocker; Level B runtime may proceed under this ADR

## Scope checked

- Expected formula vs ADR-0038 PCE / `amount_collected_minor` / CASH-only scope
- State machine OPEN→CLOSED vs reserved RECONCILED/ACCEPTED
- Permission matrix (balanced/surplus vs shortage exception)
- Concurrency: close `FOR UPDATE` vs ReceiveCash `FOR SHARE`
- Idempotency / one close / immutable evidence
- Non-effects (no Payment/Settlement/Fiscal/Session mutation)
- Fail-closed on currency / incomplete expected base
- Explicit exclusions: refunds, mid-shift cash-in/out, fake refund events

## Findings

| # | Area | Result |
| --- | --- | --- |
| 1 | Expected = opening + Σ CASH PCE collected; no fake refunds | **PASS** — aligns PO 21А / decisions 1+7; refunds remain ADR-0038 RELEASE-BLOCKING OPEN |
| 2 | Signed difference exact minor units | **PASS** — TEXT digit / signed digit; BigInt in app |
| 3 | Shortage grant isolation | **PASS** — `cash_shift.close.shortage` only; no cashier bypass |
| 4 | Surplus/balanced composition | **PASS** — `pos.operate` + `cash_shift.close` + reason if ≠0 |
| 5 | Race model SHARE vs UPDATE | **PASS** — matches existing ReceiveCash lock; close waits / then NOT_OPEN |
| 6 | Schema coherence OPEN vs CLOSED CHECKs | **PASS** — nullable-until-close; CLOSED implies evidence |
| 7 | Client trust boundary | **PASS** — server expected/actor/grants; optional client expected echo for conflict only |
| 8 | New Level C financial semantics | **NONE** — deferred RECONCILED/refunds/cash-in-out correctly out of scope |

## Residual risks (non-blocking)

- Expected ignores future refunds until separate Accepted ADR + tests
- UI SH-02 not in CASH1.2 runtime
- Persistent migrate/deploy remains operator GO (not this package)

## Recommendation

Proceed with Level B: migration `034`, `CloseCashShift` service/route, disposable acceptance (incl. race), Origin PR, required CI, merge-when-ready after independent implementation review.
