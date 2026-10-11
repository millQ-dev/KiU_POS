# FISC1.1 PR #81 — Pre-merge evidence packet (sanitized)

**Status:** STOP BEFORE MERGE — awaiting PO merge authorization after close-out.  
**Prepared:** 2026-10-11  
**Updated:** 2026-10-11 — PO Level C decisions locked + adversarial tests  
**Binding:** base `b217a1e6e214e92bdd648d382a6dbe30120a6e89` → see PR tip after push  
**PR:** Origin #81 — https://cursor.com/codebase/millqdev/MillQ/pull/81

### PO ACCEPT (product decisions locked)

1. Permission key **`payments.receive_cash`** permanent  
2. **No** separate C0 business overpay cap (Money/currency/change checks remain)  
3. Tips **out** of FISC1.1; partial cash **rejected** for one-Payment/one-Check  

Adversarial close-out: `fisc11-receive-cash.adversarial.test.ts` (HTTP deny, CLOSED shift, concurrency, semantic conflict, cross-tenant, fresh 031→032 migrate).

This file is a sanitized review attachment. It does not contain secrets, `.env`, or credentials.

---

## 1. Identity confirmation

| Fact | Value |
| --- | --- |
| Origin `main` | `b217a1e6e214e92bdd648d382a6dbe30120a6e89` |
| PR base | `b217a1e6e214` (matches expected) |
| PR head | `4be71b941cba26385e528dd93511f7caf07575a6` (matches reported) |
| Branch | `feature/fisc1.1-fiscalization-core` → `main` |
| PR state | **open**, Version 1 of 1 |
| New migration only | `032_fisc11_payment_collection_fiscal_core.sql` |
| Office / Recipes / MFA / Global Account files | **absent** from diff |

Changed files (17):

```
A  apps/api/migrations/032_fisc11_payment_collection_fiscal_core.sql
A  apps/api/src/modules/fiscalization/* (5 files)
A  apps/api/src/modules/payments/payment-collection-event.ts
A  apps/api/src/modules/payments/receive-cash-service.ts
M  apps/api/src/modules/payments/payments-service.ts
M  apps/api/src/modules/payments/index.ts
M  apps/api/src/modules/identity/errors.ts
M  apps/api/src/modules/identity/index.ts
M  apps/api/src/routes/payments.ts
M  apps/api/src/routes/pos.ts
M  docs/decisions/ADR-0038-c0-cash-tender-payment-collection-event.md
M  docs/processes/current-state.md
A  docs/processes/review-packets/fisc11-level-c-open-items.md
```

---

## 2. Security-critical surfaces (file references)

### ReceiveCash authorization + Money
- Route: `apps/api/src/routes/payments.ts` — `POST /api/v1/payments/receive-cash`
  - `permissionKey: payments.receive_cash` (not `pos.operate` alone)
  - rejects client `lifecycleState` / `verificationStatus` / `fiscalStatus`
  - `rejectTenantAuthorityInjection`
- Service: `apps/api/src/modules/payments/receive-cash-service.ts`
  - OPEN CashShift for Terminal; outlet/currency/exponent match
  - server `due` from Check; `change = tendered − due`; Payment amount = due (not tendered)
  - `CHECK_ALREADY_COVERED`, `PARTIAL_CASH_REJECTED`, `CLIENT_COLLECTED_AT_FORBIDDEN`
  - unique evidence per Check + LE idempotency key

### PaymentCollectionEvent provenance
- `apps/api/src/modules/payments/payment-collection-event.ts`
- CARD mint: `payments-service.ts` allocate path + late-capture path — requires `COLLECTION_OR_CAPTURE` + `provider_occurred_at`
- CASH mint: ReceiveCash server `NOW()` acceptance clock → `collected_at`
- Migration unique: one PCE per Payment; one PCE per Check

### FiscalCheckoutGate + CompleteOrder
- Gate: `apps/api/src/modules/fiscalization/fiscal-service.ts` `observeGate` / `createCheckoutGate`
- Wired: `apps/api/src/routes/pos.ts` → `SettlementService({ fiscalGate })`
- Checkout: `apps/api/src/modules/checkout/checkout-orchestrator.ts` blocks UNAVAILABLE / PENDING / REQUIRED_NOT_SATISFIED

### FiscalDocument + immutable provider evidence
- `fiscal-service.ts` issue/reconcile; append-only `fiscal_provider_attempt` + `fiscal_provider_outcome_evidence`
- Default adapter: `unavailableFiscalProviderAdapter()` — never fake SATISFIED
- Test adapter: `testSatisfyingFiscalProviderAdapter` — **tests only**, not POS-registered

### Migration 032
- `apps/api/migrations/032_fisc11_payment_collection_fiscal_core.sql`
- Tables: cash evidence, PCE, fiscal_policy(+version), fiscal_document, submission, attempt, outcome evidence
- Columns: `collection_time_provenance`, `legal_entity.fiscal_required`
- Permission insert: `payments.receive_cash`

---

## 3. Explicit negative guarantees verified in code

| Guarantee | Evidence |
| --- | --- |
| No production fake fiscal provider | `pos.ts` constructs `new FiscalService(pool)` → unavailable adapter default; test adapter only in tests |
| No LEGAL GATE G2 claim | Comments + open-items packet; no G2 grant path |
| No VAT recalculation in Fiscalization | Issue binds `settlement_payable_snapshot.provenance_json.taxOrderSnapshotId` |
| No unrestricted CASH | Dedicated permission + OPEN shift + human confirmation + coverage guards |
| No silent fallback collection timestamp | CARD fails without provenance/time; CASH rejects client `collected_at`; no `received_at`/`satisfied_at` |
| Split/multi-tender blocked | `evaluateC0Shape` requires exactly one Check, one allocation, one PCE |

---

## 4. Independent reviews (HEAD-bound)

All four reviews re-verified after fix pass on head `4be71b9`:

| Review | Agent | Final verdict | Residual |
| --- | --- | --- | --- |
| Architecture | ac829a92-acb4-42bb-9474-650725dcf924 | **APPROVE** | D9 adapter subset; soft JSON tax bind; late-PCE test gap |
| Financial Security | 2f803346-939d-4587-8581-fd66234835d4 | **APPROVE** | HTTP grant adversarial gap; late-PCE / currency mismatch test gaps |
| Tax/Fiscal | 004dbaa7-b2e3-4aa3-b62c-1d8c8a87d713 | **APPROVE** | timeout/resume E2E untested; G2 UNGATED |
| Functional | 10365c79-7f98-4666-8d6e-5fb58b955b00 | **APPROVE** | CARD E2E issue→complete; HTTP route tests; true concurrency |

---

## 5. STOP

Do not merge until PO final review. Do not arm merge-when-ready. Do not treat backup as canonical. Do not enable production fiscal provider.
