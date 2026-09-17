# Vietnam Fiscalization Readiness Review — 2026

**Block:** P0 Vietnam Fiscalization Readiness Review  
**Mode:** Research + architecture review  
**Baseline:** `1390758879e3764557c0b6930fe640b00547b749` (Origin == GitHub)  
**Date:** 2026-09-17  
**Hard rules:** NO runtime · NO migration · NO provider selection · NO tax engine implementation · NO ADR auto-write

---

## 0. Evidence labels

| Label | Meaning |
| --- | --- |
| **VERIFIED OFFICIAL FACT** | Government / gazette / official portal text confirmed (or English official translation of decree) |
| **PROVIDER IMPLEMENTATION FACT** | Provider API/docs (MISA, Viettel, …) |
| **LEGAL INTERPRETATION** | Firm/advisory reading of law — not sole binding source |
| **UNKNOWN** | Not established |

---

## 1. Preflight

**VERIFIED (repo):** Origin/GitHub main == `1390758879…`. PAY1.1 CLOSED. Acquiring Profile CLOSED. FiscalCheckoutGate production = `UNAVAILABLE` fail-closed. ADR-0014 Accepted.

Runtime already capable of: commercial snapshot (C1.1), Settlement/Check (S1.1), Payment/Allocation (PAY1.1), Checkout observe fiscal gate → CompleteOrder (ADR-0032), LegalEntity, businessDate on CompleteOrder.

---

## 2. Regulatory baseline (2026)

### 2.1 Current regime

| Instrument | Role | Effective | Source class |
| --- | --- | --- | --- |
| Law on Tax Administration **108/2025/QH15** | Parent tax-admin law for e-invoices | 2025 law; e-invoice detail via decrees | VERIFIED OFFICIAL FACT (cited by Decree 254 preamble on vanban.chinhphu.vn) |
| Decree **254/2026/NĐ-CP** | Details e-invoices / e-documents under Law 108 | Issued **30 Jun 2026**, effective **1 Jul 2026** | VERIFIED OFFICIAL FACT — [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?docid=218689&pageid=27160), [Công báo](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-254-2026-nd-cp-469957/66826.htm) |
| Circular **91/2026/TT-BTC** | MoF guidance on Law 108 + Decree 254 | **1 Jul 2026**; replaces Circular 32/2025/TT-BTC | LEGAL INTERPRETATION / firm alerts citing MoF (EY, Forvis Mazars, KPMG); confirm PDF for attorney |
| Decree **123/2020/NĐ-CP** as amended by Decree **70/2025/NĐ-CP** | Prior invoice decree (POS cash-register rules expanded from **1 Jun 2025**) | Superseded for e-invoice detail by Decree 254 from **1 Jul 2026** | VERIFIED OFFICIAL FACT that 70 amended 123; VERIFIED OFFICIAL FACT Decree 254 replaces that framework per gov listing + firm consensus |

**Do not treat 2024-only Decree 123 research as sufficient.**

### 2.2 Invoice methods (Đ.6 Decree 254)

Vietnamese terminology (LEGAL INTERPRETATION of Art. 6 summaries + English LuatVietnam text of Decree 254):

| Mode | Vietnamese concept | Who |
| --- | --- | --- |
| Tax-authority-coded | Hóa đơn điện tử **có mã của cơ quan thuế** | General default for many taxpayers |
| Non-coded | Hóa đơn điện tử **không có mã** | Eligible enterprises meeting IT/transmission conditions (listed sectors) |
| Cash-register / POS-generated | Hóa đơn điện tử **khởi tạo từ máy tính tiền** (data connected to tax authority) | Direct-to-consumer sellers incl. **ăn uống / nhà hàng / khách sạn** … unless already registered for có mã / không mã |

**VERIFIED OFFICIAL FACT (gov + Decree English text):** Restaurant / F&B / hotel DTC channels are in the cash-register-generated cohort; **if already registered** for coded/non-coded e-invoices, **not forced** to switch to máy tính tiền.

