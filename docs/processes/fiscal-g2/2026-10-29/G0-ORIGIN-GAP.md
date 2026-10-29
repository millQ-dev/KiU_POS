# G0 — Origin fiscal gap at 2026-10-29

PO corrections after this record was accepted: [PO-CORRECTIONS-2026-10-29.md](PO-CORRECTIONS-2026-10-29.md). G2-18 is not a prerequisite for sandbox work. This file stays the gap record.

**Class:** documentation only. Level A.  
**LEGAL GATE G2:** OPEN.  
**Origin `main` HEAD inspected:** `42957b698c985d13d646599a429945730eb9ade5` (2026-10-29, `feat(modifiers): NEXT-04 PR B — counter POS UI + accept gate (Level B) (#129)`).  
**GitHub backup SHA named in the owner packet:** `65c67544c771d2dcfa28847b5c0cc1461632e5bc`. That commit is an ancestor of this Origin HEAD. It is not the development tip.  
**Migration head on this Origin HEAD:** `037_modifier_effective_recipe_v1.sql`. Fiscal tables are still migration `032`. Tax tables are migration `031`.  
**No provider credentials were present. No sandbox call was made. No adapter was added.**

The historical matrix `docs/research/vietnam-fiscalization-gap-matrix-2026.md` is pinned to baseline `1390758879e3764557c0b6930fe640b00547b749` and verdict `NEEDS_TAX_ARCHITECTURE`. That baseline is not current. Do not quote it as the runtime state.

## What Origin already has (packet claims that match)

| Claim | Origin fact |
| --- | --- |
| `FiscalProviderAdapter` with `issue`, `queryStatus`, `retrieveEvidence`, `idempotentRetry`, `reconcileTimeoutAfterSuccess` | `apps/api/src/modules/fiscalization/fiscal-provider-adapter.ts` |
| Attempt statuses `SUCCEEDED`, `FAILED`, `TIMEOUT`, `ADAPTER_UNAVAILABLE`, `REJECTED` | Same file, plus DB check on `fiscal_provider_attempt.status` (also `STARTED`, which the service does not insert) |
| Evidence classes include `AUTHORITY_ACCEPTED`, `PROVIDER_CONFIRMED_ISSUED`, `AUTHORITATIVE_RETRIEVAL`, `TRANSPORT_TIMEOUT` | Same file and `fiscal_provider_outcome_evidence` check. Also `TRANSPORT_FAILURE`, `ADAPTER_UNAVAILABLE`, `UNKNOWN`, `REJECTED` |
| Issue input fields listed in the packet | `FiscalAdapterIssueInput` matches that list |
| Production adapter is unavailable; test adapter is disposable only | `unavailableFiscalProviderAdapter`; `resolveFiscalProviderAdapter` returns test-satisfying only when not production, `MILLQ_ALLOW_FISCAL_TEST_ADAPTER=1`, and `DATABASE_URL` matches disposable `millq_ci_pos_*` and not `millq_dev` |
| Fiscalization does not recompute VAT | `fiscal-service.ts` consumes the Settlement-bound `TaxOrderSnapshot`. Amount mismatch with the collection event throws `FISCAL_AMOUNT_MISMATCH` |
| Gate stays fail-closed | `observeGate`: `fiscal_required` NULL → `UNAVAILABLE` (detail says not `NOT_REQUIRED`). Missing policy → `UNAVAILABLE`. Required document without satisfying verified evidence → `PENDING` or `REQUIRED_NOT_SATISFIED`. `NOT_REQUIRED` only when `fiscal_required = FALSE` **and** the effective policy version says `fiscal_document_required = FALSE` |
| C0 trigger is payment collection | Document stores `payment_collection_event_id` and `collection_business_time` from that event. ADR-0014 D32–D38 and ADR-0037 are Accepted |
| Intent is persisted before the external call | `issueForSettlement` commits `fiscal_document` (`PENDING_ISSUE`) and `fiscal_submission` (`PENDING`) before `adapter.issue` |
| Duplicate settlement intent | `UNIQUE (settlement_group_id)` on `fiscal_document`; `UNIQUE (legal_entity_id, issue_idempotency_key)` |
| Evidence is append-only | `fiscal_provider_outcome_evidence` insert-only in the service. One evidence row per attempt |
| Viettel diligence packet dated 18 Oct 2026 | `docs/processes/partner-due-diligence/viettel-s-invoice-packet.md` |
| ADR-0014 / ADR-0032 / ADR-0037 Accepted | Status lines on those ADRs |

