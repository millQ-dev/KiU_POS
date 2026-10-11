# FISC1.1 Level C decision packet — OPEN / CLOSED

**Autonomy:** Level C decisions for finished-C0 polish vs Core staging  
**Date:** 2026-10-11  
**Updated:** 2026-10-11 — PO independent review CONDITIONAL APPROVE; three product decisions Accepted below  
**Context:** FISC1.1 Core Runtime (Origin PR #81) under Accepted ADR-0014 / ADR-0038 / ADR-0039.

---

## PO ACCEPT (2026-10-11) — closed for FISC1.1

| Decision | Binding |
| --- | --- |
| Cash authorization permission key | **`payments.receive_cash`** is the permanent dedicated ReceiveCash permission key (closes ADR-0038 A4 exact-name OPEN) |
| Overpay upper business bound | **No** separate C0 business overpay cap. Technical Money bounds + server validation of amount / currency / change remain mandatory (tendered ≥ due; change = tendered − due) |
| Tips inside ReceiveCash | **Not supported** in FISC1.1. Future tips require a separate Accepted model (allocation / fiscal rules) |
| Partial cash (tendered < due) | **Rejected** for the current one-Payment / one-Check narrow shape. Does **not** forbid future split/multi-tender under a later Accept |

Runtime already implements these bindings (`PARTIAL_CASH_REJECTED`, `TIPS_NOT_SUPPORTED`, no artificial overpay cap, permission key `payments.receive_cash`).

---

## Still OPEN / out of FISC1.1 Core (not silent product invention)

| Topic | Class |
| --- | --- |
| Cash refunds / voids / compensating ReceiveCash | Explicitly out of FISC1.1 |
| Late / offline cash collection | Production fail-closed without server accept (default) |
| Vietnam production FiscalProviderAdapter selection | Production / G2-blocking — OUT of Core |
| LEGAL GATE G2 | **Not granted** — production fiscal go-live forbidden until G2 |
| Split / multi-tender fiscalization | Explicitly blocked in FISC1.1 shape; later Level C |

---

## Ask resolved

- ~~Accept provisional `payments.receive_cash`~~ → **Accepted as permanent key**
- ~~Confirm no overpay upper bound for C0~~ → **Accepted (no business cap)**
- ~~Confirm tips remain out of ReceiveCash for C0~~ → **Accepted (out of FISC1.1)**

Finished C0 product release language still requires remaining OPEN items above + G2 for fiscal production — distinct from FISC1.1 Core staging merge authorization after adversarial test close-out.