**Household vs enterprise:** VND 1 billion revenue threshold for household/individual businesses is **not** the same rule as enterprise DTC sector listing. Do not apply household-only thresholds to KiU corporate merchants. (LEGAL INTERPRETATION of Art. 6 summaries.)

### 2.3 Invoice types (Đ.8)

VAT invoice (hóa đơn GTGT), sales invoice (hóa đơn bán hàng), specialised forms — method (có mã / không mã / máy tính tiền) ≠ invoice type (GTGT vs bán hàng). Deduction-method orgs typically use **VAT invoices**.

---

## 3. Core question

**Can ADR-0014 support Vietnam 2026 fiscal flow without new architecture semantics?**

### Verdict (launch §6 mapping)

**C. BLOCKED BY UPSTREAM TAX / COMMERCIAL SEMANTICS**

Mapped to launch §33 enum:

# **NEEDS_TAX_ARCHITECTURE**

**Why (highest upstream blocker):**

For economic organizations applying **VAT deduction method** (*phương pháp khấu trừ*), cash-register e-invoices must state **selling price excluding VAT, VAT rate, VAT amount, and total including VAT**.

**Evidence:** English LuatVietnam full text of Decree 254/2026 Art. 10.4(c) (official-decree translation) — labeled **VERIFIED OFFICIAL FACT** for architecture purposes. Vietnamese signed PDF on [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?docid=218689&pageid=27160) / [Công báo](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-254-2026-nd-cp-469957/66826.htm) should be counsel-cross-checked before legal production clearance (LEGAL GATE), not before Tax ADR launch.

KiU today:

- Settlement payable snapshot: tax **ABSENT** by design (S1.1 / ADR-0032).  
- No Tax domain / VAT engine / tax RoundingPolicy context (ADR-0030 only `BASE_LIST_LINE_GROSS`).  
- ADR-0014 forbids Fiscalization inventing business Money; ADR-0028 forbids fiscal total as Revenue SoT.

Therefore Fiscalization **cannot** honestly issue a compliant invoice until Tax facts exist as frozen authoritative inputs.

### Secondary (not primary)

| Item | Gap type |
| --- | --- |
| Distinguish FiscalDocument modes: có mã / không mã / máy tính tiền | ADR_DELTA (likely) after Tax |
| FiscalCheckoutGate state vocabulary vs Decree timing | ADR_DELTA or FiscalPolicy config |
| Offline transmission windows / Continuity | LEGAL_UNKNOWN (need Circular 91 + counsel) |
| Provider selection | PROVIDER_UNKNOWN (out of scope; OK) |

ADR-0014 **boundary itself remains sound** (dedicated module, immutability, offline queue without fabricating acceptance, provider adapters, Order ≠ FiscalDocument).

---

## 4. Timing → KiU checkout

**Service issuance (Decree 254 Art. 9 — English decree text / Vietnam Briefing table):**

- Generally at **service completion**, regardless of payment;  
- If payment collected **before/during** service → issuance at **collection** (excluding certain deposits).

**Restaurant dine-in LEGAL INTERPRETATION:** Payment at checkout often coincides with service completion → fiscal issue near Settlement SATISFIED / payment success is plausible. Exact dine-in edge cases (open tab, deposit) = counsel.

**ADR-0032 already:** FiscalPolicy / JurisdictionProfile **own** before/after-CompleteOrder timing — do not hardcode universally.

**Recommended conceptual gate (architecture, not implementation):**

| Gate state | Meaning |
| --- | --- |
| `NOT_REQUIRED` | Policy says no fiscal for this outcome |
| `REQUIRED_PENDING` | Issue/submit in flight or queued |
| `REQUIRED_SATISFIED` | Authoritative fiscal success evidence |
| `FAILED_RETRYABLE` | Transient failure; retry allowed |
| `FAILED_CORRECTION_REQUIRED` | Needs adjustment/replacement chain |
| `UNAVAILABLE` | Runtime/provider/config cannot determine (current production) |

