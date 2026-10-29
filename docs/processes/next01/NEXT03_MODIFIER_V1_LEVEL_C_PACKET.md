# NEXT-03 Modifier — contract after PO review

- **Review:** APPROVE WITH CHANGES, 2026-10-29
- **Does not revoke:** ADR-0049 M1–M8 (2026-10-28), ADR-0050
- **Normative corrections:** [ADR-0052](../../decisions/ADR-0052-modifier-v1-contract.md)

## Accepted product rules vs this review

| | Status |
| --- | --- |
| M1–M8 in ADR-0049 | Accepted 2026-10-28. Not reopened. |
| ADR-0050 allergy flow | Accepted 2026-10-28. Required vertical, not dropped. |
| M2 per-unit price through ADR-0030 | Accepted WITH CHANGES 2026-10-29 |
| M3 typed qty / unit conversion; REPLACE does not assume the same number | Accepted WITH CHANGES 2026-10-29 |
| M4 default satisfies mandatory unless `askEveryTime` | Accepted WITH CHANGES 2026-10-29 |
| M5 typed separation inside existing JSON | Accepted WITH CHANGES 2026-10-29 |
| M6 full allergy flow still required | Accepted WITH CHANGES 2026-10-29 |
| M7 existing grants; cashier does not publish | Accepted WITH CHANGES 2026-10-29 |
| M8 counter first; no Floor runtime | Accepted WITH CHANGES 2026-10-29 |

## PR sequence

Pricing per unit → Effective Recipe in `CompleteOrder` → kitchen/guest-note typing → freeze and concurrency → ADR-0050 allergy vertical.

No production migrate.
