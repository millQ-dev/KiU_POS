# KiU POS — P0 Counter-Service Remediation Review Packet

**Status:** DO NOT MERGE — stop for independent review
**Branch:** `feature/p0-counter-service`
**Head:** `HEAD_SHA`
**Base:** Cursor Origin `main` at `1390758`
**GitHub backup:** `feature/p0-counter-service` on `millQ-dev/KiU_POS`

## Scope

This remediation preserves the first Vietnamese counter-service slice and reconciles it with canonical S1.1/PAY1.1 runtime contracts:

```text
bootstrap OPEN CashShift
→ takeaway Order OPEN
→ modifiers + authoritative commercial terms
→ canonical Payment / verified cash outcome
→ canonical PaymentAllocation
→ Settlement reconciliation
→ Payment SUCCEEDED / product PAID
→ Order SUBMITTED
→ production tasks
→ receipt payload + readable preview
```

No merge, QR, KDS, physical printer adapter, or Shift UI was started.

## Changed areas

- Renumbered P0 migrations after canonical `020_payments_core.sql` and `021_payments_intended_settlement.sql` to `022` and `023`.
- Removed duplicate P0 Payment, TenderDefinition, and PaymentAllocation schema.
- Added P0 cash-command idempotency evidence without duplicating PAY1.1 economic entities.
- Reworked `CashCheckoutService` to use `PaymentsService`, verified cash outcome recording, PaymentAllocation, and Settlement reconciliation.
- Added semantic conflict checks for order, shift, tendered amount, payable, currency, and exponent; concurrent retries are serialized.
- Added cashier/device validation against CashShift.
- Validated modifier snapshot currency and minor-unit exponent against the authoritative item price before applying a delta.
- Kept Order cancellation blocked by a live Settlement; safe abort remains an explicit `AbortSettlement` path.
- Reloaded authoritative Settlement state after cash checkout in the POS UI.
- Added RU/EN/VI dictionaries and coverage tests for new modifier/payment copy.
- Replaced JSON receipt output with a readable receipt preview. No physical printer success is simulated.
- Reconciled ADR-0033 explicitly with ADR-0032: cash change is implemented, satisfied payment/settlement produces Order `SUBMITTED`, and future `SUBMITTED → COMPLETED` remains the fulfillment/inventory boundary.

## Verification

- Clean database migration: `001` through `023` applied successfully.
- Backend: **21 test files, 280 tests passed**.
- ADR-0033 regression suite: **7 tests passed**.
- Web: **2 test files, 29 tests passed** with `NODE_ENV=test`.
- Monorepo typecheck: passed.
- Production build: passed for API, web, domain, and contracts.
- `git diff --check`: passed.

Commands used:

```text
env -u DATABASE_URL -u PORT -u NODE_ENV DATABASE_URL=<clean-db> pnpm --filter @millq/api migrate
env -u DATABASE_URL -u PORT -u NODE_ENV DATABASE_URL=<clean-db> pnpm --filter @millq/api test -- --run
NODE_ENV=test pnpm --filter @millq/web test -- --run
env -u PORT -u NODE_ENV -u DATABASE_URL pnpm typecheck
env -u PORT -u NODE_ENV -u DATABASE_URL pnpm build
git diff --check
```

## Unresolved risks for reviewer

- Cash, Payment, and local receipt writes cross service transaction boundaries; a process failure after canonical Payment success and before local finalization needs a future recovery/reconciliation workflow.
- The cash tender is bootstrapped on first use; production tender configuration and provider/fiscal policies remain future work.
- Fiscalization, offline semantics, refund/void, QR/card, physical printing, and full KDS remain outside this branch.
- UI language is covered for RU/EN/VI but the first runtime still defaults to English; per-user session language selection remains future work.
- Touch and localization review still needs a real 10–15 inch device/staff pass.

## Reviewer request

Please independently review lifecycle separation, money conservation, semantic idempotency, concurrency behavior, Settlement coverage, and the migration boundary before any merge. Return `APPROVE` or `REQUEST CHANGES`.
