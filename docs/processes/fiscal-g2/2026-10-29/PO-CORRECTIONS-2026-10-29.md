# PO corrections — Fiscal G2 G0 (2026-10-29)

**PO review of Origin PR #133:** APPROVE WITH CHANGES.  
**G0 record:** accepted as the gap description. Merged as `7709cb58c4190c1780971be6411314defa4bf994`.  
**This file** is the correction. It does not replace `G0-ORIGIN-GAP.md` and does not reopen ADR-0014, ADR-0032, or ADR-0037.

**LEGAL GATE G2 remains OPEN.**  
**No production issuance GO.**  
**No production database migration GO.**

G2-01 through G2-18 stay **OPEN** until a real artifact exists. Nothing in a proposal, a contract draft, a local fixture, or a green CI run closes a row.

## 1. Sandbox authorization and production approval are different decisions

| | Sandbox implementation | Production provider approval |
| --- | --- | --- |
| What it allows | Local synthetic work on the existing `FiscalProviderAdapter`, and later a SANDBOX binding. A real network call waits for a written API contract, permitted credentials, vendor authorization, and a destination-specific egress record | Real merchant issuance on a production process |
| What it does not allow | Production `enabled`, production credentials, or gate `SATISFIED` from an unreviewed evidence class | Follows only from the production GO in `PRODUCTION-STOP.md` |
| G2-18 | Not required to begin | Required. G2-18 is that production GO and the persistent-database migrate GO |

## 2. What may start without G2-18

- Controlled vendor negotiations, contracts, and onboarding preparation. A contract or an onboarding checklist does not enable real merchant issuance and does not mark G2-06, G2-16, or G2-18 PASS.
- Harmless local fixtures and interface design on the existing fiscal port. Synthetic transport only. No fabricated provider confirmation. No second invoice for the same fiscal intent. The disposable test adapter stays off production routes. `FiscalCheckoutGate` stays fail-closed.
- Isolated local synthetic adapter preparation. It does not call Viettel or MISA.

## 3. Live sandbox network call

Accepted text: [ADR-0053](../../../decisions/ADR-0053-fiscal-sandbox-adapter-boundary.md). Status **Accepted with changes** on 2026-10-29, scope S1–S6 only. That acceptance does not grant a live network call.

A real sandbox network call, including one that sends only synthetic payloads, still needs a written provider API contract, permitted credentials, relevant vendor authorization, and a destination-specific approved egress record.

Local synthetic adapter work does not wait on G2-18 and does not call a vendor.

## 4. `PROVIDER_CONFIRMED_ISSUED`

This class already exists on `FiscalEvidenceClass` and in migration `032`. It stays. It is a technical evidence class. It is not a declaration that the class is legally sufficient for `FiscalCheckoutGate` `SATISFIED`. Merchant-specific sufficiency waits for G2-11 counsel review. This correction does not change `defaultC0SatisfactionProfile()`.

## 5. Still forbidden

- Fabricated provider or authority confirmation.
- A second legal invoice for one fiscal intent.
- `testSatisfyingFiscalProviderAdapter` on a production route.
- Bypassing `FiscalCheckoutGate`.
- Treating HTTP 200, a pending tax-authority status, or a delivery PDF/QR/link as issuance proof.
- Automatic failover from one provider to another on a pending or unknown intent.
- Production issuance and a production database migration. Those remain behind G2-18.

Fiscal runtime is unchanged in this correction.
