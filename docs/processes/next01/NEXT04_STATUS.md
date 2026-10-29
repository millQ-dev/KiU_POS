# NEXT-04 status

**Baseline:** Origin/GitHub MATCH @ `02f00bf…` (#125) before NEXT-04 PRs  
**PO ACCEPT:** 2026-10-28 — M1–M8, revised M6/M7, D1–D6 (Notion pages cited in ADR-0049/0050/0051)

## Authority

| ADR | Topic |
| --- | --- |
| ADR-0049 | Modifier + Effective Recipe v1 |
| ADR-0050 | Order-local allergen M6 |
| ADR-0051 | ApplyOrderMerchantDiscount v1 |

NEXT03 prep docs stamped PO ACCEPTED (historical).

## PRs (planned)

| PR | Scope | Status |
| --- | --- | --- |
| A | ADR docs + migration `037` + domain deltas + `ModifiersService.configureOrderLine` | Origin #127 — Level B gates |
| B | Counter POS modifier UI + HTTP + wire `assertLineConfigurationComplete` on accept | Follow-on |
| C | Allergy order-start + resolution + kitchen (legal override gated) | Follow-on |
| D | ApplyOrderMerchantDiscount + cashier UX | Follow-on |

**PR A note:** commercial-accept wiring of `assertLineConfigurationComplete` is deferred to PR B+; configure path is fail-closed for required/ask-every-time. Effective Recipe deltas are snapshotted on `order_line_configuration.effective_recipe_deltas_json` (ADR-0049 #9).

## CI flake

GitHub Actions #40645853976 E2E fail documented in `NEXT04_CI_FLAKE_NOTE.md` — separate from DEMO29_GO.

## Verdict

**POSV1_NO_GO** until A–D land with evidence. **R1.1** still gated.
