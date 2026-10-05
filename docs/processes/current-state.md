# MillQ Current State

**Checkpoint:** STATE FREEZE accepted → next **C0 Cafe Operability Gate** (R1.1 frozen, not started)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**GitHub backup (sole):** `https://github.com/millQ-dev/KiU_POS.git`  
  (`millQ-dev/MillQ` is a **legacy rename redirect** to the same GitHub repository ID — not a second mirror)
**Origin main:** `4e47cb0f419f47c16288e9cccb3ad875526b65ce`
**Updated:** 2026-10-05

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Origin ↔ GitHub KiU_POS equality | **EQUAL** @ `4e47cb0` |
| Migration head | **029** `029_cash_shift_open.sql` |
| CASH1.1 CashShift Open | **MERGED** Origin PR#69 |
| SEC-0 financial HTTP hardening | **MERGED** (GR HTTP auth gap remains — C0.1) |
| ID1.1 Identity / PIN / Session / AccessGrant | **MERGED** |
| PAY1.1 / S1.1 / C1.1 / GUEST1.1 / POS / Menu | **MERGED** (kernel PARTIAL) |
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** — TAX1.1 **NOT STARTED** |
| ADR-0034 Tax calculation / payable | **OPEN** Origin PR#62 — Proposed / BLOCKED (not on main) |
| Fiscalization (FISC1.1) | **NOT STARTED** — production `FiscalCheckoutGate` = **UNAVAILABLE** (fail-closed) |
| Floor/Table (R1.1) | **FROZEN / NOT STARTED** |
| Origin CI | **Not attached** |

## Health @ freeze (`4e47cb0`)

| Check | Result |
| --- | --- |
| tests | **435** PASS (domain 79 · contracts 9 · api 321 · web 26) |
| typecheck / lint / build | PASS |
| migrate 001→029 + re-run | PASS |

## Harsh maturity (unchanged)

Production cashier dies at `CashierReadyShell` after CashShift OPEN. Full POS requires `?devCashier=1`. CompleteOrder fail-closed without fiscal gate. Master data largely seed/SQL. Reporting SERVICE ONLY.

## Next

1. Merge docs PR #70 after independent review (this checkpoint).
2. Backup Origin → GitHub **KiU_POS** only; verify SHA equality.
3. Execute **C0 Cafe Operability** in small blocks — start **C0.1 Goods Receipt auth** (security hotfix).
4. **Do not** start R1.1. **Do not** silently set fiscal gate to `NOT_REQUIRED`.
