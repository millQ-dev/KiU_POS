# Review packet — ADR-0014 / ADR-0013 Payment Collection Chronology Delta

**Autonomy:** Level C (docs / architecture / contracts only)  
**Date:** 2026-10-11  
**Branch:** `docs/adr-0014-payment-collection-event`  
**Base:** `f5b6c51337f1e1bcf243b6d677602858f9debd8a`  
**PO decision:** **ACCEPT WITH DELTAS** (D + strict A; no `received_at` fallback)  
**FISC1.1:** still **NOT STARTED** — this Accept binds chronology only; explicit FISC1.1 launch remains separate.

---

## 1) Goal

Close the Level C gap found at FISC1.1 pre-check: D13 named PAYMENT COLLECTION EVENT but no trustworthy field binding existed among `provider_occurred_at` / `received_at` / `satisfied_at` / `created_at` / `NOW()`.

## 2) Docs changed

- `docs/decisions/ADR-0014-vietnam-fiscalization-boundary.md` (Accepted Chronology Delta D32–D38)
- `docs/decisions/ADR-0013-payment-non-custody.md` (Payments owns `PaymentCollectionEvent`)
- `docs/processes/current-state.md`
- `docs/processes/review-packets/2026-10-11-adr-0014-payment-collection-event.md` (this packet)

**No runtime. No migrations. No FISC1.1 tables. No provider adapter.**

## 3) Binding accepted

| Topic | Decision |
| --- | --- |
| Source of time | `provider_occurred_at` of VERIFIED SUCCEEDED outcome that affirms **actual collection** (not auth / not create) |
| Storage | Immutable Payments-owned `PaymentCollectionEvent` with `collected_at` + evidence ref |
| Missing time | Fail closed — do not fiscalize; gate not SATISFIED |
| Multi-payment / split | FISC1.1 explicit blocked |
| C0 shape | Exactly one Payment + one fully covered Check |
| Fiscal doc clocks | Collection event ≠ submission ≠ issuance |
| Forbidden | `received_at`, `satisfied_at`, `created_at`, bare `NOW()`, fiscal ACK as collection |
| CASH | Separate cash-receipt event required later; provider time not universal |

## 4) Explicitly still out

FISC1.1 runtime; migration 032; real provider; LEGAL GATE G2; CASH tender; DeviceIdentity; offline fiscal CompleteOrder; multi-tender fiscalization.

## 5) Reviews required

- Architecture
- Payments / Settlement consistency
- Tax/Fiscal consistency (no Tax recalculation; gate fail-closed)
- Financial chronology integrity

## 6) Next after merge + backup + SHA equality

Explicit FISC1.1 Level B launch from Origin main: migration `032`, Fiscal Core, PaymentCollectionEvent runtime per this Accept.
