# MillQ Current State

**Checkpoint:** Guest QR Menu read-only MVP — implementation PR (Level B), pending review (do not merge until review)
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `millQ-dev/KiU_POS`
**Equality baseline:** `fa107d1dc5ec8fda96fa130371c4c6b7d55135f6` (Origin == GitHub at launch)
**Updated:** 2026-09-18

## Runtime / CI / backup

| Item | State |
| --- | --- |
| S1.1 Settlement Foundation | **CLOSED** |
| PAY1.1 Payments Core | **CLOSED** |
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** @ `fa107d1` |
| Tax runtime (TAX1.1) | **NOT STARTED** |
| Fiscalization runtime (FISC1.1) | **NOT STARTED** — blocked by Tax runtime |
| ADR-0035 Employee Engagement + Guest QR (docs) | **OPEN** Origin PR#63 — strategic review; do not merge yet |
| Guest QR Menu read-only runtime | **IN REVIEW** — `feature/guest-qr-menu-readonly` (this PR) |
| Cash / refund / void-after-success | **NOT STARTED** |

## Architecture / research

- Guest QR pipeline: `docs/architecture/guest-qr-menu-read-only-surface.md`
- Reuses MenuResolver + `orderChannel: DIRECT` (no new channel taxonomy)
- Capability key: `guest_menu.qr` via `outlet_capability_config`

## Next

1. Independent review of Guest QR Level B PR (do not merge until APPROVE).
2. Strategic review of ADR-0035 docs PR#63.
3. TAX1.1 after PO launch.
