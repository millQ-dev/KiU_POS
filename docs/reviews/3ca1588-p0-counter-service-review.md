# KiU POS — P0 Counter-Service Remediation Review Packet

**Status:** DO NOT MERGE — stop for independent review
**Branch:** `feature/p0-counter-service`
**Implementation commit:** see the implementation commit in the final handoff
**Review branch tip:** see the final branch SHA in the handoff response
**Base:** Cursor Origin `main` at `9c97702`
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

- Renumbered P0 migrations after canonical `020_payments_core.sql` and `021_payments_intended_settlement.sql` to `022`; removed the redundant `023` alignment migration because `022` owns those columns.
- Removed duplicate P0 Payment, TenderDefinition, and PaymentAllocation schema.
- Added P0 cash-command idempotency evidence without duplicating PAY1.1 economic entities.
- Reworked `CashCheckoutService` to use `PaymentsService`, verified cash outcome recording, PaymentAllocation, and Settlement reconciliation.
- Added durable `RESERVED → PAYMENT_RECONCILED → FINALIZED` recovery state so a retry after canonical Payment/Settlement success completes local finalization exactly once.
- Added an explicit idempotent Orders application boundary for `OrderSubmitted`; production tasks and the submission audit derive from that boundary.
- Added semantic conflict checks for order, shift, tendered amount, payable, currency, and exponent; concurrent retries are serialized.
- Added cashier/device validation against CashShift.
- Validated modifier snapshot currency and minor-unit exponent against the authoritative item price before applying a delta.
- Kept Order cancellation blocked by a live Settlement; safe abort remains an explicit `AbortSettlement` path.
- Reloaded authoritative Settlement state after cash checkout in the POS UI.
- Added RU/EN/VI dictionaries plus critical cashier render coverage for Pay, modifiers, cash success, and receipt preview.
- Replaced JSON receipt output with a readable receipt preview. No physical printer success is simulated.
- Reconciled ADR-0033 explicitly with ADR-0032: cash change is implemented, satisfied payment/settlement produces Order `SUBMITTED`, and future `SUBMITTED → COMPLETED` remains the fulfillment/inventory boundary.

## Verification

- Clean database migration: `001` through `022` applied successfully.
- Backend: **21 test files, 281 tests passed**.
- ADR-0033 regression suite: **8 tests passed**, including failpoint recovery, invalid context without Settlement, and wrong-context replay rejection.
- Web: **3 test files, 36 tests passed** with `NODE_ENV=test`, including RU/EN/VI critical P0 render coverage.
- API and web typecheck: passed.
- Production build: to be recorded after the final clean run.
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

- Cash, Payment, Settlement, and local receipt writes still cross service transaction boundaries; the durable command state and failpoint test cover the P0 recovery path, while operational support tooling for manually unresolved commands remains future work.
- The cash tender is bootstrapped on first use; production tender configuration and provider/fiscal policies remain future work.
- Fiscalization, offline semantics, refund/void, QR/card, physical printing, and full KDS remain outside this branch.
- UI language is covered for RU/EN/VI and the cashier shell defaults to RU with EN/VI selectors; per-user persisted language preference remains future work.
- Touch and localization review still needs a real 10–15 inch device/staff pass.

## Reviewer request

Please independently review lifecycle separation, money conservation, semantic idempotency, concurrency behavior, Settlement coverage, and the migration boundary before any merge. Return `APPROVE` or `REQUEST CHANGES`.
