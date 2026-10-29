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
| A | ADR docs + migration `037` + domain deltas + `ModifiersService.configureOrderLine` | **Merged** Origin #127 @ `65c6754` |
| B | Counter POS modifier UI + HTTP + wire `assertLineConfigurationComplete` on accept | In flight (`feature/next04-modifier-pos-ui-b`) |
| C | Allergy order-start + resolution + kitchen (legal override gated) | Follow-on |
| D | ApplyOrderMerchantDiscount + cashier UX | Parallel branch |

**PR A note:** Effective Recipe deltas snapshotted on `order_line_configuration.effective_recipe_deltas_json` (ADR-0049 #9).

**PR B note:** HTTP `GET …/modifier-groups` + `POST …/configure-modifiers`; commercial accept calls `assertLineConfigurationComplete`; additive VND folded into line gross; cashier `ModifierConfigurationModal` after slot select.

## CI flake

GitHub Actions #40645853976 E2E fail documented in `NEXT04_CI_FLAKE_NOTE.md` — separate from DEMO29_GO.

## Verdict

**POSV1_NO_GO** until A–D land with evidence. **R1.1** still gated.
