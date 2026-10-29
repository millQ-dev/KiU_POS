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
