# DEMO29_INT_TRACEABILITY — INT-001…203 map

**Rule:** DEMO-29 **proves existing counter-service POS**. INT-164–203 are **not** new demo implementation tasks. Refund B2 is **regression only**.

| INT band | Demo stance | Proof |
| --- | --- | --- |
| INT-001… core POS open/sell/cash/fiscal/GI/close | **In scope** — golden route | Evidence `manual-1793112022` |
| Cash12 close BALANCED | **In scope** | close-result + E2E |
| Fiscal test adapter | **In scope** (demo only) | Issue → SATISFIED |
| Refund B1/B2 / ADR-0048 | **Regression only** | vitest B1+B2; **0 refunds** on golden |
| INT-164…203 (pack “future / adjacent”) | **Excluded** as demo deliverables | See pack §absolute exclusions |
| Production migrate 036 / live providers | **Excluded** | NO-GO for prod |

Trace to pack files: `07_INT_001_203_TRACEABILITY.md` (source intent) ↔ this file (executed stance).
