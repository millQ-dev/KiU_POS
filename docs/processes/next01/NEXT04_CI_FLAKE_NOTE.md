# NEXT-04 — GitHub Actions run #40645853976 (backup mirror)

**Repo:** `millQ-dev/KiU_POS` (backup only)  
**Run:** https://github.com/millQ-dev/KiU_POS/actions/runs/40645853976  
**Trigger tip:** docs merge #125 era (`02f00bf…`)  
**Typecheck/test/build:** success  
**Disposable PG job:** failed on **CASH1.2 CloseCashShift browser E2E** only

## Failures observed

1. `two parallel windows allocate distinct terminal businessOrders via production helper` — deep equality fail (retry path also ran).  
2. `surplus requires reason; shortage FORBIDDEN then Manager re-auth closes` (retry #1) — timeout waiting for `opening-cash-screen` **or** `open-close-cash-shift` (30s) after PIN.

Cash12 **acceptance** (non-browser) on same job: **8/8 PASS**. Immutability trigger log (`cash_shift close history is immutable`) is expected from acceptance negatives, not the E2E root cause.

## Stance

- **Do not** reopen DEMO29_GO without local/Depot reproduction.  
- Origin Depot CI for #125 was the merge gate (docs-only); treat GH mirror E2E as **separate flake/regression** investigation.  
- Follow-up: harden post-PIN wait / isolate parallel chronology test under CI load (Level A/B fix PR) — not a DEMO-29 product revoke.
