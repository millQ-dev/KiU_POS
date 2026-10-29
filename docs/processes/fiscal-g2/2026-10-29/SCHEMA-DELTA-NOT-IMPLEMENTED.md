# Schema and API delta — not implemented

**Decision:** no migration, no TypeScript port change, no provider DTO in Orders, Checkout, Tax, or Fiscalization.

A delta would be justified only for a field the accepted contract cannot store and that a funded slice is about to use. Neither condition holds on 2026-10-29.

- G2 is OPEN. No merchant MST, no sandbox key, no counsel profile.
- Level C forks 1–4 in `LEVEL-C-FORKS.md` are unresolved. A binding table or a legally sufficient evidence enum would smuggle those decisions into schema.
- Accepted facts already have a home: fiscal intent, idempotency key, tax snapshot id, fingerprint, amount, collection time, attempt, and evidence class (migration `032`). Issue input on `FiscalProviderAdapter` already carries the packet’s listed fields.
- Provider payloads stay outside the domain. A Viettel or MISA DTO does not belong on `FiscalDocument`.

## If a later slice is authorized

Persist only the missing **neutral** fields. Do not copy provider JSON into Orders or Tax.

| Need | Where it belongs | Why it waits |
| --- | --- | --- |
| LegalEntity MST, legal address | Organization `legal_entity` (D17). Fiscalization reads them | Fork 3 is about binding; seller master is configuration, still unused without a merchant |
| `registered_fiscal_mode`, invoice type (VAT vs sales) | `fiscal_policy_version` (D4, D5) | Mode must be the merchant’s registration, not a restaurant-wide constant |
| Vault pointer, provider code, environment, enabled | Integrations binding (Proposed in INTEGRATIONS-0 §3.2) | Level C fork 3. `enabled` for production stays false until G2-18 |
| Provider invoice number, authority code, template/series **as evidence** | Append-only outcome evidence, not a locally incremented legal counter (D19) | Needs a real provider reference from G2-08 |
| Buyer name / buyer MST when requested | Fiscal document snapshot (D18), frozen, omitted for ordinary B2C | Needs G2-05. No PII in logs (G2-15) |
| In-flight attempt before HTTP | Insert `fiscal_provider_attempt` `STARTED` in the same transaction as the document, then call the adapter | Accepted D11/D12. Behavior change is a later Level B, with tests, not this docs PR |
| adjust / replace | New fiscal document linked to the original (D20) plus port methods | G2-13. No generic delete |

`satisfaction_evidence_profile` JSON already exists. Do not add a second policy store. Do not widen the default accepted classes.

Out of this delta on purpose: dine-in and post-pay triggers, offline queue, VietQR as a fiscal collection kind, automatic provider failover.
