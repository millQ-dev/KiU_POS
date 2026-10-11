# Review packet — ADR-0038 C0 Cash + Card PaymentCollectionEvent

**Autonomy:** Level C (docs only)  
**Status:** **Accepted** — PO **ACCEPT WITH DELTAS** 2026-10-11; **Origin merge pending** PO merge authorization  
**Branch:** `docs/adr-0038-c0-cash-payment-collection`  
**Base:** `b218684586580999092496680772ec69d0adf8b5`  
**Do not merge until PO merge authorization. No migration 032 / FISC runtime.**

---

## Goal

Mandatory Vietnam C0 **CASH and CARD** under `PaymentCollectionEvent`, with frozen tender/change Money, non-forgeable `ReceiveCash`, and clear separation of FISC Core staging vs finished C0 release.

## Docs

- `docs/decisions/ADR-0038-c0-cash-tender-payment-collection-event.md` (Accepted A1–A8)
- `docs/decisions/ADR-0014-vietnam-fiscalization-boundary.md` (D37 superseded pointer for narrow path)
- this packet

## Accepted freezes

| ID | Freeze |
| --- | --- |
| A1 | CASH+CARD mandatory core; FISC staging ≠ finished C0 |
| A2 | Example 65000/100000/35000; gross≠Revenue/allocation/fiscal; change≠refund |
| A3 | ReceiveCash server Money + human confirm + Session/Terminal/Open CashShift; server `collected_at`; durable idempotency |
| A4 | Release-blocking matrix; no CompleteOrder without fiscal; no manager/ApprovalRequest backdoor |
| A5 | CARD: VERIFIED collection `provider_occurred_at` only; no unsafe chronology fallback |
| A6 | One Payment XOR; one Check; no duplicates |
| A7 | Fiscal consumes PCE; drawer Cash-owned; cash≠SATISFIED; ONLINE-ONLY; G2 |
| A8 | DEV/test cash evidence forbidden in production |

## RELEASE-BLOCKING OPEN (not invented)

Permission key name; overpay bounds; tips-in-ReceiveCash; partial acceptance; cash refunds; late/offline cash; provider field→COLLECTION mapping.
