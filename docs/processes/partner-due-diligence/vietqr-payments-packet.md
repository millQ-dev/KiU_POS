# Partner due diligence — VietQR / dynamic QR payments

- **Date:** 2026-10-18
- **Status:** Packet for sales/legal/engineering — **not** a contract
- **Authority:** INTEGRATIONS-0 gate
- **Constraint:** Payments remain **non-custodial** (ADR-0013)

## Ask partner / bank / NAPAS path

| Area | Items |
| --- | --- |
| Product path | vietqr.vn host2host vs bank VietQR API vs NAPAS VietQRPay ISV — pick one commercial path |
| Sandbox | `dev.vietqr.org` (or bank sandbox) access; test accounts (docs mention MB/BIDV test paths) |
| Contract prerequisites | Merchant KYC; tax code; bank account ownership match |
| API specifications | Generate dynamic QR (`qrType=0`); Get Token; Transaction Sync; inquire; refund/cancel if any |
| Signatures | Callback `signature` algorithm + key distribution; Bearer token lifetime |
| Callback verification | Partner must document canonical string to sign; KiU verifies before state change |
| Costs / MDR | Per-txn, monthly, NAPAS fees — **SALES** |
| SLA | Callback latency, retry (docs: ≤10), support |
| Business authorization | Who is merchant of record; multi-outlet `terminalCode` mapping |
| VietQRGlobal | Tourist rails — separate commercial confirm |

## KiU engineering prerequisites

- `PaymentRailAdapter` (Proposed) behind LE binding.
- Idempotent callback on `referencenumber` / `providerEventIdentity`.
- Amount/currency binding to Payment.
- No Order completion bypass of Settlement/Payment lifecycle.

## References

- Generate: https://api.vietqr.vn/en/vn/api-vietqr-callback/goi-api-generate-vietqr-code
- Transaction Sync: https://api.vietqr.vn/en/vn/api-vietqr-callback/api-transaction-sync
- Retry: https://api.vietqr.vn/en/vn/api-vietqr-callback/retry-giao-dich
- Integrated: https://doc.vietqr.vn/doc/api-vietqr-callback/api-vietqr-host2host/integrated-document-for-payment-service-vietqr
- Acquiring profile research: `docs/research/vietnam-acquiring-profile-2026.md`
