# ADR-0050: Order-local Allergen Resolution (M6) — delta on ADR-0024

- **Status:** Accepted (PO ACCEPT 2026-10-28; revised M6/M7)
- **Date:** 2026-10-28
- **Related:** ADR-0024 (base), ADR-0049, ADR-0015 Privacy; Notion `40730d517151819fa63bc41efbbac50f`

## Decision

### Capture (Order start — once)

Ask once per Order (order-local guest/seat scope; **not** CustomerProfile by default):

| Choice | Meaning |
| --- | --- |
| `NO_ALLERGIES_CONFIRMED` | Guests confirmed no allergies |
| `SELECT_ALLERGENS` | Structured allergen codes selected |
| `UNABLE_TO_CLARIFY` | Cannot clarify → treat uncertainty honestly |

### Offer resolution (deterministic; Effective Recipe + kitchen handling policy)

| Result | Meaning |
| --- | --- |
| `AVAILABLE` | Item OK under constraints without required modification |
| `AVAILABLE_WITH_MODIFICATION` | Approved RecipeDelta removes/replaces relevant allergen **and** kitchen handling policy permits; UI must show required options; apply actual Effective Recipe |
| `BLOCKED` | Allergen non-removable |
| `REQUIRES_CONFIRMATION` / map from ADR-0024 `UNKNOWN` / cross-contact | Uncertainty — **never SAFE**; require appropriate human review |

Revalidate when constraints or item configuration change. Freeze allergen context with OrderLine / consumption snapshot.

### Kitchen

Pass conspicuous structured allergy details, required acknowledgements, and preparation changes. No AI safety determinations. No fictional certifications.

### Privacy / legal (external gates — do not block Modifier domain)

- Minimize sensitive allergy data; do **not** save to CustomerProfile by default.  
- Jurisdiction labeling / medical claims remain LEGAL GATE (ADR-0024 §9).  
- Novel safety **override** or retention beyond order-local scope = separate Level C/legal — not invented here.

## Does not Accept

Fake SAFE; permanent guest allergy CRM; AI inventing composition; holding Modifier PRs solely for unresolved legal override catalog.