Domain ownership on this HEAD: Tax module and `tax_order_snapshot` exist. Payments owns `payment_collection_event` (kinds in migration 032: cash receive and card provider collection). Settlement owns the checkout gate port. There is no Integrations runtime module.

## Historical gap matrix — do not repeat as current

| Old claim (baseline `13907588…`) | Current Origin |
| --- | --- |
| No Fiscalization runtime; FISC1.1 not started | Module, migration 032, `fiscal-service.ts`, acceptance tests `fisc11*.test.ts`, cashier gate tests |
| No Tax domain; rows 20–22 block FISC1.1 (`UPSTREAM_TAX`) | Migration 031, ADR-0033 and ADR-0034 Accepted, Tax snapshots consumed by fiscal issue |
| Gate vocabulary only `UNAVAILABLE` in production | `observeGate` returns `NOT_REQUIRED`, `SATISFIED`, `PENDING`, `REQUIRED_NOT_SATISFIED`, `UNAVAILABLE` under the rules above. Production **adapter** is still unavailable, so a required document cannot become `SATISFIED` without a real verified profile match |
| Idempotent issue “not implemented” | Document and submission uniqueness exist. Timeout sets submission `NEEDS_RECONCILE` and does not insert a second document |
| “Do not start FISC1.1” | FISC1.1 core is merged. Production provider and G2 are still not granted (ADR-0014 D29, D30) |

INTEGRATIONS-0 (2026-10-18) is still the right onboarding gate for vendor work, with these freshness corrections: Origin tip is `42957b69…`, not `973deb87…`; migration head is **037**, not 032; 033 is not free. Its STOP BEFORE RUNTIME and G2-open statements still hold. It does not record MISA sandbox evidence.

## Exact dependency gaps (still open)

1. **No production or sandbox vendor adapter.** The only runtime adapters are unavailable and test-satisfying. G3 is blocked: no signed 2026 API pack and no test credentials for Viettel or MISA.
2. **No per-LegalEntity provider binding.** `resolveFiscalProviderAdapter` is process-wide. Suggested `ProviderBinding` is not a table. See Level C fork 3.
3. **No credential vault and no egress gate runtime.** ADR-0015 remains docs. Secrets must not be added to config or to this repo.
4. **LegalEntity is not a fiscal seller master.** No MST, legal address, taxpayer class, or tax-office registration id. `fiscal_required` and `tax_required` are separate booleans (NULL = undecided = fail closed).
5. **Registered mode is not stored.** ADR-0014 D4 names `CODED_E_INVOICE`, `NON_CODED_E_INVOICE`, `CASH_REGISTER_E_INVOICE`. `fiscal_policy_version` has `fiscal_document_required` and `satisfaction_evidence_profile` JSON only. No invoice-type column (VAT vs sales).
6. **No `FiscalSeries` row and no authority code column.** Correct that the service does not allocate a legal invoice number. The provider/authority number has nowhere durable to sit except `provider_reference` / `diagnostic_metadata` JSON.
7. **No buyer snapshot.** D18 is Accepted as a rule. No columns, no B2B MST freeze.
8. **TypeScript port is narrower than ADR-0014 D9 prose.** No `adjust`, `replace`, or customer-delivery method. No webhook ingress.
9. **Attempt row is written after the HTTP call returns.** `STARTED` is allowed by the check constraint and never inserted. A process crash during `adapter.issue` leaves `PENDING_ISSUE` and submission `PENDING` with no attempt. `reconcileDocument` treats `PENDING_ISSUE` as `idempotentRetry` (another issue call) and every other non-satisfied status as `reconcileTimeoutAfterSuccess`. That matches D12 only after a recorded `TIMEOUT` moved the document to `ISSUED_PENDING_EVIDENCE`. The crash window can call issue again. A later Level B change inside D11/D12 should persist an in-flight attempt before the call and must not issue a new document id. Not done here. Provider idempotency is unproven (G2-08, G2-12).
10. **Timeout is stored as `ISSUED_PENDING_EVIDENCE`.** The name is stronger than the evidence. The gate maps that status to `PENDING`, not `SATISFIED`. Do not rename in this handoff (status vocabulary is already shipped). Readers must not treat the status as proof the provider issued.
11. **`defaultC0SatisfactionProfile()` includes `PROVIDER_CONFIRMED_ISSUED`.** Gate `SATISFIED` requires that class to be listed and `verificationStatus = VERIFIED`. Legal sufficiency of that class is G2-11, still OPEN. The default is not a counsel clearance.
12. **No correction/replacement document chain.** D20 forbids silent rewrite. Runtime has no linked correction document.
13. **No customer PDF/QR/link projection.** Nothing in fiscalization treats a URL as authority success. Also nothing refreshes an expired download. G2-09.
14. **Cross-provider failover does not exist.** Keep it that way. One binding per LegalEntity when a binding is someday accepted.
15. **C0 shape is one payment and one check.** Bank/VietQR collection is not a fiscal evidence kind (INTEGRATIONS-0 §2A). This pilot packet is counter/prepay and does not add bank fiscalization.
16. **Seller/buyer PII logging policy is not implemented as a redaction layer** on fiscal diagnostic JSON. `diagnostic_metadata` stores adapter diagnostics. G2-15.

