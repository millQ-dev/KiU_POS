# ADR-0037: C0 Counter-Service Cafe Tax / Fiscal Level C Decisions

- **Status:** Accepted (PO / Architecture ACCEPT WITH DELTAS — C0.2, 2026-10-06)
- **Date:** 2026-10-06
- **Accepted:** 2026-10-06
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0014, ADR-0028, ADR-0030, ADR-0032, ADR-0033, ADR-0034 (narrow Accepted), Law 108/2025/QH15, Decree 254/2026/NĐ-CP
- **Blocks enabled after Accept:** **TAX1.1** (Tax runtime for narrowed C0 slice). Does **not** enable FISC1.1 until separate launch.
- **Explicitly deferred:** FISC1.1 runtime; provider vendor selection; authority/provider ACK evidence profile; offline fiscal; restaurant dine-in/post-pay timing; Floor/Table (R1.1); CASH tender UI; CashierShell wiring

## Context

C0.2 Level C decision packet established the current Vietnam legal baseline and the economic/fiscal facts required before KiU can truthfully complete a Vietnam cafe transaction. PO / Architecture returned **ACCEPT WITH DELTAS**.

This ADR freezes those accepted production decisions for documentation and TAX1.1 scope. It does **not** implement Tax or Fiscal runtime.

### Legal baseline (binding product reference — not legal advice)

| Instrument | Status as of 2026-10 |
| --- | --- |
| Law on Tax Administration **108/2025/QH15** | Current (eff. 2026-07-01; Art. 13 + household e-invoice Art. 26 from 2026-01-01) |
| Decree **254/2026/NĐ-CP** | Current from **2026-07-01** |
| Decree **70/2025/NĐ-CP** | **Expired** from 2026-07-01 under Decree 254 |

Architecture must not encode a legal guess. Open evidence/ACK/delay questions remain counsel/provider decisions for FISC1.1.

---

## Decision

### 1. C0 production slice — COUNTER-SERVICE / PREPAY CAFE

Canonical C0 transaction:

```text
Vietnam economic organization
→ phương pháp khấu trừ target
→ VND
→ one LegalEntity
→ one Outlet
→ counter-service / prepay
→ direct consumer
→ normal catalog items
→ thirdPartyFunding = 0
→ platformSubsidy = 0
→ no marketplace / aggregator
→ online fiscal operation
→ CASH as first tender later
```

Restaurant dine-in / post-pay fiscal timing is **not** frozen by C0. That belongs to a later Restaurant/Floor vertical + separate Level C.

### 2. Tax before payable (LC-03)

For the Vietnam deduction-method C0 path:

```text
tax = ABSENT
```

is **not** production-valid.

Tax facts must exist before authoritative final payable freeze.

### 3. Canonical dependency (LC-04)

```text
Commercial facts
  → Tax determination / Tax snapshot
  → final payable freeze
  → Settlement
  → Payment coverage
  → FiscalIntent / FiscalDocument
  → FiscalCheckoutGate
  → CompleteOrder
```

Fiscalization must **never** calculate or invent VAT. Settlement must **never** recalculate Tax (`SettlementTaxCalculator` forbidden).

### 4. ADR-0034 narrow Accept (LC-02)

ADR-0034 is Accepted for:

```text
thirdPartyFunding = 0
platformSubsidy = 0
```

Third-party-funded promotion semantics remain **UNSUPPORTED**. TAX1.1 must reject them.

### 5. PricingTaxMode (LC-14)

```text
PricingTaxMode is explicit configuration.
It is never inferred from a numeric price.
```

Required modes: `TAX_INCLUSIVE` | `TAX_EXCLUSIVE`.

**Owner:** versioned **TaxPolicy** (per ADR-0033 §5). LegalEntity binds which TaxPolicy set / default PricingTaxMode applies at business time. Commercial unit Money remains Menu/Pricing-resolved (ADR-0029); Tax interprets Money according to PricingTaxMode.

VAT rate/treatment must be explicit, effective-dated Tax configuration. Do **not** hard-code `8%`, `10%`, or any single VAT rate into domain logic.

### 6. E-invoice regime configuration (LC-01)

C0 product preference for direct-consumer cafe: **cash-register-generated e-invoice** (*máy tính tiền*).

This must **not** be hard-coded as the only Vietnam regime:

```text
restaurant category ≠ hard-coded MTT regime
```

LegalEntity / FiscalPolicy carries the configured registered e-invoice regime (MTT, có-mã, không-mã, or other supported registered mode). Onboarding/configuration determines legal mode.

### 7. Fiscal architecture (LC-05)

