# Vietnam Acquiring Integration Profile — 2026

**Block:** P0 Vietnam Acquiring Integration Profile / Provider Selection  
**Mode:** Research + product/integration architecture  
**Baseline:** `f6289e946bb4df1acb183ec377871ee281f2b139` (Origin == GitHub after backup gate)  
**Date:** 2026-09-17  
**Autonomy:** Level B research against Accepted ADR-0013 / ADR-0016 / ADR-0032 / PAY1.1  
**Hard rules:** NO adapter · NO migration · NO production credentials · NO Payment Core changes · NO winner selection

---

## 0. Evidence labels (mandatory)

Every material claim in this dossier uses one of:

| Label | Meaning |
| --- | --- |
| **VERIFIED CURRENT FACT** | Primary/official source checked (SBV/gov, NAPAS, provider docs, bank pages) |
| **PROVIDER CLAIM** | Vendor marketing/docs; treat as commercial assertion until sales confirms |
| **COMMERCIAL INFO REQUIRING SALES CONFIRMATION** | Fees, eligibility, SLA, timelines |
| **INFERENCE** | Logical reading of sources; not a binding integration fact |
| **UNKNOWN** | Not established; must not be invented |

Legal conclusions are **not** attorney advice. Flag attorney confirmation separately.

---

## 1. Product context (KiU / MillQ)

**VERIFIED CURRENT FACT (repo):** PAY1.1 Payments Core is provider-neutral:

- TenderDefinition axes: provider / rail / instrument / presentation  
- Payment + immutable provider-outcome evidence  
- Async lifecycle, idempotency, reconciliation ingestion  
- PaymentAllocation → Settlement coverage  
- Redirect/client success is **not** Payment truth  
- Non-custody (ADR-0013)

**INFERENCE:** First production adapter must map into PAY1.1 without Core redesign. Any required Core change is a major finding (none identified yet for the researched routes).

---

## 2. Regulatory / contracting profile

### 2.1 Cashless payments & intermediaries

**VERIFIED CURRENT FACT:**

