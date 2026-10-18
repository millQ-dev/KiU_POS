# INTEGRATIONS-0 — Vietnam Provider Onboarding Gate

- **Status:** Level **C** docs/research — **STOP BEFORE RUNTIME / migrations / vendor production / secrets / merge-as-GO**
- **Date:** 2026-10-18
- **Origin HEAD (resolved):** `973deb878c977535fa35e921d73fc689fe358530`
- **GitHub backup checkpoint (verified ancestor):** `e83a02b8933947a80d4ceb0cf50d84e44c5aaf0f` (PR #82; contained in current main via #85)
- **Migration head:** `032_fisc11_payment_collection_fiscal_core.sql` (**033 free**)
- **Do not delay:** Identity AUTH-18.10 / IDENTITY-B\* work (separate tracks)

Evidence labels: **VERIFIED OFFICIAL FACT** · **PROVIDER DOC FACT** · **REPO FACT** · **UNKNOWN / SALES** · **LEGAL INTERPRETATION** (counsel before G2).

**PO (2026-10-18):** ACCEPT DIRECTION / REVIEW GO / **MERGE HOLD** on PR #88 until remediations + re-APPROVE.

**Ownership split (binding for I1+):** Integrations owns LE bindings + future gateway/transport. **Fiscalization** owns `FiscalProviderAdapter` port. **Payments** owns Payment lifecycle + future `PaymentRailAdapter` port. Concrete vendor clients sit at the edge behind those ports.

**Privacy (ADR-0015):** Uncleared third-party calls (including **sandbox**) → **synthetic data only** or **blocked**. Real buyer/merchant PII requires Egress Gate record + vault credential path before I2/I3 sandbox with live merchant data.

---

## 1. Integration readiness matrix (Origin modules)

| Capability | State | Exact refs | Notes |
| --- | --- | --- | --- |
| Dedicated `integrations` runtime module | **Missing** | No `apps/api/src/modules/integrations/` | Domain map lists Integrations conceptually only (`domain-module-map.md` §Integrations) |
| Integration Gateway (unified outbound/inbound bus) | **Missing** | — | Not implemented; do not invent |
| ModelGateway / Intelligence (ADR-0020) | **Partial (contract)** | Docs ADR-0020; no fiscal/payment use | **≠** Integration Gateway |
| FiscalProviderAdapter interface | **Implemented (neutral)** | `apps/api/src/modules/fiscalization/fiscal-provider-adapter.ts` L1–L117 | `issue` / `queryStatus` / `retrieveEvidence` / `idempotentRetry` / `reconcileTimeoutAfterSuccess` |
| Production fiscal adapter | **Missing (fail-closed)** | `unavailableFiscalProviderAdapter()` L76–L93 | Default never fakes `SATISFIED` |
| Test-only fiscal adapter | **Implemented (test)** | `testSatisfyingFiscalProviderAdapter` L98–L117 | Must not register on prod HTTP |
| Fiscal attempt / evidence append-only | **Implemented** | mig `032` `fiscal_provider_attempt`, `fiscal_provider_outcome_evidence`; `fiscal-service.ts` ~L627+ | Retry/reconcile tests in `fisc11-*.test.ts` |
| LEGAL GATE G2 | **Missing / not granted** | ADR-0014 D30; `fisc11-level-c-open-items.md`; `current-state.md` | **No production fiscal success without G2** |
| Payments core (provider-neutral) | **Implemented** | `payments-service.ts`, PAY1.1 tests | Axes: `provider_identity`, rail, instrument; non-custodial |
| Production VietQR / bank adapter | **Missing** | Dev/fake providers in tests only | Dynamic VietQR contract below |
| Payment callback ingress + signature verify | **Missing** | — | Required for VietQR Transaction Sync |
| Identity notification outbox | **Partial** | mig `027` `identity_notification_outbox`; Identity/Cash/Task patterns | Not a general Integration Outbox |
| Credentials vault (runtime) | **Missing** | ADR-0015 vault is **logical/docs**; no vault module in `apps/api` | Provider secrets must not land in plain config |
| Egress Gate runtime | **Missing** | ADR-0015 §Cross-border Egress Gate (docs) | ApproveEgress command not implemented |
| Tenant isolation (payments/fiscal rows) | **Implemented (partial)** | LE/tenant FKs on payment/fiscal tables in `032` / payments schema | Provider config ownership per LE **not** shipped |
| Provider config per LegalEntity | **Missing** | — | Designed in **§3.2** |
| Migration import connectors (iPOS/MISA/…) | **Missing** | ADR-0011 migration architecture only | §8 interface placeholders |
| C0 `PaymentCollectionEvent` for VietQR / BANK_TRANSFER | **Missing** | `payment-collection-event.ts` L8; mig `032` CHECK only `CARD_PROVIDER_COLLECTION` \| `CASH_RECEIVE` | **Not C0-ready** — see §2A |

---

## 2. Legal & vendor evidence (dated URLs)

### 2.1 Fiscal law stack

| Instrument | Issued / effective | Role | Source |
| --- | --- | --- | --- |
| **Luật 108/2025/QH15** (Tax Administration) | Issued ~10/12/2025; main eff. **01/07/2026**; household e-invoice rules from **01/01/2026** | Parent law; e-invoice Art. 26 | [Công báo](https://congbao.chinhphu.vn/van-ban/luat-so-108-2025-qh15-468670.htm); [Chính phủ summary](https://xaydungchinhsach.chinhphu.vn/toan-van-luat-quan-ly-thue-co-hieu-luc-tu-1-7-2026-119260626174633402.htm) — **VERIFIED OFFICIAL FACT** |
| **NĐ 254/2026/NĐ-CP** | Issued **30/06/2026**, eff. **01/07/2026** | Detail e-invoice / e-documents under Law 108 | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?docid=218689&pageid=27160); [Công báo](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-254-2026-nd-cp-469957/66826.htm) — **VERIFIED OFFICIAL FACT** |
| **TT 91/2026/TT-BTC** | Issued **30/06/2026**, eff. **01/07/2026**; replaces TT 32/2025 | MoF technical rules (registration, format, provider conditions) | Firm/edu mirrors cite MoF; confirm signed PDF with counsel — **LEGAL INTERPRETATION** until attorney-verified PDF |
| **NĐ 70/2025/NĐ-CP** (amends NĐ 123/2020) | Eff. **01/06/2025** | Prior cash-register e-invoice expansion for DTC incl. **ăn uống / nhà hàng** | [GDT Can Tho explainer](https://cantho.gdt.gov.vn/wps/portal/news/detail?1dmy=&current=true&urile=wcm%3Apath%3A%2Fcantho%2Fsite%2Fnews%2Fcucthue%2F77b07137-1699-408d-a9ec-819452ced966); [vbpl](https://vbpl.vn/botaichinh/Pages/vbpq-vanbanlienquan.aspx?ItemID=178308) — **VERIFIED OFFICIAL FACT** (70 exists); transitional interaction with 254 = **LEGAL INTERPRETATION** (254 is the post-1 Jul 2026 detail frame; 70/123 remain relevant for pre-transition registrations / máy tính tiền cohort — counsel) |

**Transitional interaction (architecture binding until counsel):**

1. From **01/06/2025**: DTC F&B restaurants in the máy tính tiền cohort under NĐ 70 (with choice to keep prior có mã / không mã if already registered — per TT 32/2025 guidance summaries).
2. From **01/07/2026**: Law 108 + NĐ 254 + TT 91 govern e-invoice detail; provider technical conditions and registration flows must track TT 91.
3. KiU Fiscal Core **must not** claim legal sufficiency; **G2** remains mandatory for production go-live (ADR-0014).

Prior research (still useful): `docs/research/vietnam-fiscalization-readiness-2026.md`.

### 2.2 Viettel S-Invoice (provider docs) — verification status

| Item | Evidence | Class | Status |
| --- | --- | --- | --- |
| REST Invoice API (legacy / V1 demo) | `https://demo-sinvoice.viettel.vn:8443/InvoiceAPI` — Basic Auth, IP whitelist | **PROVIDER DOC FACT** — [Technical PDF](http://viettelsolution.com.vn/uploads/tai%20lieu/Technical_webservice_Sinvoice_en.pdf) | Documented |
| V2 API base (integrator docs) | `https://api-vinvoice.viettel.vn/services/einvoiceapplication/api/` | **PROVIDER DOC FACT** — Viindoo / downloads pack; **confirm with Viettel commercial pack** | Documented; pack not held by MillQ |
| V1 vs V2 semantics | V1: demo-sinvoice + InvoiceAPI; V2: api-vinvoice + auth/login cookie/`access_token` paths; separate download packs (v2.46 noted on hoadondientuvt.vn) | **PROVIDER DOC FACT** | **Must not mix V1/V2 clients** |
| Issue / adjust / replace / cancel | createInvoice; adjustmentType values (e.g. 1 issue, 3 replace, 5 adjust — integrator mirrors); cancelTransactionInvoice; USB-token hash+insert signature paths | **PROVIDER DOC FACT** (third-party mirrors + PDF) | Confirm exact enums in commercial V2 pack |
| Evidence / status | Search + download invoice file APIs in technical PDF | **PROVIDER DOC FACT** | Map to `queryStatus` / `retrieveEvidence` |
| Legal signing | Merchant CA / USB-token / server CTS paths documented by Viettel downloads | **PROVIDER DOC FACT** | Who signs (merchant vs provider-hosted) = **SALES + MERCHANT** |
| 2026 máy tính tiền / NĐ 254 / TT 91 | Law stack §2.1 VERIFIED; MISA/AMIS describe MTT correction under 254/91; **Viettel written confirmation for KiU F&B cash-register e-invoice under Law 108/NĐ 254 not in hand** | **LEGAL INTERPRETATION** + **UNKNOWN / SALES** | **OPEN — do not claim C0 fiscal prod readiness** |
| Onboarding | Contract + 100% payment → demo account + API docs + tax registration pack (merchant serials / CQT notify) | **PROVIDER DOC FACT** — [quy trình ch.3](https://sinvoice-viettel.vn/quy-trinh-chuong-3/) | Per-merchant accounts |
| SaaS partner vs individual merchant | Public flow is **per enterprise contract + merchant tax registration**. KiU-as-SaaS multi-merchant partner program / credential ownership / reseller pricing | **UNKNOWN / SALES** | **OPEN** — ask packet |
| KiU commercial eligibility / pricing / SLA | — | **UNKNOWN / SALES** | **OPEN** |

### 2.3 VietQR / payments — verification status

| Item | Evidence | Class | Status |
| --- | --- | --- | --- |
| Dynamic QR generate | vietqr.dev / api.vietqr.vn (`qrType=0`, amount+orderId) | **PROVIDER DOC FACT** — [Generate](https://api.vietqr.vn/en/vn/api-vietqr-callback/goi-api-generate-vietqr-code) | Documented |
| Transaction Sync (VI authoritative page) | Partner hosts `POST …/bank/api/transaction-sync`; Bearer from **partner Get Token**; VI Required: `bankaccount`, `amount`, `transType`, `content`, `transactionid`, `transactiontime` (Long ms), `referencenumber`, `orderId`; `sign` Optional | **PROVIDER DOC FACT** — [VI Sync](https://api.vietqr.vn/vi/api-vietqr-callback/api-transaction-sync) | Treat VI Required set as engineering minimum until partner letter |
| Transaction Sync (EN path divergence) | EN/markdown path lists `transactionid` / `transactiontime` (String) / `referencenumber` / `orderId` / `sign` as **Optional**; sample models use `long transactiontime` | **PROVIDER DOC FACT** — [EN Sync](https://api.vietqr.vn/en/vn/api-vietqr-callback/api-transaction-sync) | **OPEN — EN/VI conflict; partner must declare binding spec** |
| Callback authentication | Bearer JWT validated with **partner-held** secret (sample code); payload `sign` Optional — **no published canonical HMAC string** in public docs | **PROVIDER DOC FACT** | **OPEN — confirm auth + sign algorithm + key custody** |
| Bank collection evidence source | Callback body claims bankaccount/amount/transType/content (+ VI txn id/time/ref); provenance = VietQR platform → partner URL, not a NAPAS settlement file | **PROVIDER DOC FACT** | Insufficient alone for C0 PCE — see §2A |
| Retries | Docs: ≤10 retries | **PROVIDER DOC FACT** — [Retry](https://api.vietqr.vn/en/vn/api-vietqr-callback/retry-giao-dich) | Align outbox/ingress dedupe |
| Host2host / banks | Integrated doc; MB/BIDV noted in partner materials | **PROVIDER DOC FACT** — [Integrated](https://doc.vietqr.vn/doc/api-vietqr-callback/api-vietqr-host2host/integrated-document-for-payment-service-vietqr) | **OPEN — which banks give verifiable confirmation for KiU** |
| NAPAS VietQRPay ISV | KiotViet public example Aug 2026 | **VERIFIED** (acquiring profile); KiU access **UNKNOWN / SALES** | Alternate rail |
| Credential ownership / pricing | Partner Get Token implies **merchant/partner secret on KiU side**; MDR/fees | **UNKNOWN / SALES** | **OPEN** |
| Non-custody | ADR-0013 / PAY1.1 | **REPO FACT** | Funds settle to merchant bank; KiU records lifecycle only |

### 2.4 Later connectors

| Connector | Role | Evidence class | Gate |
| --- | --- | --- | --- |
| **VFA Open API** | Food-authority data (read) | **UNKNOWN** public Open API surface for KiU — do not claim | Later gated; prefer **read-only** first |
| **BHXH / I-VAN** | Social insurance e-filing via licensed I-VAN providers | **PROVIDER/REG DOC** — Quyết định 593/QĐ-BHXH I-VAN standard; eBH IVANService example | Later gated; **filing** requires legal authorization + I-VAN contract — distinct from read lookup |

---

## 2A. VietQR / BANK_TRANSFER → Fiscal C0 gap (binding honesty)

**Verdict:** Provider-neutral Payment Core + FiscalProviderAdapter **do not** make VietQR C0-ready. C0 fiscal path today is **CASH XOR CARD** only.

### 2A.1 Accepted C0 path (runtime + ADR)

| Fact | Ref | Class |
| --- | --- | --- |
| `CollectionEvidenceKind` = `CARD_PROVIDER_COLLECTION` \| `CASH_RECEIVE` only | `payment-collection-event.ts` L8; mig `032` CHECK | **REPO FACT** |
| CARD PCE requires affirmed `provider_occurred_at` collection time | ADR-0014 D33–D35; `insertCardPaymentCollectionEvent` | **REPO FACT** |
| CASH PCE via `ReceiveCash` / ADR-0038 | ADR-0014 D37 overlay; cash insert helper | **REPO FACT** |
| Fiscal `collected_at` = PCE only; never ingest/Settlement/fiscal ACK clock | ADR-0013 Chronology Delta; ADR-0014 D32–D35; `fiscal-service.ts` | **REPO FACT** |
| `FiscalCheckoutGate` fail-closed without PCE + policy | FISC1.1 runtime | **REPO FACT** |
| Production fiscal `SATISFIED` requires **G2** | ADR-0014 D30 | **REPO FACT** |
| BANK_TRANSFER / VietQR evidence kind | — | **Missing** |

### 2A.2 Gap vs BANK_TRANSFER via VietQR

| Topic | C0 CASH/CARD today | VietQR / bank transfer today | Required future contract (Level C before runtime) |
| --- | --- | --- | --- |
| Authoritative confirmation of collection | CARD: provider collection affirmation; CASH: `ReceiveCash` | Transaction Sync callback ± inquire; EN/VI field conflict; `sign` optional | Written partner rule: which field(s) affirm **funds collected** (not QR scanned / not pending); reject if unaffirmable |
| Evidence provenance | CARD provider / cash drawer event | VietQR→partner POST; not NAPAS settlement file | Provenance enum + vaulted raw payload hash; who attested (bank vs aggregator) |
| Actual collection timestamp | `provider_occurred_at` / cash receipt time → PCE `collected_at` | VI: `transactiontime` Long ms Required; EN: Optional String | Affirmed collection clock mapping; forbid wall-clock / callback ingest time / QR create time |
| Unique transaction ID + duplicate callbacks | Payment/Check uniqueness + provider refs | VI: `transactionid` + `referencenumber` Required; retries ≤10 | Idempotency key = LE + binding + canonical ref; duplicate → same Payment transition; never double PCE |
| Partial / excess / reversed / unmatched | C0 one Payment XOR one Check; amount match | Callback amount may ≠ Payment; credits/debits (`transType` D/C); no C0 reverse→fiscal path | Explicit states: PARTIAL, EXCESS, REVERSED, UNMATCHED; **no PCE** until exact match policy Accepted |
| Unknown outcomes + reconciliation | Fiscal TIMEOUT reconcile exists for adapter | No bank inquire→Payment reconciliation runtime | UNKNOWN park + inquire/reconcile job; never invent SUCCEEDED or PCE |
| `PaymentCollectionEvent` compatibility | Only CASH/CARD kinds | No `BANK_TRANSFER_*` kind | New evidence kind + Level C Accept; migration CHECK change; insert helper with collection affirmation |
| `FiscalCheckoutGate` / e-invoice chronology | Gate after PCE; issuance uses `collected_at` | Paying via VietQR success ≠ PCE ≠ gate open | Chronology: QR pay → Payment lifecycle → (future) bank PCE → Tax snapshot bind → issue; G2 still required for prod |

**Hard rule:** Do **not** mark VietQR as C0-ready because Payment Core or Integration Gateway exists. BANK_TRANSFER fiscalization is a **separate Level C** after vendor contract + FinSec/Privacy/Arch APPROVE + PO Accept.

### 2A.3 Proposed future evidence kind (docs only — not Accepted)

```text
CollectionEvidenceKind += BANK_TRANSFER_PROVIDER_COLLECTION  -- Proposed name only
  requires:
    provider_event_identity (canonical unique ref)
    provider_occurred_at     (affirmed bank collection time)
    amount/currency match Payment
    binding.legal_entity_id match
    signature/auth valid per partner contract
  forbids:
    inventing collected_at from received_at / settlement_satisfied_at / NOW()
    PCE on PARTIAL / EXCESS / UNMATCHED / UNKNOWN
```

---

## 3. Provider selection & ownership model

### 3.1 Selection (Proposed — not Accepted)

| Domain | Primary candidate | Alternates | Production gate |
| --- | --- | --- | --- |
| Fiscal e-invoice | **Viettel S-Invoice** (adapter) | MISA meInvoice, VNPT-class — not contracted here | **G2** + Egress Gate + LE credentials |
| Dynamic QR + confirm | **VietQR host2host / partner API** **or** bank VietQR API | NAPAS VietQRPay ISV (UNKNOWN access); SePay-class (**PROVIDER CLAIM**) | FinSec review + non-custody preserved |
| Migration | Interface only §8 | — | Separate PO GO |

### 3.2 Ownership per LegalEntity (Proposed)

```text
integration_provider_binding
  binding_id PK
  tenant_id
  legal_entity_id          -- REQUIRED owner of fiscal/payment merchant identity
  provider_family          -- FISCAL_EINVOICE | PAY_VIETQR | PAY_BANK | MIGRATION | BHXH_IVAN | VFA
  provider_code            -- e.g. VIETTEL_SINVOICE_V2 | VIETQR_H2H
  status                   -- DRAFT | ACTIVE | SUSPENDED | REVOKED
  scope_json               -- outlets/terminals allowed (fail-closed empty ≠ wildcard)
  credential_ref           -- opaque vault pointer (never raw secret in row)
  external_merchant_ref    -- tax code / merchant id as displayed
  activated_at / revoked_at
  UNIQUE active (legal_entity_id, provider_family, provider_code) WHERE status=ACTIVE
```

Rules:

1. Credentials **independent per LegalEntity** (and per provider_family).
2. Tenant-level “shared secret for all LEs” **forbidden**.
3. Revocation is immediate for outbound calls; immutable audit of activate/revoke/rotate.
4. Fiscal binding required before any non-test adapter call; Payments binding for QR generate/callback.
5. ADR-0015: secrets in vault; Egress Gate before cross-border or third-party PII send.

---

## 4. Adapter API / DTO contracts (docs)

### 4.1 Fiscal — Viettel S-Invoice → `FiscalProviderAdapter`

Map provider ops onto existing interface (`fiscal-provider-adapter.ts`):

| Adapter method | Viettel-oriented responsibility (Proposed) |
| --- | --- |
| `issue` | Create/issue e-invoice for frozen Tax + PCE inputs; return providerReference |
| `queryStatus` | Poll issue/CQT status |
| `retrieveEvidence` | Fetch immutable PDF/XML/hash evidence |
| `idempotentRetry` | Safe re-issue keyed by `issueIdempotencyKey` |
| `reconcileTimeoutAfterSuccess` | Resolve TIMEOUT vs later success without regressing `SATISFIED` |

**DTO boundary:** Vendor JSON/XML **stops at adapter**. Fiscal Core stores only `FiscalAdapterResult` + append-only evidence.

**G2:** Adapter may run in **sandbox** under Level B GO; production `SATISFIED` path requires **G2**.

### 4.2 Payments — VietQR → Payments provider port (Proposed new)

Complement PAY1.1 (no production SDK today):

```text
PaymentRailAdapter (Proposed)
  createDynamicQr(input: {
    legalEntityId, paymentId, amountMinor, currencyCode,
    orderOrCheckRef, idempotencyKey, bankAccountRef
  }) → { qrPayload, expiresAt, providerQrRef }

  verifyAndMapCallback(rawHeaders, rawBody) → {
    providerEventIdentity,  // e.g. referencenumber
    amountMinor, currencyCode, orderId, transType,
    signatureValid: boolean
  }

  inquire(providerQrRef | paymentId) → status projection
```

Callbacks: idempotent on `providerEventIdentity` / `referencenumber`; amount/currency match; never auto-complete Order without Settlement/Payment lifecycle rules.

**Non-custody:** funds settle to merchant bank account; KiU records Payment lifecycle only (ADR-0013).

---

## 5. Sandbox vs production criteria

### 5.0 Privacy / egress (binding)

| Mode | Allowed data | Credential path | Egress Gate |
| --- | --- | --- | --- |
| **Sandbox (synthetic)** | Synthetic tax codes / buyers / amounts only | Vault test secrets or fixtures; never prod secrets | Record endpoints + data categories even for synthetic |
| **Sandbox (live merchant)** | Real merchant/buyer PII | LE vault credential_ref | **Required** ApproveEgress before first call |
| **Production** | Real | LE vault; rotate/revoke audited | Required + **G2** for fiscal SATISFIED + FinSec APPROVE |

Uncleared third-party → **synthetic only or blocked** (ADR-0015).

### 5.1 Viettel S-Invoice checklist

1. LegalEntity tax code + business license pack (sales checklist).
2. Commercial contract + payment — **SALES**.
3. Explicit V1 vs V2 pack + IP whitelist — **PROVIDER**.
4. Written confirmation of máy tính tiền / Law 108 / NĐ 254 / TT 91 support for F&B — **PROVIDER + counsel**.
5. Invoice template/serial/type registration with tax authority — **MERCHANT + PROVIDER**.
6. Digital signature / CA path ownership — **MERCHANT** (+ SaaS partner model if any — **OPEN**).
7. KiU: adapter behind flag; never claim G2; synthetic sandbox first.
8. Egress Gate record for Viettel endpoints + data categories.
9. Cost/SLA / multi-merchant credential model — **SALES UNKNOWN** until quote.

### 5.2 VietQR (host2host-class) checklist

1. Merchant bank account (docs cite MB/BIDV paths) — **MERCHANT**.
2. Partner registration + Get Token credentials + **binding EN/VI Transaction Sync spec** — **PROVIDER**.
3. Documented `sign` algorithm (or explicit “Bearer-only”) + key custody — **PROVIDER**.
4. Implement Transaction Sync + auth verify + dedupe — **KiU** (after I0/I1 foundations).
5. Dynamic QR generate sandbox — **PROVIDER DOC**.
6. Retry policy alignment (≤10) — **KiU tests**.
7. MDR / fees / NAPAS path / credential ownership — **SALES UNKNOWN**.
8. Distinguish vietqr.vn aggregator vs NAPAS VietQRPay ISV — do not conflate.
9. **No** C0 fiscal PCE from VietQR until §2A Level C Accept.

### 5.3 Production criteria (separate from sandbox)

- Vault + rotate/revoke + audit live
- Egress Gate enforced on all third-party calls with real PII
- LE-scoped ACTIVE binding
- Vendor contracts + confirmed API semantics
- Fiscal: **G2** + counsel on regime
- Payments QR: FinSec APPROVE on callback auth + non-custody preserved
- BANK_TRANSFER→fiscal: §2A contract Accepted (not implied by Payment Core)

---

## 6. Failure / retry / idempotency / callback / reconciliation / compensation — test matrix

Tags: **Implemented** (repo today) · **Proposed** (future adapter/binding work)

| ID | Tag | Scenario | Expect |
| --- | --- | --- | --- |
| F1 | Implemented | Fiscal adapter unavailable | `ADAPTER_UNAVAILABLE`; no fake SATISFIED |
| F2 | Implemented | Fiscal TIMEOUT then late SUCCESS | reconcile; never regress SATISFIED |
| F3 | Implemented | Duplicate issue same idempotency key | One logical invoice / same providerReference |
| F4 | Implemented | Concurrent reconcile vs late FAIL | Append evidence; SATISFIED preserved |
| P1 | Proposed | VietQR callback replay same referencenumber | Idempotent SUCCESS; one Payment transition; **no PCE** until §2A |
| P2 | Proposed | Callback amount/currency mismatch | Reject; no SUCCEEDED; no PCE |
| P3 | Proposed | Invalid Bearer/sign | 4xx; no state change |
| P4 | Proposed | Callback before Payment create | Fail closed / park UNKNOWN |
| P5 | Proposed | Provider retry storm (10×) | Dedupe; no double allocation |
| P6 | Proposed | Inquire vs callback race | Single SUCCEEDED |
| P7 | Proposed | PARTIAL / EXCESS / REVERSED / UNMATCHED | Explicit park; no PCE |
| C1 | Proposed | Cross-LE credential misuse | Denied |
| C2 | Proposed | Revoked binding mid-flight | Outbound blocked; audit |
| M1 | Proposed | Migration import duplicate external id | Idempotent upsert / reject per connector policy |

---

## 7. External blockers (contract / credentials / cost)

Canonical list with engineering OPEN items: **§11**. Summary:

| Blocker | Blocks |
| --- | --- |
| Viettel commercial + V2 pack + 2026 MTT written confirm | Fiscal sandbox/prod honesty |
| Tax authority registration / serials / CA | Merchant fiscal usable |
| **LEGAL GATE G2** | Production fiscal success |
| VietQR EN/VI Sync binding + sign/auth letter | Payments QR sandbox/prod |
| VietQR/bank partner contract + MDR + bank list | Payments QR production |
| NAPAS ISV access (if chosen) | Alternate rail |
| Vault + Egress Gate + LE binding runtime | Any third-party call with real PII |
| §2A BANK_TRANSFER PCE Level C | VietQR→fiscal C0 |
| Counsel on 254/91 / transitional 70 | G2 package |
| I-VAN / VFA | Later connectors only |

---

## 8. Migration adapter interface & priority

**Interface (Proposed — no API claims for closed vendors):**

```text
MigrationSourceAdapter
  readonly sourceCode: 'IPOS_VN' | 'MISA_CUKCUK' | 'KIOTVIET_FNB' | 'SAPO_FNB' | ...
  probeConnectivity(): Promise<{ ok: boolean; mode: 'API'|'FILE'|'MANUAL' }>
  listExportCapabilities(): Capability[]  // only what is verified
  pullBatch(cursor, capability): Promise<Batch>
  // Never invent endpoints not in vendor docs held by MillQ
```

| Priority | Source | Known posture | Claim rule |
| --- | --- | --- | --- |
| P1 | **KiotViet F&B** | Large VN F&B installed base; NAPAS partnership public | API surface **UNKNOWN** until partner pack |
| P2 | **MISA CukCuk** | Accounting/F&B suite common | API **UNKNOWN** without MISA partner docs |
| P3 | **iPOS.vn** | Restaurant POS competitor | API **UNKNOWN** |
| P4 | **Sapo FnB** | Commerce/F&B | API **UNKNOWN** |

**Default:** file/manual export importers first if APIs unavailable. **No unsupported API claims** in marketing or ADRs.

---

## 9. VFA & BHXH/I-VAN (later gated)

| Connector | Allowed first mode | Filing / write | Gate |
| --- | --- | --- | --- |
| VFA Open API | **Read-only** catalogs/alerts if API exists | Forbidden until legal GO | Separate PO + Privacy |
| BHXH via I-VAN | Lookup / status read via licensed provider | **Filing** only with employer authorization + I-VAN contract | Separate PO + FinSec + Privacy |

Do not bundle into Fiscal or Payments go-live.

---

## 10. Small PR sequence (after separate PO authorization)

| PR | Autonomy | Scope |
| --- | --- | --- |
| **I0 docs** (this PR #88) | C | Research gate + ownership/gap honesty — **docs-only**; MERGE HOLD until reviews APPROVE |
| **I0 runtime (recommended first Level B)** | B | **Provider-neutral foundations only:** Integration Gateway registry stub; `integration_provider_binding` + vault credential_ref; egress allowlist gate hook; append-only `integration_attempt` audit; transactional outbox pattern for outbound attempts; **no** Viettel/VietQR production or sandbox vendor clients |
| **I1** | C | Binding/vault/egress ADR Accept (if not folded into I0-B design) |
| **I2** | B | Fiscal Viettel **sandbox** adapter behind flag (synthetic data; no G2) — only after I0-B + vendor pack |
| **I3** | B | Payments VietQR sandbox + callback verify — Payment lifecycle only; **no** bank PCE/fiscal |
| **I3b** | C | BANK_TRANSFER → PCE / fiscal chronology (§2A) Accept |
| **I4** | C | G2 legal package + counsel |
| **I5** | B | Migration adapter skeleton + first **file** importer |
| **I6+** | C/B | VFA read / BHXH later |

**I0 Level B must not include:** Viettel/VietQR production adapters, G2, secrets in repo, invented API capabilities, Identity #87 changes.

**Reviews (each implement PR):** Architecture · FinSec · Privacy (independent).  
Identity PRs: **do not block** on this sequence.

---

## 11. OPEN blockers (exact)

1. Viettel commercial + V2 pack + written 2026 máy tính tiền / Law 108 / NĐ 254 support for F&B
2. Viettel SaaS multi-merchant vs per-merchant credential model + pricing/SLA
3. VietQR EN/VI Transaction Sync Required-field conflict — partner binding letter
4. VietQR callback `sign` algorithm / Bearer-only confirmation + key custody
5. Banks/modes with verifiable collection confirmation for KiU
6. Vault + Egress Gate runtime (missing)
7. Integration Gateway / LE binding runtime (missing)
8. BANK_TRANSFER PCE / FiscalCheckoutGate chronology — Level C not Accepted (§2A)
9. LEGAL GATE G2
10. Counsel on TT 91 PDF + transitional 70/254 for KiU merchants

---

## 12. STOP

No vendor production connection, no secrets in repo, no migrations from this gate alone, no runtime merge without separate PO GO, no provider legal go-live, no G2 claim, no VietQR-as-C0 claim from Payment Core existence. Identity PR #87 untouched.
