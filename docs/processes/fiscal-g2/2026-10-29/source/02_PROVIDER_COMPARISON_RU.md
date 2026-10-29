# KiU POS — Viettel S-Invoice vs MISA meInvoice (29.10.2026)

Evidence labels: **PUBLIC/VERIFIED** means provider-owned public page/docs or government source; **NOT VERIFIED** means neither contract nor tested merchant credentials received; **REQUEST** means explicit contractual/technical diligence question. Older public docs are not proof of a current 2026 production API contract.

| Criterion | Viettel S-Invoice | MISA meInvoice | Gate/decision |
|---|---|---|---|
| Product / provider | Viettel Telecom official SME catalog advertises SInvoice e-invoicing. https://sme.viettel.vn/market-place/detail/SINVOICE | MISA first-party meInvoice and developer portal. https://www.meinvoice.vn ; https://developer.misa.vn/ | Both viable **candidates**, no KiU partnership confirmed |
| External integration | S-Invoice public REST Webservice integration docs; 2025 v2.46 technical download listed on reseller/help pages; API issue/search/adjust/replace/cancel/download referenced. https://www.sinvoice.vn/p/tai-ve.html?m=1 ; https://www.tlptech.vn/tai-lieu-mo-ta-webservice-hoa-don-dien-tu-viettel-api | First-party REST API docs for token, POS issue, invoice status, retrieval, corrections. https://doc.meinvoice.vn/api/index.html ; https://doc.meinvoice.vn/api/Document/InvoicePublishCalculatingMachine.html | Viettel current version/document ownership and 2026 MTT API **REQUEST**. MISA current product-specific API/merchant version **REQUEST**. |
| POS cash-register invoice | Vendor product claims; *binding* 2026 POS-specific API payload, tax status and semantic success **NOT VERIFIED** | Explicit first-party `code/itg/invoice-calculating/invoiceandpublish`, `IsInvoiceCalculatingMachine=true`; docs example in test environment. | MISA leads on public POS API evidence. |
| Sandbox | Viettel demo/webservice guides exist; exact approved endpoints, credentials and parity **REQUEST** | `testapi.meinvoice.vn` vs `api.meinvoice.vn`; per-merchant taxcode/appID credentials required. https://doc.meinvoice.vn/itg/Doc/GetToken.html | Neither KiU sandbox account received. |
| Authentication | Provider webservice user/merchant credentials documented in third-party and vendor download descriptions; **verify** protocol (legacy session/cookie vs newer token). No shared production credential. | meInvoice integration token page documents `appid`, `taxcode`, `username`, `password` in token request; its general Developer Portal discusses OAuth 2.0 for broader MISA ecosystem — **do not mix auth models**. | Ask for exact product/API auth and secret-rotation mechanism. |
| Status/inquiry | Search and invoice retrieval in integration docs; exact machine invoice tax statuses, polling intervals, idempotency fields **REQUEST** | First-party status endpoint `/status`, params `invoiceCalcu` and `invoiceWithCode`, response `PublishStatus`, `SendTaxStatus`, `InvoiceCode`, `ReferenceType`. https://doc.meinvoice.vn/itg/Doc/GetStatusInvoice.html | Never treat HTTP 200, publish pending, email sent as legally sufficient. Confirm evidence mapping per mode. |
| Adjustment/replacement | Docs show issue/replace/adjust/cancel; 2026 applicability and allowed operational actions **REQUEST** | POS issue docs describe `ReferenceType` 1 replace / 2 adjust and original invoice references. https://doc.meinvoice.vn/api/Document/InvoicePublishCalculatingMachine.html | Approved issued doc correction is append-only; not generic cancel/refund. |
| Download / buyer delivery | Download/search described, public product supports issuance/delivery; URLs and artifact retention **REQUEST** | Download XML/PDF/HTML documented and invoice lookup link; some view links expire. https://doc.meinvoice.vn/itg/Doc/DowloadInvoice.html | Preserve durable legally meaningful identifiers and evidence, not only an expiring URL. |
| Rate limits / retries / timeouts | **UNKNOWN** | Portal acknowledges rate limits vary by plan, exact product thresholds unknown. | Obtain contractual numeric limits, timeout policy, idempotency guarantees and tax authority outages. |
| Price | Official SME catalog has price tab/quote process but no verified API-integration and MTT price in collected evidence. **REQUEST firm quote** | MISA site (updated 03 Jul 2026) lists illustrative 1,000 invoices / 1,050,000 VND; 5,000 / 3,150,000 VND; 10,000 / 5,250,000 VND. Tariff by type, onboarding, VAT, API fee, annual validity and partner discount **NOT VERIFIED**. https://www.meinvoice.vn/tin-tuc/7418/phan-mem-hoa-don-dien-tu/ | Marketing price ≠ signed quote. Ask for all-in 1k/5k/10k invoices monthly/yearly scenarios. |
| SLA / support | Official SME contact 18008000. Product uptime, 24×7 incident response, sandbox SLA, RTO/RPO **UNKNOWN**. | Developer support channel on portal; formal SLA, response, escalation and incident procedures **UNKNOWN**. | Contract required. |
| Partner / white label / multi-merchant | **NOT VERIFIED**: supplier direct merchant vs SaaS integrator program and API rights | Developer Portal allows registered developer applications; exact meInvoice partnership reseller/white-label terms **REQUEST**. | KiU must remain technical intermediary, restaurant is seller; no credential mixing. |
| Jurisdiction 2026 / merchant compliance | Decree 254 and Circular 91 mapping must be confirmed in writing, not inferred from generic brochure. | Same. Old samples from 2022/2025 don't prove 2026 mode. | LEGAL G2 blocking item. |

