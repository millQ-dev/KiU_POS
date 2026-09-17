# Vietnam Payment UX Scenarios for Forge — 2026

**Purpose:** Feed Forge / cashier UX from **verified capability classes**, not from a chosen provider.  
**Rule:** Screens labelled **GENERIC** (PAY1.1) vs **PROVIDER-SPECIFIC** (only if shortlisted route supports).

---

## Design invariants (GENERIC)

1. Cashier never marks “paid” manually.  
2. Browser/app return ≠ paid.  
3. PENDING / UNKNOWN keep Settlement COLLECTING.  
4. Duplicate provider events are invisible to cashier (no double allocate).  
5. Fiscal UNAVAILABLE may still block CompleteOrder after SATISFIED Settlement.

---

## Scenario pack

### S1 — Create dynamic merchant-presented QR (GENERIC)

**Preconditions:** Open Settlement, non-zero outstanding Check.  
**Cashier:** chooses digital tender (label TBD after PO route choice — never fake “VietQR connected” until adapter exists).  
**System:** CreatePayment → PENDING; show QR / wait panel.  
**Guest:** scans with bank/wallet app.  
**Forge states:** Creating → Waiting for customer.

### S2 — Confirmed via server evidence (GENERIC)

**Trigger:** VERIFIED provider SUCCESS (+ allocation).  
**UI:** Confirmed; Outstanding updates from Settlement reconcile.  
**Not shown:** raw HMAC, secrets.

### S3 — Delayed callback (GENERIC)

Cashier may leave wait screen / timeout UX.  
Later SUCCESS arrives → same Payment reconciles → coverage appears.  
**UI:** Status unknown / Reconciling → Confirmed (no second Payment).

### S4 — Fake client success (GENERIC — permanent)

Redirect says success → Settlement still COLLECTING until server evidence.  
**UI copy:** “Waiting for bank confirmation”.

### S5 — Expired / declined (GENERIC)

Provider EXPIRED/FAILED → non-qualifying; allow new Payment with new idempotency key.  
**UI:** Expired / Declined.

### S6 — Status inquiry recovery (GENERIC; MoMo/ZaloPay/VNPAY docs support)

Cashier “Check status” → adapter inquiry → VERIFIED outcome or still UNKNOWN.  
**UI:** Reconciling → Confirmed | Still waiting.

### S7 — Duplicate callback (GENERIC)

No cashier-visible change; Outstanding unchanged.

### S8 — Amount / currency mismatch quarantine (GENERIC)

**UI:** Payment problem / needs reconciliation — do not show Paid.

### S9 — Customer-presented QR (PROVIDER-SPECIFIC / FUTURE)

Only if route supports VIETQRMe / customer-presented.  
**UI:** “Ask guest to show QR” → device scan → Processing → Confirmed.  
**Do not ship** until selected route confirms.

### S10 — SoftPOS / Tap-to-Phone (PROVIDER-SPECIFIC)

Amount pushed to SoftPOS app → guest taps card/wallet → server-confirmed result.  
**UI:** Processing on terminal → Confirmed.  
Avoid any KiU PAN capture screen.

### S11 — Tourist VietQRGlobal (PROVIDER-SPECIFIC)

Same merchant-presented QR if network enabled; optional badge “International QR accepted” only when merchant truly enrolled.  
**Do not claim** Alipay/Weixin acceptance without acquirer confirmation.

### S12 — Refund pending (FUTURE — research only)

After future compensating architecture: Refund pending / Refund confirmed.  
**Not in PAY1.1 runtime.**

---

## Suggested cashier state vocabulary (map to PAY1.1)

| UX label | Lifecycle / notes |
| --- | --- |
| Creating | INITIATED |
| Waiting for customer | PENDING |
| Processing | PENDING / UNKNOWN |
| Confirmed | SUCCEEDED + allocated |
| Declined | FAILED |
| Expired | EXPIRED |
| Cancelled | CANCELLED |
| Status unknown | UNKNOWN / awaiting inquiry |
| Reconciling | inquiry in flight |
| Refund pending | future |

Only enable labels supported by the chosen integration route.
