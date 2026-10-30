# Provider evidence checklist — Viettel S-Invoice and MISA meInvoice

**Date:** 2026-10-30.  
**Origin basis:** ADR-0053 Accepted with changes, S1–S6. LEGAL GATE G2 remains OPEN.  
**No provider was contacted for this checklist. No answer below is inferred from a public page.**

A public product page is not a written API contract, a credential, a vendor authorization, or an egress record. Each cell stays **OPEN** until a named artifact exists. A MISA artifact does not close a Viettel cell.

Live sandbox network calls stay blocked until every row for that vendor is held for the destination that will be called.

| Requirement | Viettel S-Invoice | MISA meInvoice |
| --- | --- | --- |
| API version and binding specification | OPEN — not on file | OPEN — not on file |
| Idempotency: same key, and same key with a different payload | OPEN — no written guarantee | OPEN — no written guarantee |
| Status query: provider publish vs authority acceptance vs rejection | OPEN — not mapped | OPEN — not mapped |
| Sandbox authorization for KiU as integrator | OPEN — not received | OPEN — not received |
| Permitted credentials (vault reference only; no secret in git) | OPEN — not received | OPEN — not received |
| Contract / commercial authorization | OPEN — not signed | OPEN — not signed |
| Destination-specific egress approval | OPEN — not approved | OPEN — not approved |

Questions to ask, still unsent, remain in `docs/processes/fiscal-g2/2026-10-29/PROVIDER-DILIGENCE-QUESTIONS.md`.

Local synthetic work may use `executeSandboxFiscalAttempt`. That path does not call these vendors and does not satisfy `FiscalCheckoutGate`.

`FiscalService.reconcileDocument` calls `idempotentRetry` only when the adapter sets `verifiedSameKeyRetry`. Neither Viettel nor MISA has that capability. A timeout or an unknown result reconciles the same document and stays unresolved. The idempotency row above is still required before any live retry.
