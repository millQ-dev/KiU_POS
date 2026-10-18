# INTEGRATIONS-0 — PO Decision Packet

- **STATUS:** Level **C** research gate — **STOP BEFORE RUNTIME**
- **Date:** 2026-10-18
- **Origin HEAD:** `973deb878c977535fa35e921d73fc689fe358530`
- **Backup ancestor:** `e83a02b…`
- **Authority doc:** `docs/architecture/integrations-0-vietnam-provider-onboarding-gate.md`

---

## Ask of PO

1. Accept INTEGRATIONS-0 as the **provider onboarding gate** (docs only).
2. Confirm **Viettel S-Invoice** as first fiscal adapter candidate (sandbox only until **G2**).
3. Confirm **VietQR host2host-class** (or name alternate bank path) as first payments QR candidate — non-custodial preserved.
4. Authorize sales to run due-diligence packets:
   - `docs/processes/partner-due-diligence/viettel-s-invoice-packet.md`
   - `docs/processes/partner-due-diligence/vietqr-payments-packet.md`
5. Confirm migration sources priority P1–P4 with **no unsupported API claims**.
6. Confirm VFA / BHXH I-VAN remain **later gated** (read vs filing split).
7. Confirm Identity work is **not** blocked by this track.

## Non-asks / STOP

- No vendor production connection
- No secrets in repo
- No migrations / runtime PR
- No LEGAL GATE G2
- No merge of this PR as implementation authorization

## Review before any I2/I3 runtime

Architecture · FinSec · Privacy (independent) on adapter PRs.

## Recommended next after Accept

Sales due diligence → I1 vault/binding design → sandbox adapters (I2/I3) → G2 package (I4).
