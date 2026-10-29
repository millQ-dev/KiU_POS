# ADR-0053: Fiscal sandbox adapter boundary

- **Status:** Proposed (2026-10-29). Not Accepted. Merging this file does not record PO ACCEPT.
- **Date:** 2026-10-29
- **Decision owners:** Product Owner, after review. Counsel where G2-11 or egress of personal data is involved.
- **Related:** ADR-0012, ADR-0014 (Accepted, not reopened), ADR-0015, ADR-0032, ADR-0037, `docs/processes/fiscal-g2/2026-10-29/PO-CORRECTIONS-2026-10-29.md`
- **Does not grant:** production issuance, production provider approval, persistent-database migration GO, or closure of any G2 row.

## Context

Origin PR #133 recorded the Fiscal Core gap. The Product Owner accepted that record with corrections: sandbox work and production issuance are different authorizations. G2-18 must not be a prerequisite for starting an isolated sandbox adapter. New binding architecture, a live vendor API, and data egress still need an explicit Level C acceptance.

`FiscalProviderAdapter` already exists. Production resolution remains `unavailableFiscalProviderAdapter`. `PROVIDER_CONFIRMED_ISSUED` already exists as a technical evidence class.

## Decision requested

### S1. Two authorizations

1. **Sandbox implementation authorization** — one provider adapter in a sandbox environment, behind the existing port, for one LegalEntity binding when that binding is itself accepted.
2. **Production provider approval** — a named provider allowed to issue for a named merchant on a production deployment. That approval is the production GO in `PRODUCTION-STOP.md` (G2-18). It is a later decision.

Accepting S1 does not name Viettel or MISA as the production issuer.

### S2. G2-18 does not start or stop sandbox work

Isolated sandbox adapter implementation may begin without G2-18.

G2-18 remains mandatory for production deploy and for a persistent production database migration. All of G2-01..G2-18 stay OPEN until artifacts exist.

### S3. Level C gates that this ADR is asking to accept

Implementation of the following waits for PO ACCEPT of this ADR (this Proposed text is the request):

1. **Provider-binding architecture.** Integrations-owned binding per LegalEntity: provider code, vault credential reference, `environment = SANDBOX`, and an enable flag that cannot be set for `PRODUCTION` by this ADR. No shared secret across LegalEntities. No provider DTO on Orders, Checkout, Tax, or `FiscalDocument`.
2. **Technical API requirements.** Before the first real sandbox call: written provider version, idempotency behavior for the same key and for the same key with a different payload, timeout behavior, and status fields. Map them onto `issue`, `queryStatus`, `retrieveEvidence`, `idempotentRetry`, and `reconcileTimeoutAfterSuccess`. A timeout or an unknown result stays unsatisfied. No second document id after a timeout.
3. **Data-egress controls.** Sandbox calls use synthetic payloads unless a separate egress record names the data categories and the destination. Real merchant and buyer personal data stay off the wire until that record exists. Operational logs redact those fields.

### S4. Allowed before this ADR is Accepted

These do not wait for production GO and do not wait for S3:

- Vendor negotiations, draft and signed commercial contracts, and onboarding preparation. They do not enable issuance and do not close G2 rows by themselves.
- Local synthetic fixtures and interface sketches that stay on the existing port: no production registration of `testSatisfyingFiscalProviderAdapter`, no fabricated `AUTHORITY_ACCEPTED` used as a success path, no gate bypass, no schema migration.

### S5. Evidence class

Keep `PROVIDER_CONFIRMED_ISSUED`. Do not treat it as legally sufficient for `FiscalCheckoutGate` `SATISFIED` for a merchant until G2-11 counsel review accepts that class for that registered mode. This ADR does not change `defaultC0SatisfactionProfile()`.

### S6. One provider per open intent

A sandbox binding selects one provider for a LegalEntity. A timeout or an unknown result does not call the other candidate. A later provider change is a cut-over after reconciliation, with a new binding.

## Consequences if Accepted later

- A follow-on implementation PR may add a sandbox-only binding and one vendor adapter, with synthetic tests, still Level B or C as the diff requires, still without G2-18.
- Production `environment` and production credentials remain impossible under this ADR alone.
- Fiscal Core status enums stay as shipped. No rename.

## Out of scope

Production issuance. Dine-in, post-pay, deposit, and offline completion. Legal sufficiency of any evidence class. Amendment of ADR-0014, ADR-0032, or ADR-0037. Automatic failover. Inventing MST, series, or a local legal invoice number.

## PO ACCEPT line (empty until the owner writes it)

```text
PO ACCEPT — ADR-0053 Fiscal sandbox adapter boundary
Date:
Scope: S1–S6 only. G2 remains OPEN. G2-18 not granted.
```
