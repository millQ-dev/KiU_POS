# Provider evidence checklist — Viettel S-Invoice and MISA meInvoice

**Date:** 2026-10-30. Research pass the same day, after PR #158.  
**Origin basis:** ADR-0053 Accepted with changes, S1–S6. LEGAL GATE G2 remains OPEN.  
**No email was sent. No credential was requested. No provider API was called.** Documentation HTML was read. Downloadable Viettel files were not opened.

A public page can verify only the words on that page. It is not a KiU contract, not a credential, not an egress approval, and not legal sufficiency. A sandbox or test host is not production authorization. A marketing page is not an API contract. A MISA page does not close a Viettel cell. No G2 row moves off OPEN because of this file.

Labels:

- **VERIFIED** — the cited official page, read on 2026-10-30, says this.
- **PROVIDER CONFIRMATION REQUIRED** — a public text or catalog entry exists, and KiU still needs a written vendor answer before relying on it.
- **UNKNOWN** — not stated on the pages read. An unread file stays UNKNOWN.
- **UNSUPPORTED** — the page that would have to define it does not.

Live sandbox network calls stay blocked until the written contract, permitted credentials, vendor authorization, and destination-specific egress approval all exist for that destination.

Residual unsent questions: [2026-10-30-provider-questions.md](2026-10-30-provider-questions.md). The 2026-10-29 question list stays unsent and is not replaced as a historical note.

## Gate rows

These rows stay **OPEN**. Public documentation does not fill them.

| Requirement | Viettel S-Invoice | MISA meInvoice |
| --- | --- | --- |
| API version and binding specification | OPEN — catalog title only; file not read | OPEN — public `/itg/` pages have no version or date |
| Idempotency: same key, and same key with a different payload | OPEN — no written guarantee | OPEN — duplicate-check wording is not a retry guarantee |
| Status query: provider publish vs authority acceptance vs rejection | OPEN — not in a read specification | OPEN — fields exist; legally sufficient values are not confirmed |
| Sandbox authorization for KiU as integrator | OPEN — not received | OPEN — a documented test host is not KiU authorization |
| Permitted credentials (vault reference only; no secret in git) | OPEN — not received | OPEN — field names exist; no KiU credential |
| Contract / commercial authorization | OPEN — not signed | OPEN — not signed |
| Destination-specific egress approval | OPEN — not approved | OPEN — hostnames are documented; approval is not |

`verifiedSameKeyRetry` stays unset for both providers. `FiscalService.reconcileDocument` reconciles the same document and leaves an unknown result unresolved.

## Viettel S-Invoice

| # | Topic | Label | What was read |
| --- | --- | --- | --- |
| 1 | Official API documentation and version | PROVIDER CONFIRMATION REQUIRED | The Viettel SME guide page lists a download titled “Hướng dẫn tích hợp hệ thống hóa đơn điện tử 2.0 v2.54”, an English integration guide, C# and Java API examples, a certificate guide, and contract-form titles. The files were not opened. v2.54 is a catalog title, not a specification KiU holds. |
| 2 | Developer sandbox | UNKNOWN | That page does not state a sandbox base URL or a developer-sandbox program. |
| 3 | Vendor permission / contract | PROVIDER CONFIRMATION REQUIRED | The same page lists downloadable contract forms, including “BM02.HD.HDDT”. No form was opened and none is signed for KiU. |
| 4 | Authentication and credentials | UNKNOWN | Not in the pages read. |
| 5 | Issue endpoint | UNKNOWN | Not in the pages read. |
| 6 | Idempotency | UNKNOWN | Not in the pages read. Do not infer it from an example client. |
| 7 | Status query | UNKNOWN | Not in the pages read. |
| 8 | Timeout and uncertain result | UNKNOWN | Not in the pages read. |
| 9 | Cancellation / correction | UNKNOWN | The SME page lists a download “HDSD sai sót 04SS NĐ70”. The file was not opened, so the operation is not verified. |
| 10 | Callback / webhook verification | UNKNOWN | Not in the pages read. |
| 11 | Provider document IDs and legal confirmation | UNKNOWN | Not in the pages read. |
| 12 | Destination and egress | PROVIDER CONFIRMATION REQUIRED | The Sinvoice app privacy policy names `https://api-vinvoice.viettel.vn` as the Sinvoice domain and, in the next sentence, names `https://api-vinvoice.veltel.vn` as the push destination. The policy has no visible version or date. It is not an API specification. The two host spellings disagree, so neither host is an approved egress destination. |

