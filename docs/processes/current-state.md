# MillQ Current State

**Checkpoint:** GUEST1.1 Guest QR Menu Public Read Projection — Level B PR#64 pending merge gate (FUNCTIONAL + ARCHITECTURE + SECURITY APPROVE)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `millQ-dev/KiU_POS`
**Equality baseline:** `fa107d1dc5ec8fda96fa130371c4c6b7d55135f6` (Origin == GitHub at launch)
**Updated:** 2026-09-18

## Runtime / CI / backup

| Item | State |
| --- | --- |
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** @ `fa107d1` |
| Tax runtime (TAX1.1) | **NOT STARTED** |
| Fiscalization runtime (FISC1.1) | **NOT STARTED** |
| ADR-0035 Employee Engagement docs | **OPEN** Origin PR#63 — strategic review |
| GUEST1.1 Guest QR Public Read | **IN REVIEW** — Origin PR#64; Security APPROVE after remediation; merge gate not closed |

## Architecture notes

- Capability: `guest_menu.qr` via **PackageEntitlement ∧ OutletCapabilityConfig** (fail closed)
- Public cache: **none** (`Cache-Control: no-store`); Referrer-Policy: no-referrer
- orderChannel: existing `DIRECT` only (no GUEST_QR channel)
- Admin mint/revoke: `/api/v1/dev/guest-menu/*` only (disabled in production)

## Next

1. Independent FUNCTIONAL + ARCHITECTURE review APPROVE on PR#64.
2. Then merge Origin + `scripts/backup-origin-to-github.sh` + ChatGPT equality verify.
3. TAX1.1 after PO launch.
