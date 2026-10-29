# NEXT-04 status

**Baseline:** Origin/GitHub MATCH @ `02f00bf…` (#125) before NEXT-04 PRs  
**PO ACCEPT:** 2026-10-28 — M1–M8, revised M6/M7, D1–D6 (Notion pages cited in ADR-0049/0050/0051)

## Authority

| ADR | Topic |
| --- | --- |
| ADR-0049 | Modifier + Effective Recipe v1 |
| ADR-0050 | Order-local allergen M6 |
| ADR-0051 | ApplyOrderMerchantDiscount v1 |

NEXT03 prep docs stamped PO ACCEPTED (historical).

## PRs (planned)

| PR | Scope | Status |
| --- | --- | --- |
| A | ADR docs + migration `037` + domain deltas + `ModifiersService.configureOrderLine` | **Merged** Origin #127 @ `65c6754` |
| B | Counter POS modifier UI + HTTP + wire `assertLineConfigurationComplete` on accept | **Merged** Origin #129 @ `42957b6` |
| C | Allergy order-start + resolution + kitchen (legal override gated) | Follow-on |
| D | ApplyOrderMerchantDiscount v1 (API + domain policy + migration `038` + acceptance); cashier UX deferred | Level B — Origin PR open (`feature/next04-discount-d1-d6`) |

**PR A note:** Effective Recipe deltas snapshotted on `order_line_configuration.effective_recipe_deltas_json` (ADR-0049 #9).

**PR B note:** HTTP `GET …/modifier-groups` + `POST …/configure-modifiers`; commercial accept calls `assertLineConfigurationComplete`; additive VND folded into line gross; cashier `ModifierConfigurationModal` after slot select.

## PR D — ApplyOrderMerchantDiscount v1 (ADR-0051)

**Scope shipped:** API + domain + tests (no UI).

| Area | Behaviour |
| --- | --- |
| Command | `POST /api/v1/orders/:orderId/apply-merchant-discount` (`pos.operate`). Strict body: `terminalId`, `idempotencyKey`, `mode` (`FIXED_MINOR` + `amountMinor` \| `PERCENT` + `percent`), `reason`, `approvalRequestId`. No commercial-terms fields accepted; no `setOrderCommercialTerms` HTTP route exists. |
| AuthZ (D1) | Cashier requests via `POST /api/v1/identity/approval-requests` with `operationType = orders.merchant_discount.apply`; approver needs `orders.merchant_discount.approve` (migration `038`; approver ≠ requester). Apply consumes the APPROVED request (single-use, bound to requester, terminal, order, mode, amount/`percentBasisPoints`, trimmed reason) in the same transaction. Direct-permission bypass is **not** offered. |
| Amount (D3) | Fixed VND minor or percent (≤ 2 decimals); max 20% of Σ(gross − line discount) over order-discount-eligible lines (`resolveOrderMerchantDiscount`, `@millq/domain`). Percent rounds down. |
| Reason (D4) | Mandatory, non-empty after trim. |
| Lifecycle (D6) | One transaction under Order row lock: OPEN-only, no live Settlement, accepted FINAL terms required → resolve → consume approval → re-accept terms via `allocateOrderMerchantDiscount` + `persistOpenCommercialTerms`. COMPLETED / CANCELLED / live-Settlement orders are rejected without consuming approval. |
| Semantics | A new approved discount **replaces** the prior order discount (not stacking); prior amount recorded in `provenance_json.merchantDiscount`. Audit: `identity_audit_event` `ORDER_MERCHANT_DISCOUNT_APPLIED`. Idempotent retry (same key + same semantics) returns `duplicate`. |
| Follow-ups | After applying, TAX1.1 `accept-tax-snapshot` should be (re)accepted (TaxOrderSnapshot is keyed by commercial fingerprint, which changes; not covered by this PR's tests) before `open-settlement`. Cashier UX (button, reason field, approval QR/request hook) is a follow-up PR. LoginChallenge as an extra evidence leg is not wired (approval requests already carry `login_challenge_id` from creation). |

**Tests:** `packages/domain` `order-merchant-discount.test.ts` (cap/rounding/reason); `apps/api` `discounts/apply-order-merchant-discount.acceptance.test.ts` (disposable `millq_ci_pos_*` only; skipped otherwise).

## CI flake

GitHub Actions #40645853976 E2E fail documented in `NEXT04_CI_FLAKE_NOTE.md` — separate from DEMO29_GO.

## Verdict

**POSV1_NO_GO** until A–D land with evidence. **R1.1** still gated.
