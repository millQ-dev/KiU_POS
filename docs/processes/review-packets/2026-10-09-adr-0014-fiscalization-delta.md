# Review packet — ADR-0014 Fiscalization Delta (FISC1.1 readiness)

**Autonomy:** Level C (docs / architecture / contracts only)  
**Date:** 2026-10-09  
**Branch:** `docs/adr-0014-fiscalization-delta-fisc1.1`  
**Base:** `36f6603fac6ef41a5ccb868d5561794fa98401f0`  
**Status of ADR Delta:** **Accepted** — PO decision **ACCEPT** 2026-10-10 (no additional PO deltas)  
**FISC1.1:** still **NOT STARTED** — this Accept enables architecture only; explicit FISC1.1 launch + LEGAL GATE G2 remain separate.

---

## 1) Goal

Refine Accepted ADR-0014 so FISC1.1 can launch without Fiscalization inventing Tax, Payment/Settlement truth, legal regime, fiscal success, numbering ownership, provider truth, or offline acceptance semantics.

## 2) Docs changed

- `docs/decisions/ADR-0014-vietnam-fiscalization-boundary.md` (Accepted Delta D1–D31)
- `docs/processes/review-packets/2026-10-09-adr-0014-fiscalization-delta.md` (this packet)
- `docs/research/vietnam-fiscalization-open-questions-2026.md` (ADR-1…ADR-6 Accepted architecturally; LEGAL/PROVIDER unknowns preserved)
- `docs/processes/current-state.md` (delta Accepted; FISC1.1 not started)

**No runtime. No migrations. No frontend. No provider code.**

## 3) Inputs reconciled

ADR-0012, 0013, 0014, 0016, 0018, 0032, 0033, 0034, 0037; domain-module-map; Vietnam fiscalization readiness / gap matrix / open questions; current-state (TAX1.1 + CASHIER-1 closed; FISC1.1 not started; gate UNAVAILABLE).

## 4) Current ADR-0014 gaps addressed by Accepted Delta

| Gap | Accepted freeze |
| --- | --- |
| Tax invent / recalculate risk | Consume frozen TaxOrderSnapshot only; fail closed if missing/stale |
| FiscalDocumentMode | Provider-neutral CODED / NON_CODED / CASH_REGISTER |
| Invoice type ownership | Fiscalization + FiscalPolicy config; LEGAL/ONBOARDING where unverified |
| Mode-neutral SATISFIED | Explicit; no SATISFIED_MTT-style gate states |
| NOT_REQUIRED shortcut | Forbidden for VN F&B category; never missing-config fallback |
| Evidence profile | FiscalSatisfactionEvidenceProfile configurable; legal sufficiency UNKNOWN |
| Adapter contract | issue/status/evidence/retry/reconcile/correct/replace/webhook|poll |
| Timeout-after-success | No second document; inquire; no fabricated SATISFIED |
| Numbering | Separate KiU id vs authority number; never manufacture authority number |
| Terminal binding | Fiscal binding → Organization Terminal; ≠ DeviceIdentity |
| C0 online-only vs ADR-0014 offline wording | Clarified: C0 production = online-only fail-closed |
| Payment OK / fiscal pending | Payment immutable; CompleteOrder blocked; retry required |

## 5) Explicitly still LEGAL_UNKNOWN / PROVIDER_UNKNOWN

Offline transmission windows; customer-leave-while-queued; dine-in timing; adjustment vs replacement mandate; multi-outlet location codes; exact SATISFIED evidence per regime; signing/HSM ownership; webhook vs poll.

## 6) FISC1.1 scope after Accept (explicit launch still required)

FiscalPolicy + FiscalDocument foundation + Tax snapshot consume + submission port + evidence + idempotency + timeout reconcile + gate mapping + C0 online-only.

**Out:** provider adapter, legal go-live, offline complete, dine-in, refunds UX, DeviceIdentity, CASH tender, R1.1.

## 7) Reviews recorded

- Fiscal / Domain Architecture: **APPROVE**
- Financial Security Architecture: **APPROVE**
- Tax Consistency (ADR-0033/0034/0037 / TAX1.1): **APPROVE**

**Architecture remediation (2026-10-09):** Accepted Decision restored as historical 2026-09-12 text (including Offline queue + never-fabricate). Accepted Delta D1–D31 is a separate section. `FiscalSatisfactionEvidenceProfile` SoT = FiscalPolicy-owned. D15 clarifies Accepted Offline vs C0 online-only CompleteOrder.

## 8) PO decision

**ACCEPT** (2026-10-10) — no additional PO deltas.
