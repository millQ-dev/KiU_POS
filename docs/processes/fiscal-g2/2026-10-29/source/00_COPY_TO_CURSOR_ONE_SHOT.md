# CURSOR ONE-SHOT — NO INTERNAL LINKS / NO NOTION

# COPY ENTIRE FILE TO CURSOR ORIGIN — KIU FISCAL G2 / VIETNAM 2026

**Autonomous technical assignment. Effective 29 October 2026.** This file is SELF-CONTAINED. DO NOT request or follow Notion documentation; DO NOT use, authenticate, reconnect or retry Notion connectors. The owner-side ChatGPT supplies all external research and Product Owner context in full text. Read Origin `PROJECT_CHARTER.md`, `AGENTS.md`, accepted ADRs and source code. If a genuinely new Level C decision is required, report exact fork only.

## 0. Objectives, evidence, stop conditions

Bring existing Fiscal Core toward a **real Vietnamese restaurant merchant pilot**. The current production provider is UNAVAILABLE, and **LEGAL GATE G2 is OPEN**. No production tax issuance, paid merchant onboarding, production migration, hidden demo verification or fake `SATISFIED` is authorized by this task.

Commercial primary candidate **Viettel S-Invoice**, parallel technical fallback **MISA meInvoice**. This is candidate prioritization, NOT a contract or production vendor approval. One merchant / LegalEntity with appropriately registered invoice mode for the first pilot. No automatic provider-switch retry for ambiguous/issued invoices. Pilot C0 counter/prepay online-only; other dining/postpaid/deposit/offline cases are not silently included.

## 1. Existing Origin architecture to preserve

In current GitHub backup research (verify actual **Origin main HEAD**):

- `apps/api/src/modules/fiscalization/fiscal-provider-adapter.ts` has `FiscalProviderAdapter` with `issue`, `queryStatus`, `retrieveEvidence`, `idempotentRetry`, `reconcileTimeoutAfterSuccess`.
- `FiscalAdapterResult` contains `attemptStatus` (`SUCCEEDED`, `FAILED`, `TIMEOUT`, `ADAPTER_UNAVAILABLE`, `REJECTED`), `evidenceClass` (`AUTHORITY_ACCEPTED`, `PROVIDER_CONFIRMED_ISSUED`, `AUTHORITATIVE_RETRIEVAL`, `TRANSPORT_TIMEOUT`, etc.), `verificationStatus`, raw provider status and optional provider reference.
- `FiscalAdapterIssueInput` includes fiscalDocumentId, legalEntityId, settlementGroupId, orderId, paymentCollectionEventId, collectionBusinessTime, taxOrderSnapshotId, taxSemanticFingerprint, documentAmountMinor, currencyCode, issueIdempotencyKey.
- `unavailableFiscalProviderAdapter` is correct production default; `testSatisfyingFiscalProviderAdapter` is DISPOSABLE TEST-ONLY, NEVER production route.
- Fiscalization owns FiscalDocument/Policy/Series/Submission; Integrations owns LegalEntity provider binding + credential references; Tax owns authoritative frozen TaxOrderSnapshot/TaxLineSnapshot, NOT Fiscalization; Payments owns PaymentCollectionEvent; Orders/Settlement remain different systems of record.
- `FiscalCheckoutGate` exists in Settlement/Checkout and must remain fail-closed; **ADR-0014** accepted including D1–D38 chronology delta, **ADR-0032/0037** accepted; C0 timing = authoritative Payment Collection Event, production online-only. Do not convert missing production provider into `NOT_REQUIRED`.
- `docs/processes/partner-due-diligence/viettel-s-invoice-packet.md` dated 18 Oct 2026 exists; `docs/research/vietnam-fiscalization-gap-matrix-2026.md` is an older research baseline and **incorrectly says no TAX domain/FISC1.1 core in runtime** at that historical SHA; inspect current Origin and reconcile, do NOT repeat old gaps as current facts.
- Current GitHub backup HEAD observed 29.10.2026: `65c67544c771d2dcfa28847b5c0cc1461632e5bc`; only Origin HEAD determines real development state.

