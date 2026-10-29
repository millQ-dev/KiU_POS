# ADR-0049: Modifier Groups & Effective Recipe v1 (counter POS)

- **Status:** Accepted (PO ACCEPT 2026-10-28)
- **Date:** 2026-10-28
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0024, ADR-0025 (delta), ADR-0028, ADR-0029, ADR-0030, ADR-0031; NEXT-03 prep; Notion Accept `40730d51715181dd8347e2016ed34777`

## Context

NEXT-03 required PO decisions M1–M8 before Modifier runtime. Owner ACCEPTED 2026-10-28. ADR-0025 §7 previously deferred Effective Recipe for sale write-off; this Accept authorizes the first vertical.

## Decision (binding — M1–M8)

1. **Ownership:** Menu Configuration owns versioned `ModifierGroup` / `ModifierOption` bindings to sellable CatalogItems (not a separate universal rules engine).  
2. **Price:** Additive exact VND integer adjustments on options only (no replace/base matrix in v1).  
3. **Effective Recipe:** Structured **component deltas** per selected option (remove/replace/add CatalogItem or PreparationVersion components on the base published recipe graph).  
4. **Mandatory enforcement:** Fail-closed before commercial accept (and before kitchen send when present); optional groups never block routine sales.  
5. **Defaults / ask-every-time:** Groups may declare default option(s) and/or ask-every-time; ask-every-time requires explicit selection even when a default exists.  
6. **Kitchen instruction:** Structured templates from options; free-text guest notes are **non-authoritative** and cannot bypass allergen/inventory.  
7. **Allergen:** Resolution consumes Effective Recipe (ADR-0024 / ADR-0050); Modifier v1 must not invent SAFE.  
8. **Scope:** Counter cashier UI first; backend waiter-compatible; Order without modifier groups remains valid (DEMO29_GO).  
9. **Snapshots:** Selected options, additive price, Effective Recipe provenance, and kitchen structured instructions freeze on OrderLine configuration / commercial / consumption path; historical CompleteOrder does not re-resolve live menu.  
10. **GoodsIssue:** Still one GoodsIssue per CompleteOrder (ADR-0025 causality); consumption leaves derive from Effective Recipe for configured lines.

## ADR-0025 delta

§7 “OUT OF SCOPE” is superseded for **configured OrderLines with Modifier snapshots**. Base-only resolution remains for lines without modifier groups / empty configuration.

## Out of scope

Universal promotions engine; replace-price matrices; production migrate GO; Floor/Table; fake allergen SAFE; CustomerProfile allergy persistence (see ADR-0050).

## Consequences

- Migration `037_modifier_effective_recipe_v1.sql` (disposable/CI first).  
- Domain module under Menu + Orders configuration + sale-consumption Effective Recipe apply.  
- Implementation Level B review discipline after this Accept.
