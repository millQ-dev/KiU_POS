# FISC1.1 Level C decision packet — remaining OPEN items

**Autonomy:** Level C (decision required before finished C0 polish claims)  
**Date:** 2026-10-11  
**Context:** FISC1.1 Core Runtime implements Accepted ADR-0014 / ADR-0038 / ADR-0039 under Level B.  
ReceiveCash and Fiscal Core ship with frozen Accepted direction. The following ADR-0038 A4 items remain **RELEASE-BLOCKING OPEN** and were **not silently invented as product policy**.

## Implemented under Accepted frozen direction (Level B)

| Topic | Binding used |
| --- | --- |
| Dedicated ReceiveCash permission | Provisional key `payments.receive_cash` (Accepted A3 dedicated permission; exact name was OPEN) |
| Tendered ≥ due; change = tendered − due | Server-authored; client cannot set lifecycle/fiscal status |
| tendered == due → change 0 | Allowed |
| Partial (tendered < due) | Rejected (`PARTIAL_CASH_REJECTED`) |
| Tips in ReceiveCash | Rejected (`TIPS_NOT_SUPPORTED`) |
| Client `collected_at` | Forbidden |
| Concurrency / idempotency | Unique per Check + LE idempotency key |
| Cash ≠ Fiscal SATISFIED | Gate remains fail-closed until verified fiscal evidence |
| No Vietnam production provider | Unavailable adapter default; test adapter only in tests |

## Level C decisions still required

1. **Exact permission key name** — confirm or rename `payments.receive_cash`.
2. **Overpay upper bounds / denomination UX** — no artificial cap enforced; confirm product bounds.
3. **Tips model** — if tips ever accepted in same command, allocation/fiscal rules (ADR-0013).
4. **Partial cash / multi-tender** — out of FISC1.1; separate Accept if needed.
5. **Cash refunds / voids / compensating ReceiveCash** — out of FISC1.1.
6. **Late / offline cash collection** — production remains fail-closed without server accept.
7. **Vietnam production FiscalProviderAdapter selection** — OUT; LEGAL GATE G2 still required for go-live.
8. **LEGAL GATE G2** — not granted by this runtime.

## Ask of Product Owner

- Accept provisional `payments.receive_cash` as the binding key name, or specify the final key.
- Confirm no overpay upper bound for C0, or provide the bound.
- Confirm tips remain out of ReceiveCash for C0.

No merge of this packet into “finished C0 release” language until these are Accepted.