S1.1 already exposes `NOT_REQUIRED | SATISFIED | PENDING | REQUIRED_NOT_SATISFIED | UNAVAILABLE`. Launch vocabulary (`REQUIRED_PENDING`, `FAILED_*`) is a naming polish — map, do not invent a second gate.

---

## 5. Payment success + fiscal failure

| Question | Architecture answer |
| --- | --- |
| May Order Complete? | **FiscalPolicy-owned** (ADR-0032 §20). Default fail-closed until policy known. |
| Inventory write-off? | Tied to **CompleteOrder** (ADR-0025) — not to fiscal acceptance. |
| Sale legally recognised? | Legal invoice obligation ≠ inventory fact. LEGAL INTERPRETATION needed for dine-in. |
| Customer leave? | Operational UX; legal issuance may still be required. |
| Async retry? | Yes — ADR-0014 queue/PENDING/SUBMITTED; never fabricate acceptance. |
| Duplicate issue? | Forbidden — idempotent Issue + inquiry. |

---

## 6. Offline / outage

ADR-0014: may queue; never fabricate provider acceptance.

**LEGAL_UNKNOWN:** exact deferred-transmission windows under Decree 254 / Circular 91 for máy tính tiền connectivity loss — counsel + Circular 91 PDF required. Do not assume “offline = free forever” or “offline = sale forbidden.”

---

## 7. Corrections / refunds (research only)

Circular 91 (firm summaries): material errors → **adjustment (điều chỉnh)** or **replacement (thay thế)**; cash-register invoices often **replacement**; minor errors may use notification Form 04/SS-HDDT.

ADR-0014 immutability + correction chains **align**. Refund/return fiscal docs = future compensating block dependency — **not** silent mutation.

---

## 8. Customer / seller identity

POS cash-register content (Decree 254 Art. 10 summaries):

- Seller: name, address, tax code — **required**  
- Buyer: name/address/tax code/ID/phone **if buyer requests**; consumer may be “Sold to consumer” style (KPMG note)  
- Business location code/address in some multi-store cases (KPMG)

Map ownership: LegalEntity (tax code) · Outlet (location) · Terminal/cash-register identity (device) — **not** Menu/Layout.

---

## 9. Money ownership (critical)

| Invoice field (typical) | Owner |
| --- | --- |
| Line description / qty / unit | Orders + Catalog |
| Unit price / line gross | Orders + Commercial (ADR-0030 BASE_LIST_LINE_GROSS) |
| Discounts | Commercial snapshot |
| Customer payable / tender | Settlement + Payments |
| **VAT rate / VAT amount / ex-VAT / inc-VAT** | **Tax domain — MISSING** |
| Fiscal document total | FiscalDocument consumes Tax + Commercial — does not invent |

---

## 10. Provider model

**Prefer:** Fiscalization Core → provider-neutral adapter (mirror Payments Core).

Credible provider **classes** (no selection):

- E-invoice service providers (MISA meInvoice APIs, Viettel S-Invoice APIs, VNPT-class) — PROVIDER IMPLEMENTATION FACT that APIs exist  
- Direct tax-authority transmission where eligible  
- POS/cash-register certified stacks transmitting standard format

Signing: USB token / HSM / provider-assisted signing appear in provider docs — prefer merchant/provider-controlled keys; flag if KiU would hold private keys.

---

## 11. Final enum (§33)

# **NEEDS_TAX_ARCHITECTURE**

Secondary after Tax ADR: likely **NEEDS_ADR_DELTA** on ADR-0014 (document modes + gate vocabulary + LegalEntity tax identifiers) before FISC1.1.

---

## 12. Next block proposal

1. **Level C — Tax / VAT Architecture ADR** (named RoundingPolicy contexts for tax; line/order tax facts; inclusive vs exclusive; snapshot at commercial acceptance; ABSENT vs PRESENT).  
2. Then focused **ADR-0014 delta** (if still needed).  
3. Then **FISC1.1 Fiscalization Core Runtime** (provider-neutral).  
4. Provider selection / adapter later (parallel to payment acquiring selection).

**Do not start FISC1.1 runtime now.**
