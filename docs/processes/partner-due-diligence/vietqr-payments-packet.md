# Partner due diligence — VietQR / dynamic QR payments

- **Date:** 2026-10-18
- **Status:** Packet for sales/legal/engineering — **not** a contract
- **Authority:** INTEGRATIONS-0 gate (`integrations-0-vietnam-provider-onboarding-gate.md` §2.3 / §2A)
- **Constraint:** Payments remain **non-custodial** (ADR-0013)
- **Constraint:** VietQR success **≠** C0 `PaymentCollectionEvent` until separate Level C (§2A)

## Ask partner / bank / NAPAS path

| Area | Items | Priority |
| --- | --- | --- |
| Product path | vietqr.vn host2host vs bank VietQR API vs NAPAS VietQRPay ISV — pick one commercial path | Must |
| Binding Transaction Sync spec | Resolve **EN vs VI** Required-field conflict (`transactionid`, `transactiontime` type, `referencenumber`, `orderId`); deliver signed field matrix | Must — **OPEN** |
| Sandbox | `dev.vietqr.org` (or bank sandbox) access; test accounts (docs mention MB/BIDV) | Must |
| Contract prerequisites | Merchant KYC; tax code; bank account ownership match | Must |
| API specifications | Generate dynamic QR (`qrType=0`); Get Token; Transaction Sync; inquire; refund/cancel if any | Must |
| Auth | Bearer JWT model (partner Get Token secret custody); whether `sign` is required; **canonical string** + algorithm if sign used | Must — **OPEN** |
| Collection evidence | Which fields affirm **funds collected** vs QR displayed; bank vs aggregator attestation; usable as collection clock? | Must — fiscal-critical |
| Banks / modes | List banks and integration modes with **verifiable** transaction confirmation for KiU | Must — **OPEN** |
| Callback verification | Document verify-before-state-change contract; retry ≤10 semantics | Must |
| Costs / MDR | Per-txn, monthly, NAPAS fees; SaaS vs merchant credential pricing — **SALES** | Must — **OPEN** |
| SLA | Callback latency, retry, support | Should |
| Business authorization | Merchant of record; multi-outlet `terminalCode` mapping | Must |
| VietQRGlobal | Tourist rails — separate commercial confirm | Later |

## KiU engineering prerequisites

- `PaymentRailAdapter` (Proposed) behind LE binding — Payments owns port.
- Idempotent callback on canonical `referencenumber` / `transactionid` per binding letter.
- Amount/currency binding to Payment; PARTIAL/EXCESS/REVERSED/UNMATCHED park without PCE.
- No Order completion bypass of Settlement/Payment lifecycle.
- **No** bank `PaymentCollectionEvent` / FiscalCheckoutGate open until §2A Level C Accept.

## References

- Generate: https://api.vietqr.vn/en/vn/api-vietqr-callback/goi-api-generate-vietqr-code
- Transaction Sync VI: https://api.vietqr.vn/vi/api-vietqr-callback/api-transaction-sync
- Transaction Sync EN: https://api.vietqr.vn/en/vn/api-vietqr-callback/api-transaction-sync
- Retry: https://api.vietqr.vn/en/vn/api-vietqr-callback/retry-giao-dich
- Integrated: https://doc.vietqr.vn/doc/api-vietqr-callback/api-vietqr-host2host/integrated-document-for-payment-service-vietqr
- Acquiring profile research: `docs/research/vietnam-acquiring-profile-2026.md`
