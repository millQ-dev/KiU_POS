# ADR-0053: Fiscal sandbox adapter boundary

- **Status:** Accepted (PO ACCEPT WITH CHANGES — 2026-10-29). Scope **S1–S6 only**.
- **Date:** 2026-10-29
- **Accepted:** 2026-10-29
- **Decision owners:** Product Owner. Counsel remains required where G2-11 or personal-data egress is involved.
- **Related:** ADR-0012, ADR-0014 (Accepted, not reopened), ADR-0015, ADR-0032, ADR-0037, `docs/processes/fiscal-g2/2026-10-29/PO-CORRECTIONS-2026-10-29.md`
- **Does not grant:** production issuance, production provider approval, persistent-database migration GO, or closure of any G2 row.

## Context

Origin PR #133 recorded the Fiscal Core gap. The Product Owner accepted that record with corrections, then accepted this ADR with the clarifications below. Sandbox authorization and production issuance stay separate. G2-18 does not block local synthetic work. A live vendor call and data egress still need the written records in clarification 4.

`FiscalProviderAdapter` already exists. Production resolution remains `unavailableFiscalProviderAdapter`. `PROVIDER_CONFIRMED_ISSUED` already exists as a technical evidence class.

## Binding clarifications (control S1–S6)

PO ACCEPT WITH CHANGES, 2026-10-29. These ten points control this ADR. Where an older sentence is broader, the clarification wins.

1. Sandbox implementation authorization and production provider approval are separate.
2. Integrations-owned, LegalEntity-scoped **SANDBOX** provider binding is accepted behind the existing `FiscalProviderAdapter`, subject to authorization and tenant isolation.
3. G2-18 is not a prerequisite for local synthetic adapter work.
4. Before any real sandbox network call, including a call that carries only synthetic payloads, all of the following must exist: a written provider API contract, permitted credentials, relevant vendor authorization, and a destination-specific approved egress record.
5. After timeout, or after a crash before attempt persistence, preserve the fiscal intent identity and reconcile authoritatively. Do not blindly repeat issue unless the actual provider contract establishes safe idempotency and recovery.
6. `PROVIDER_CONFIRMED_ISSUED` stays a technical evidence class. Its legal sufficiency remains G2-11 **OPEN**. This acceptance does not change `FiscalCheckoutGate` semantics.
7. No automatic cross-provider failover.
8. G2-01 through G2-18 remain **OPEN**.
9. No production provider selection, production issuance, permanent database migration, or production deployment.
10. Accepted ADR-0014, ADR-0032, and ADR-0037 stay as they are.

## Decision

### S1. Two authorizations

1. **Sandbox implementation authorization** — one provider adapter in a sandbox environment, behind the existing port, for one LegalEntity binding when that binding is itself accepted.
2. **Production provider approval** — a named provider allowed to issue for a named merchant on a production deployment. That approval is the production GO in `PRODUCTION-STOP.md` (G2-18). It is a later decision.

Accepting S1 does not name Viettel or MISA as the production issuer.

### S2. G2-18 does not block local synthetic work

Local synthetic adapter work may proceed without G2-18. A real sandbox network call may not. Clarification 4 lists what that call requires.

G2-18 remains mandatory for production deploy and for a persistent production database migration. All of G2-01..G2-18 stay OPEN until artifacts exist.

### S3. Accepted sandbox boundary

Accepted for SANDBOX only:

1. **Provider-binding architecture.** Integrations-owned binding per LegalEntity: provider code, vault credential reference, `environment = SANDBOX`, and an enable flag that cannot be set for `PRODUCTION` by this ADR. Authorization and tenant isolation are required. No shared secret across LegalEntities. No provider DTO on Orders, Checkout, Tax, or `FiscalDocument`.
2. **Technical API requirements.** Before the first real sandbox network call, including synthetic payloads: written provider version, idempotency behavior for the same key and for the same key with a different payload, timeout behavior, and status fields, plus permitted credentials and vendor authorization (clarification 4). Map them onto `issue`, `queryStatus`, `retrieveEvidence`, `idempotentRetry`, and `reconcileTimeoutAfterSuccess`. A timeout or an unknown result stays unsatisfied. Preserve fiscal intent identity. Do not repeat issue unless that written contract establishes safe idempotency and recovery. No second document id.
3. **Data-egress controls.** A destination-specific approved egress record is required before any real sandbox network call, including synthetic payloads. Real merchant and buyer personal data stay off the wire until that record names them. Operational logs redact those fields.

### S4. Allowed without a live network call

These do not wait for production GO:

- Vendor negotiations, draft and signed commercial contracts, and onboarding preparation. They do not enable issuance and do not close G2 rows by themselves.
- Local synthetic fixtures and interface sketches that stay on the existing port: no production registration of `testSatisfyingFiscalProviderAdapter`, no fabricated `AUTHORITY_ACCEPTED` used as a success path, no gate bypass, no schema migration.

### S5. Evidence class

Keep `PROVIDER_CONFIRMED_ISSUED`. Do not treat it as legally sufficient for `FiscalCheckoutGate` `SATISFIED` for a merchant until G2-11 counsel review accepts that class for that registered mode. This ADR does not change `defaultC0SatisfactionProfile()`.

### S6. One provider per open intent

A sandbox binding selects one provider for a LegalEntity. A timeout or an unknown result does not call the other candidate. A later provider change is a cut-over after reconciliation, with a new binding.

## Consequences

- A separate implementation PR may prepare an isolated local synthetic adapter on the existing port. It must not call Viettel or MISA. It must not change `FiscalCheckoutGate`.
- When a later PR does call a provider, acceptance tests must cover crash-after-issue-before-attempt-persistence and timeout-after-success. Both preserve fiscal intent identity and reconcile. They do not blindly repeat issue unless the written provider contract says that recovery is safe.
- A sandbox binding migration is allowed only in an implementation PR that keeps `environment` off `PRODUCTION`. This acceptance does not apply a database migration.
- Production `environment` and production credentials remain impossible under this ADR alone.
- Fiscal Core status enums stay as shipped. No rename.

## Out of scope

Production issuance. Dine-in, post-pay, deposit, and offline completion. Legal sufficiency of any evidence class. Amendment of ADR-0014, ADR-0032, or ADR-0037. Automatic failover. Inventing MST, series, or a local legal invoice number.

## PO ACCEPT

```text
PO ACCEPT WITH CHANGES — ADR-0053 Fiscal sandbox adapter boundary
Date: 2026-10-29
Scope: S1–S6 only, controlled by the ten binding clarifications.
G2-01..G2-18 remain OPEN. G2-18 is not granted.
Production provider selection, production issuance, permanent DB migration, and production deployment are not granted.
```
