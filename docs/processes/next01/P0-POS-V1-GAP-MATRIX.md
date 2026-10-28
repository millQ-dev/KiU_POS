# P0-POS-V1-GAP-MATRIX — Track P (Origin `a1bb99e`)

Roadmap checklist from NEXT-01 (Login/PIN → … → Shift Close).  
**Proof rule:** UI + authoritative API + tests → can claim VERIFIED. Figma alone ≠ runtime.  
Figma node IDs: **SOURCE_UNAVAILABLE** this run (live Figma not opened).

| # | Roadmap step | Figma | React / UI | API / domain | Tests / proof | Classification | Gap / gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Login / PIN | SOURCE_UNAVAILABLE | `PinAuthScreen.tsx`, `CompanyIdentificationScreen.tsx`, `App.tsx` front door | Identity PIN authenticate + Session cookie | `cashier1.front-door.test.tsx`; DEMO-29 / cash12 E2E | **EXISTS** / ALREADY_WORKING | Preserve; no reopen |
| 2 | Shift open | SOURCE_UNAVAILABLE | `OpeningCashScreen.tsx` | Cash `OpenCashShift` | cash11 acceptance; E2E open | **EXISTS** | — |
| 3 | Cashier Home | SOURCE_UNAVAILABLE | `CashierShell.tsx` + QuickAccess + grid | POS surface resolve | cashier shell tests; E2E | **EXISTS** (counter shell) | Not Floor home |
| 4 | Categories / pages | SOURCE_UNAVAILABLE | `PosPageNavigation.tsx` + layout pages | POS Presentation layout publication | pos acceptance; shell loads pages | **EXISTS** (layout pages ≈ categories) | Not full menu-tree taxonomy UI |
| 5 | Product select | SOURCE_UNAVAILABLE | `ProductGrid.tsx`, `ProductTile.tsx`, quantity modal | `POST /api/v1/pos/select-count` (+ weighted) | E2E Eggs path; pos select | **EXISTS** | — |
| 6 | Modifier | SOURCE_UNAVAILABLE | **None** in cashier | No modifier module/API; golden scenario marks MODIFIER as future | golden-restaurant note only | **MISSING** | New product/commercial semantics → likely **Level C** STOP until accepted Modifier / Effective Recipe contract |
| 7 | Cart | SOURCE_UNAVAILABLE | `OrderBasket.tsx`, `OrderLineEditor.tsx` | Orders lines + qty update + remove | shell + E2E | **EXISTS** | Line remove ≠ named “Void” product |
| 8 | Discount | SOURCE_UNAVAILABLE | **No cashier discount UI** | Commercial snapshot supports `orderMerchantFundedDiscountMinor` / line discounts in Orders domain (`commercial-terms.ts`, d14b tests); **no** POS HTTP discount command exposed for cashier | domain acceptance only | **PARTIAL** | Operator discount UX/API missing. Wiring UI to accepted commercial accept path may be Level B **if** command already exists end-to-end; inventing promo engine = Level C. Audit: no `/discount` in `routes/pos.ts` |
| 9 | Void | SOURCE_UNAVAILABLE | Cancel order + remove line + abort checkout | `cancelOrder`, line remove, settlement abort | shell tests; routes/pos | **PARTIAL** | Pre-payment cancel/remove **EXISTS**. Post-payment void / tender void = ADR-0048 **R5 deferred** — **DECLARED_DEFERRED**, not fake void |
| 10 | Payment (cash) | SOURCE_UNAVAILABLE | `SettlementCheckout` ReceiveCash | `POST /api/v1/payments/receive-cash` + PCE | receive-cash unit + E2E + DEMO-29 | **EXISTS** | C0 cash path proven — do not replace |
| 11 | QR / VietQR pay | SOURCE_UNAVAILABLE | UI filters tenders `instrumentFamily=CASH` only — **no QR collect UI** | Tender/PCE model can represent non-CASH; **no** live VietQR provider / collect adapter; refund VietQR **blocked** | refund permission key only | **BLOCKED_BY_LEGAL** / provider | Show honest unavailable/sandbox later — **never** fabricate paid. Distinct legal/provider G2. **DECLARED_DEFERRED** for POS-v1 exit |
| 12 | Success / Error | SOURCE_UNAVAILABLE | Inline panels: `receive-cash-success`, `complete-order-success`, error alerts; feedback strip | Server error codes mapped in shell | unit + E2E success path | **PARTIAL** | Dedicated full-screen Success/Error journey (roadmap frame) not separate; fail-closed errors **exist**. Polish = Level A if product wants dedicated screen without new semantics |
| 13 | Shift Close | SOURCE_UNAVAILABLE | `ClosingCashScreen.tsx` | CloseCashShift BALANCED/SURPLUS/SHORTAGE | cash12 acceptance + E2E + DEMO-29 | **EXISTS** | — |

## Navigability (operator-critical)

Counter clickable path **VERIFIED** (DEMO-29 closed evidence + cash12 E2E): Company → PIN → OpenShift → Product → Commercial → ReceiveCash → Fiscal(test) → Complete → Close.  

**Not** counted twice as POS-v1 “wider” proof: DEMO-29 remains closed cafe/counter slice only.

## Track P exit candidates (honest)

| Item | Exit tag |
| --- | --- |
| 1–5, 7, 10, 13 | **VERIFIED** |
| 8 Discount UI | **DECLARED_DEFERRED** or small Level B if PO confirms commercial-accept discount command scope |
| 6 Modifier | **BLOCKED** (needs accepted Modifier contract — Level C) |
| 9 Void (post-pay) | **DECLARED_DEFERRED** (ADR-0048 R5) |
| 11 QR | **BLOCKED** / **DECLARED_DEFERRED** (provider + legal) |
| 12 Success screen polish | optional Level A |

## Minimal proposed PRs (after G0; no Level C invent)

1. **docs-only (Level A):** this matrix + baseline + R1 matrix — ship first.  
2. **Optional Level A:** POS checkout honesty — explicit “QR / card unavailable in this build” (disabled, not fake paid) when non-CASH tenders absent.  
3. **Optional Level B (only with accepted command surface):** cashier Discount apply via existing commercial terms accept path + tests — **STOP** if new promo/loyalty semantics appear.  
4. **Do not:** Modifier runtime, VietQR collect, post-pay void, Floor/Table in Track P.
