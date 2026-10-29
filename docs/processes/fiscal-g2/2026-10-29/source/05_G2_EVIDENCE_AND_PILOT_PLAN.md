# LEGAL GATE G2 — evidence register and activation plan

**As of 2026-10-29: G2 = OPEN / NO PRODUCTION GO.** An item cannot be marked PASS because it was described in a proposal or shown in a mock. Each evidence item requires a specific signed document, source system proof or test artifact, version/date/owner and merchant/LegalEntity scope. No production merchant credentials or legal opinions were obtained in this research.

## Register — all items initially OPEN

| ID | Evidence (specific artifact to collect) | Expected verifier | Status |
|---|---|---|---|
| G2-01 | Merchant enterprise/household registration, MST and verified legal/outlet addresses, legal representative authority | Merchant legal/accountant | OPEN |
| G2-02 | Merchant tax classification/VAT method and **registered fiscal invoice regime** (coded/noncoded/POS), type GTGT or sales | Licensed Vietnam tax counsel + merchant CPA | OPEN |
| G2-03 | Tax registration/change form (e.g. 01/ĐKTĐ-HĐĐT where relevant), official tax receipt and **acceptance**, approved invoice series/template/provider binding | Merchant accountant + provider | OPEN |
| G2-04 | Written tax counsel determination for actual first pilot: counter-prepay trigger, receipt of money vs completion of service, no exception ignored | Vietnam tax counsel | OPEN |
| G2-05 | Tax and fiscal document fields: frozen TaxOrderSnapshot mapping to real 2026 invoice sample, seller/buyer content, VAT and VND rounding, issued example reviewed | Merchant accountant + tax counsel | OPEN |
| G2-06 | Viettel or MISA authorized provider status and merchant service agreement for specific legal issuer | Provider + merchant | OPEN |
| G2-07 | KiU SaaS integrator legal status, integration/partner agreement, explicit delegated issuance position and DPA if applicable | KiU legal + provider | OPEN |
| G2-08 | Official 2026 provider machine/coded/noncoded API kit incl version, error codes, tax-status semantics, sandbox/production compatibility, vendor technical sign-off | Provider engineering | OPEN |
| G2-09 | Sandbox account and **signed** provider UAT logs: issue → retrieval → tax result → PDF/XML/QR; never synthetic result treated as real | Provider + KiU QA | OPEN |
| G2-10 | Merchant/LegalEntity credential scoping, secret vault path, credential rotation, TLS/security and IP restrictions tested; no cross-tenant access | KiU security | OPEN |
| G2-11 | Versioned `FiscalSatisfactionEvidenceProfile`: exact authoritative proof required for registered mode; reviewed by counsel/provider | Architecture + tax counsel | OPEN |
| G2-12 | Timeout-after-success, idempotent retry, lost callbacks, out-of-order CQT responses, reconciliation reports: UAT proof and runbook | KiU QA + provider | OPEN |
| G2-13 | Error correction/replacement/adjustment formal workflow, linking original invoice; authorization and merchant/accountant sign-off | Tax counsel + provider | OPEN |
| G2-14 | Lawful downtime handling and any submission deadline/exemption; C0 online-only remains until separate accepted policy | Tax counsel + provider | OPEN |
| G2-15 | Data-processing agreement, seller/buyer PII minimization, Vietnam hosting/cross-border disclosure/retention, verified logging redaction and export/deletion processes | KiU legal/privacy/security | OPEN |
| G2-16 | Signed quote and SLA: per-doc fees, setup, sandbox/production limits, service support hours, rate limits, incident escalation and contractual performance | Provider commercial + KiU PO | OPEN |
| G2-17 | Merchant production pilot consent, test business transaction types, staff training, incident/rollback owners, legal manual fallback procedure and cash reconciliation | Merchant owner + KiU PO | OPEN |
| G2-18 | Explicit separate **PO production deployment GO** and **persistent DB migration GO** for named merchant and scope, approved release/rollback, monitoring and alerting | KiU PO + engineering lead | OPEN |

If `NOT_APPLICABLE`, attach a signed, scope-specific explanation; no naked N/A. Provider-specific gates must be independently fulfilled for each vendor; MISA test result cannot clear Viettel requirement.

## Timelined dependency sequence (milestone-based, NOT promised calendar dates)

### Stage P0 — Provider and legal discovery

- Ask both vendors for binding 2026 API, sandbox, partner contract, price/SLA, merchant onboard and current POS e-invoice protocol. Obtain a qualified local counsel memo for specific seller and fiscal mode. No provider is selected for live issue just by public docs.
- EXIT: candidate signed technical pack, written mode/gap list, sample payload and test credentials, vendor engineer, Merchant #1 initial legal documents (for live only).

### Stage P1 — KiU mapping and local tests

- Inspect actual Origin `FiscalProviderAdapter`, frozen tax facts, FiscalPolicy, FiscalCheckoutGate and PaymentCollectionEvent; extend only the missing typed adapter fields, persist idempotent business intent and provider attempt, test fail-closed states.
- EXIT: code tests passed with synthetic transport fixtures, no mock `SATISFIED` routed to prod, no unauthorized economic changes, architecture acceptance on genuinely new Level C semantics.

### Stage P2 — Vendor sandbox / UAT

- Inject real sandbox responses for success, pending, rejected, unknown timeout, duplicate callback, retry and retrieval; confirm actual fiscal document data, status mapping and provider tax acknowledgment semantics.
- EXIT: signed technical evidence, test matrix, vendor API version, credential and error handling demonstrated; no real merchant data egress without approved basis.

### Stage P3 — Legal + merchant production onboarding

- Merchant registers the exact invoice mode/series/provider, obtains acceptance from tax office and vendor; contract and merchant-specific credentials are issued via secure channel. Collect counsel determination on 2026 requirements/authority evidence; DPA, security and operational runbook.
- EXIT: all G2-01..G2-17 PASS, production issuer legally configured, commercial agreement/SLA confirmed.

### Stage P4 — Controlled live pilot (separate named PO GO)

- One merchant, one outlet, one legal tax code/series, narrow counter/prepay C0, limited real transactions; operator on call and accountant reconciliation daily, human contingency procedure in case of fiscal outage. Production provider is enabled only in merchant-scoped binding and deployment approval.
- EXIT: G2-18 explicit production and DB GO, first invoice verified by provider + authoritative tax status with the required policy evidence, buyer retrieval demonstrable, no duplicate fiscal invoice, accounting/Tax snapshots reconcile, metrics/incident log approved.

### Stage P5 — Expansion / reserve

- Extend to more outlets and merchant entities only after each merchant has separate accepted registration/credential/series and successful test evidence. An alternate provider is a **planned switch**, not automatic failover: reconcile all `PENDING/UNKNOWN` first, preserve invoice histories and tax-office/merchant cutover approval.

## Production GO — exact decision format

A human authorized PO must approve separately:

```
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

A mere PO ACCEPT on an ADR, green CI, public price page, partner sales assurance or successful synthetic `testSatisfyingFiscalProviderAdapter` is NOT equivalent to this GO.
