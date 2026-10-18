# INTEGRATIONS-0 — PO Decision Packet

- **STATUS:** Level **C** research gate — **MERGE HOLD** (awaiting PO docs-only MERGE GO) / **STOP BEFORE RUNTIME**
- **Date:** 2026-10-18
- **PO prior:** ACCEPT DIRECTION / REVIEW GO / MERGE HOLD
- **Origin main:** `973deb878c977535fa35e921d73fc689fe358530`
- **Authorized candidate (pre-remediation):** `13da636739b5df54f8f369c5743ad8f4cb9e18cb`
- **Review tip (current):** `28eff26b4aadae24de53b11623b779ff62e4798c`
- **Independent reviews @ tip:** Architecture **APPROVE** · FinSec **APPROVE** · Privacy **APPROVE**
- **Authority doc:** `docs/architecture/integrations-0-vietnam-provider-onboarding-gate.md`
- **Identity:** PR #87 independent — do not modify

---

## Ask of PO

1. Accept INTEGRATIONS-0 as the **provider onboarding gate** (docs only) after Arch/FinSec/Privacy re-APPROVE on remediated tip.
2. Confirm ownership split: Integrations = LE bindings + future gateway/transport; Fiscalization = `FiscalProviderAdapter` port; Payments = lifecycle + future `PaymentRailAdapter`.
3. Confirm **Viettel S-Invoice** as first fiscal adapter **candidate** (sandbox only until **G2**; synthetic data until egress GO).
4. Confirm **VietQR host2host-class** (or name alternate) as first payments QR **candidate** — non-custodial; **not** C0 fiscal-ready (§2A).
5. Authorize sales to run due-diligence packets (updated OPEN items):
   - `docs/processes/partner-due-diligence/viettel-s-invoice-packet.md`
   - `docs/processes/partner-due-diligence/vietqr-payments-packet.md`
6. Authorize next implement slice as **I0 Level B foundations only** (registry, vault credential_ref, egress hook, auditable attempts/outbox) — **not** vendor adapters.
7. Confirm migration sources priority P1–P4 with **no unsupported API claims**.
8. Confirm VFA / BHXH I-VAN remain **later gated**.
9. Confirm Identity work is **not** blocked.

## Non-asks / STOP

- No vendor production connection
- No secrets in repo
- No migrations / runtime without separate PO GO
- No LEGAL GATE G2
- No VietQR → fiscal C0 claim from Payment Core
- No merge of this PR as implementation authorization until reviews APPROVE + explicit docs-only MERGE GO

## Sandbox vs production (short)

| | Sandbox | Production |
| --- | --- | --- |
| Data | Synthetic default; live merchant only with Egress Gate | Real + vault + egress |
| Fiscal SATISFIED | Forbidden without G2 | G2 required |
| VietQR | Payment lifecycle tests only | FinSec APPROVE + contracts |
| BANK→fiscal | Out of scope | Requires §2A Level C Accept |

## Recommended next after docs MERGE GO

Sales diligence → I0-B foundations → I2/I3 sandbox adapters → §2A Level C (if bank fiscal needed) → G2 (I4).
