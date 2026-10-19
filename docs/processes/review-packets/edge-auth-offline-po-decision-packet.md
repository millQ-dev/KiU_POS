# Edge Auth & Offline Financial Policy — PO Decision Packet

- **STATUS:** Level **C** — **Proposed** — **STOP BEFORE RUNTIME / MERGE-AS-GO** (awaiting PO ACCEPT / ACCEPT WITH DELTAS / REJECT)
- **Date:** 2026-10-19
- **Priority:** P0
- **Origin main (verified):** `33dad072e014158c6658546abcda5de38e87f4b2`
- **PR tip (reviews):** `b9c6fa43c560a164c9e8572209cc5ed5faf2e3b0`
- **Independent reviews:** Architecture **APPROVE** · FinSec **APPROVE** · Privacy **APPROVE**
- **Authority:** `docs/architecture/edge-auth-offline-financial-policy.md`
- **ADRs:** Proposed ADR-0043 (OFFLINE-001) · ADR-0044 (OFFLINE-002) · ADR-0045 (OFFLINE-003)
- **Identity:** PR #87 / ADR-0042 independent — do not modify in this track

---

## Ask of PO

Choose one:

| Verdict | Meaning |
| --- | --- |
| **ACCEPT** | Accept ADR-0043/44/45 as written (including numerical grant/session TTLs and L1/L3 split) |
| **ACCEPT WITH DELTAS** | Accept with listed deltas (record below) |
| **REJECT** | Keep C0 online-only; Edge auth/ops deferred |

### Specific decisions required

1. **Product tiers** — confirm Cloud-only vs Edge differentiation and shared domain (no fork).
2. **Numerical TTLs** — 72h grant / 12h session / revoke-on-sync / local suspend immediate / no clock-rollback grace — Accept or alter.
3. **Offline CASH (ADR-0045 D3)** — Accept EdgeReceiveCash closing ADR-0038 A4 OPEN, or keep fail-closed until server accept.
4. **CompleteOrder** — Accept `OperationalClose` (L1) beside unchanged L3 fiscal-gated `CompleteOrder` (do **not** remove CheckoutOrchestrator gate).
5. **Authority partition** — Tenant+LE+Outlet default; Hub multi-partition OK.
6. **No automatic Cloud takeover** on lease expiry alone — Accept. Lease `expires_at` is alert-only; Cloud writes for an Edge-owned partition require explicit D4 recovery transfer even after lease expiry.
7. **Counsel** — authorize Vietnamese fiscal counsel package on offline cash + delayed e-invoice (G2 still separate).
8. **OFF-01…OFF-10** — acknowledge sequence; authorize only OFF-01 Accept now (docs); later slices need separate GO.
9. Confirm offline QR **not** in first release; Mobile QR remains online/#87 track.

## Non-asks / STOP

- No runtime, migrations, secrets, Edge binary ship, G2, VietQR C0 PCE
- No merge of this PR as implementation authorization
- Do not treat INTEGRATIONS-0 Proposed items as Accepted by this packet

## Preserve

- VietQR / BANK_TRANSFER ≠ C0 PCE  
- C0 PCE = CASH \| CARD  
- No production fiscal SATISFIED without G2  
- No fabricate card/bank/fiscal SUCCESS  
- CheckoutOrchestrator fiscal gate not silently removed  

## Independent reviews (required before Accept stamp)

Architecture · Financial Security · Privacy — verdicts recorded under `docs/processes/review-packets/edge-auth-offline-*-review.md` when obtained.

## Recommended next after Accept

Counsel kickoff → OFF-02 packaging skeleton (separate Level B GO) → OFF-03/04 auth → OFF-05/06 writer/sync → OFF-07 OperationalClose → OFF-08 cash if D3 Accepted.
