# MillQ Current State

**Checkpoint:** Block D1.3A Orders Foundation & Consumption Plan **in review** — branch from Origin `main` @ `8844ccb` (2026-09-14)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)
**Accept PR #30:** ADR-0025 @ `8844ccb`
**Block D1.2B PR #29:** merged @ `57499df`
**Block D1.2A PR #27:** merged @ `4546dbe`
**Block D1.1 PR #25:** merged @ `3ff79a2`
**Accept PR #23:** ADR-0022 / ADR-0023 / ADR-0024 @ `3590147`
**Accept PR #21:** ADR-0011 @ `cf5398a`
**Accept PR #19:** ADR-0017 @ `1f683dc`
**Accept PR #17:** ADR-0018 @ `be58388`
**Accept PR #15:** ADR-0014 / ADR-0016 @ `f764599`
**Accept PR #13:** ADR-0015 / ADR-0019 @ `4510092`
**Accept PR #11:** ADR-0012 / ADR-0013 @ `cf3375f`
**Architecture v1.3 PR:** https://cursor.com/codebase/millqdev/MillQ/pull/9 — **merged** @ `77c6949`
**Updated:** 2026-09-14

## Runtime / CI / backup

| Item | State |
| --- | --- |
| Foundation Operational Core | Merged |
| Architecture v1.2 | **Accepted / Merged** |
| Block C Goods Receipt vertical | **Merged** + v1.3-compatible |
| Architecture v1.3 alignment | **Merged** (PR #9 → `77c6949`) |
| ADR-0012 / ADR-0013 | **Accepted** (PR #11 → `cf3375f`) |
| ADR-0015 / ADR-0019 | **Accepted** (PR #13 → `4510092`) |
| ADR-0014 / ADR-0016 | **Accepted** (PR #15 → `f764599`) |
| ADR-0018 | **Accepted** (PR #17 → `be58388`) |
| ADR-0017 | **Accepted** (PR #19 → `1f683dc`) |
| ADR-0011 | **Accepted** (PR #21 → `cf5398a`) |
| ADR-0022 / ADR-0023 / ADR-0024 | **Accepted** (PR #23 → `3590147`) |
| Block D1.1 Recipes & Preparations foundation | **Merged** (PR #25 → `3ff79a2`) |
| Block D1.2A ProductionBatch domain foundation | **Merged** (PR #27 → `4546dbe`) |
| Block D1.2B Production posting / inventory / costing | **Merged** (PR #29 → `57499df`) |
| ADR-0025 Order Completion & Sale Inventory Write-off | **Accepted / Merged** (PR #30 → `8844ccb`) |
| Block D1.3A Orders Foundation & Consumption Plan | **This PR** — no GoodsIssue; CompleteOrder unwired until D1.3B |
| D1.3B / Food Cost | **STOP** until explicit PO launch per block |
| Origin CI | **Attached** — Depot |
| GitHub Actions | Dormant copies only |
| GitHub backup | Post-merge Origin→GitHub via **MillQ Origin Backup** App |

## Accepted decisions

| ADR | Status | Topic |
| --- | --- | --- |
| ADR-0001 | Accepted | Technology stack |
| ADR-0002 | Accepted | Money, quantity, units |
| ADR-0003 | Accepted | Yield, preparations, moving-average costing |
| ADR-0004 | Accepted | Origin SoT; GitHub backup |
| ADR-0006 | Accepted | Production Intelligence boundary (**not superseded**) |
| ADR-0007 | Accepted | Foundation scaffolding |
| ADR-0008 | Accepted | Domain Boundaries Architecture v1.2 |
| ADR-0009 | Accepted | Catalog, Units, SupplierItem |
| ADR-0010 | Accepted | Document posting & correction |
| ADR-0011 | Accepted | Migration Architecture |
| ADR-0012 | Accepted | JurisdictionProfile vs Provider Adapters |
| ADR-0013 | Accepted | Payment Non-Custody Boundary |
| ADR-0014 | Accepted | Vietnam Fiscalization Architecture Boundary |
| ADR-0015 | Accepted | Privacy, Residency, Egress, LLC & Security Control Plane |
| ADR-0016 | Accepted | Order Settlement & Split Bill |
| ADR-0017 | Accepted | Floor Plan & Table Engine |
| ADR-0018 | Accepted | Offline Multi-Platform Client Runtime |
| ADR-0019 | Accepted | Economic Facts & Contribution Margin |
| ADR-0020 | Accepted | Production Intelligence Execution & Model Gateway |
| ADR-0021 | Accepted | Voice & Multilingual Interaction Boundary |
| ADR-0022 | Accepted | Professional Account & Cross-Business Access |
| ADR-0023 | Accepted | Workforce / Recruiting / Learning / Assessment |
| ADR-0024 | Accepted | Allergen & Dietary Constraint Resolution |
| ADR-0025 | **Accepted** | Order Completion & Sale Inventory Write-off Semantics |

## Proposed

_None._

### Settlement / non-custody invariant (ADR-0013 + ADR-0016)

A recorded **external** deposit/prepayment may be referenced/allocated later but **must not** become a MillQ custodial balance or wallet.

### Floor / Table ownership invariant (ADR-0017)

Floor/Table owns `TableAssignment` (refs `OrderId`). Orders owns Order truth only and does not depend on Floor/Table internal state.

### Professional access invariant (ADR-0022)

Ordinary membership ≠ professional `ClientAccessGrant`. Mutations in exactly one client Tenant context; no shared tenant / cross-client mutation.

### Employment decision invariant (ADR-0023)

AI may score/recommend; material employment decisions require authorized human action + audit. Assessment audio ≠ ADR-0021 zero-retention.

### Allergen resolution invariant (ADR-0024)

Structured Effective Recipe resolution; `UNKNOWN` never silently SAFE; AI/voice must not invent ingredients.

### Sale write-off invariant (ADR-0025)

Charter “Sale” = OrderCompleted. Write-off via Inventory-owned GoodsIssue on CompleteOrder. Exactly one physical path (VIRTUAL explode XOR STOCK_TRACKED consume). ConsumptionPlanSnapshot frozen at completion. Food Cost deferred after D1.3B. D1.3A does not persist COMPLETED without Inventory port.

## Architecture baseline

- [`docs/architecture/architecture-v1.2.md`](../architecture/architecture-v1.2.md) (Accepted)
- [`docs/architecture/architecture-v1.3.md`](../architecture/architecture-v1.3.md)
- [`docs/architecture/domain-module-map.md`](../architecture/domain-module-map.md)
- [`docs/architecture/block-c-implementation.md`](../architecture/block-c-implementation.md)
- [`docs/architecture/block-d1.1-recipes-preparations.md`](../architecture/block-d1.1-recipes-preparations.md)
- [`docs/architecture/block-d1.2a-production-batch.md`](../architecture/block-d1.2a-production-batch.md)
- [`docs/architecture/block-d1.2b-production-posting.md`](../architecture/block-d1.2b-production-posting.md)
- [`docs/architecture/block-d1.3a-orders-consumption-plan.md`](../architecture/block-d1.3a-orders-consumption-plan.md)
- [`docs/decisions/ADR-0025-order-completion-sale-inventory-write-off.md`](../decisions/ADR-0025-order-completion-sale-inventory-write-off.md)

## What exists in code

- Block C: Goods Receipt → movements → balance → CostQuote → GoodsReceived fact mirror
- Block D1.1 **Merged**: RecipeSpecification / RecipeVersion / PreparationSpecification with VIRTUAL|STOCK_TRACKED
- Block D1.2A **Merged**: ProductionBatch DRAFT→FINALIZED
- Block D1.2B **Merged**: ProductionBatch posting FINALIZED→POSTED with Inventory OUT/IN, shared costing stream, reversal entity
- Block D1.3A **This PR**: Orders OPEN/CANCELLED, CatalogItem RecipeProfile binding, consumption resolver preview, CompleteOrder boundary unwired (no GoodsIssue)
- No GoodsIssue sale path yet (D1.3B)
- No Migration adapters, fiscal providers, POS/FloorPlan, Grab/Shopee, ModelGateway, ASR/TTS, or GPU runtime

## Explicitly not started (implementation)

- **D1.3B** GoodsIssue & Automatic Sale Write-off (after D1.3A merge + PO launch)
- **Food Cost** (after D1.3B + PO launch)
- Migration Core scaffolding & source adapters
- Fiscal provider adapters
- POS / FloorPlan / Grab / Shopee
- ModelGateway / Intelligence runtime / Voice runtime
- Professional Account / accountant workspace
- Workforce recruiting / learning / assessment product
- Allergen Resolver UI
- Intelligence algorithms

## Next recommended sequence

1. ~~Block C~~ done
2. ~~Architecture v1.3 alignment~~ merged
3. ~~ADR-0011…0024~~ **Accepted**
4. ~~Block D1.1~~ **Merged**
5. ~~Block D1.2A~~ **Merged**
6. ~~Block D1.2B~~ **Merged** (PR #29 → `57499df`)
7. ~~ADR-0025~~ **Accepted / Merged** (PR #30 → `8844ccb`)
8. **D1.3A** this PR
9. **STOP** — D1.3B only after explicit PO launch
10. Food Cost only after D1.3B + PO launch
11. Review policy: this substantive application PR requires **COMPLETE FULL-DIFF REVIEW**