Official sources read:

- https://sme.viettel.vn/content_v2/guideline_v2/service/37/SINVOICE — fetched 2026-10-30. No documentation version beyond the download title v2.54. Spare link named on that page: `https://mybox.vietteltelecom.vn/drive/s/ZMQUwT02b4v8d4Ct1ZFliB4qs9OFzj`. Not downloaded.
- https://vinvoice.viettel.vn/policy-sinvoice.html — privacy policy, fetched 2026-10-30. Not an API contract.

The SME product landing page describes business features. It was not used as an API contract.

## MISA meInvoice

Pages under `https://doc.meinvoice.vn/itg/` were read on 2026-10-30. None of those pages shows a documentation version or a last-updated date. Search results the same day also pointed at other trees (`/ticket/`, `/api/`). Those trees were not adopted. They are not the same contract until MISA says which tree is binding.

| # | Topic | Label | What was read |
| --- | --- | --- | --- |
| 1 | Official API documentation and version | PROVIDER CONFIRMATION REQUIRED | The integration intro describes REST services and names a test base URL and a production base URL. No version or date is on the page. |
| 2 | Developer sandbox | VERIFIED as a documented test host; PROVIDER CONFIRMATION REQUIRED for KiU | Test base: `https://testapi.meinvoice.vn/api/integration/invoice`. Production base: `https://api.meinvoice.vn/api/integration/invoice`. A test URL does not authorize KiU to call it and does not authorize production. |
| 3 | Vendor permission / contract | UNKNOWN | The pages describe an `appid` “được MISA cung cấp”. They do not state KiU’s integrator permission or a contract. |
| 4 | Authentication and credentials | VERIFIED as field names; PROVIDER CONFIRMATION REQUIRED as the binding path | Token body fields are `appid`, `taxcode`, `username`, `password`. Other calls use `Authorization: Bearer`. The token section names `POST https://testapi.meinvoice.vn/api/integration/auth/token` and `POST https://api.meinvoice.vn/api/integration/auth/token`. The curl example on the same page names `https://testapi.meinvoice.vn/api/integration/invoice/token`. Both cannot be assumed. Example token material on that page was not copied. |
| 5 | Issue endpoint | PROVIDER CONFIRMATION REQUIRED | Several publish pages describe `POST` to the integration base with a `SignType`. SignType 5 was read in full: the title says a cash-register invoice without a digital signature, and the body comment on the same page says HSM signing. That contradiction is unresolved. SignType 1, 2, 3, and 4 titles were seen the same day and are not selected. |
| 6 | Idempotency | VERIFIED only as a duplicate-check sentence; UNKNOWN as a retry guarantee | `RefID` is a required client id, recommended as a GUID, “dùng làm khóa chính để check trùng” and to retrieve the invoice. The page does not state the result of a replay, of the same `RefID` with a different payload, or of a timeout after MISA has stored the invoice. This is not `verifiedSameKeyRetry`. |
| 7 | Status query | VERIFIED as fields; PROVIDER CONFIRMATION REQUIRED for legal meaning | `POST /status`. Parameters include `invoiceWithCode`, `invoiceCalcu`, and `inputType` (1 lookup code, 2 `RefID`). `SendTaxStatus` is enumerated separately for invoices without a tax-authority code and with one. `PublishStatus` is an integer with no value list on that page. An example uses `PublishStatus` 1 and does not define it. `invoiceCalcu=true` is not given its own `SendTaxStatus` map. |
| 8 | Timeout and uncertain result | UNKNOWN | No timeout, retry, or uncertain-HTTP-result rule was on the pages read. SignType 3 is described as an asynchronous queue that returns `TransactionID` for a later status call. That is not a timeout contract. |
| 9 | Cancellation / correction | VERIFIED as a documented cancel call; PROVIDER CONFIRMATION REQUIRED for 2026 use | `POST /cancel` with `TransactionID`, `InvSeries`, and `CancelReason`. Adjustment and replacement fields exist on `InvoiceData`: `ReferenceType` 1 thay thế, 2 điều chỉnh, plus original series, number, and date. The status object uses `ReferenceType` 0 gốc, 1 thay thế, 2 điều chỉnh. Whether a POS integrator may call cancel for a 2026 cash-register invoice is not stated. |
| 10 | Callback / webhook verification | VERIFIED that a field exists; UNSUPPORTED as a verification contract | `InvoiceData` has `TokenCallback`, commented as a token callback to update status after issue. No URL, signature, retry, or verification steps are on that page. |
| 11 | Provider IDs and legal confirmation | PROVIDER CONFIRMATION REQUIRED | Documented names: client `RefID`, lookup `TransactionID`, tax-authority `InvoiceCode` for invoices with a code, and `InvNo` in a SignType 5 example response. The SignType 5 example shows `InvCode` null. Which value is legal confirmation for a cash-register invoice is not stated. |
| 12 | Destination and egress | VERIFIED as documented hostnames; OPEN as KiU approval | Test host `testapi.meinvoice.vn`. Production host `api.meinvoice.vn`. No port, IP allowlist, or KiU egress record is on the pages. No egress setting was changed. |

