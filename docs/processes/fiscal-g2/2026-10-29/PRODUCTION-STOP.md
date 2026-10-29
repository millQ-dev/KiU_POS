# Production stop — Vietnam fiscal pilot

**As of 2026-10-29: G2 = OPEN. No production tax issuance. No paid merchant onboarding. No persistent-database migration GO. No production provider enablement.**

## What is forbidden

- Routing a real Viettel or MISA client on a production process.
- Setting any LegalEntity provider binding `enabled` for `PRODUCTION`.
- Treating `testSatisfyingFiscalProviderAdapter` as a pilot, demo verification, or hidden SATISFIED path. That adapter stays disposable-test-only (`MILLQ_ALLOW_FISCAL_TEST_ADAPTER=1` and a disposable `millq_ci_pos_*` database, never `NODE_ENV=production`).
- Converting a missing provider, missing registration, timeout, or HTTP 200 into `NOT_REQUIRED` or `SATISFIED`.
- Automatic failover from Viettel to MISA (or the reverse) for a pending, unknown, submitted, or issued fiscal intent.
- Issuing a zero-value invoice, mutating `PaymentCollectionEvent`, or rolling back a recorded collection because fiscal evidence is missing.
- Offline or deferred CompleteOrder for C0. No silent grace period.
- A merge, a green Depot CI run, a public price page, or a sales assurance counting as production GO.

Production fiscal adapter resolution on Origin `main` (`42957b698c985d13d646599a429945730eb9ade5`) is `unavailableFiscalProviderAdapter`. That remains correct.

## The only production GO format

A human Product Owner approves this text separately from any ADR ACCEPT:

```text
PO GO — KiU Vietnam Fiscal Live Pilot
LegalEntity ID / merchant MST: [verified]
Outlet ID: [verified]
Provider and API version: [verified]
Registered fiscal mode / invoice series: [verified]
Tax counsel memo/version: [artifact]
G2 evidence register: G2-01..G2-18 PASS for scope (G2-18 signed in this GO)
Fiscal satisfaction policy/version: [verified]
Production deploy version/SHA: [verified]
Database migration set and rollback: [verified]
Trial date/window and traffic cap: [specific]
Ops/incident contact and merchant accounting sign-off: [named]
Provider outage procedure: [signed]
```

Scope of a future pilot, if that GO is ever signed: one merchant, one LegalEntity, one registered invoice mode, counter/prepay C0, online only. Dine-in, post-pay, deposit, and offline are not included by silence.

ADR ACCEPT, green CI, and a successful synthetic adapter are not this GO. Owner approval of this research file is not this GO.
