# LEGAL GATE G2 — evidence register

**As of 2026-10-29. Status of the gate: OPEN. No production GO.**

An item is not PASS because it appears in this file, in the owner packet, or in a mock. PASS requires a signed document, a source-system proof, or a test artifact, with version, date, owner, and merchant/LegalEntity scope. No production merchant credentials and no legal opinion were obtained for this register.

`NOT_APPLICABLE` is unused. A future N/A needs a signed, scope-specific reason.

Provider rows are per vendor. A MISA sandbox log does not close a Viettel row.

Artifact path, date, and expiry are empty while status is OPEN. Merchant tax code scope: **none on file**. Vendor scope: **none contracted**.

| ID | Required evidence | Expected verifier | Status | Artifact | Date | Expiry | Vendor scope | Merchant MST scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G2-01 | Enterprise or household registration, MST, verified legal and outlet addresses, legal representative authority | Merchant legal / accountant | OPEN | — | — | — | — | none |
| G2-02 | Tax classification, VAT method, registered regime (coded / non-coded / cash-register), invoice type GTGT or sales | Licensed Vietnam tax counsel + merchant CPA | OPEN | — | — | — | — | none |
| G2-03 | Tax registration or change filing (01/ĐKTĐ-HĐĐT where it applies), official acceptance, approved series/template/provider binding | Merchant accountant + provider | OPEN | — | — | — | — | none |
| G2-04 | Written determination for the first pilot: counter-prepay trigger, receipt of money vs completion of service | Vietnam tax counsel | OPEN | — | — | — | — | none |
| G2-05 | Frozen TaxOrderSnapshot mapped to a 2026 invoice sample: seller, buyer, VAT, VND rounding, reviewed issued example | Merchant accountant + tax counsel | OPEN | — | — | — | — | none |
| G2-06 | Authorized provider status and merchant service agreement for the legal issuer | Provider + merchant | OPEN | — | — | — | Viettel open; MISA open | none |
| G2-07 | KiU integrator status, partner agreement, delegated-issuance position, DPA if required | KiU legal + provider | OPEN | — | — | — | — | none |
| G2-08 | Official 2026 API kit: version, error codes, tax-status semantics, sandbox/production parity, vendor sign-off | Provider engineering | OPEN | — | — | — | Viettel open; MISA open | none |
| G2-09 | Sandbox account and signed UAT logs: issue, retrieval, tax result, PDF/XML/QR. Synthetic success is not this row | Provider + KiU QA | OPEN | — | — | — | — | none |
| G2-10 | Per-LegalEntity credential scope, vault path, rotation, revocation, TLS and IP restrictions. No cross-tenant access | KiU security | OPEN | — | — | — | — | none |
| G2-11 | Versioned FiscalSatisfactionEvidenceProfile: exact proof required for the registered mode, counsel and provider review | Architecture + tax counsel | OPEN | — | — | — | — | none |
| G2-12 | UAT and runbook: timeout-after-success, idempotent retry, lost callback, out-of-order authority status | KiU QA + provider | OPEN | — | — | — | — | none |
| G2-13 | Correction, replacement, adjustment workflow linked to the original invoice; accountant sign-off | Tax counsel + provider | OPEN | — | — | — | — | none |
| G2-14 | Lawful downtime handling and any submission deadline. C0 stays online-only until a separate accepted policy | Tax counsel + provider | OPEN | — | — | — | — | none |
| G2-15 | DPA, PII minimization, Vietnam hosting and cross-border disclosure, retention, log redaction, export and deletion | KiU legal / privacy / security | OPEN | — | — | — | — | none |
| G2-16 | Signed quote and SLA: fees, setup, quota, support hours, rate limits, escalation, cancellation | Provider commercial + KiU PO | OPEN | — | — | — | — | none |
| G2-17 | Merchant pilot consent, in-scope transaction types, training, incident owners, legal manual fallback, cash reconciliation | Merchant owner + KiU PO | OPEN | — | — | — | — | none |
| G2-18 | Separate PO production deploy GO and persistent DB migration GO, named rollback owner, monitoring. No prod test adapter | KiU PO + engineering lead | OPEN | — | — | — | — | none |

Public statutes and public vendor pages are sources for human verification. They are not artifacts for any row above.

Milestone sequence (no calendar commitment):

1. **P0** — vendor and counsel discovery. Exit: signed technical pack, written mode gaps, sample payload, test credentials, merchant #1 legal documents when a live pilot is actually being prepared.
2. **P1** — map Origin fiscal core; extend only missing typed fields after the Level C forks are accepted. Exit: synthetic transport tests, no mock SATISFIED on a production route.
3. **P2** — vendor sandbox. Exit: signed technical evidence. No real merchant PII without an approved egress basis.
4. **P3** — merchant registration and contracts. Exit: G2-01..G2-17 PASS for that scope.
5. **P4** — live pilot only after the production GO in `PRODUCTION-STOP.md`, including G2-18.
6. **P5** — another outlet or LegalEntity needs its own registration, credentials, series, and evidence. A second provider is a cut-over after reconciliation, not failover.
