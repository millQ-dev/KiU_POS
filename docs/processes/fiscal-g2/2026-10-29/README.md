# Fiscal G2 — Origin handoff 2026-10-29

**LEGAL GATE G2 = OPEN. No production GO.**

This directory is the G0 record for the 29 October 2026 Vietnam fiscal pilot assignment. It does not select a production vendor, enable issuance, or close any G2 evidence item.

| File | Role |
| --- | --- |
| [G0-ORIGIN-GAP.md](G0-ORIGIN-GAP.md) | Actual Origin `main` vs the assignment and vs the historical gap matrix |
| [G2-EVIDENCE-REGISTER.md](G2-EVIDENCE-REGISTER.md) | G2-01..G2-18, all **OPEN** |
| [PROVIDER-DILIGENCE-QUESTIONS.md](PROVIDER-DILIGENCE-QUESTIONS.md) | Questions for Viettel and MISA. **Not sent** |
| [SCHEMA-DELTA-NOT-IMPLEMENTED.md](SCHEMA-DELTA-NOT-IMPLEMENTED.md) | Why no migration or API change ships in this handoff |
| [PO-CORRECTIONS-2026-10-29.md](PO-CORRECTIONS-2026-10-29.md) | PO APPROVE WITH CHANGES. Sandbox work is not production GO |
| [LEVEL-C-FORKS.md](LEVEL-C-FORKS.md) | Decisions that still need PO ACCEPT before binding, live API, or egress |
| [PRODUCTION-STOP.md](PRODUCTION-STOP.md) | Production issuance and production migration stop rule |
| [source/](source/) | Owner packet copied verbatim from `KIU_FISCAL_G2_2026_10_29` (2026-10-29). Research input. Engineering state is the G0 file, not the packet’s GitHub SHA |

Autonomy of the original handoff: **Level A** (documentation). It does not change FiscalPolicy, LegalEntity behavior, or authority semantics.

PO ACCEPT WITH CHANGES 2026-10-29 records [ADR-0053](../../../decisions/ADR-0053-fiscal-sandbox-adapter-boundary.md) for S1–S6 only. Local synthetic adapter work may proceed without G2-18 and without a vendor call. A real sandbox network call still needs a written API contract, permitted credentials, vendor authorization, and a destination-specific egress record. No G2 row is closed. Production GO is not granted.
