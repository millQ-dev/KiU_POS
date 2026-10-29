# Provider diligence questions — not sent

**Date:** 2026-10-29. Updated the same day after PO APPROVE WITH CHANGES.  
**No email was sent. No form was submitted. No account was registered by this change.**

## Commercial preparation (allowed)

Negotiations, contracts, and onboarding preparation with Viettel and with MISA may proceed in parallel. Keep sandbox commercial terms and production commercial terms in separate clauses. A signed contract, a price, or an onboarding slot does not enable real merchant issuance, does not set a production binding, and does not move G2-06, G2-16, or G2-18 off OPEN. File the signed document as the artifact before any human reviewer changes a row.

Ask each vendor for a sandbox credential pack separately from any production credential. Do not request that production issuance be switched on.

Draft text to copy later, after bracketed sender identity is filled with real business data, is in [source/03_PROVIDER_EMAILS_EN_VI.md](source/03_PROVIDER_EMAILS_EN_VI.md). Do not invent a legal entity name, MST, or personal phone to send it.

Candidate order is diligence priority only: Viettel S-Invoice first, MISA meInvoice in parallel. Neither is contracted.

Official routes already on record:

- Viettel product listing: https://sme.viettel.vn/market-place/detail/SINVOICE — hotline 18008000. Ask for S-Invoice B2B technical partnership, not generic telco care.
- Existing KiU packet (2026-10-18): `docs/processes/partner-due-diligence/viettel-s-invoice-packet.md`.
- MISA developer portal: https://developer.misa.vn/ . Product docs: https://doc.meinvoice.vn/ . Do not mix developer-portal OAuth with the meInvoice product token unless MISA says they are the same credential.

## Ask both vendors (written answer required)

1. Binding API version that is valid for restaurant cash-register e-invoices under Law 108/2025/QH15, Decree 254/2026/NĐ-CP, and Circular 91/2026/TT-BTC. State whether coded, non-coded, and máy tính tiền are different payloads.
2. Sandbox base URL, production base URL, parity statement, IP allowlist, and how a test tax code is issued.
3. Auth: username/password, token, cookie, or certificate. Rotation and revocation. Confirm MISA meInvoice token is not the general MISA OAuth client, or document that it is.
4. Stable merchant idempotency key. Behavior when the same key is replayed, when the key is reused with a different amount or tax snapshot, and when the HTTP client times out after the invoice was stored.
5. Status model that distinguishes provider publish, transmission to the tax authority, authority acceptance, and authority rejection. Field names (`PublishStatus`, `SendTaxStatus`, CQT code, or Viettel equivalents) and which value is legally sufficient for which registered mode.
6. Retrieval of XML, PDF, and buyer lookup. Which identifier is durable if a URL expires.
7. Adjustment, replacement, and cancellation: which operations exist in 2026, required reference to the original invoice, and which operations a POS integrator must not call.
8. Who signs a cash-register invoice (merchant token, HSM, provider-hosted). What KiU is allowed to hold.
9. SaaS integrator versus the restaurant as seller. Separate credentials and series per MST. Whether KiU may issue on delegated authority.
10. Data location, subprocessors, retention, and a DPA. Whether sandbox may receive synthetic data only.
11. Rate limits, timeout budget, retry rules, and incident contacts. Numeric SLA only if written into an offer.
12. All-in quote for a one-outlet pilot and for 1 000 / 5 000 / 10 000 invoices: setup, API fee, pack price, VAT, term, cancellation. A July 2026 MISA list price (1 000 invoices / 1 050 000 VND) is not this quote. Viettel’s public SME page is not this quote.
13. Named engineer who will sign the sandbox UAT log for G2-09.

## Viettel-specific

- Confirm whether the integration in force is V1 (`demo-sinvoice` / InvoiceAPI) or V2 (`api-vinvoice`), and forbid mixing them. Public v2.46 packs on reseller sites are not the binding spec.
- Written confirmation that restaurant / F&B direct-to-consumer cash-register invoices are in the contracted product, not only a brochure claim.

## MISA-specific

- Which of the published families is current in 2026: `POST …/code/itg/invoice-calculating/invoiceandpublish` with `IsInvoiceCalculatingMachine=true`, or another meInvoice API. Sample pages include older payloads.
- Token host `testapi.meinvoice.vn` versus `api.meinvoice.vn`, and the exact token request fields (`appid`, tax code, username, password) for that product.
- `GetStatusInvoice` parameters `invoiceCalcu` / `invoiceWithCode` and the meaning of `PublishStatus`, `SendTaxStatus`, `InvoiceCode`, `ReferenceType` (1 replace / 2 adjust) for a 2026 POS invoice.

## Evidence rule

A public doc URL is `PUBLIC/VERIFIED` as a page existing. It is not G2-06, G2-08, or G2-16. Record the vendor’s written reply as the artifact before any status moves off OPEN.
