# DEMO29_EVIDENCE — G3 ledger

**Run id:** `manual-1793111407`  
**DB:** `millq_ci_pos_demo29_1793111406` (disposable; dropped after capture)  
**Origin base:** `7225085a7cef9e8ec6b98dc44d29781139163f23`

## Golden IDs (from evidence)

| Artifact | Value |
| --- | --- |
| Company | from fixture (redacted in PR) |
| Terminal | Cash12 E2E Terminal |
| Shift | opened → **CLOSED / BALANCED** |
| Order | **COMPLETED** |
| PaymentCaptureEvent | **CASH 5000**, unique |
| Fiscal | **SATISFIED** (test adapter) |
| GoodsIssue | **POSTED** |
| Expected close | opening + ΣCASH PCE − refunds = **105000** (opening 100000 + 5000) |
| Close result | **BALANCED** (`close-result.json`) |
| Refunds | **0** |

## Screenshots

Path: `docs/processes/demo29/evidence/manual-1793111407/`

| File | Step |
| --- | --- |
| `01-banner-company.png` | TEST banner + company entry |
| `02-after-pin.png` | After PIN (credentials redacted in fixture) |
| `03-cashier-open.png` | Open shift |
| `04-egg-line.png` | Eggs in basket |
| `05-receive-cash.png` | ReceiveCash |
| `06-fiscal-blocked.png` | Fiscal gate blocked |
| `07-fiscal-satisfied.png` | Fiscal SATISFIED after issue |
| `08-complete-order.png` | Complete + GI |
| `09-close-balanced.png` | Close BALANCED |

Also: `fixture.json` (**PIN redacted**), `close-result.json`, DB readback notes.

## Capture method

- `demo:serve` loopback API+web  
- `demo29-golden-capture.mjs` + follow-up close via Playwright selectors (`close-actual-input`)  
- SQL inspection aligned with pack `10_DB_READBACK_INSPECTION.sql` patterns

## Non-evidence (explicit)

- No production DB  
- No migration 036 on shared/prod  
- No real fiscal/payment provider  
- No Refund B2 UI path in this demo
