# Review packet — ADR-0039 Office Global Account / MFA / Owner Bootstrap

**Autonomy:** Level C (docs only)  
**Status:** **Accepted** — PO **ACCEPT WITH DELTAS** 2026-10-11; rebased for merge review; **Origin merge pending**  
**Branch:** `docs/adr-0039-office-global-account-mfa`  
**New base:** `e3ed42cf0ff272e5d7ef364918afbdfe091afb20` (ADR-0038 canonical closed)  
**Prior reviewed HEAD (pre-rebase):** `6e02997f2830766257af27c814ed4140ee5ef0c5`  
**Do not merge until PO merge authorization. No runtime. No migrations.**

---

## Rebase

- Rebased onto Origin main after ADR-0038 merge.
- Preserved Payments `domain-module-map` ADR-0038 CASH / PaymentCollectionEvent line (no overwrite with older “CASH not started”).
- ADR-0039 Org/Identity map notes retained.

## Brand bootstrap delta (B4)

Atomic: Tenant → LegalEntity → Brand #1 → Outlet #1 (brand+LE) → BankAccounts[1..N] → owner membership.  
Confirmed Brand name (prefill from business name allowed). No phantom Brand; no cross-tenant Brand borrow; no partial authorize on failure; semantic idempotency + draft recovery.

## Notion

`https://app.notion.com/p/3f630d51715181faba65d6ffa13b909e` — **access limitation** (login wall / not anonymously readable). Do **not** claim full Notion UI parity beyond PO B6 checklist already bound in ADR §B6.

## Office requirements maintained

GlobalAccount independent; zero-membership Office; password first; first email OTP; later passkey/push/OTP; optional passkey enroll+skip; POS/Office isolation; LE tax+banks; ADR-0022 independent; server owner grants; no tax-ID claim of existing business.

## OPEN

Invitations; recovery; country tax fields; OTP params; bank KYC; session TTL; push phasing; roles beyond bootstrap; link DDL; concurrent distinct-key race conflict code; Notion UI-only beyond B6.