- Decree **52/2024/NĐ-CP** (issued 15 May 2024, effective **1 July 2024**) governs non-cash payments, payment services, and **payment intermediary services**, replacing Decree 101. Sources: [Công báo / Chính phủ](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-52-2024-nd-cp-41938/50259.htm); English summary [LuatVietnam](https://english.luatvietnam.vn/tai-chinh/decree-52-2024-nd-cp-on-non-cash-payment-336447-d1.html); firm note [Allen & Gledhill](https://www.allenandgledhill.com/vn/publication/articles/28438/new-regulations-on-cashless-payments-in-in-effect).
- Payment intermediary services include: financial switching, international switching, ACH/clearing, e-wallet, collection/payment support, electronic payment gateway. IPS providers are **non-bank** organisations **licensed by SBV**.
- Circular **40/2024/TT-NHNN** (issued/effective **17 July 2024**) regulates provision of payment intermediary services. Official Công báo listing: [congbao.chinhphu.vn — Thông tư 40/2024/TT-NHNN](https://congbao.chinhphu.vn/van-ban/thong-tu-so-40-2024-tt-nhnn-42371.htm) (Công báo 885+886; PDF/DOC linked there). Article-level licence analysis still **REQUIRES OFFICIAL TEXT CONFIRMATION** by counsel.

**VERIFIED CURRENT FACT (capital thresholds — secondary English summaries of Decree 52):**

- ~VND **50 billion** charter capital for e-wallet / collection-payment support / electronic payment gateway.  
- ~VND **300 billion** for financial switching / international switching / electronic clearing.  
  Sources: LuatVietnam / tradeeconomics summaries of Decree 52. Confirm against official Vietnamese text before any licensing decision.

### 2.2 KiU intended role

**VERIFIED CURRENT FACT (ADR-0013):** MillQ does **not** hold customer or merchant funds; does not act as wallet or payment intermediary of funds.

**INFERENCE (product posture):** KiU should remain a **software / technical integration layer** for restaurant LegalEntities that contract with a licensed bank/PSP/acquirer. KiU should **not** become merchant-of-record for diner funds nor seek an IPS licence **unless** a chosen commercial model forces that (attorney + sales confirmation required).

**UNKNOWN / ATTORNEY REQUIRED:**

- Whether foreign-owned Vietnamese LLC may contract each specific route as ISV/platform vs merchant.  
- Whether multi-tenant SaaS “bring your own merchant account” vs “platform aggregates merchants under KiU” changes licensing.  
- Exact ERC/IRC business-line codes required per route.  
- Data localisation / retention obligations beyond general IPS/provider contracts.

### 2.3 Customer-presented QR standard

**VERIFIED CURRENT FACT:** SBV Decision **2525/QĐ-NHNN** (15 Nov 2024) issued basic standard **TCCS 04:2024/NHNN** for **customer-presented QR** technical specification in Vietnam. Source: [VDB English note](https://en.vdb.gov.vn/news12788/-issuance-of-basic-standard-for-technical-specification-of-qr-code-displayed-from-customers-side-in-vietnam).

**VERIFIED CURRENT FACT:** NAPAS publicly describes **VIETQRMe** as customer-presented QR for retail / transit / parking (2026 NAPAS conference materials). Source: [NAPAS 2026 conference](https://en.napas.com.vn/napas-successfully-holds-the-2026-task-deployment-conference-18426031710042133.htm).

**INFERENCE:** PAY1.1 `CUSTOMER_PRESENTED` axis remains architecturally correct; first adapter may still start merchant-presented only.

---

## 3. VietQR access routes — critical

**Do NOT assume “NAPAS owns the rail ⇒ KiU gets a public NAPAS merchant API.”**

### 3.1 Observed commercial patterns (2026)

| Route class | What sources show | Contract parties (typical) | Label |
| --- | --- | --- | --- |
| **A. NAPAS direct (rail owner)** | NAPAS develops VietQRPay / VietQRGlobal; partners with platforms (e.g. KiotViet Aug 2026) | Platform ↔ NAPAS (+ merchant KYC); restaurant may also sign | VERIFIED CURRENT FACT that partnerships exist; **UNKNOWN** whether KiU can get equivalent direct NAPAS commercial access |
| **B. Acquiring / merchant bank** | Banks publish VietQR merchant registration / QR APIs (e.g. OCB developer portal MSME VietQR APIs) | Restaurant ↔ Bank; KiU as ISV integrating bank API | VERIFIED CURRENT FACT that bank APIs exist; eligibility UNKNOWN |
| **C. Licensed IPS / gateway** | MoMo, ZaloPay, VNPAY operate licensed payment products with merchant APIs | Restaurant ↔ IPS; KiU as technical integrator | VERIFIED CURRENT FACT for public API models |
| **D. Gateway / network-development partner** | SePay claims authorised NAPAS network-development partner for VietQRPay/VietQRGlobal | Restaurant ↔ SePay (+ NAPAS/bank path); KiU ↔ SePay API | PROVIDER CLAIM (SePay); verify SBV licence / NAPAS authorisation with sales |
| **E. Open VietQR aggregator sites** | vietqr.vn documents host2host QR generate + transaction sync/callback | Partner ↔ VietQR.vn + beneficiary bank account (docs mention MB/BIDV support) | PROVIDER CLAIM / docs; distinguish from NAPAS VietQRPay retail product |

### 3.2 NAPAS × KiotViet (proof that access route is a product negotiation)

**VERIFIED CURRENT FACT:** On **5 Aug 2026**, NAPAS and KiotViet signed a comprehensive cooperation agreement to deploy **VietQRPay** on KiotViet and expand **VietQRGlobal** acceptance. NAPAS states VietQRPay links transactions to order info/amount for reconciliation, inquiry, refunds/cancellations/disputes. Source: [NAPAS English release](https://en.napas.com.vn/napas-and-kiotviet-partner-to-expand-the-vietqr-payment-ecosystem-184260820095404275.htm).

**INFERENCE:** Direct NAPAS commercial access for POS platforms is **possible in principle** (proven by KiotViet), but is **not a public self-serve API**. KiU needs a sales/partnership path (or alternative B/C/D).

### 3.3 Explicit answers required by launch brief

| Question | Status |
| --- | --- |
| A. NAPAS directly? | **POSSIBLE BUT NOT SELF-SERVE** — partnership model (KiotViet evidence). KiU access = UNKNOWN / sales. |
| B. Acquiring bank? | **VIABLE PATTERN** — bank VietQR merchant APIs exist (e.g. OCB). KiU eligibility = UNKNOWN. |
| C. Licensed intermediary/PSP? | **VIABLE PATTERN** — MoMo / ZaloPay / VNPAY public merchant APIs. |
| D. Gateway/platform partner? | **VIABLE CANDIDATE CLASS** — e.g. SePay (PROVIDER CLAIM of NAPAS authorisation). |
| E. More than one route? | **YES in market** — platforms may combine domestic QR + wallet + SoftPOS later. |

---

## 4. Candidate universe (no ranking)

Researched for viability (not scored as winner):

1. NAPAS VietQRPay / VietQRGlobal commercial access (direct partnership)  
2. Bank VietQR / OneQR-style acquiring (Vietcombank, BIDV, OCB, Techcombank, VIB, …)  
3. VNPAY (gateway + QR + PhonePOS/SoftPOS)  
4. MoMo (AIO Payment Gateway)  
5. ZaloPay (create order / callback / query / async refund)  
6. SePay / similar NAPAS network partners (gateway aggregators)  
7. Domestic NAPAS card + Visa/Mastercard/JCB/UnionPay via bank or VNPAY SoftPOS  
8. SmartPOS / SoftPOS (Techcombank ePOS, VIB Tap-to-Phone, VNPAY PhonePOS)

See matrix document for capability tables.

---

## 5. Payment truth model (KiU invariant)

**VERIFIED CURRENT FACT (PAY1.1):** Client redirect / deeplink return ≠ Payment success.

| Provider class | Authoritative success (docs) | Redirect/deeplink | Inquiry |
| --- | --- | --- | --- |
| MoMo | Signed **IPN** + match partnerCode/orderId/amount/requestId | UX return only | Query APIs documented |
| ZaloPay | Signed **callback** (`key2`); if miss after ~15 min → **query order** | UX | `/v2/query` |
| VNPAY | **IPN** updates DB; Return URL for display only (integration guides) | UX | merchant transaction API |
| VietQR host2host (vietqr.vn) | Partner **Transaction Sync** / check-order | N/A or secondary | check-order API |
| SoftPOS | Terminal/app final result + acquirer settlement (details SALES) | Device UI | Portal/API UNKNOWN per bank |

---

## 6. Cross-border / Asia (VietQRGlobal)

**VERIFIED CURRENT FACT:**

- NAPAS promotes VietQRGlobal for foreign visitors paying in Vietnam; connectivity includes Thailand, Laos, Cambodia, China (Alipay via Ant + Vietcombank Apr 2026; Weixin Pay via BIDV Aug 2026). Sources: [NAPAS China/Alipay](https://en.napas.com.vn/napas-expands-cross-border-qr-payment-between-vietnam-and-china-18426041513535516.htm), [NAPAS/BIDV/Weixin](https://en.napas.com.vn/napas-bidv-and-weixin-pay-partner-to-expand-qr-payment-services-between-vietnam-and-china-184260820090000496.htm), [NAPAS 2026 conference](https://en.napas.com.vn/napas-successfully-holds-the-2026-task-deployment-conference-18426031710042133.htm).
- Reverse flow (VN apps paying in China) described as under study / not yet complete in those releases.

**COMMERCIAL INFO REQUIRING SALES CONFIRMATION:** Whether restaurant merchant onboarding for VietQRGlobal is automatic with VietQRPay, same MDR, FX owner, settlement still VND, separate certification.

**INFERENCE:** Cross-border acceptance is primarily a **rail + merchant network** property of VietQRGlobal-enabled acquirers/partners, not a separate Order/Settlement model in KiU.

---

## 7. Economics / payout

**PUBLIC:** SoftPOS registration fee promotions appear on bank pages (often time-bounded).  
**SALES QUOTE REQUIRED / UNKNOWN for all routes:** MDR, fixed fees, refund fees, terminal rental, payout T+n, weekend behaviour, reserves, minimum volume, cross-border fees, FX spread.

**Do not invent pricing.** Capture quotes in open-questions tracker.

---

## 8. PAY1.1 fit summary

| Route class | Fit |
| --- | --- |
| MoMo / ZaloPay / VNPAY gateways | **FITS PAY1.1 AS-IS** via adapter (HMAC verify → RecordVerifiedProviderOutcome; inquiry; idempotent request ids) |
| Bank / NAPAS-partner dynamic VietQR | **FITS PAY1.1 AS-IS** if callback/inquiry + amount-bound QR available |
| SoftPOS/SmartPOS | **FITS PAY1.1 AS-IS** if device/provider final status can be verified server-side; else REQUIRES ADAPTER-ONLY WORK for status truth |
| Direct card PAN entry in KiU | **AVOID** — PCI scope; not recommended |
| Customer-presented (VietQRMe) | **FITS axes**; first adapter may defer — REQUIRES ADAPTER-ONLY WORK when product prioritises |

**No Core change required** by researched public docs for first dynamic QR / wallet adapter.

---

## 9. Shortlist for PO decision (not a selection)

Recommended **research shortlist** for sales/legal outreach (unordered):

1. **NAPAS commercial partnership path** for VietQRPay + VietQRGlobal (KiotViet-comparable ISV access) — strategic, highest uncertainty on access.  
2. **NAPAS-authorised gateway partner** (e.g. SePay class) — faster API path if authorisation/licence verifies.  
3. **Major bank VietQR / OneQR** for restaurant LegalEntity — settlement clarity; ISV API quality varies.  
4. **MoMo AIO** — strong public docs: IPN, signature, requestId idempotency, QR payType.  
5. **ZaloPay** — strong public docs: callback + mandatory inquiry fallback; async refund profile for future compensating design.  
6. **VNPAY** — gateway + QR + SoftPOS/PhonePOS breadth for cards/tourists.

**PO / ChatGPT chooses** after sales answers on foreign-owned LLC eligibility, MDR, onboarding SLA, and VietQRGlobal.

---

## 10. Explicit non-decisions

- No first production adapter chosen.  
- No NAPAS/VNPAY/MoMo/ZaloPay/bank appointed.  
- Dynamic VietQR remains a **strong P0 hypothesis**, not a locked partner.  
- Fiscalization, cash, refund runtime remain out of scope.

---

## 11. Next actions (owner / sales)

1. Confirm backup gate independently (user).  
2. Open sales threads for shortlist items 1–6 with questionnaire in `vietnam-acquiring-open-questions-2026.md`.  
3. Attorney memo: software-only role vs IPS risk under Decree 52 for chosen contracting model.  
4. Only after PO decision: launch first adapter block.