**Critical invariant:** Economic facts from frozen Order/Tax snapshots only; fiscal adapter does not recompute VAT, guess zero VAT, change payment coverage or create revenue. Fiscal proof is mode-specific policy-configured and must be authoritative before Gate SATISFIED. Unknown/timeout is never a fiscal success.

## 2. Law and registered mode — facts to implement/configure, not assume

Effective 01.07.2026:
- Law 108/2025/QH15 — Vietnam Tax Administration.
- Decree 254/2026/NĐ-CP — 2026 e-invoices/e-documents. Restaurant/F&B direct-to-consumer included in POS e-invoice eligibility/usage; existing coded/noncoded registrants may have separate registration treatment. Company vs household taxpayer rules differ.
- Circular 91/2026/TT-BTC — e-invoice registration and changes, forms including 01/ĐKTĐ-HĐĐT and administration notices, corrections.

**Registered merchant policy MUST select** coded/non-coded/cash-register mode; VAT invoice vs sales invoice; tax method; business trigger; evidence sufficient; numbering/series; required buyer data; signature requirement (cash-register invoice itself not necessarily digitally signed; provider service authentication may differ); outage policy; and tax office accepted registration. Never hardcode all restaurants into one profile.

Sources (public legislation and official explanations):
- https://vanban.chinhphu.vn/?classid=1&docid=216541&pageid=27160&typegroupid=3
- https://vanban.chinhphu.vn/?classid=1&docid=218689&orggroupid=2&pageid=27160
- https://vanban.chinhphu.vn/?classid=1&docid=219006&orggroupid=4&pageid=27160
- https://xaydungchinhsach.chinhphu.vn/nhung-diem-moi-cua-nghi-dinh-254-2026-nd-cp-va-thong-tu-91-2026-tt-btc-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260717143502375.htm

**Legal uncertainty / require local counsel**: merchant-specific registered mode, applicability of C0 prepaid service issue time, authority acceptance profile, compliance for downtime/deferred transmission, invoice correction versus refund, data residency/processing, delegation of issuance. This task authorizes research and sandbox engineering only, NOT a conclusion to these open legal items.

## 3. Provider facts and open contracts

### Viettel S-Invoice — candidate A
Official Viettel product listing https://sme.viettel.vn/market-place/detail/SINVOICE (hotline 18008000). Vendor webservice docs and v2.46 integration kits are publicly listed (some vendor/reseller material older). Need written **binding API + 2026 MTT** contract, issue/status/retrieve/adjust/replace, provider event/reference identity, merchant credentials/LE mapping, webhook or polling, sandbox keys, integration partner and pricing/SLA. Public product claims do NOT count as vendor production agreement.

### MISA meInvoice — candidate B
Developer portal https://developer.misa.vn/ . First-party docs:
- Specific machine-generated e-invoice issue API `POST <BaseURL>code/itg/invoice-calculating/invoiceandpublish`, `IsInvoiceCalculatingMachine=true`: https://doc.meinvoice.vn/api/Document/InvoicePublishCalculatingMachine.html
- Token/test/live: https://doc.meinvoice.vn/itg/Doc/GetToken.html
- Status, `invoiceCalcu`, `SendTaxStatus`, `PublishStatus`: https://doc.meinvoice.vn/itg/Doc/GetStatusInvoice.html
- Download: https://doc.meinvoice.vn/itg/Doc/DowloadInvoice.html

