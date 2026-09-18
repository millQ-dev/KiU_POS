# MillQ Current State

**Checkpoint:** GUEST1.1 Guest QR Menu Public Read Projection — **MERGED** Origin PR#64 @ `6788d43`
**Canonical host:** Cursor Origin (`https://origin.cursor.com/millqdev/MillQ.git`)
**Backup host:** GitHub `millQ-dev/KiU_POS`
**Origin main:** `6788d43840c9b1d5bce742e1b24eab6caec06339`
**Updated:** 2026-09-18

## Runtime / CI / backup

| Item | State |
| --- | --- |
| ADR-0033 Tax/VAT Architecture | **ACCEPTED** |
| GUEST1.1 Guest QR Public Read | **MERGED** Origin PR#64 → `6788d43` |
| GitHub backup after GUEST1.1 | **PENDING** — MillQ Origin Backup App credentials not in this agent env; run `scripts/backup-origin-to-github.sh` via backup automation |
| Tax runtime (TAX1.1) | **NOT STARTED** |
| Fiscalization runtime (FISC1.1) | **NOT STARTED** |
| ADR-0035 Employee Engagement docs | **OPEN** Origin PR#63 |

## GUEST1.1 merge gate (closed)

- FUNCTIONAL REVIEW: APPROVE (`f8dc19c2-f837-4e9c-a10f-0b7c5cb27a90`)
- ARCHITECTURE REVIEW: APPROVE (`109c1694-b51b-49ba-98de-492695f1efb5`)
- SECURITY REVIEW: APPROVE (`138f8d32-cc15-4103-8a4f-418d2a8ddd86`)
- Production: `/api/v1/dev/guest-menu/*` **not registered** when `NODE_ENV=production` (no env override)

## Next

1. ChatGPT verifies Origin/GitHub equality after backup automation runs.
2. Do not auto-start next vertical.
