# Edge Auth & Offline Financial Policy — PO Decision Packet (OFF-01 / PR #90)

- **STATUS:** Level **C** — **ACCEPT WITH DELTAS** (PO 2026-10-19) — **docs only**
- **MERGE:** **HOLD** until deltas applied + independent re-review APPROVE + separate docs-merge permission
- **LEVEL B GO:** **NOT ISSUED**
- **OFFLINE CASH PRODUCTION GO:** **NOT ISSUED**
- **LEGAL GATE G2:** **NOT ISSUED**
- **Date:** 2026-10-19
- **Priority:** P0
- **Origin main (baseline):** `33dad072e014158c6658546abcda5de38e87f4b2`
- **Reviewed content (pre-Accept):** `b9c6fa43c560a164c9e8572209cc5ed5faf2e3b0`
- **Tip at Accept decision:** `7c506bc8451b123e44131fbf3da4d8349342fc84`
- **Revised content HEAD (deltas closed):** `b87c0c48efdaf0084c8753396c7c1bded62c8469`
- **Re-reviews @ content HEAD:** Architecture **APPROVE** · FinSec **APPROVE** · Privacy **APPROVE**
- **Authority:** `docs/architecture/edge-auth-offline-financial-policy.md`
- **ADRs:** ADR-0043 / ADR-0044 / ADR-0045 — **Accepted WITH DELTAS** (aliases OFFLINE-001/002/003)
- **Identity:** PR #87 / ADR-0042 independent — do not modify

---

## PO verdict

**ACCEPT WITH DELTAS — Level C / docs only**

### Accepted architectural direction

- ADR-0043 — Edge Auth / signed grants  
- ADR-0044 — single-writer / fencing  
- ADR-0045 — offline operational and financial boundaries  
- `OperationalClose` **L1** distinct from `CompleteOrder` **L3**  
- No fabricated payment or fiscal SUCCESS  
- No automatic Cloud writer takeover after lease expiry  

### Binding PO deltas (must be closed in docs before docs-merge)

| # | Delta | Closure location |
| --- | --- | --- |
| 1 | Preserve existing CheckoutOrchestrator fiscal gate | ADR-0045 D1 / package §1.4 |
| 2 | Keep ADR-0038 offline CASH **A4 OPEN** | ADR-0045 D3 |
| 3 | Distinguish offline cash **evidence** from authoritative PCE + fiscal chronology | ADR-0045 D3–D4 |
| 4 | Safe manual recovery, fencing, **old-writer quarantine** | ADR-0044 D4 |
| 5 | Grant/session expiry, rollback, revocation limits under **total isolation** | ADR-0043 D4–D5 |
| 6 | Vietnam counsel clearance **OPEN** for offline cash + delayed e-invoice | ADR-0045 D5 |
| 7 | Independent **LEGAL GATE G2** preserved | ADR-0045 D5 / package |

---

## Explicit non-authorization

- No Level B implementation GO  
- No offline cash production GO  
- No G2  
- No runtime / migrations / Identity #87 / vendor integrations / financial logic changes  
- Do **not** merge PR #90 or PR #91 until their respective gates are satisfied  
- Docs merge ≠ implementation authorization  

## Preserve

- VietQR / BANK_TRANSFER ≠ C0 PCE  
- C0 PCE kinds = CASH \| CARD only when authoritative path exists  
- CheckoutOrchestrator fiscal gate not removed  
- No fabricate card/bank/fiscal SUCCESS  

## Independent re-review (required after delta edits)

Architecture · Financial Security · Privacy — focused on modified substance; stamps under `docs/processes/review-packets/edge-auth-offline-*-review.md`.

## Recommended next after docs-merge of #90

Counsel kickoff (OPEN) → OFF-02 / OFF-03 / OFF-04 as **separate** Level B GOs → OFF-05 fencing → OFF-07 OperationalClose → OFF-08 cash only if A4 closed by future Accept + production GO.