## Recommendation

- **Primary commercial/technical diligence:** Viettel S-Invoice, conditional. Existing KiU partner due-diligence packet dated 18 Oct 2026 already nominates Viettel as candidate. Request binding 2026 MTT API specification, sandbox, exact status and acknowledgment evidence, merchant registration, credential model, partner contract, price and SLA. If proof is not supplied, do **not** write blind production adapter.
- **Parallel fallback / possible technical first:** MISA meInvoice. Its first-party documentation clearly shows the machine-invoice issue API and status endpoint. Give it equal priority for obtaining sandbox keys and testing the provider-neutral adapter. Consider flipping to MISA as primary if MISA clears the evidence gates while Viettel does not.
- **Never automate fiscal failover across providers** for an issued, submitted, unknown or pending business intent. Migrations/switches require new authorized merchant binding, series/numbering reconciliation and a documented cut-over. One provider per configured legal-entity/registered fiscal mode at a time; tax/merchant ownership verified.

## Weighted decision matrix — evaluation rule (no fabricated scores)

| Weight | Capability (binary evidence gate) | Required evidence |
|---:|---|---|
| 25% | Legal MTT/coded/noncoded compatibility | Written provider + merchant counsel mapping to accepted 2026 registered mode |
| 25% | Safe issue → status → timeout reconciliation | Sandbox demonstrations: timeout-after-issued, repeat, duplicate callback, authority rejection, reconciliation |
| 15% | Real API / sandbox + vendor engineering support | Versioned OpenAPI/Postman + test tenant keys + live support engineer |
| 10% | Corrections, replacement, retrieval | Sandbox correction reference chain + provider tax status |
| 10% | Multi-tenant and credential security | Merchant-scoped credentials/vault, authorized API partner/processor terms |
| 10% | Contract/SLA/security | Service contract, SLO/SLA, escalation, incident notices, retention/egress |
| 5% | Price | Written fee schedule per merchant, setup, invoice packs, support/API |

**Decision rule:** all legal/idempotency/tenant/production evidence gates MUST pass. A high weighted score cannot compensate for any red blocking gate. Exact live preference only after both offers and tests. No partner promise, prices, uptime percentage or speed assumption is asserted here.

## Contact routes (not messages sent)

- Viettel official SInvoice SME: https://sme.viettel.vn/market-place/detail/SINVOICE — hotline **18008000** (official product listing). Ask to route to S-Invoice B2B technical partnership / integrations team, not generic telco care.
- MISA developer portal: https://developer.misa.vn/ — register developer account/request Open API product access. MISA meInvoice: https://www.meinvoice.vn/ ; https://doc.meinvoice.vn/ . Public support via website contact. Current direct personal sales contact not independently verified; use company form/portal.
