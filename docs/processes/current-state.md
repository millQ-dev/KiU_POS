# MillQ Current State

**Checkpoint:** P1.3 Cashier Order Interaction UX — **IMPLEMENTATION COMPLETE (pre-merge)**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Baseline:** Origin/GitHub main @ `0a8180941cf220b983135dd31d4e4e79b47c91ee`
**P1.2:** **DONE** @ `0a81809…` (PR #46)
**P1.1:** **DONE** @ `f9b728e…` (PR #45)
**ADR-0031 / ADR-0029:** **ACCEPTED**
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| P1.2 First KiU Cashier Frontend Shell | **DONE** @ `0a81809…` |
| P1.3 Cashier Order Interaction UX | **THIS PR** — COUNT edit/remove/cancel; commercial status; unit-price refresh; MASS/VOLUME qty entry |
| Identity / production session auth | **ABSENT** — labeled DEV bootstrap only |
| COUNT line edit / remove / cancel OPEN | **Supported** (Orders commands; CancelOrder no manager auth today) |
| MASS/VOLUME quantity entry | **Supported** (dimension/unit from Catalog/OrderLine/POS slot) |
| Commercial status read + price refresh (unit only) | **Supported** — no auto gross |
| COMMERCIAL ROUNDING POLICY | **DEFERRED Level C** — **ADR-0030 reserved, NOT created** |
| Payments / CompleteOrder UX / Fiscalization | **STOP** |

## This PR (P1.3)

- Thin HTTP: PATCH/DELETE line, cancel Order, commercial status, resolve Menu unit prices, select-quantity
- Basket line selection (UI-only), COUNT +/− / edit, remove, cancel with confirm
- MASS/VOLUME quantity entry + weighted add (no qty=1 assumption; no commercial gross)
- Commercial NEEDS_REACCEPTANCE after line mutation; Refresh prices = resolve only
- OPTION A preserved; no line/Order total invention; no migration
- Golden Order-interaction variation (COUNT mutate → invalidate → re-resolve → explicit re-accept → CompleteOrder)

## Next

Independent review → merge → backup → **ADR-0030 Commercial RoundingPolicy** (before Payments)
