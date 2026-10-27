# DEMO29_EVIDENCE — G3 ledger

**Run id:** `manual-1793112022`  
**DB:** `millq_ci_pos_demo29_1793112022` (disposable; dropped after readback)  
**Origin base:** `7225085a7cef9e8ec6b98dc44d29781139163f23`  
**Capture:** `demo29-golden-oneshot.mjs` → `demo29-golden-capture.mjs` (`ok: true`)

## Golden IDs

| Artifact | Value |
| --- | --- |
| Order | `e913a65c-f97b-4917-acd3-ecf388f51037` **COMPLETED** |
| PCE | CASH **5000** (`CASH_RECEIVE`) |
| Fiscal | `27905302-…` **SATISFIED** |
| GoodsIssue | `82b9e67a-…` **POSTED** |
| CashShift | `2177ba85-…` **CLOSED / BALANCED** expected=actual=105000 |
| Refunds | **0** |
| Close UI | `close-result.json` variance BALANCED |

## Screenshots

Path: `docs/processes/demo29/evidence/manual-1793112022/`

| File | Step |
| --- | --- |
| `01-banner-company.png` | TEST banner + company |
| `02-after-pin.png` | After PIN |
| `03-cashier-open.png` | Open shift |
| `04-egg-line.png` | Eggs in basket |
| `05-receive-cash.png` | ReceiveCash |
| `06-fiscal-blocked.png` | Fiscal gate blocked |
| `07-fiscal-satisfied.png` | Fiscal SATISFIED |
| `08-complete-order.png` | Complete + GI |
| `09-close-balanced.png` | Close BALANCED |

Also: redacted `fixture.json`, `golden-capture-ledger.json` (`ok: true`), `close-result.json`, `db-readback.txt` (manual `psql` SELECT-only capture against the disposable DB immediately after oneshot; DB then dropped).

## Non-evidence

- No production DB / migrate 036 on shared/prod  
- No real fiscal/payment provider  
- No Refund B2 UI path  
- Live PINs never written under `evidence/` (redacted at copy)
