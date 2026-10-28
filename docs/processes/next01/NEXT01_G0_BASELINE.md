# NEXT-01 G0 BASELINE — 2026-10-28

**Canonical:** Cursor Origin `millqdev/MillQ`  
**Origin HEAD:** `a1bb99eae809b987cc2268b1e1f4b6f7f36072bf`  
**GitHub backup:** `a1bb99eae809b987cc2268b1e1f4b6f7f36072bf` (**MATCH**)  
**Working tree:** clean on `main` at G0  
**Migration head:** `036_payments_refund_cash_handover_b2.sql`  
**DEMO-29:** **CLOSED** (`DEMO29_GO`); evidence `docs/processes/demo29/evidence/manual-1793112022/` — not re-run  
**Refund B2:** merged dependency only — not reopened

## Active Origin PRs (open)

| # | Title | Note |
| --- | --- | --- |
| 63 | ADR-0035 Employee Engagement + Guest QR architecture | docs ADR — unrelated to NEXT-01 P/R1 code |
| 2 | foundation post-merge checkpoint | stale docs chore |

No open Floor/Table or POS-v1 completion PRs at G0.

## Modules under `apps/api/src/modules/`

Present: cash, checkout, commercial-rounding, fiscalization, guest-menu, identity, inventory, menu, orders, organization, payments, pos, procurement, production, recipes, reporting, security, settlement, tax.  

**Absent:** dedicated `floor` / `tables` module (confirmed). POS acceptance test asserts floor tables do not exist (`pos.acceptance.test.ts` §56).

## ADR / PO status (Origin docs)

| Item | Status |
| --- | --- |
| ADR-0016 Settlement / Split | **Accepted** |
| ADR-0017 Floor / Table | **Accepted** (boundaries only; no runtime required by Accept) |
| ADR-0018 Offline | **Accepted** |
| ADR-0032 Checkout orchestration | **Accepted** |
| ADR-0046 CloseCashShift | **Accepted** (runtime on Origin) |
| ADR-0048 Refund | **Accepted WITH DELTAS**; VietQR adapter / G2 still OPEN |
| Floor/Table R1.1 | `current-state.md`: **FROZEN / NOT STARTED** |
| LEGAL GATE G2 | **REQUIRED** for Vietnam fiscal production — not granted |
| R3-4 colleague cross-assignment / R3-5 Hostess Reservations | **SOURCE_UNAVAILABLE** in this run (Notion R&D pages not independently retrieved); treat as **OPEN** per NEXT-01 brief — do not invent Accept |

## Notion / Figma sources

| Source | Retrieval | Stance |
| --- | --- | --- |
| Roadmap / R1 Notion pages listed in NEXT-01 | Interrupted / not independently fetched | **SOURCE_UNAVAILABLE** — not rejected |
| Figma KIU-POS-Design nodes | Not inspected live in this G0 | **SOURCE_UNAVAILABLE** — design desired UI only; code is authority for EXISTS |

Use NEXT-01 executive roadmap step list as the audit checklist; mark Figma IDs `SOURCE_UNAVAILABLE` until live confirm.

## What G0 did / did not do

- Did: Origin SHA parity, migration head, module inventory, cashier/API/test classification, ADR read, matrices below.  
- Did **not:** DEMO-29 re-run, Refund B2 reopen, prod migrate, Notion retry loop, Floor/Table schema invent, Level C semantics.