Official sources read on 2026-10-30, no version stamp on the pages:

- https://doc.meinvoice.vn/itg/intro.html
- https://doc.meinvoice.vn/itg/Doc/GetToken.html
- https://doc.meinvoice.vn/itg/Doc/Info/InvoiceData.html
- https://doc.meinvoice.vn/itg/Doc/GetStatusInvoice.html
- https://doc.meinvoice.vn/itg/Doc/publish/SignType5.html
- https://doc.meinvoice.vn/itg/Doc/Cancel.html

SignType titles also seen the same day, not selected:  
https://doc.meinvoice.vn/itg/Doc/publish/SignType1.html  
https://doc.meinvoice.vn/itg/Doc/publish/SignType2.html  
https://doc.meinvoice.vn/itg/Doc/publish/SignType3.html  
https://doc.meinvoice.vn/itg/Doc/publish/SignType4.html

Local synthetic work may use `executeSandboxFiscalAttempt`. That path does not call these vendors and does not satisfy `FiscalCheckoutGate`.

## Crash window — attempt row after the provider call

Not implemented here. No new status and no new legal meaning.

On Origin `main` at `d30de92131b0aaac6587f5540c196c0f0b009c60`, `FiscalService.issueForSettlement` commits `fiscal_document` as `PENDING_ISSUE` and `fiscal_submission` as `PENDING`, then calls `adapter.issue` outside that transaction. `runIssueAttempt` inserts `fiscal_provider_attempt` only after the call returns. `STARTED` is already allowed by `fiscal_provider_attempt_status_ck` and is not inserted. Evidence rows are append-only, one per attempt.

If the process dies during the provider call, the document remains `PENDING_ISSUE`, the submission remains `PENDING`, and there is no attempt row. Recovery must keep that `fiscalDocumentId`. It must not issue a second document. Without `verifiedSameKeyRetry`, reconcile stays unresolved.

`executeSandboxFiscalAttempt` does not write this table. The durable window is the service path above.

Safe later ordering, still inside the current tables:

1. Keep the current document and submission commit, with the same document id and issue idempotency key.
2. Before any adapter call, commit a short second transaction that inserts `fiscal_provider_attempt` with operation `ISSUE`, status `STARTED`, and `finished_at` null. Release the connection before the call. Do not hold a database transaction across the network call.
3. After the call returns, insert one `fiscal_provider_outcome_evidence` row for that attempt and set the same attempt’s status and `finished_at` from the returned result. Do not overwrite evidence and do not allocate a new document.
4. If the process dies after `STARTED` is committed, the next recovery sees that open attempt and reconciles the same document. It does not call `idempotentRetry` unless the adapter has a verified same-key contract.
5. No migration is required for this ordering. Implementing it is a later change. It does not authorize a provider call.