## Status map (do not rename)

Use existing enums. The assignment’s detailed names are projections.

| Assignment name | Existing record |
| --- | --- |
| READY_TO_SUBMIT | `fiscal_document.status = PENDING_ISSUE`, submission `PENDING` |
| SUBMITTING | submission `IN_FLIGHT` if set; attempt status is recorded only after the call |
| ACCEPTED_BY_PROVIDER | evidence class `PROVIDER_CONFIRMED_ISSUED`. Not gate `SATISFIED` unless the **merchant policy** lists that class and verification is `VERIFIED` |
| SUBMITTED_TO_AUTHORITY | no separate enum. Keep `raw_provider_status`. Do not invent a satisfying class |
| ACCEPTED_BY_AUTHORITY | evidence class `AUTHORITY_ACCEPTED` with `VERIFIED`, and the policy lists it |
| REJECTED_BY_AUTHORITY | attempt `REJECTED` and evidence `REJECTED`. Final only when verification is `VERIFIED`. Document moves to `FAILED` when the profile does not match |
| UNKNOWN_AFTER_TIMEOUT | attempt `TIMEOUT`, evidence `TRANSPORT_TIMEOUT` or `UNKNOWN`, submission `NEEDS_RECONCILE`, document `ISSUED_PENDING_EVIDENCE`, gate `PENDING` |
| RECONCILING | operation `RECONCILE_TIMEOUT` or `IDEMPOTENT_RETRY` |
| VERIFIED_ISSUED | document `SATISFIED` only after `evidenceSatisfiesProfile` |
| VERIFIED_REJECTED | evidence `REJECTED` and `VERIFIED`; document `FAILED` |
| STILL_UNKNOWN | submission remains `NEEDS_RECONCILE`; gate stays unsatisfied |

`fiscal_document.status = SATISFIED` is the internal mark. Checkout `SATISFIED` still re-checks the latest evidence against the frozen policy (`documentEvidenceSatisfies`). A document row marked satisfied with non-matching evidence does not open the gate.

## Schema / API

No migration and no port change in this handoff. Justification and the deferred shape: [SCHEMA-DELTA-NOT-IMPLEMENTED.md](SCHEMA-DELTA-NOT-IMPLEMENTED.md).

## G3 entry conditions (not met)

- Written binding API for one provider (version, errors, idempotency, status semantics) — G2-08.
- Sandbox credentials in a vault reference, synthetic data only — G2-09, G2-15.
- Level C forks 1–4 either accepted for the narrow slice or explicitly out of that PR’s behavior.
- Tests are synthetic transport fixtures. A stub must not return fabricated `AUTHORITY_ACCEPTED`.

Second provider is a separate PR. Viettel evidence does not clear MISA, or the reverse.

## Tests run for this G0

None. Docs only. Fiscal acceptance tests were not re-executed. Production readiness is not claimed.
