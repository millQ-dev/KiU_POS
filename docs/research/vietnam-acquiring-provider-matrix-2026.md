# Vietnam Acquiring Provider Matrix — 2026

**Companion to:** `vietnam-acquiring-profile-2026.md`  
**Baseline:** `f6289e9…`  
**Rule:** cells use VERIFIED / PROVIDER CLAIM / SALES / UNKNOWN — never invent fees or eligibility.

---

## A. Contracting / eligibility (summary)

| Route | Acquiring/PSP role | F&B | Corp merchant | Foreign-owned VN LLC | VN bank account | KYC/KYB | Per-outlet | Sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NAPAS direct VietQRPay partnership | Rail + commercial partnership | Likely yes (KiotViet F&B mention) | Likely | **UNKNOWN / SALES+LEGAL** | Likely for settlement | Merchant verification described for KiotViet path | Likely | NAPAS–KiotViet release 2026-08-05 |
| Bank VietQR (e.g. OCB MSME APIs) | Bank acquirer | **SALES** | **SALES** | **SALES+LEGAL** | Typically yes | Bank KYC | Often yes | OCB developer portal |
| MoMo AIO | Licensed IPS / wallet gateway | **SALES** | Yes (merchant portal) | **SALES+LEGAL** | **SALES** | MoMo onboarding | **SALES** | developers.momo.vn |
| ZaloPay | Licensed IPS / wallet gateway | **SALES** | Yes | **SALES+LEGAL** | **SALES** | ZaloPay onboarding | **SALES** | docs.zalopay.vn |
| VNPAY gateway / QR / PhonePOS | Gateway / SoftPOS | Yes (press) | Yes | **SALES+LEGAL** | **SALES** | VNPAY merchant | **SALES** | sandbox.vnpayment.vn; Visa–VNPAY SoftPOS PR |
| SePay NAPAS gateway | Claims NAPAS network partner | Claims | Claims | **SALES+LEGAL** | Claims | Online + e-contract claims | Claims | sepay.vn / developer.sepay.vn |
| SoftPOS bank apps (TCB/VIB) | Bank SoftPOS | Yes | Yes | **SALES+LEGAL** | Required (bank pages) | Business docs + ID | Store photos (VIB) | techcombank.com; vib.com.vn |

---

## B. API / integration capability

| Capability | MoMo | ZaloPay | VNPAY | Bank VietQR (OCB-class) | SePay (claim) | NAPAS direct |
| --- | --- | --- | --- | --- | --- | --- |
| Create payment | YES (docs) | YES `/v2/create` | YES payment URL / genqr | QR generate APIs | YES REST claim | **UNKNOWN** public API |
| Dynamic QR | YES (payType qr) | YES (QR channels) | YES genqr | YES — OCB `generate-qr-code-for-merchant-vietqr` (portal) | YES | Product yes (marketing) |
| Merchant-presented | YES | YES | YES | YES | YES | YES |
| Customer-presented | **UNKNOWN** product | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | VIETQRMe product (NAPAS) — ISV API UNKNOWN |
| QR expiry | **SALES/docs per product** | Order timeout / inquiry after 15m | ExpireDate in QR specs (lib notes) | **SALES** | Claims | **SALES** |
| Deeplink / redirect | YES | YES | YES return URL | Optional | YES | **SALES** |
| Server callback/IPN | YES IPN | YES callback | YES IPN | **UNKNOWN/SALES** (do not assume vietqr.vn host2host sync) | Claims webhook | Via partner |
| Callback retry | **SALES** | Miss → inquiry after 15m (docs) | **SALES** | **SALES** | **SALES** | **SALES** |
| Signature/auth | HMAC-SHA256 | HMAC (`key2` callback) | `vnp_SecureHash` | Bearer/Basic patterns | Basic Auth claim | **UNKNOWN** |
| Status inquiry | YES | YES `/v2/query` | YES merchant transaction API | Merchant register + generate QR documented (OCB); **inquiry/callback UNKNOWN/SALES** | Claims | Via partner |
| Idempotency | `requestId` unique; dup → code 40 | `app_trans_id` merchant TX | `vnp_TxnRef` uniqueness rules | **UNKNOWN/SALES** | **SALES** | **SALES** |
| Merchant request ID | requestId / orderId | app_trans_id | vnp_TxnRef | **SALES** (order fields likely) | Claims | Order-linked (marketing) |
| Provider TX ID | transId | zp_trans_id | vnp_TransactionNo | **UNKNOWN/SALES** | Claims | **SALES** |
| Refund | YES (docs) | YES async + query_refund | YES refund API | **SALES** | **SALES** | Mentions refunds in VietQRPay marketing |
| Partial refund | **SALES** | Docs allow amount; bank-dependent | **SALES** | **SALES** | **SALES** | **SALES** |
| Void/cancel | Capture/cancel patterns (AIO) | **SALES** | **SALES** | **SALES** | **SALES** | Cancellations mentioned |
| Refund query | YES | YES required | YES | **SALES** | **SALES** | **SALES** |
| Refund callback | **SALES** | Not primary; poll query | **SALES** | **SALES** | **SALES** | **SALES** |
| Reconciliation report | Merchant tools **SALES** | Merchant portal **SALES** | Merchant portal **SALES** | Bank statements | Claims | Partner tools |
| Sandbox | YES public docs | YES sb-openapi | YES sandbox.vnpayment.vn | Portal subscribe | Claims sandbox | **UNKNOWN** for ISV |
| SDK required | Optional SDKs | Optional | Optional sample code | REST | Optional SDK claim | N/A |
| Direct HTTP API | YES | YES | YES | YES | YES | **UNKNOWN** |

