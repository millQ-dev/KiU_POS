# Gate 0 — Notion handoff (13.10.2026 export) → Origin matrix

- **Baseline Origin:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e` / migration head `032`
- **Export source:** `/Users/admin/Downloads/Private & Shared/` (Markdown, 13.10.2026 handoff children + parent index)
- **PO status vocabulary:** **ACCEPTED** product behavior · **PROPOSED** engineering names · **OPEN** architecture/legal
- **Caveat:** Parent index contains older discovery text; **children 00–07 supersede** for PO-accepted behavior (per page 00). Q Place+Q Card page **not** in export folder.

Legend: **EXISTS** / **PARTIAL** / **MISSING** / **LEVEL C REQUIRED** / **LEGAL/PROVIDER GATED** — same as Gate 0.

---

## Export coverage

| Page | Status tag in export | Matrix completeness |
| --- | --- | --- |
| 00–07 + Parent | Present | **Reconciled** below |
| Q Place + Q Card `…ed94e1e0…` | Missing from folder | **PARTIAL** — out of five-cabinet delivery; no invented requirements |

---

## Cross-cutting (00 + 06) — ACCEPTED product invariants

| Requirement (ACCEPTED unless noted) | Class | Origin evidence / gap |
| --- | --- | --- |
| Five cabinets; cook/bartender no Backoffice (KDS/Mobile) | **MISSING** UI | No Backoffice app; web = cashier + guest |
| GlobalAccount multi-role via scoped grants | **MISSING** runtime / ADR-0039 Accepted docs; ADR-0040 Proposed on #82 | mig `027` = tenant `identity_user` only |
| Outlet selection every Owner entry | **MISSING** | No OfficeSession |
| Capability grants not role-omnipotence | **PARTIAL** | Few permission keys: `pos.operate`, `cash_shift.*`, `procurement.goods_receipt.manage`, `payments.receive_cash` |
| Immutable finance/order/stock/approval history | **PARTIAL** | Document posting ADR-0010 + fiscal/payment audit paths; no Task audit |
| AI drafts only; no auto publish/sign/spend | **LEVEL C** + policy | No AI runtime in Core |
| Manager ops alerts **not** auto-push Owner; manual escalate | **MISSING** | Only `DANGEROUS_OPERATION_APPROVAL_REQUESTED` outbox |
| Food safety not bypassable by explanation | **LEVEL C** + domain | Production off-norm explanation exists in Chef PO; runtime food-safety hard block incomplete as Backoffice concern |
| Task four-color + manual move any color + reason/audit | **MISSING** | No TaskService |
| Display priority ≠ gate enforcement | **LEVEL C** (ADR) | Must be in PR-T0 |
| Channels: Task vs Owner approval vs compliance vs escalation | **MISSING** / **LEVEL C** | Collapse forbidden |
| Empty LE/Outlet ≠ tenant-wide | **PARTIAL** | Grant indexes distinguish tenant-wide vs outlet; empty-scope fail-closed still OPEN (R82-3) |
| Professional vs membership paths | **PARTIAL** | ADR-0022 Accepted; no ClientAccessGrant tables |
| DTO names Task/TaskSourceRef/… | **PROPOSED** only | Not Accepted |

---

## Owner (01) — ACCEPTED product flow

| Requirement | Class | Notes |
| --- | --- | --- |
| Office login + always pick outlet | **MISSING** | Depends OFFICE1.1 |
| Empty outlet → onboarding wizard not empty dashboard | **MISSING** | |
| Overview KPIs with certainty / deep-link | **PARTIAL** | `reporting/*` services; no Owner HTTP/UI |
| Sales / Finance / Warehouse / Staff cabinets | **MISSING** UI; **PARTIAL** domain facts | Orders/payments/inventory/procurement exist as Core |
| Assign contextual tasks to Manager/Chef/Accountant | **MISSING** | TaskService |
| Only Owner approves official recipe publish | **MISSING** as Owner ApprovalRequest channel | RecipesService publish path exists without Owner Office flow |
| Purchase route A/B config by Owner | **MISSING** | |
| Hire/fire Owner approve; Manager initiates | **MISSING** | ADR-0023 workforce Accepted boundaries only |
| Threshold approvals via Mobile ≠ bank execute | **PARTIAL** pattern | POS ApprovalRequest exists; not Owner Mobile accounting |

---

## Manager (02) — ACCEPTED killer feature

| Requirement | Class | Notes |
| --- | --- | --- |
| Live four-color dispatcher | **MISSING** | First PR-T0/M1 target |
| Create task from context + reviewRequired | **MISSING** | |
| System auto-tasks + manager suggestions | **MISSING** | Idempotent derivation |
| Schedule/shifts/swaps (selfie, no GPS) | **MISSING** / privacy | `workforce_employee` stub only; selfie **LEGAL/PRIVACY** retention |
| Open/close checklists | **MISSING** | |
| Floor/reservations | **MISSING** runtime; ADR-0017 Accepted | **Out of first Task vertical** |
| Cash in/out/close with discrepancy immutable | **PARTIAL** | CashShift open EXISTS; full close/discrepancy **MISSING** |
| Cancel HOLD/RESUME after kitchen dispatch | **MISSING** | No KDS |
| Stop-list: Chef/Bar manual; system only suggests to Manager | **MISSING** | |
| Q Card/Q Place multi-tenant PII | **OUT OF SCOPE** / separate | Page not in export |

**Acceptance from export (tests for PR-T0+):** RED→YELLOW requires reason + history + no Owner auto-push; reviewRequired hold; authz denial — bind into TaskService ADR test plan.

---

## Accountant (03) — ACCEPTED direction; legal OPEN

| Requirement | Class | Notes |
| --- | --- | --- |
| Internal + Managed multi-client hub | **MISSING** | R82-4; ADR-0022 |
| No charts; task/deadline inbox | **MISSING** | |
| One shared primary document ID across cabinets | **PARTIAL** | Goods receipt EXISTS; OCR/scan/Mobile **MISSING** |
| Banks / payment execution | **LEGAL/PROVIDER GATED** | ADR-0013 non-custody |
| E-invoice submit | **LEGAL/PROVIDER GATED** | FISC1.1 Core EXISTS; provider go-live not granted |
| Accounting Lite/Managed monetization | **OPEN** | Legal gate |

---

## Chef (04) — ACCEPTED

| Requirement | Class | Notes |
| --- | --- | --- |
| Chef Backoffice (not cook) | **MISSING** UI | |
| Recipe draft; Owner-only publish approve | **PARTIAL** | `RecipesService` EXISTS; Owner channel **MISSING** |
| Production post without Owner each batch; off-norm reason + separate Owner notice | **PARTIAL** | Production posting EXISTS; notice channel **MISSING** |
| Receiving / count / post separate grants | **PARTIAL** | `procurement.goods_receipt.manage` only coarse |
| Training library without recipe legal change | **MISSING** | |
| Manual kitchen stop-list | **MISSING** | |

---

## Bar Manager (05) — ACCEPTED

| Requirement | Class | Notes |
| --- | --- | --- |
| Reuse Chef workflows | **LEVEL C** design | Shared components Vertical C |
| Beverage stock in **ml**, aggregated SKU×location | **MISSING** / **LEVEL C** UoM specialization | Units foundation EXISTS (ADR-0002/0009) |
| Open-item hard price floor (no role bypass) | **MISSING** | |
| Comp as zero-price allowance with Bar Manager limit | **MISSING** | |
| Kegs / tech loss norms | **MISSING** | |
| Manual bar stop-list | **MISSING** | |

---

## Roadmap (07) — PROPOSED work order (not dates)

| Vertical | Relation to Gate 0 / PR-T0 |
| --- | --- |
| Gate 0 audit | This docs track (#83 + delta) |
| Vertical A shared backbone | TaskService + Identity grants + document/approval engines |
| Vertical B Manager launch | After TaskService ADR Accept + schema |
| C Chef+Bar / D Accountant+Owner analytics | Later; not first Task vertical |
| Later gated | AI accounting network, CCTV, Q Card/Q Place, bank exec |

---

## First Manager Dispatcher vertical — build vs new

| Can use existing runtime | Requires new contracts |
| --- | --- |
| Tenant/outlet/`identity_user` + `assertPermission` | TaskService ADR + schema + `task.*` permissions |
| Outbox/audit patterns | Four channels A–D; manager-only notify policy |
| CashShift / Order / GoodsReceipt as **source refs** (optional derive later) | Manual create + priority history + reviewRequired |
| POS ApprovalRequest (leave separate) | Do not complete Task ⇒ approve payment/recipe/refund |

**Explicitly excluded from first vertical (PO + Gate 0):** Floor/Table, payroll, bank execution, biometry, fiscal provider, full Accounting, Q Place/Q Card.
