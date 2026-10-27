# DEMO29_BASELINE — G0 Origin reconciliation

**Captured:** 2026-10-27 (Asia/Ho_Chi_Minh)  
**Agent:** Cursor Origin Implementation/QA  
**Task:** DEMO-29 v3 prove existing counter-service POS  
**AI_RUNTIME:** OFF (no LLM product calls in demo path)

## Remotes (credentials redacted)

| Remote | URL |
| --- | --- |
| `origin` (canonical) | `https://origin.cursor.com/millqdev/MillQ.git` |
| `github` (backup-only) | `https://github.com/millQ-dev/KiU_POS.git` |

## SHA / parity

| Item | Value |
| --- | --- |
| Local branch after checkout | `main` |
| Working tree | clean |
| `git rev-parse HEAD` | `7225085a7cef9e8ec6b98dc44d29781139163f23` |
| `origin/main` (`ls-remote`) | `7225085a7cef9e8ec6b98dc44d29781139163f23` |
| `github/main` (`ls-remote`) | `7225085a7cef9e8ec6b98dc44d29781139163f23` |
| Parity | **MATCH** |
| Prior handoff expected | `7225085…` (#121 B2 merge) — confirmed |

## Recent main tip

```
7225085 feat(payments): C0-REFUND-B2 CASH handover + B1 SAVEPOINT (Level B) (#121)
```

## Open Origin PRs (unrelated to DEMO-29)

| PR | Title | Branch |
| --- | --- | --- |
| #63 | docs(adr): ADR-0035 Employee Engagement + Guest QR architecture | `feature/adr-0035-…` |
| #2 | docs: foundation post-merge checkpoint | `chore/foundation-post-merge-checkpoint` |

No DEMO-29 implementation PR opened at G0.

## Migration head

| Migration | Role |
| --- | --- |
| 032 | FISC1.1 payment collection fiscal core |
| 033 | goods receipt reverse unique |
| 034 | CASH1.2 CloseCashShift |
| 035 | C0-REFUND-B1 reservation |
| **036** | C0-REFUND-B2 cash handover — **disposable/CI only; PROD_MIGRATION_036=NO** |

## Scoped code paths (inspected)

| Area | Path |
| --- | --- |
| Browser E2E | `apps/e2e-cash12-close/src/cash12-close.browser.spec.ts` |
| E2E stack runner | `apps/e2e-cash12-close/src/run-with-stack.mjs` (exits after Playwright; not human serve) |
| Web cashier | `apps/web/src/cashier/`, `apps/web/src/App.tsx` |
| API listen | `apps/api/src/index.ts:114` — `host: '0.0.0.0'` (**G2 risk**: loopback-only bind needed for safe demo) |
| Identity / POS / payments / cash / fiscal | `apps/api/src/modules/{identity,pos,payments,cash,fiscalization}/` |
| Refund B2 (consume only) | `refund-service.ts`, `036_*.sql`, `refund-b2.acceptance.test.ts` — **do not reimplement** |
| Golden scenario docs | `docs/processes/golden-restaurant-scenario.md` |
| Fixture prepare | `apps/api/src/test/cash12-close-e2e-prepare.ts` |

## INT / ADR scope map (DEMO-touched only)

| Topic | Authority | Status for DEMO-29 |
| --- | --- | --- |
| Counter-service CASH receive + PCE | ADR-0038 | ALREADY_COVERED (runtime) |
| CloseCashShift expected | ADR-0046 + ADR-0048 expected − refunds | ALREADY_COVERED; demo uses **zero refunds** |
| Refund B2 foundation | ADR-0048 Accepted; PR #121 | ALREADY_COVERED; **out of demo operator path** |
| Fiscal test adapter opt-in | ADR-0014 / FISC1.1 | ALREADY_COVERED with fail-closed prod defaults |
| INT-164–198 AI/help | Notion ledger | DEFERRED — AI_RUNTIME=OFF |
| INT-199–203 adaptive launch/migration | Notion ledger | DEFERRED — no Office/Floor/KDS/Migration in 29.10 slice |
| ADR-0020 vs Lean AI #185B/193D | Conflict | CONFLICT → post-demo Level C; non-blocking for DEMO-29 |

## Risks

1. Playwright `getByRole('option', { name: /Eggs/i })` flaky on GitHub CI (retry PASS) — root cause unproven; G1 must re-run no-retry on Origin.
2. API binds `0.0.0.0` — G2 must provide loopback-only or isolated network for human demo.
3. No persistent `demo:serve` human mode in tree at G0 — may need minimal Level A/B addition.
4. Refund 036 must never target production/shared DB for DEMO-29.

## Disposable DB for this run

| Item | Value |
| --- | --- |
| Host | localhost:5432 |
| Database | `millq_ci_pos_demo29_1793110682` |
| Provenance | created exclusively for DEMO-29; destroy-only this DB allowed |
| Note | Shell env may still hold older `millq_ci_pos_fisc2_*`; **all DEMO-29 commands must set DATABASE_URL explicitly** |

## G0 verdict

**PASS** — Origin/GitHub MATCH @ `7225085…`; migration head 036; no divergence STOP. Proceed G1.
