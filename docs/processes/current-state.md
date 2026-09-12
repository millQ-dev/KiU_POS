# MillQ Current State

**Checkpoint:** Block D1.2A ProductionBatch domain foundation **Merged** — Origin `main` @ `4546dbe` (2026-09-12)  
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)  
**Backup host:** GitHub `https://github.com/millQ-dev/MillQ.git` (mirror only)  
**Block D1.2A PR #27:** merged @ `4546dbe` (tip before merge `ee59f39`)  
**Block D1.1 PR #25:** merged @ `3ff79a2` (tip before merge `3c7c84a`)  
**Accept PR #23:** ADR-0022 / ADR-0023 / ADR-0024 @ `3590147`  
**Accept PR #21:** ADR-0011 @ `cf5398a`  
**Accept PR #19:** ADR-0017 @ `1f683dc`  
**Accept PR #17:** ADR-0018 @ `be58388`  
**Accept PR #15:** ADR-0014 / ADR-0016 @ `f764599`  
**Accept PR #13:** ADR-0015 / ADR-0019 @ `4510092`  
**Accept PR #11:** ADR-0012 / ADR-0013 @ `cf3375f`  
**Architecture v1.3 PR:** https://cursor.com/codebase/millqdev/MillQ/pull/9 — **merged** @ `77c6949`  
**Updated:** 2026-09-12

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
| Block D1.1 Recipes & Preparations foundation | **Merged** (PR #25 → `3ff79a2`; no ProductionBatch / sale write-off) |
| Block D1.2A ProductionBatch domain foundation | **Merged** (PR #27 → `4546dbe`; FINALIZED facts; **no** inventory posting) |
| Block D1.2B Production posting / inventory / costing | **In review** (FINALIZED→POSTED; shared Block C rebuild) |
| New application verticals beyond D1.2B | **STOP** until PO launches next slice |
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

## Proposed (Architecture v1.3 — not yet Accepted)

_None remaining in the ADR-0011…0024 set covered by this architecture track._

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

## Architecture baseline

- [`docs/architecture/architecture-v1.2.md`](../architecture/architecture-v1.2.md) (Accepted)
- [`docs/architecture/architecture-v1.3.md`](../architecture/architecture-v1.3.md)
- [`docs/architecture/domain-module-map.md`](../architecture/domain-module-map.md)
- [`docs/architecture/block-c-implementation.md`](../architecture/block-c-implementation.md)
- [`docs/architecture/block-d1.1-recipes-preparations.md`](../architecture/block-d1.1-recipes-preparations.md)
- [`docs/architecture/block-d1.2a-production-batch.md`](../architecture/block-d1.2a-production-batch.md)
- [`docs/architecture/block-d1.2b-production-posting.md`](../architecture/block-d1.2b-production-posting.md)

## What exists in code

- Block C: Goods Receipt → movements → balance → CostQuote → GoodsReceived fact mirror
- Block D1.1 **Merged**: RecipeSpecification / RecipeVersion / PreparationSpecification with VIRTUAL|STOCK_TRACKED, nested graph validation, normative yield — **no** ProductionBatch / sale write-off
- Block D1.2A **Merged**: ProductionBatch DRAFT→FINALIZED with pinned PreparationVersion, normative vs actual I/O/yield, deviation classification — **no** inventory movements / costing
- Block D1.2B (this PR): ProductionBatch posting FINALIZED→POSTED with Inventory OUT/IN, moving-average rebuild, facts, reversal — shared Block C engine
- No Migration adapters, fiscal providers, POS/FloorPlan, Grab/Shopee, ModelGateway, ASR/TTS, or GPU runtime
- No Professional Account / Workforce recruiting / Allergen Resolver application code

## Explicitly not started (implementation)

- Next vertical slices after PO: **Sale write-off → Food Cost**
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
4. ~~Block D1.1 Recipes & Preparations foundation~~ **Merged** (PR #25 → `3ff79a2`)  
5. ~~Block D1.2A ProductionBatch domain foundation~~ **Merged** (PR #27 → `4546dbe`)  
6. Block D1.2B Production posting — **await handoff review #2 / merge**  
7. Further application slices remain **STOP** until PO launch  
8. Review policy: **NEXT substantive PR after D1.2B requires COMPLETE FULL-DIFF REVIEW**  

