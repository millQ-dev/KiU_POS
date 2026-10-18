# Partner due diligence — Viettel S-Invoice

- **Date:** 2026-10-18
- **Status:** Packet for sales/legal/engineering — **not** a contract
- **Authority:** INTEGRATIONS-0 gate

## Ask Viettel / collect

| Area | Items |
| --- | --- |
| Sandbox access | Demo vs V2 (`api-vinvoice` / `demo-sinvoice`) URLs; credentials issuance SLA; IP whitelist process |
| Contract prerequisites | Entity docs (GPKD, ID of legal rep); e-invoice service agreement; CA/USB token requirements |
| API specifications | Current supported version (V1 vs V2); OpenAPI/PDF; issue/adjust/cancel/replace; status query; evidence download |
| Signatures | Invoice signing model (provider-hosted vs merchant USB-token); hash algorithms |
| Callback / async | Any webhook for CQT acceptance, or poll-only? |
| Costs | Setup, per-invoice, subscription, sandbox fees — **SALES** |
| SLA | Uptime, support hours, incident RTO/RPO — **SALES** |
| Business authorization | Tax registration of serials/templates; who files với CQT |
| Data residency / subprocessors | For ADR-0015 Egress Gate |
| Law 108 / NĐ 254 readiness | Provider confirmation of máy tính tiền / có mã / không mã support for F&B |

## KiU engineering prerequisites

- Map to `FiscalProviderAdapter` only.
- LE-scoped credentials in vault.
- Fail-closed without G2.
- Append-only `fiscal_provider_attempt` / evidence.

## References

- Provider technical PDF: http://viettelsolution.com.vn/uploads/tai%20lieu/Technical_webservice_Sinvoice_en.pdf
- Onboarding flow: https://sinvoice-viettel.vn/quy-trinh-chuong-3/
- Downloads: https://hoadondientuvt.vn/tai-ve/
