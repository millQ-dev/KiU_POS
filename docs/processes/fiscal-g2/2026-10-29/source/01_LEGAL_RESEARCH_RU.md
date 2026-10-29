# KiU POS — Vietnam fiscalization legal research (29.10.2026)

**Research snapshot:** 29 October 2026. This is technical/legal research, not an opinion of Vietnamese licensed tax counsel and not a LEGAL GATE G2 release authorization. Source classes are labelled `OFFICIAL`, `PROVIDER`, `REPOSITORY`, `INTERPRETATION`, and `OPEN`. Official/public documents are external research evidence, not automatically a certified merchant-specific tax position.

## 1. Governing legislation, confirmed

| Instrument | Date signed | Effective | Official source | Role |
|---|---|---|---|---|
| Law on Tax Administration 108/2025/QH15 | 10 Dec 2025 | 01 Jul 2026 | https://vanban.chinhphu.vn/?classid=1&docid=216541&pageid=27160&typegroupid=3 | Overall tax administration |
| Decree 254/2026/NĐ-CP | 30 Jun 2026 | 01 Jul 2026 | https://vanban.chinhphu.vn/?classid=1&docid=218689&orggroupid=2&pageid=27160 | Electronic invoices/docs: type, issuance, timing, seller/buyer data, registration, handling errors |
| Circular 91/2026/TT-BTC | 30 Jun 2026 | 01 Jul 2026 | https://vanban.chinhphu.vn/?classid=1&docid=219006&orggroupid=4&pageid=27160 | Implementation rules, registration/changes, processing, appendices/forms |

OFFICIAL tax department summary of changes dated 20 July 2026: https://xaydungchinhsach.chinhphu.vn/nhung-diem-moi-cua-nghi-dinh-254-2026-nd-cp-va-thong-tu-91-2026-tt-btc-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260717143502375.htm

**Version caution:** Decree 123/2020, Decree 70/2025 and Circular 32/2025 explain history but cannot be the sole current normative contract as of this research date. Decree 254 supersedes older decree framework; Circular 91 replaces Circular 32/2025. Existing historical documents may still be governed by applicable transitional rules — merchant counsel to verify exact correction path.

## 2. Key requirements relevant to restaurant merchants

### Applicability and registered mode

- Decree 254 Art. 6 describes economic organizations and household/individual businesses selling directly to consumers, including food, drinks and restaurants, and cash-register e-invoices (`hóa đơn điện tử khởi tạo từ máy tính tiền`). OFFICIAL source: https://baochinhphu.vn/quy-dinh-doi-tuong-su-dung-hoa-don-dien-tu-10226070308163723.htm.
- **Important carve-out:** government's July 2026 update says organizations/households already registered for coded or non-coded e-invoices are not automatically required to register *again* for cash-register e-invoices. It is wrong to force every restaurant into one universal document mode. Select `FiscalDocumentMode` by accepted merchant registration, tax method, legal-entity profile and local counsel/provider evidence.
- The VND 1 billion annual-revenue household-business threshold must not be applied to incorporated restaurant companies as a universal exemption. Household business and company are different taxpayer classes.
- Decree 254 Art. 3 recognizes that cash-register invoices may be coded, non-coded or linked electronic access data; do not assume a single provider response type is legally sufficient in all regimes.

### POS invoice data and electronic delivery

- Decree 254 Art. 8(9): cash-register invoices have recognizable POS form and **do not necessarily require a digital signature on the invoice**. This does not settle provider authentication or tax-registration requirements. Source: https://fnblegal.vn/van-ban/nghi-dinh-254-2026-nd-cp/dieu-8 and the decree above.
- Decree 254 Art. 10(4): seller name/address/MST; buyer identity/contact/tax number if required/requested; goods/service names, quantities, unit prices and payment total; additional VAT detail when seller uses deduction method; invoice date/time; authority code or accessible electronic verification data. Buyer can receive by electronic delivery or a lookup link/QR. Source: https://fnblegal.vn/van-ban/nghi-dinh-254-2026-nd-cp/dieu-10.
- **Do not conflate** normal thermal payment receipt, kitchen ticket, invoice preview, official issued e-invoice, provider confirmation and tax-authority confirmation. Each must have separate status/evidence.
- Do not emit a zero-valued tax invoice merely because a software test route needs to pass. Zero consideration is only handled with real legal business basis and mode policy; sample/complimentary/advertising operations have their own rules.

### Timing

