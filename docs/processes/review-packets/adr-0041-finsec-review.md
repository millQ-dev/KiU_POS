# PR #84 — ADR-0041 finsec review (independent)

- **Subject:** ADR-0041 TaskService Manager Dispatcher (PR-T0, Level C docs-only)
- **PR:** Origin [#84](https://cursor.com/codebase/millqdev/MillQ/pull/84)
- **Branch:** `docs/taskservice-adr-0041`
- **Exact HEAD reviewed:** `79b107386b72f0d5a0f835c27d2fe1f025045333`
- **Base:** `18316b8f8aa2da6d045b04aebbde3c5434ea046e` (FISC1.1 Core on `main`)
- **Reviewer context:** independent Financial Security review (not the authoring agent)
- **Reviewed:** 2026-10-13
- **Scope:** Docs only — ADR-0041 + domain-module-map Proposed stub + review/decision packets. No runtime, no migrations, no edits to fiscal/payments code. **No merge.**

## Invariants checklist

- [x] Task completion / review-approve / cancel / revoke / supersede **never** satisfies Payment / Settlement / Fiscal / inventory posting gates
- [x] Channel **B** (Owner ApprovalRequest) lifecycle stays separate from Channel A Task complete
- [x] Priority moves (incl. RED→YELLOW) **never** clear or disable mandatory gates (`displayPriority` ≠ `originalSeverity` ≠ gates; no `priorityFloor` ban, but no gate bypass)
- [x] Cross-tenant create/read/write/notify/derive **denied**
- [x] Empty LegalEntity / Outlet (and other scope dims) **fail-closed** — never silent tenant-wide
- [x] FISC1.1 Core referenced correctly as non-bypass path (`apps/api/src/modules/fiscalization/`, mig `032`, ADR-0014); Accept does not authorize fiscal provider go-live or Task mutation of fiscal SATISFIED

## Evidence (brief)

| Check | Evidence in ADR-0041 / packets |
| --- | --- |
| Gate non-bypass (Payment/Settlement/Fiscal/inventory) | §1 Does not own ledgers or Payment/Settlement/Fiscal satisfaction; **Must not** mark domain gates satisfied by complete or priority change; module map “Does not own”; §8 notify failure must not clear gates; §13.6 gate non-bypass test (Payment/Fiscal/RecipePublish) + §1 inventory/Settlement ownership exclusion |
| Channel B ≠ Task complete | §2 separate aggregate; completing Task **never** approves B; do not overload `identity_approval_request`; §13.6 no RecipePublish/Payment/Fiscal approval side effects |
| Priority ≠ gate clearance | §3 any-color move with reason+audit; changing priority **must never** disable mandatory gate; §6 priority never implies gate clearance; `priorityFloor` **rejected** without reintroducing bypass |
| Cross-tenant denial | §7 derive scoped `(tenantId, derivationKey)`; A→B never creates/reads B; §10 cross-tenant notify/read/write denied; §13.3 test |
| Fail-closed empty scope | §4 scope comment; §5 empty LE/Outlet fail-closed + deny-by-default; §13.3 empty scope rejected; §15 PO ACCEPTED |
| FISC1.1 non-bypass refs | Decision packet refs `fiscalization/`, mig `032`, ADR-0014; §11/§14 exclude fiscal provider; baseline tip is FISC1.1 `#81`; this PR does not touch fiscal runtime |

## Findings (≤5)

1. **Hard non-bypass is correctly encoded:** Task owns neither Payment/Settlement/Fiscal satisfaction nor inventory/financial ledgers; complete and priority change must not mark domain gates satisfied.
2. **Channel B separation is explicit** and POS `identity_approval_request` overload is rejected until a follow-up Accept note — Task complete cannot approve regulated Owner actions.
3. **Priority reclassification without `priorityFloor` is FinSec-safe** because display color is decoupled from gates; RED→YELLOW requires audit and still cannot disable mandatory gates.
4. **Authz posture is sound for docs:** deny-by-default, empty-scope fail-closed, cross-tenant denied, permission revalidation on mutate, derivation uniqueness tenant-scoped.
5. **Residual for runtime Level B (not blocking this docs ADR):** extend §13.6 automated tests to assert Settlement and inventory-posting gates remain open after Task complete/priority change; ensure complete/revoke UX does not imply financial risk cleared (Gate 0 FinSec residual C-BO-02).

## Verdict

Financial-security posture of Proposed ADR-0041 is sound for Level C docs-only Accept path. Does not authorize runtime, Gate 0 #83 merge, OFFICE1.1 Accept, or fiscal provider go-live. Residuals bind to future Task schema/API PRs.

```text
VERDICT: APPROVE
```
