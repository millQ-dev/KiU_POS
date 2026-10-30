# Vendor questions — Viettel and MISA — not sent

**Date:** 2026-10-30.  
**No email was sent. No form was submitted. No account was requested. No credential was requested.**

These questions are the residue after the public pages recorded in [2026-10-30-provider-evidence-checklist.md](2026-10-30-provider-evidence-checklist.md). Ask each vendor in writing. A sandbox credential, a test host, or a public page does not authorize production issuance and does not close LEGAL GATE G2.

The 2026-10-29 list in [2026-10-29/PROVIDER-DILIGENCE-QUESTIONS.md](2026-10-29/PROVIDER-DILIGENCE-QUESTIONS.md) remains unsent. Do not send either list until the sender identity is real business data. Do not invent an MST, legal entity name, or phone number.

## Viettel S-Invoice

1. Is the binding specification the file titled “Hướng dẫn tích hợp hệ thống hóa đơn điện tử 2.0 v2.54” on https://sme.viettel.vn/content_v2/guideline_v2/service/37/SINVOICE, or a newer file? Give the title, date, version, and file hash. A reseller copy is not accepted. KiU has not opened that download.
2. State the sandbox base URL and the production base URL separately. Say whether `api-vinvoice.viettel.vn` is either of them. The Sinvoice app privacy policy also names `api-vinvoice.veltel.vn`. The privacy policy is not the API specification.
3. Does an official developer sandbox exist? What written permission must KiU hold before any network call, including a call with synthetic data? State that a sandbox credential is not production authorization.
4. Give the authentication scheme and the credential fields. State who may hold them for a restaurant MST, how they rotate and revoke, and that KiU must store only a vault reference.
5. Give the issue operation for a restaurant cash-register invoice: method, path, version, and the fields that differ from other invoice types. Do not leave KiU to choose from an example client.
6. Name the idempotency field. State the result when the same key is replayed, when the same key is sent with a different amount or tax snapshot, and when the client times out after Viettel has stored the invoice. Until that written answer exists, KiU will not set `verifiedSameKeyRetry`.
7. Give the status operation and the values that mean provider publish, transmission to the tax authority, authority acceptance, and authority rejection. State which value is legally sufficient for this invoice mode. KiU will not treat a provider-confirmed publish as legal sufficiency while G2-11 is open.
8. Give the required recovery when the HTTP result is timeout or unknown. State the identifier to poll and that a second issue with a new document id is forbidden.
9. For a 2026 restaurant cash-register invoice, which of cancel, adjustment, and replacement exist, which original-document fields are required, and which operations a POS integrator must not call?
10. Is acceptance delivered by webhook, by poll, or by both? If a webhook exists, give the signature verification method. A URL alone is not verification.
11. Name the durable provider document id, the lookup code, and the tax-authority confirmation field. State which one remains valid if a PDF or URL expires.
12. List the exact sandbox host and production host, ports, and any IP allowlist. KiU will not change egress until an internal approval names that destination. Sandbox and production are different destinations.

## MISA meInvoice

1. Confirm whether the binding family is `https://doc.meinvoice.vn/itg/` as fetched on 2026-10-30, and give a document version or last-updated date. Other public trees were not adopted. Name the one family KiU must use and forbid the others.
2. The token page names `POST /api/integration/auth/token` on `testapi.meinvoice.vn` and `api.meinvoice.vn`, while the curl example on the same page names `POST https://testapi.meinvoice.vn/api/integration/invoice/token`. Which URL is binding for test, and which for production?
3. Which `SignType` is authorized for a restaurant cash-register invoice? SignType 5’s title says no digital signature, and the body comment on the same page says HSM. Resolve that in writing. Do not leave SignType 1, 2, 3, or 4 selectable by KiU.
4. `RefID` is documented as a client id used to check duplicates and to retrieve the invoice. State the result of a replay, of the same `RefID` with a different payload, and of a client timeout after MISA has stored the invoice. This wording is not a verified same-key retry capability.
5. `POST /status` documents `SendTaxStatus` separately for invoices with and without a tax-authority code. `PublishStatus` has no value list on that page. Give the numeric meanings, and give the `SendTaxStatus` map when `invoiceCalcu=true`. State which combination is authority acceptance. An example value is not that definition.
6. Give the recovery steps for timeout and for an unknown HTTP result. State whether SignType 3’s later status poll is mandatory for the authorized SignType, and which id is the poll key (`TransactionID` or `RefID`).
7. Is `POST /cancel` still a lawful operation for a 2026 cash-register invoice, or must KiU use only replacement (`ReferenceType` 1) or adjustment (`ReferenceType` 2)? State the original-invoice fields required and which call a POS integrator must not make.
8. `TokenCallback` is a string field with a comment that it updates status after issue. Is it a webhook? If yes, give the URL KiU must host, the authentication, the signature check, the retry rule, and what the callback proves. No verification scheme was on the field comment.
9. Which of `RefID`, `TransactionID`, `InvoiceCode`, and `InvNo` is the legal confirmation for a cash-register invoice? The SignType 5 example response shows `InvCode` null. State which identifier is still valid when a PDF link expires.
10. How does MISA issue `appid` to KiU as an integrator, as distinct from a restaurant tax-code login? Confirm that a test `appid` does not authorize `api.meinvoice.vn`.
11. Confirm the only sandbox host is `testapi.meinvoice.vn` and the only production host is `api.meinvoice.vn`, with ports and any IP allowlist. KiU will not call either host until an internal egress approval names that destination. Say whether the test host may receive synthetic data only.
12. State the retention, data location, and subprocessors for invoice payloads sent to each host. A public API page is not that record.
