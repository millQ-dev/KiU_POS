# Level C forks — report only, no code

Inspected Origin `main` `42957b698c985d13d646599a429945730eb9ade5` on 2026-10-29. Accepted ADR-0014 (D1–D38), ADR-0032, and ADR-0037 already cover the fiscal boundary, checkout gate, and C0 payment-collection trigger. This handoff does not reopen them.

The forks below are the decisions that are **not** already accepted. Implementation stops until a recorded PO ACCEPT (and, where named, counsel evidence) exists. Research approval is not that ACCEPT.

## Fork 1 — Production provider for merchant #1

**Decision needed:** which provider, API version, and credential model is the live issuer for one named LegalEntity.

Viettel S-Invoice is the commercial diligence candidate. MISA meInvoice is the parallel technical candidate. That ordering is not a contract and not an Accepted ADR. `docs/architecture/integrations-0-vietnam-provider-onboarding-gate.md` (2026-10-18) and `docs/processes/review-packets/integrations-0-po-decision-packet.md` still say Proposed / MERGE HOLD / STOP BEFORE RUNTIME. They nominate Viettel as a candidate only.

**Do not code** a Viettel or MISA client, a production `enabled` flag, or a provider switch until PO ACCEPT names the provider for that LegalEntity, and until G2-06, G2-08, G2-16, and G2-18 are evidenced. G2-18 is a separate production GO (`PRODUCTION-STOP.md`).

## Fork 2 — Legally sufficient evidence for the registered mode (G2-11)

**Decision needed:** which verified evidence class is enough for FiscalCheckoutGate `SATISFIED` for this merchant’s registered mode (coded, non-coded, or cash-register) and invoice type (VAT vs sales).

ADR-0014 D8 already says profiles are versioned and fail-closed and do **not** claim legal sufficiency. `defaultC0SatisfactionProfile()` currently accepts `AUTHORITY_ACCEPTED`, `PROVIDER_CONFIRMED_ISSUED`, and `AUTHORITATIVE_RETRIEVAL` when `verificationStatus = VERIFIED`. That helper is technical configuration. It is not a counsel memo.

**Do not code** a production profile, and do not change which classes can satisfy the gate, until G2-04 and G2-11 are written and PO/legal ACCEPT is recorded. HTTP 200, provider “published”, or `PROVIDER_CONFIRMED_ISSUED` must not be treated as legally sufficient by this task.

## Fork 3 — LegalEntity provider binding runtime

**Decision needed:** accept a runtime binding (Integrations-owned) before any table or vault path is added.

The suggested shape (provider code, merchant tax code, vault `credentialRef`, registered mode, tax-office evidence id, `SANDBOX|PRODUCTION`, `enabled`) matches the Proposed `integration_provider_binding` in INTEGRATIONS-0 §3.2. It is not Accepted. No `apps/api/src/modules/integrations/` package exists. No vault module exists. Adapter selection today is process-wide (`resolveFiscalProviderAdapter`), not per LegalEntity.

Unclear Level B vs Level C is Level C. **Do not add** the binding migration, credential resolution, or egress hook in this handoff.

## Fork 4 — Counsel conclusion on C0 prepaid issue time (G2-04)

**Decision needed:** a licensed Vietnam tax memo for the actual first seller: whether the fiscal trigger is receipt of money, completion of the food-service, or another rule under Decree 254/2026 for that taxpayer class and registered mode.

Product trigger is already Accepted: C0 counter/prepay uses `PaymentCollectionEvent.collected_at` (ADR-0037, ADR-0014 D13 and D32–D38). That ACCEPT is product chronology. It is not G2-04.

**Do not code** policy text or a gate exception that states the C0 trigger is legally sufficient for a named merchant.

## Not forks — already accepted, still not implemented

These are gaps, not new legal rules. They stay unimplemented until G3 credentials exist or a later Level B slice is explicitly started. They are listed so they are not mistaken for Forks 1–4.

- Persist `FiscalDocumentMode` and VAT-invoice vs sales-invoice on `FiscalPolicy` (ADR-0014 D4, D5). No column today.
- Seller MST and address on LegalEntity master data (D17). Columns today: `name`, `jurisdiction_code`, valuation currency, `tax_required`, `fiscal_required`. No MST, no address.
- Buyer fiscal snapshot when requested (D18). No buyer columns on `fiscal_document`.
- `FiscalSeries` as configuration/reference only; legal number stays provider/authority evidence (D19). No series table. No local legal-number generator (correct).
- Correction/replacement as a new linked document (D20). No chain table. No generic delete of an issued document (correct).
- Adapter methods `adjust` / `replace` / customer delivery (D9 prose). The TypeScript port has `issue`, `queryStatus`, `retrieveEvidence`, `idempotentRetry`, `reconcileTimeoutAfterSuccess` only.

## Explicit non-decisions

- No offline or deferred C0 completion.
- No automatic cross-provider failover.
- No conclusion on data residency, delegation of issuance, or downtime transmission. Those are G2-14 and G2-15, status OPEN.
