# NEXT-02 status — POS-v1 smallest authorized gaps

**Baseline verified:** Origin/GitHub MATCH @ `a987f63ce2e49ac783b802b3d78521b1dd16900d` (#123)  
**Not repeated:** G0 inventory, DEMO-29 golden, Refund B2, prod migrate

## Implemented (this block)

| Gap | Action | Level |
| --- | --- | --- |
| #11 QR honesty | Checkout shows CASH available; QR/VietQR + Card **unavailable** (disabled copy, no collect UI, no fabricated paid) | **A** |
| #12 Success polish | CompleteOrder success titled “Sale complete — server confirmed” + explicit not-QR/card receipt | **A** |

## Explicitly not implemented

| Gap | Reason |
| --- | --- |
| #6 Modifier | Needs accepted Modifier / Effective Recipe semantics → **Level C STOP** |
| #8 Discount UI | POS commercial accept has no discount body; domain-only → **DECLARED_DEFERRED** (Level B only after accepted cashier command surface) |
| #9 Post-payment void | ADR-0048 R5 → **DECLARED_DEFERRED** |
| #11 VietQR collect | Provider + legal gate → **BLOCKED** |

## R1.1

See `R1.1-IMPLEMENTATION-PROPOSAL.md`. **No Floor/Table code** until Track P exit gate is recorded.

## Verdict snapshot

- Counter cash path still VERIFIED (unchanged).  
- Wider POS-v1 roadmap still incomplete → **POSV1_NO_GO** until Modifier/Discount/QR policy exits are accepted or deferred with product Sign-off. Honesty UI alone does **not** flip to GO.
