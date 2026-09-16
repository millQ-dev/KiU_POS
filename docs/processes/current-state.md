# MillQ Current State

**Checkpoint:** P1.2 First KiU Cashier Frontend Shell — **CURRENT**
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Baseline:** Origin/GitHub main @ `f9b728e6731b9269bcdbcf9e5f32448811246814`
**P1.1:** **DONE** @ `f9b728e…` (PR #45)
**ADR-0031 / ADR-0029:** **ACCEPTED**
**Updated:** 2026-09-16

## Runtime / CI / backup

| Item | State |
| --- | --- |
| GOLDEN-1 | **DONE** — Live Menu/Pricing **PASS**; Live POS selection **PASS** |
| M1.1 Menu Configuration & Resolution Runtime | **DONE** |
| P1.1 POS Presentation Runtime | **DONE** @ `f9b728e…` |
| P1.2 First KiU Cashier Frontend Shell | **CURRENT** |
| Identity / production session auth | **ABSENT** — P1.2 uses explicit **dev cashier bootstrap** only (not production authorization) |
| COMMERCIAL ROUNDING POLICY (unit Money × fractional qty) | **DEFERRED Level C** — **ADR-0030 reserved, NOT created** |
| Promotions / Loyalty / Floor/Table / Payments / Fiscalization | **STOP** — not started |

## This PR (P1.2)

- Thin HTTP transport for ResolvedPosSurface, selectPosCountTap, OpenOrder, get Order
- React/Vite cashier shell at `/` (cashier primary); consumes P1.1 contracts only
- COUNT one-tap add; MASS/VOLUME quantity entry **DEFERRED** (P1.3)
- No SetOrderCommercialTerms / CompleteOrder / Payment on tap
- No Floor/Table UI; no package forks; OPTION A preserved

## Next

Independent review → merge → backup → **P1.3 Cashier Order Interaction UX**