```text
KiU Fiscal Core
  → provider adapter
  → Vietnam e-invoice provider / tax system
  → immutable evidence
```

Provider DTO/status must never become economic source-of-truth.

### 8. FiscalCheckoutGate `SATISFIED` (LC-06 / LC-07)

Forbidden:

```text
Vietnam restaurant → NOT_REQUIRED
```

Do **not** introduce `REQUIRED_BUT_SATISFIED_EXTERNALLY` yet.

`SATISFIED` is **mode-neutral**: the active `FiscalPolicy` has the required authoritative fiscal evidence for its configured legal e-invoice regime. MTT / có-mã / không-mã / supported external-provider mode may all satisfy the same business gate through different evidence.

Exact evidence profile (authority ACK vs provider ACK vs issued + retrieval data vs queued transmission) is:

```text
FISC1.1 / PROVIDER / COUNSEL DECISION
```

not TAX1.1.

### 9. Invoice timing — C0 only (LC-08)

For **counter-service / prepay Cafe C0**, the payment collection event is the relevant invoice trigger.

```text
fiscal business time ≠ created_at
```

and must come from the relevant business event.

Do **not** generalize to Restaurant dine-in/post-pay.

### 10. Online-only failure policy (LC-09 / LC-10)

C0 production:

```text
ONLINE-ONLY
```

No offline Fiscal production path. No default `ALLOW COMPLETE + PENDING FISCAL`.

If Fiscal requirement is not satisfied → **CompleteOrder remains blocked**.

If money was already physically collected and provider issuance then fails:

- Payment evidence must not be deleted or falsified
- Checkout may be: payment recorded / fiscal unsatisfied / CompleteOrder blocked / retry required

Exact lawful delay/submission handling: **REQUIRES VN TAX COUNSEL + PROVIDER CONFIRMATION**. Do not invent a legal grace period.

### 11. Buyer fiscal info (LC-11)

Buyer fiscal information is optional in the normal consumer flow; there must be a path to capture it when requested. No broad CRM/customer model required for C0.

### 12. Corrections architecture (LC-12)

Issued fiscal documents are immutable historical facts. Corrections / replacements / adjustments must compensate/reference prior documents. Do not overwrite issued fiscal truth. Runtime correction UX is **OUT of C0**.

### 13. Provider-neutral adapter contract (LC-13)

Minimum capabilities (no vendor selection in TAX1.1):

```text
issue
query status
retrieve fiscal evidence
retrieve customer lookup / QR data
idempotent retry
reconcile timeout-after-success
correction / replacement capability
webhook and/or polling
```

### 14. Domain ownership reaffirmation

```text
Order ≠ FiscalDocument
Settlement ≠ FiscalDocument
Payment ≠ FiscalDocument
Tax ≠ Fiscalization
CashShift / Receipt ≠ Fiscal e-invoice
Tax ≠ Settlement
```

---

## Open questions (not TAX1.1)

| Topic | Owner |
| --- | --- |
| Exact SATISFIED evidence profile per regime | FISC1.1 / provider / counsel |
| Lawful delay / force-majeure transmission | Counsel + provider |
| Offline fiscal production | Future Level C (forbidden in C0) |
| Restaurant dine-in / post-pay invoice timing | Future Level C |
| Vendor selection | Future product decision |
| Third-party funding semantics | Future Commercial ADR |

---

## Consequences

- TAX1.1 may implement minimal Vietnam direct-sale Tax runtime after this ADR + ADR-0034 narrow Accept are on Origin `main`.
- FISC1.1 must not start from this ADR alone.
- Golden / Cafe regression must remain honest: Fiscal gate stays `UNAVAILABLE` after TAX1.1 until FISC1.1.
- Docs/process checkpoint must show C0.2A Accepted and TAX1.1 as next implementation.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Keep tax ABSENT for C0 | Invalid for VN khấu trừ invoice content |
| Fiscal before Tax | Fiscalization inventing VAT forbidden |
| Vietnam → NOT_REQUIRED | Explicitly forbidden |
| New gate enum per regime | Multiplies checkout states without need |
| Hard-code MTT only | Entities may legally use other registered modes |
| Hard-code TAX_INCLUSIVE only | LC-14 / ADR-0033 require both modes |
| Wait for all fiscal ACK questions before TAX1.1 | ACK/outage semantics belong to FISC1.1 |

## Status progression

```text
C0.2 Level C decision packet
  → PO / Architecture ACCEPT WITH DELTAS
  → C0.2A docs (ADR-0034 narrow Accept + this ADR) → independent Architecture review
  → merge + Origin→GitHub backup
  → TAX1.1 implementation (do not wait for FISC open questions)
```
