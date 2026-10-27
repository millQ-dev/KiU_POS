# ADR-0048 — PO ACCEPT WITH DELTAS (2026-10-27)

- **Status:** Recorded owner decision (documentation stamp)
- **ADR:** `docs/decisions/ADR-0048-payments-refund-c0.md`
- **Baseline Origin main at decision:** `c3ef13407d0ce77eb94c5a70eda638704b088954`
- **Autonomy of this docs change:** Level **C** (docs-only PR after PO ACCEPT)

## Decision

Product Owner: **ACCEPT WITH DELTAS** for ADR-0048 refund architecture, including:

- reservation / anti-over-refund model
- CASH human confirmation protocol
- VietQR per-attempt reconciliation requirements
- independent FinancialRefundStatus and FiscalCorrectionStatus

## Approved R1–R9 / #37 / #47

See Accepted matrix in ADR-0048. Summary: R1 partial with reservations; R2 current OPEN; R3-D historical Payment / original Outlet; R4 CASH+VietQR target (VietQR blocked on provider evidence), CARD deferred; R5 void deferred; R6 fiscal independent + counsel/G2/policy gate; R7 immutable originals; R8 scoped grant keys without invented thresholds; R9 ≠ abort; #37/#47 binding.

## Mandatory deltas called out by PO

1. Capacity scoped to original Payment + related Settlement/sale obligation.
2. Atomic reservation + semantic idempotency; EXECUTION_UNKNOWN holds reserve.
3. CASH requires explicit physical handover confirmation; uncertain → manual reconcile.
4. VietQR single-flight ≠ payout proof; missing correlation → RECONCILE_BLOCKED.
5. Manual bank refund needs separate Owner + legal GO.
6. FiscalCorrectionPolicy must define REQUIRED / CONFIRMED / UNKNOWN / REJECTED / NOT_REQUIRED / LEGAL_BLOCKED + timing/docs/sequence.
7. Fiscal retries never re-run money payout.

## Explicitly NOT authorized by this Accept

- Production deploy; persistent production DB migrations
- Real CASH/VietQR payouts
- Test fiscal adapter in production
- G2 clearance
- VietQR refund adapter without contractual/technical evidence
- CHRONO1.1 model changes
- Backup / Origin rules / paid Automations changes

## Next

Level B implementation task: refund reservation / schema / financial invariants on **disposable** PostgreSQL only (separate PR; not production migrate GO).