These pages include old samples and multiple API families; verify **which is active in 2026** before hardcoding. Do NOT combine broad developer-portal OAuth with meInvoice product token without explicit provider guidance. Public price example: 1000 invoice pack 1,050,000 VND (provider's July 2026 site); binding SaaS/API/SLA quote unknown.

## 4. Target 2026 Fiscal Policy / Adapter boundary

DO NOT rewrite the existing Fiscal Core. First inspect existing contracts and migrations. If provider needs new fields, author a narrowly scoped versioned extension, no provider DTO in Orders, Checkout, Tax or Fiscal domain.

Suggested internal adapter/work model (validate against Origin):

```ts
interface ProviderBinding {
  tenantId: string;
  legalEntityId: string;
  outletId?: string;
  providerCode: 'VIETTEL_SINVOICE' | 'MISA_MEINVOICE';
  merchantTaxCode: string;
  credentialRef: string;         // vault reference, no plain passwords
  acceptedFiscalPolicyId: string;
  registeredFiscalMode: 'CODED_E_INVOICE'|'NON_CODED_E_INVOICE'|'CASH_REGISTER_E_INVOICE';
  taxOfficeRegistrationEvidenceId: string;
  environment: 'SANDBOX'|'PRODUCTION';
  enabled: boolean;              // production remains false without G2
}
```

Server computes a unique **business intent identity** `(legalEntityId, fiscalDocumentId, semanticHash)`, separates request-attempt ID from provider invoice identity and tax-authority code. Do not generate legal series/number locally when assigned by provider/authority. Strict equal key + different payload => conflict, no write. Never transmit real merchant PII in sandbox without explicit approved egress basis.

Retain append-only submissions/attempts, `rawProviderStatus`, signed response evidence/verified retrieval hash, timestamps for business event, sending, provider acceptance and authority acceptance; store sensitive raw payload only per privacy/retention policy and redact operational logs.

### Required status machine (map to existing statuses without blind renaming)

```
READY_TO_SUBMIT
  -> SUBMITTING
  -> ACCEPTED_BY_PROVIDER / SUBMITTED_TO_AUTHORITY / ACCEPTED_BY_AUTHORITY
  -> REJECTED_BY_AUTHORITY (final only when verified)
  -> UNKNOWN_AFTER_TIMEOUT
  -> RECONCILING -> VERIFIED_ISSUED | VERIFIED_REJECTED | STILL_UNKNOWN
```

**Do not treat** `ACCEPTED_BY_PROVIDER` or a generic successful HTTP response as legally sufficient unless the merchant-specific **FiscalSatisfactionEvidenceProfile** explicitly accepts that precise verified evidence for its registered mode and legal counsel has cleared it. Use existing domain enum where present; internal detailed statuses may be projection/attempt substate.

### Timeout / duplicate behavior

1. Persist immutable fiscal intent + fingerprint + LE binding + idempotency before making external issue call. Outbox/attempt transaction per existing patterns.
2. Call one configured provider for the legal entity with stable reference.
3. HTTP timeout/network reset => `UNKNOWN` until investigation; **never POST another new issue with a new ID**.
4. Re-query by provider reference and merchant stable client ref / known CQT lookup; apply original result if verified. Retry only if provider guarantees idempotency for that key or there is decisive evidence no invoice was issued.
5. Duplicate callback, delayed status, authority response out of order => strict monotonic/versioned reconciliation, no lost historical evidence.
6. Disagreement between provider status and tax authority: quarantine/escalate, no blindly optimistic SATISFIED.
7. Different legal entity/taxcode, invoice number mismatch, different amount, VAT, Tax snapshot hash or consent requirement => reject and security/audit event.
8. Failover to MISA on Viettel timeout is **FORBIDDEN**. Provider switch requires merchant and legal approval, reconciliation and new registered numbering/cutover, no ambiguity.

### Payment success, fiscal uncertainty and critical-path isolation

- For accepted **C0 counter/prepay**: PaymentCollectionEvent exists, but if required fiscal evidence not verified, FiscalCheckoutGate is PENDING/UNAVAILABLE/failed and CompleteOrder remains blocked (online-only). Do not roll back recorded payment, create fake fiscal receipt, mutate payment event or issue zero invoice. Offer recovery UI and controlled operator reconciliation.
- Existing POS/KDS operations that do not require checkout completion cannot be globally blocked by vendor downtime; do not conflate this with authorizing a legally unsatisfied sale completion.
- Production offline fiscal issue/deferred completion is not approved. Do not create silent grace period.
- Customer QR/link/paper print are delivery/lookup projections after legally meaningful issuance, not evidence of issuance themselves.
- Corrections/adjustments/replacements: explicit linked legal documents and status inquiry, audit, permission. Avoid silently rewriting original FiscalDocument, TaxOrderSnapshot or Revenue Basis.

## 5. Work packages (no premature implementation)

- **G0 targeted, docs-only:** inspect actual Origin `main`, Fiscal Core, Tax snapshot, settlement gate, Identity/Integrations binding, accepted ADR-0014/0032/0037, existing partner packet, relevant current provider contracts; produce actual-diff + new exact dependency gaps. Reuse existing research and DO NOT restart POS-wide G0.
- **G1 provider diligence in parallel:** prepare tech vendor questionnaires, sample anonymized payloads, developer onboarding steps and explicit evidence requests; no vendor claims without written response. Existing contacts must be authenticated through official vendor channels. No automatic mail/send.
- **G2 contract/ADR:** proposal for mode-specific `FiscalSatisfactionEvidenceProfile` for merchant #1, credentials and status mapping, 2026 legal requirement matrix, sandbox data egress/privacy, correction path and new externally meaningful semantics. If accepted ADR already covers it fully, reference it; if new Level C rules, get explicit PO/Legal ACCEPT before coding. Owner approval of research ≠ production GO.
- **G3 isolated sandbox adapter:** implement one vendor adapter behind existing FiscalProviderAdapter when signed binding API spec and test credentials are available; separate PR(s), first synthetic test only. Second provider adapter in independent follow-up PR. Stub not allowed to return fabricated acceptance.
- **G4 UAT and verification:** tests listed below, provider + counsel + merchant written acceptance and production credentials under protected vault.
- **G5 Live pilot:** **separate** explicit merchant + PO production GO after all G2 items show evidence. No automatic enable from merging PRs or assigning environment variable.

Routine A docs or B implementation PR after accepted semantics: autonomous review/CI/MWR according to project `AGENTS.md`. Any unapproved FiscalPolicy/LegalEntity financial behavior or authority changes: Level C before code. No direct Origin main push, no direct GitHub backup write, no removing branch protections or bypass of required Depot CI. MWR on current HEAD only after required review.

## 6. Acceptance and negative tests (must test with synthetic sandbox fixtures)

1. Authenticated merchant A can issue only in its own taxcode/LegalEntity/registered series; cross-tenant/LE/outlet denial.
2. Missing G2/merchant registration/credentials/TaxOrderSnapshot/PaymentCollectionEvent => fail closed; no network issue.
3. Legitimate C0 payment + frozen tax commercial snapshot => exactly one stable fiscal intent; no VAT calculation inside Fiscalization.
4. Timeout AFTER vendor accepted invoice => issue not duplicated; subsequent status lookup retrieves existing legal invoice and authority evidence.
5. Duplicate POST/callback/multiple workers => one legal invoice; stable business intent and lock/idempotency.
6. HTTP 200 with pending CQT or incomplete evidence => gate remains unsatisfied until regime-specific threshold verified.
7. Provider REJECTED/CQT REJECTED => cannot display success; retries only legally/technically valid.
8. Provider offline / API rate-limit / expired token / wrong taxcode => explicit recoverable or failed state, no zero-value fallback and no production test adapter.
9. Provider invoice number/code/amount/VAT mismatch => quarantine; do not accept altered business snapshot.
10. C0 order CASH paid + fiscal pending => immutable payment remains; checkout gate blocks CompleteOrder.
11. B2C buyer optional only where lawful; requested B2B company buyer MST captured and frozen. No PII in logs.
12. Different document modes / tax policies => proper distinct evidence threshold; missing config never NOT_REQUIRED.
13. Replacement/adjustment after issued => new linked document, preserves original and tax snapshot; no unsafe generic DELETE.
14. Customer delivery PDF/QR/link only after verified issue; expired download link refreshed from provider; never proof of authority success.
15. No double posting in Orders/Inventory; fiscal state not income or payment SoT. DEMO29 test fiscal flow untouched.
16. Provider switch while original document pending/unknown => prohibited; only explicit compliant cut-over after reconciliation.
17. Fault injection: network reset, 502/503, 429, late webhook, out-of-order tax status, unknown status, backlog reprocess, migration rollback.
18. Long-running performance and reconciliation backlog thresholds measured; no invented SLA values.

## 7. G2 evidence register to produce (do not falsely mark pass)

Evidence IDs: `G2-01...G2-18`, state `OPEN | REQUESTED | REVIEWED_PASS | REJECTED | NOT_APPLICABLE_WITH_SIGNED_REASON` plus owner, actual artifact path/date/expiry, vendor and merchant taxcode scope. See appendix below; no check item closes on self-assertion.

| ID | Required evidence | Owner |
|---|---|---|
| G2-01 | Merchant company/household registration, MST, legal address and taxpayer class | Merchant legal/accounting |
| G2-02 | Confirmed merchant tax regime, VAT vs sales invoice, 2026 coded/noncoded/POS registration | Merchant CPA / VN tax counsel |
| G2-03 | Tax office accepted registration/change filing and provider/series activation | Merchant accountant + provider |
| G2-04 | Binding 2026 legal memo on issue timing for specific C0 prepaid restaurant | VN licensed tax counsel |
| G2-05 | Invoice mandatory fields/mode/tax rate mapping and signed sample incl buyer/B2B | Tax counsel + merchant accountant |
| G2-06 | Confirmed provider authorized service status / merchant/provider contract | Provider + merchant |
| G2-07 | KiU company credentials/authorization and legal processing role | KiU legal + provider |
| G2-08 | Official current provider API spec, error codes, sandbox/production parity | Provider engineering |
| G2-09 | Sandbox credentials and signed UAT issue/status/timeout/correction evidence | KiU engineering + provider |
| G2-10 | Auth, per-LE credential management, rotation and revocation | KiU security + provider |
| G2-11 | Evidence sufficiency profile for SATISFIED per registered mode | Tax counsel + KiU architect |
| G2-12 | Reconciliation/unknown status/duplicate issuance drill, disaster runbook | KiU QA + provider |
| G2-13 | Correction, replacement, return/refund legal procedure and permissions | Counsel + merchant accountant |
| G2-14 | Outage/offline treatment written legal/provider policy; C0 stays online-only until authorized | Counsel + provider |
| G2-15 | DPA, PII and Vietnam data residency/egress, breach, retention & exports | KiU privacy/legal + provider |
| G2-16 | Commercial agreement: pricing, invoice quota, support, SLA, limits, cancellation | KiU procurement + provider |
| G2-17 | Approved merchant production onboarding and exact real pilot test plan / fallback to manual legally compliant process | Merchant owner + KiU PO |
| G2-18 | Separate PO production deploy + persistent DB migration GO, named rollback owner and monitoring, no prod-test adapter | KiU PO + engineering |

## 8. Immediate deliverables and report

Deliver in Origin as small PRs/documented handoff: (1) actual code gap diff; (2) provider evidence register and questions; (3) schema/API delta only if justified; (4) provider-specific sandbox implementation and tests only when API credentials verified; (5) G2 open evidence matrix and production stop rule. For each PR report Origin SHA, files, test commands/results, Bugbot/AI review, Depot CI status, MWR status, blockers. **Never claim fiscal production ready based on CI alone.**

Do not call any inaccessible external documentation connector. Supplied public URLs are sources for human/PO verification; no Notion URLs or connector dependency appears in this handoff.


---

# FULL LEGAL G2 EVIDENCE REGISTER

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


---

# PROVIDER COMPARISON AND DUE DILIGENCE EVIDENCE

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
