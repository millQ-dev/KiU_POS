# INTEGRATIONS-0 — Vietnam Provider Onboarding Gate

- **Status:** Level **C** docs/research — **STOP BEFORE RUNTIME / migrations / vendor production / secrets / merge-as-GO**
- **Date:** 2026-10-18
- **Origin HEAD (resolved):** `973deb878c977535fa35e921d73fc689fe358530`
- **GitHub backup checkpoint (verified ancestor):** `e83a02b8933947a80d4ceb0cf50d84e44c5aaf0f` (PR #82; contained in current main via #85)
- **Migration head:** `032_fisc11_payment_collection_fiscal_core.sql` (**033 free**)
- **Do not delay:** Identity AUTH-18.10 / IDENTITY-B\* work (separate tracks)

Evidence labels: **VERIFIED OFFICIAL FACT** · **PROVIDER DOC FACT** · **REPO FACT** · **UNKNOWN / SALES** · **LEGAL INTERPRETATION** (counsel before G2).

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
| Provider config per LegalEntity | **Missing** | — | Designed in §5 |
| Migration import connectors (iPOS/MISA/…) | **Missing** | ADR-0011 migration architecture only | §7 interface placeholders |

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

### 2.2 Viettel S-Invoice (provider docs)

| Item | Evidence | Class |
| --- | --- | --- |
| REST Invoice API (legacy demo) | `https://demo-sinvoice.viettel.vn:8443/InvoiceAPI` — Basic Auth, IP whitelist | **PROVIDER DOC FACT** — [Technical PDF](http://viettelsolution.com.vn/uploads/tai%20lieu/Technical_webservice_Sinvoice_en.pdf) |
| V2 API base (integrator docs) | `https://api-vinvoice.viettel.vn/services/einvoiceapplication/api/` | **PROVIDER DOC FACT** — Viindoo / MISA SME notes; **confirm with Viettel commercial pack** |
| V1 vs V2 portals | sinvoice.viettel.vn vs vinvoice.viettel.vn | **PROVIDER DOC FACT** |
| Onboarding | Contract + payment → demo account + API docs + tax registration pack | **PROVIDER DOC FACT** — [sinvoice-viettel.vn quy trình](https://sinvoice-viettel.vn/quy-trinh-chuong-3/) |
| KiU commercial eligibility / pricing / SLA | — | **UNKNOWN / SALES** |

### 2.3 VietQR / payments

| Item | Evidence | Class |
| --- | --- | --- |
| Dynamic QR generate | vietqr.dev / api.vietqr.vn docs (`qrType=0`, amount+orderId) | **PROVIDER DOC FACT** — [Generate API](https://api.vietqr.vn/en/vn/api-vietqr-callback/goi-api-generate-vietqr-code) |
| Transaction Sync callback | Partner hosts sync endpoint; Bearer from partner Get Token; signature field; retries ≤10 | **PROVIDER DOC FACT** — [Transaction Sync](https://api.vietqr.vn/en/vn/api-vietqr-callback/api-transaction-sync), [Retry](https://api.vietqr.vn/en/vn/api-vietqr-callback/retry-giao-dich) |
| Host2host integrated doc | Bank account link (MB/BIDV noted in docs) | **PROVIDER DOC FACT** — [Integrated doc](https://doc.vietqr.vn/doc/api-vietqr-callback/api-vietqr-host2host/integrated-document-for-payment-service-vietqr) |
| NAPAS VietQRPay ISV access | KiotViet partnership example Aug 2026 | **VERIFIED** NAPAS release (see `vietnam-acquiring-profile-2026.md`); KiU access **UNKNOWN / SALES** |
| Non-custody | ADR-0013 / PAY1.1 | **REPO FACT** — KiU never holds customer funds |

### 2.4 Later connectors

| Connector | Role | Evidence class | Gate |
| --- | --- | --- | --- |
| **VFA Open API** | Food-authority data (read) | **UNKNOWN** public Open API surface for KiU — do not claim | Later gated; prefer **read-only** first |
| **BHXH / I-VAN** | Social insurance e-filing via licensed I-VAN providers | **PROVIDER/REG DOC** — Quyết định 593/QĐ-BHXH I-VAN standard; eBH IVANService example | Later gated; **filing** requires legal authorization + I-VAN contract — distinct from read lookup |

---

## 3. Provider selection & ownership model

### 3.1 Selection (Proposed — not Accepted)

| Domain | Primary candidate | Alternates | Production gate |
| --- | --- | --- | --- |
| Fiscal e-invoice | **Viettel S-Invoice** (adapter) | MISA meInvoice, VNPT-class — not contracted here | **G2** + Egress Gate + LE credentials |
| Dynamic QR + confirm | **VietQR host2host / partner API** **or** bank VietQR API | NAPAS VietQRPay ISV (UNKNOWN access); SePay-class (**PROVIDER CLAIM**) | FinSec review + non-custody preserved |
| Migration | Interface only §7 | — | Separate PO GO |

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

## 5. Sandbox onboarding checklists

### 5.1 Viettel S-Invoice

1. LegalEntity tax code + business license pack (sales checklist).
2. Commercial contract + payment — **SALES**.
3. Demo/V2 credentials + IP whitelist — **PROVIDER**.
4. Invoice template/serial/type registration with tax authority — **MERCHANT + PROVIDER**.
5. Digital signature / CA path — **MERCHANT**.
6. KiU sandbox: wire adapter behind flag; never claim G2.
7. Egress Gate record for Viettel endpoints + data categories.
8. Cost/SLA schedule — **SALES UNKNOWN** until quote.

### 5.2 VietQR (host2host-class)

1. Merchant bank account (docs cite MB/BIDV paths) — **MERCHANT**.
2. Partner registration + Get Token credentials — **PROVIDER**.
3. Implement Transaction Sync + signature verify + dedupe — **KiU**.
4. Dynamic QR generate sandbox (`dev.vietqr.org` per docs) — **PROVIDER DOC**.
5. Retry policy alignment (≤10) — **KiU tests**.
6. MDR / fees / NAPAS path — **SALES UNKNOWN**.
7. Distinguish vietqr.vn aggregator vs NAPAS VietQRPay ISV — do not conflate.

---

## 6. Failure / retry / idempotency / callback / reconciliation / compensation — test matrix

| ID | Scenario | Expect |
| --- | --- | --- |
| F1 | Fiscal adapter unavailable | `ADAPTER_UNAVAILABLE`; no fake SATISFIED |
| F2 | Fiscal TIMEOUT then late SUCCESS | reconcile; never regress SATISFIED |
| F3 | Duplicate issue same idempotency key | One logical invoice / same providerReference |
| F4 | Concurrent reconcile vs late FAIL | Append evidence; SATISFIED preserved |
| P1 | VietQR callback replay same referencenumber | Idempotent SUCCESS; one Payment transition |
| P2 | Callback amount/currency mismatch | Reject; no SUCCEEDED |
| P3 | Invalid signature | 4xx; no state change |
| P4 | Callback before Payment create | Fail closed / park UNKNOWN per policy |
| P5 | Provider retry storm (10×) | Dedupe; no double allocation |
| P6 | Inquire vs callback race | Single SUCCEEDED |
| C1 | Cross-LE credential misuse | Denied |
| C2 | Revoked binding mid-flight | Outbound blocked; audit |
| M1 | Migration import duplicate external id | Idempotent upsert / reject per connector policy |

---

## 7. External blockers (contract / credentials / cost)

| Blocker | Blocks |
| --- | --- |
| Viettel commercial contract + sandbox creds + IP allowlist | Fiscal adapter Level B sandbox |
| Tax authority registration / serials / CA | Merchant fiscal usable |
| **LEGAL GATE G2** | Production fiscal success |
| VietQR/bank partner contract + MDR | Payments QR production |
| NAPAS ISV access (if chosen) | Alternate rail |
| Vault + Egress Gate runtime | Any production third-party call with PII |
| Counsel sign-off on 254/91 máy tính tiền vs có mã for KiU merchants | G2 package |
| I-VAN licensed partner (BHXH filing) | BHXH connector (later) |
| VFA API availability / terms | VFA connector (later) |

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
| **I0** (this) | C | Docs/research gate — **no merge-as-implement** |
| **I1** | C/B | Provider binding schema ADR + vault/egress design Accept |
| **I2** | B | Fiscal Viettel **sandbox** adapter behind flag (no G2) |
| **I3** | B | Payments VietQR sandbox adapter + callback verify |
| **I4** | C | G2 legal package + counsel |
| **I5** | B | Migration adapter skeleton + first **file** importer |
| **I6+** | C/B | VFA read / BHXH later |

**Reviews (each implement PR):** Architecture · FinSec · Privacy (independent).  
Identity PRs: **do not block** on this sequence.

---

## 11. STOP

No vendor production connection, no secrets in repo, no migrations, no runtime PR merge, no provider legal go-live, no G2 claim from this document.