---

## C. Payment truth mapping → PAY1.1

| Route | Authoritative success | Adapter verifies | Maps to |
| --- | --- | --- | --- |
| MoMo | IPN `resultCode=0` + signature | HMAC | VERIFIED SUCCEEDED outcome |
| ZaloPay | Callback mac + optional query | HMAC key2 | VERIFIED SUCCEEDED |
| VNPAY | IPN + secure hash | Hash | VERIFIED SUCCEEDED |
| SoftPOS | Acquirer final / confirmed txn | Per-vendor | VERIFIED if server-proven |
| Redirect only | Never | N/A | Client redirect signal only |

---

## D. QR presentation modes

| Mode | Market reality | KiU note |
| --- | --- | --- |
| Static QR | Common for VA / store QR | Not order-exact; weak for Settlement exact amount |
| Dynamic amount-bound | VietQRPay / gateway QR | Preferred P0 for Check outstanding |
| Order/reference-bound | VietQRPay marketing (order info) | Aligns with Payment.merchant reference |
| Merchant-presented | Dominant restaurant UX | Default first adapter |
| Customer-presented | SBV TCCS 04:2024; NAPAS VIETQRMe | Later; SoftPOS/device scan |

---

## E. Cross-border

| Corridor | Status (2026 sources) | Settlement bank examples | KiU impact |
| --- | --- | --- | --- |
| Thailand / Laos / Cambodia | Connected (NAPAS conference) | Member banks | Merchant network enablement |
| China Alipay | Expanded Apr 2026 | Vietcombank | Tourist QR acceptance |
| China Weixin Pay | Expanded Aug 2026 | BIDV | Tourist QR acceptance |
| Korea / Singapore | Expanding (conference) | **SALES** | Future |
| Outbound VN→abroad | Under study / incomplete | N/A | Out of P0 |

---

## F. Card / SoftPOS

| Product | Schemes claimed | Device | PCI note |
| --- | --- | --- | --- |
| VNPAY PhonePOS / SoftPOS | Visa, MC, JCB, NAPAS, Apple/Google Pay (press) | Android NFC | Avoid PAN in KiU; use provider app |
| Techcombank ePOS | Visa, MC, NAPAS, wallets | Android 8.2+ | Bank SoftPOS |
| VIB Tap-to-Phone | NAPAS/Visa/Master | Android 8.1+ NFC | Bank SoftPOS |

---

## G. Economics placeholder

| Fee type | All routes |
| --- | --- |
| Setup / monthly / MDR / fixed / refund / terminal / SIM / payout / FX / chargeback / reserve | **SALES QUOTE REQUIRED** — do not invent |

---

## H. Payout / settlement

| Item | Status |
| --- | --- |
| T+0 / T+1 / T+n | **SALES** per product (SePay claims realtime bank credit for some QR — PROVIDER CLAIM) |
| Weekend/holiday | **SALES** |
| Settlement currency | Expect VND for domestic; FX owner for cross-border **SALES** |
| Gross vs net | **SALES** |

---

## I. PAY1.1 concept mapping checklist

For every shortlisted route, adapter must supply:

- provider_identity / rail_identity / instrument_family / presentation_capability  
- merchant request / create idempotency key  
- provider transaction reference  
- raw provider status string  
- normalized outcome  
- VERIFIED boundary after signature check  
- CALLBACK vs INQUIRY origin  
- amount/currency evidence  

All public gateway docs reviewed fit **ADAPTER-ONLY WORK**.
