# SEC-0 — Financial Core Adversarial Security Review

**Baseline:** Origin / GitHub `main` = `4b92457ec32652f928c92733a76f711c195094a3`  
**Branch:** `chore/sec-0-financial-core-adversarial`  
**Autonomy:** Level B remediations only (Accepted Identity + Payments/Settlement architecture).  
**Not in scope:** CASH1.1 / TAX1.1 / FISC1.1 / real PSP / refunds / new CashShift / new payment semantics.

---

## Threat model

### Assets

Payment, provider evidence (`payment_provider_outcome`), PaymentAllocation, SettlementGroup / Check / CheckLineAllocation, CustomerPayable, commercial snapshots, Order completion gates, reconciliation state, tenant / LegalEntity scope, Session / AccessGrant, provider refs, idempotency keys, audit evidence, secrets (PIN pepper, session token, webhook/provider secrets when present).

### Trust boundaries

browser/POS → API → Identity (Session/AccessGrant) → DB → provider adapter/webhook (future) → admin/dev tools.

### Attackers

Internet attacker; malicious cashier/employee/merchant; cross-tenant attacker; compromised session; compromised provider credential; replayed valid message; malicious/buggy provider; operator mistake; compromised DEV tooling.

### Abuse stories (minimum 10)

1. Unauthenticated caller opens orders / creates tenders / allocates payments for arbitrary tenants.
2. Caller injects `tenantId` in body to provision Tender under another tenant.
3. UUID-oracle IDOR: GET `/payments/{id}` across tenants.
4. DEV payment simulator mint VERIFIED SUCCESS → fake SATISFIED settlement.
5. `ALLOW_DEV_*` restores simulator/bootstrap in production.
6. Browser redirect signal treated as paid (coverage).
7. Unverified SUCCESS claim qualifies coverage.
8. Verified SUCCESS with wrong amount/currency qualifies.
9. Replay same provider event ×100 double-effects money.
10. Same idempotency key, different amount → silent overwrite.
11. Concurrent duplicate success / allocation over-covers Check.
12. Caller posts `settlementStatus=SATISFIED` / `paid=true` / `fiscalAccepted=true` to force CompleteOrder.
13. Reconciliation overwrites immutable provider outcome / invents Payment.
14. Pathological `NaN`/`1.5` amountMinor corrupts Money.
15. Session cookie CSRF via cross-site POST to financial routes.
16. Log leakage of session token / PIN / provider secrets.

---

## Findings (pre-remediation → remediation)

| ID | Severity | Prerequisite | Exploit | Asset | Impact | Location | Remediation | Permanent test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC0-01 | CRITICAL | Reach API | Call financial routes with no session | Orders/Payments/Settlement | Full financial mutation | `routes/pos.ts`, `routes/payments.ts` | Require Session + `pos.operate` AccessGrant + CSRF | `sec0-financial-adversarial` unauthenticated 401 |
| SEC0-02 | CRITICAL | NODE_ENV≠prod or misconfig | Simulator VERIFIED SUCCESS | Provider evidence / coverage | Fake SATISFIED | `payments.ts` simulator | Never register simulator in production | production never-register test |
| SEC0-03 | HIGH | ALLOW_DEV_CASHIER_BOOTSTRAP=1 | Dump tenant topology | Tenant/outlet IDs | Recon / targeting | `pos.ts` bootstrap | Never register bootstrap in production | production never-register test |
| SEC0-04 | HIGH | Unauth or wrong session | Body `tenantId` | Tenant authority | Cross-tenant provision | tender/order bodies | Session tenant authority; reject mismatch | P body tenant switch 403 |
| SEC0-05 | HIGH | Know UUID | GET foreign payment | Payment | Cross-tenant read | `GET /payments/:id` | Filter by `principal.tenantId` | B IDOR 404 |
| SEC0-06 | MEDIUM (blocking) | Auth | Post `paid`/`SATISFIED` flags | CompleteOrder gates | Bypass attempt | advance-checkout / open order | Reject authoritative fields; orchestrator-only gates | N/O mass-assign 400 |
| SEC0-07 | MEDIUM | Concurrent clients | Race allocate / duplicate outcome | Allocation / evidence | Double effect | Payments Core | Existing FOR UPDATE + unique; PG concurrency test | pay11 J/K race test |

Non-blocking residuals: service-level `OrdersService.completeOrder` has no settlement gate (Accepted: CheckoutOrchestrator owns HTTP gate; baking settlement into CompleteOrder = Level C). No real webhook yet → webhook signature tests deferred to real adapter block.

---

## A–T matrix (permanent coverage)

| | Scenario | Coverage |
| --- | --- | --- |
| A | Payment inflation rejected | PAY1.1 overcoverage / allocate exceeds |
| B | Tenant A ↛ Payment B | HTTP IDOR 404 + allocate CROSS_ENTITY |
| C | Tenant A ↛ Check B | PAY1.1 CROSS_ENTITY |
| D | Replay ×N → one effect | PAY1.1 + pay11 race unique event |
| E | Idempotency semantic conflict | PAY1.1 |
| F | Redirect → zero coverage | PAY1.1 / golden |
| G | Unverified SUCCESS → zero | PAY1.1 |
| H/I | Wrong amount/currency → no qualify | PAY1.1 |
| J | Concurrent duplicate success | pay11 PG Promise.all |
| K | Concurrent allocations | pay11 PG Promise.all |
| L | Success/failure race deterministic | PAY1.1 monotonicity |
| M | Success/abort cannot erase success | PAY1.1 external-effect |
| N | Cannot force SATISFIED | HTTP reject + reconcile from coverage only |
| O | Cannot bypass CompleteOrder gates | No completeOrder route; advance rejects flags |
| P | Tenant/LE payload injection | Session tenant; reject mismatch |
| Q | Provider ref collision | PAY1.1 |
| R | Recon cannot poison facts | Settlement reads qualifying allocations only |
| S | Pathological decimals | Money createMoney + SEC-0 S test |
| T | Evidence not ordinary CRUD-mutated | Append-only outcomes; no DELETE routes |

---

## Remediations shipped

1. Migration `028_sec0_pos_operate_permission.sql` — Identity permission `pos.operate`.
2. Shared `http-auth.ts` — session resolve, CSRF, tenant injection reject, `assertPosOperate`.
3. All POS / Orders / Payments / Settlement HTTP routes require Session + grant; tenant from Session.
4. DEV payment simulator + cashier bootstrap: **zero routes** when `NODE_ENV=production` (no ALLOW override).
5. Mass-assignment rejection for authoritative financial fields on HTTP.
6. Permanent SEC-0 + pay11 concurrency regression tests.
