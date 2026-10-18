# Partner due diligence — Viettel S-Invoice

- **Date:** 2026-10-18
- **Status:** Packet for sales/legal/engineering — **not** a contract
- **Authority:** INTEGRATIONS-0 gate (`integrations-0-vietnam-provider-onboarding-gate.md` §2.2)

## Ask Viettel / collect

| Area | Items | Priority |
| --- | --- | --- |
| Sandbox access | Demo vs V2 (`api-vinvoice` / `demo-sinvoice`) URLs; credentials issuance SLA; IP whitelist process | Must |
| Contract prerequisites | Entity docs (GPKD, ID of legal rep); e-invoice service agreement; CA/USB token / server CTS requirements | Must |
| API specifications | **Binding** version (V1 vs V2); OpenAPI/PDF pack held by MillQ; issue / adjust / cancel / **replace**; status query; evidence download | Must |
| V1/V2 semantics | Confirm auth model (Basic vs login/`access_token`); forbid mixed clients | Must |
| 2026 restaurant MTT | Written confirmation: cash-register e-invoice (`máy tính tiền`) under **Law 108 / NĐ 254 / TT 91** for F&B / nhà hàng; correction/replacement rules | Must — **OPEN** |
| Signatures | Invoice signing model (provider-hosted vs merchant USB-token vs server CTS); hash algorithms | Must |
| Callback / async | Webhook for CQT acceptance, or poll-only? | Must |
| SaaS partner vs merchant | Multi-tenant SaaS partner program vs **per-merchant** contracts; who holds webservice user; credential rotation | Must — **OPEN** |
| Costs | Setup, per-invoice, subscription, sandbox fees — **SALES** | Must |
| SLA | Uptime, support hours, incident RTO/RPO — **SALES** | Should |
| Business authorization | Tax registration of serials/templates; who files với CQT | Must |
| Data residency / subprocessors | For ADR-0015 Egress Gate | Must |

## KiU engineering prerequisites

- Map to `FiscalProviderAdapter` only (Fiscalization owns port).
- LE-scoped credentials in vault; Integrations owns binding rows.
- Fail-closed without G2.
- Append-only `fiscal_provider_attempt` / evidence.
- Sandbox starts with **synthetic** data unless Egress Gate + live-merchant GO.

## References

- Provider technical PDF: http://viettelsolution.com.vn/uploads/tai%20lieu/Technical_webservice_Sinvoice_en.pdf
- Onboarding flow: https://sinvoice-viettel.vn/quy-trinh-chuong-3/
- Downloads: https://hoadondientuvt.vn/tai-ve/