- Decree 254 Art. 9 states invoice timing for goods generally at transfer of ownership/use, and for services at completion, or on receipt of advance/during-service payment where required (excluding qualifying security deposits under the prescribed exception). Restaurant counter-prepay, table-postpay, delivery, deposits, split tenders and refunds may need different triggers.
- KiU **accepted C0 counter-service business contract** uses authoritative Payment Collection Event as the fiscal trigger, and C0 fiscal completion is online-only, fail-closed. That contract is applicable to the narrow counter-service prepay pilot, **not** general dining/tables or every possible fiscal regime. LEGAL counsel must confirm suitability for actual merchant and service model.
- OFFICIAL: https://xaydungchinhsach.chinhphu.vn/nhung-diem-moi-cua-nghi-dinh-254-2026-nd-cp-va-thong-tu-91-2026-tt-btc-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260717143502375.htm; full legal wording https://thuvienphapluat.vn/van-ban/Thue-Phi-Le-Phi/Nghi-dinh-254-2026-ND-CP-huong-dan-Luat-Quan-ly-thue-hoa-don-dien-tu-chung-tu-dien-tu-713085.aspx (secondary reproduction).

### Registration, approval and corrections

- Before lawful issuance, restaurant taxpayer must have accepted registration/changes for the appropriate e-invoice mode. Circular 91 Art. 8 implementation includes `01/ĐKTĐ-HĐĐT` (Appendix III) and administrative receipt/acceptance notices such as `01/TB-TNĐT` (Appendix IV). Confirm the **final accepted/approved** administrative state, not merely proof of submission. Secondary full-text source: https://m.thuvienphapluat.vn/van-ban/Thue-Phi-Le-Phi/Thong-tu-91-2026-TT-BTC-huong-dan-Luat-Quan-ly-thue-va-Nghi-dinh-254-2026-ND-CP-699151.aspx.
- Correction/replacement/adjustment of an issued invoice are formal flows. Never cancel, refund, reissue or mutate historical sale facts through a casual API retry. If older 2020/2025 invoices are involved, apply their transition handling after legal review.
- Regulatory incident/deferred issuance allowances are **not a universal offline grace period**. Ask counsel and the provider which precise disruption, documentation, deadline and notice procedures apply to cash-register e-invoices in the chosen regime.

## 3. Documents to collect — separate company vs issuing merchant

### KiU / MillQ as SaaS integrator

1. Current Vietnamese legal entity registration / enterprise registration certificate (`Giấy chứng nhận đăng ký doanh nghiệp`, if established), correct business lines, address, MST; if not yet constituted, disclose actual status rather than inventing an incorporated entity.
2. Authorized legal representative ID/authority (prefer minimum disclosure; share only through verified provider onboarding channel, not plain email).
3. Integration/partner application and business contact; product description, security architecture, multi-tenant isolation, fiscal data flow, seller-of-record statement and merchant onboarding model.
4. Data processing and confidentiality contract; subprocessor, Vietnamese hosting/residency and cross-border egress assessment; incident and breach responsibilities.
5. Developer sandbox agreement, API policy, fair-use/rate limits, partner/commercial terms, service/support/SLA agreements; written scope of whether KiU acts only as middleware or is entrusted to issue invoices.
6. Where KiU legally acts as **ủy nhiệm**/delegated e-invoice issuer, separate written authorization and tax-notification/registration obligations. Do not presume ordinary SaaS API integration equals delegated invoice issuance.

### Restaurant merchant (actual issuing taxpayer)

1. Legal entity/household tax identity: correct MST, official trade/legal name, legal address and outlet address, enterprise/business-household registration as applicable; tax office/filing details.
2. VAT/tax method and fiscal document type: VAT (`GTGT`) vs sales (`bán hàng`), coded/non-coded/POS under their registration, registered invoice series/templates and tax status; tax classifications per actual menu and business facts.
3. E-invoice registration/change filing (`01/ĐKTĐ-HĐĐT` where applicable) **and accepted tax administration response**, plus historical status if changing provider.
4. Provider account/contract; authority of signatory, roles and delegated issuance agreement if relevant; provider-supplied credentials, series/template, assigned legal invoice identity policy and merchant workspace.
5. Digital certificate/signer if chosen regime/provider requires; confirm no-signature POS regime separately instead of universally requiring USB key.
6. Source accounting data, tax snapshot configuration, payment collection method, receipt-delivery workflow; sample legitimate sale with consenting test merchant and written live pilot approval.
7. Buyer data policy: collect only when legally necessary/requested; retention, access controls and approved egress to provider/tax authority.

**Open legal confirmations (MUST obtain signed written advice):** exact registered invoice mode for Merchant #1, whether merchant's restaurant service flow meets C0 Payment Collection Event timing, authorization requirements, tax invoice fields / VAT method, correction and replacement workflows, permitted transmission during outages, retention and cross-border data processing, vendor suitability/authority.

## 4. LEGAL GATE G2 principle

`LEGAL_G2 = BLOCKED` unless there is an auditable packet for the concrete legal entity, outlet, terminal/provider binding and approved fiscal document mode; tax counsel confirms legal mappings and evidence threshold, provider credentials/status mapping pass sandbox, merchant registration accepted, security/egress reviewed, and production merchant explicitly authorizes the live pilot.

No signed production authority from these sources is assumed. Merchant's existing invoice history/series may require migration or clean handover rather than issue from a second provider. **Neither provider's marketing page nor HTTP 200 means tax authority accepted an invoice.**
