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
| C | Allergy order-start + resolution + kitchen (legal override gated) | Level B — `feature/next04-allergy-m6`, migration `039` (see PR C notes) |
| D | ApplyOrderMerchantDiscount + cashier UX | Parallel branch |

**PR A note:** Effective Recipe deltas snapshotted on `order_line_configuration.effective_recipe_deltas_json` (ADR-0049 #9).

**PR B note:** HTTP `GET …/modifier-groups` + `POST …/configure-modifiers`; commercial accept calls `assertLineConfigurationComplete`; additive VND folded into line gross; cashier `ModifierConfigurationModal` after slot select.

## PR C notes (ADR-0050 order-local allergens)

**Implemented:** migration `039` (`038` is reserved for PR D discount); `apps/api/src/modules/allergens/` (pure deterministic resolver, composition loader, `AllergensService`); HTTP in `routes/allergens.ts` (`PUT/GET /orders/:id/allergen-context`, `POST /orders/:id/allergen-resolution`, `POST /orders/:id/allergen-offers`, `POST /orders/:id/lines/:lineId/allergen-acknowledgements`, `GET /orders/:id/kitchen-allergen-ticket`); cashier `AllergenPanel` (order-start prompt + per-line status + guest-informed ack).

| Rule | Behaviour |
| --- | --- |
| Capture | `NO_ALLERGIES_CONFIRMED` / `SELECT_ALLERGENS` (codes `^[A-Z][A-Z0-9_]{1,31}$`, tenant taxonomy not hard-coded) / `UNABLE_TO_CLARIFY`; order-scoped, revisioned, append-only event log, no CustomerProfile link |
| Resolution | Reads Recipe → Preparation → leaf `catalog_item_allergen_*` declarations, applies the line's frozen Effective Recipe deltas (ADR-0049 #9). Missing/INCOMPLETE leaf or unpublished/cyclic recipe ⇒ `UNKNOWN` ⇒ `REQUIRES_CONFIRMATION`; there is no SAFE value |
| Outcomes | `AVAILABLE` (declared-complete, no hit; not a guarantee), `AVAILABLE_WITH_MODIFICATION` (delta removes allergen **and** explicit kitchen policy permits), `BLOCKED` (CONTAINS survives, or policy forbids), `REQUIRES_CONFIRMATION` (UNKNOWN / MAY_CONTAIN / cross-contact / policy missing / `UNABLE_TO_CLARIFY`) |
| Kitchen | Structured `kitchenWarnings`, preparation changes, handling codes, required acknowledgements (`CASHIER_GUEST_INFORMED`, `KITCHEN_ACKNOWLEDGED`) bound to the resolution fingerprint |
| Revalidation | Any context revision or line configuration change makes the snapshot stale; old acknowledgements stop counting |

**Accept-path wiring:** `OrdersService.calculateBaseCommercialTermsLocked` now calls `AllergensService.assertReadyWhenCaptured` right after the ADR-0049 modifier gate: once an order-local context exists, every line must be freshly resolved, not BLOCKED, and carry its required acknowledgements. **Gap (needs PO decision, not invented here):** an order with *no* captured context is not rejected at accept — mandatory-capture enforcement would change every existing accept flow. The cashier UI blocks on an order-start prompt; direct API callers can still skip capture. `freezeForOrder` is implemented but not wired (freezing at accept would block corrections while the basket is editable); wire at CompleteOrder/consumption snapshot.

**Not built (LEGAL GATE, ADR-0050):** any BLOCKED / UNKNOWN safety override catalog, retention/purge policy for order-local allergy data, jurisdiction labeling / medical claims, allergen taxonomy per jurisdiction. Acknowledgements are human-review records, not overrides; BLOCKED lines have no acknowledge path.

## CI flake

GitHub Actions #40645853976 E2E fail documented in `NEXT04_CI_FLAKE_NOTE.md` — separate from DEMO29_GO.

## Verdict

**POSV1_NO_GO** until A–D land with evidence. **R1.1** still gated.
