# Vietnam Acquiring — Open Questions Tracker — 2026

**Purpose:** Sales / legal / NAPAS outreach questionnaire.  
**Rule:** Answers become VERIFIED only after written confirmation; until then remain UNKNOWN.

---

## L0 — Cross-cutting (KiU MillQ Vietnamese LLC)

| ID | Question | Owner | Status |
| --- | --- | --- | --- |
| L0.1 | Confirm software-only / non-custody role does **not** require IPS licence under Decree 52 for each contracting model | Attorney | OPEN |
| L0.2 | Foreign-owned Vietnamese LLC eligibility for merchant acquiring / ISV partnership per shortlist | Attorney + Sales | OPEN |
| L0.3 | Required ERC/IRC business lines | Attorney | OPEN |
| L0.4 | Per-LegalEntity vs per-outlet contracts | Sales | OPEN |
| L0.5 | Who is merchant of record for diner payment | Sales | OPEN |
| L0.6 | Who holds settlement account | Sales | OPEN |
| L0.7 | Chargeback / refund liability split | Sales + Attorney | OPEN |
| L0.8 | Data residency / retention / audit | Attorney | OPEN |

---

## L1 — NAPAS direct / VietQRPay partnership

| ID | Question | Status |
| --- | --- | --- |
| L1.1 | Can KiU obtain commercial access comparable to KiotViet (Aug 2026)? | OPEN |
| L1.2 | API ownership, sandbox, certification path | OPEN |
| L1.3 | Merchant onboarding: KiU vs restaurant signs what | OPEN |
| L1.4 | Dynamic QR + order binding + callback/inquiry | OPEN |
| L1.5 | VietQRGlobal enablement included? | OPEN |
| L1.6 | Fees / payout / SLA | OPEN |

---

## L2 — Bank VietQR / OneQR

| ID | Question | Status |
| --- | --- | --- |
| L2.1 | Target bank shortlist for F&B foreign-owned LLC | OPEN |
| L2.2 | ISV multi-merchant API availability | OPEN |
| L2.3 | Dynamic QR + webhook + query | OPEN |
| L2.4 | Settlement T+n / fees | OPEN |

---

## L3 — MoMo

| ID | Question | Status |
| --- | --- | --- |
| L3.1 | Corporate F&B + foreign-owned LLC eligibility | OPEN |
| L3.2 | Production MDR / fees / payout | OPEN |
| L3.3 | QR expiry defaults; SoftPOS roadmap if any | OPEN |
| L3.4 | Sandbox → production certification timeline | OPEN |

---

## L4 — ZaloPay

| ID | Question | Status |
| --- | --- | --- |
| L4.1 | Eligibility + fees | OPEN |
| L4.2 | Confirm async refund + query_refund operational SLAs | OPEN |
| L4.3 | Callback retry policy beyond 15-minute inquiry guidance | OPEN |

---

## L5 — VNPAY

| ID | Question | Status |
| --- | --- | --- |
| L5.1 | Gateway vs SoftPOS packaging for restaurants | OPEN |
| L5.2 | Fees / SoftPOS device requirements | OPEN |
| L5.3 | VietQR / NAPAS QR relationship clarification | OPEN |

---

## L6 — SePay / NAPAS network partners

| ID | Question | Status |
| --- | --- | --- |
| L6.1 | Written proof of NAPAS authorisation + SBV licence class | OPEN |
| L6.2 | Foreign-owned LLC + multi-tenant SaaS model | OPEN |
| L6.3 | Published vs quoted MDR (claim 0.3% needs confirmation) | OPEN |
| L6.4 | VietQRGlobal availability | OPEN |

---

## L7 — SoftPOS banks (TCB / VIB / others)

| ID | Question | Status |
| --- | --- | --- |
| L7.1 | Server API for transaction status usable by KiU Core | OPEN |
| L7.2 | Fees after promotional periods | OPEN |
| L7.3 | F&B outlet requirements | OPEN |

---

## Decision gate

PO may select first production route only when:

- L0.1–L0.2 answered for that route  
- API truth model (callback + inquiry) confirmed  
- Sandbox certified usable  
- Fees/payout known enough for commercial go/no-go  
- PAY1.1 fit remains ADAPTER-ONLY
