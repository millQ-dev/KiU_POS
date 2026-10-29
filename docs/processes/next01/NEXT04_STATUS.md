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
| C | Allergy order-start + resolution + kitchen (legal override gated) | Level B — branch `feature/next04-allergy-m6`, migration `039` (see PR C notes) |
| D | ApplyOrderMerchantDiscount + cashier UX | Follow-on |

**PR A note:** commercial-accept wiring of `assertLineConfigurationComplete` is deferred to PR B+; configure path is fail-closed for required/ask-every-time. Effective Recipe deltas are snapshotted on `order_line_configuration.effective_recipe_deltas_json` (ADR-0049 #9).

## PR C notes (ADR-0050 order-local allergens)

**Implemented:** migration `039` (`038` is reserved for PR D discount); `apps/api/src/modules/allergens/` (pure deterministic resolver, composition loader, `AllergensService`); HTTP in `routes/allergens.ts` (`PUT/GET /orders/:id/allergen-context`, `POST /orders/:id/allergen-resolution`, `POST /orders/:id/allergen-offers`, `POST /orders/:id/lines/:lineId/allergen-acknowledgements`, `GET /orders/:id/kitchen-allergen-ticket`); cashier `AllergenPanel` (order-start prompt + per-line status + guest-informed ack).

| Rule | Behaviour |
| --- | --- |
| Capture | `NO_ALLERGIES_CONFIRMED` / `SELECT_ALLERGENS` (codes `^[A-Z][A-Z0-9_]{1,31}$`, tenant taxonomy not hard-coded) / `UNABLE_TO_CLARIFY`; order-scoped, revisioned, append-only event log, no CustomerProfile link |
| Resolution | Reads Recipe → Preparation → leaf `catalog_item_allergen_*` declarations, applies the line's frozen Effective Recipe deltas (ADR-0049 #9). Missing/INCOMPLETE leaf or unpublished/cyclic recipe ⇒ `UNKNOWN` ⇒ `REQUIRES_CONFIRMATION`; there is no SAFE value |
| Outcomes | `AVAILABLE` (declared-complete, no hit; not a guarantee), `AVAILABLE_WITH_MODIFICATION` (delta removes allergen **and** explicit kitchen policy permits), `BLOCKED` (CONTAINS survives, or policy forbids), `REQUIRES_CONFIRMATION` (UNKNOWN / MAY_CONTAIN / cross-contact / policy missing / `UNABLE_TO_CLARIFY`) |
| Kitchen | Structured `kitchenWarnings`, preparation changes, handling codes, required acknowledgements (`CASHIER_GUEST_INFORMED`, `KITCHEN_ACKNOWLEDGED`) bound to the resolution fingerprint |
| Revalidation | Any context revision or line configuration change makes the snapshot stale; old acknowledgements stop counting |

**Hooks not yet wired into the accept path** (avoids editing `orders-service.ts` / `pos.ts` owned by PR B/D): `AllergensService.assertReadyForCommercialAccept(client, orderId)` and `freezeForOrder(client, orderId)`. Wire both next to `assertLineConfigurationComplete` after PR B/D merge; until then allergen gating is advisory at the UI and not enforced at commercial accept.

**Not built (LEGAL GATE, ADR-0050):** any BLOCKED / UNKNOWN safety override catalog, retention/purge policy for order-local allergy data, jurisdiction labeling / medical claims, allergen taxonomy per jurisdiction. Acknowledgements are human-review records, not overrides; BLOCKED lines have no acknowledge path.

## CI flake

GitHub Actions #40645853976 E2E fail documented in `NEXT04_CI_FLAKE_NOTE.md` — separate from DEMO29_GO.

## Verdict

**POSV1_NO_GO** until A–D land with evidence. **R1.1** still gated.
