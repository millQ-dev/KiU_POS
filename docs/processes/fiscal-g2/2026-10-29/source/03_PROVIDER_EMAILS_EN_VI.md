# KiU POS — provider outreach pack (ready to copy; NOT SENT)

**Do not invent company details.** Replace bracketed fields with genuine business information before sending. Do not include personal IDs, certificate keys, production passwords, tax system credentials or merchant personal data in initial email. Both candidates are asked in parallel. Scope is Vietnam restaurant/POS software with first small merchant pilot; SaaS integrator acts for individual restaurant merchant, and restaurant remains actual invoice issuer/seller.

## Email A1 — Viettel S-Invoice (English)

**To:** Viettel S-Invoice Enterprise Integration / B2B Partnerships (via official Viettel SInvoice sales/support channel; individual email address not yet confirmed)

**Subject:** KiU POS × Viettel S-Invoice — 2026 cash-register e-invoice API, sandbox and restaurant pilot

Dear Viettel S-Invoice Integration Team,

We are developing **KiU POS**, a cloud-based restaurant and café point-of-sale product for the Vietnamese market. We are evaluating Viettel S-Invoice as our **first-choice integration candidate** for legally compliant electronic invoices generated from cash registers (hóa đơn điện tử khởi tạo từ máy tính tiền), initially for one authorized restaurant merchant, with future support for multiple independently registered merchants.

We have an existing provider-neutral Fiscal Core and are seeking confirmation that your current solution supports **Law 108/2025/QH15, Decree 254/2026/NĐ-CP and Circular 91/2026/TT-BTC**, effective from 1 July 2026.

Could you please provide or confirm:

1. The latest **binding API documentation**, version, authentication, invoice modes (POS/coded/non-coded), issue/create, status inquiry, XML/PDF retrieval, buyer QR/link, replacement/adjustment and correction procedures.
2. **Sandbox** environment, merchant test accounts, access steps, IP allowlisting, sample requests/responses, error code catalog, and a technical contact for integration tests.
3. **Uncertain outcome handling:** if issue request times out after your system has already issued or submitted an invoice, can we retrieve it by a stable merchant reference/idempotency key? Does your API guarantee no duplicate issuance? What is the tax-authority acknowledgment/status model? Is webhook/callback supported, or should we poll?
4. Prerequisites for **KiU as a SaaS integrator** versus the restaurant as the legal invoice issuer: whether a partner/reseller program exists, separate credentials and invoice series per tax ID, contractual processing responsibility, merchant authorization and tax-office registration.
5. Required merchant/company documents, any digital-signature or HSM requirements specifically for the 2026 cash-register mode, and whether you assist with tax registration and 2026 corrections.
6. Written **commercial proposal** for a 1-outlet pilot and 5/25/100 outlets: setup/integration, per-document prices, monthly or annual minimums, additional API or support fees, test quota, volume discounts, and any promotional terms.
7. **SLA/security:** uptime commitment, incident response, support hours, RTO/RPO, rate limits, service outages, Vietnam data storage and subcontractors, data processing agreements and partner escalation channel.
8. Certification/UAT requirements, acceptance test scenarios, issuance authorization, and estimated steps from sandbox → merchant production credential → first real invoice.

We are not requesting production issuance until the merchant's registration, tax/legal approval and technical acceptance are confirmed. We can share our high-level architecture and synthetic test cases through an approved channel.

Please connect us to a technical partner manager and send the relevant documents and a proposed technical call slot.

Regards,
[Full name]
[Role] · KiU POS / [registered company legal name, if applicable]
[Work email] · [Telephone/Zalo]
[Website, if available]

## Email A2 — Viettel S-Invoice (Vietnamese)

**Chủ đề:** KiU POS × Viettel S-Invoice — yêu cầu API hóa đơn từ máy tính tiền, sandbox và hợp tác thí điểm nhà hàng năm 2026

Kính gửi Bộ phận Tích hợp Kỹ thuật / Hợp tác Doanh nghiệp Viettel S-Invoice,

Chúng tôi đang phát triển **KiU POS**, phần mềm quản lý bán hàng dành cho nhà hàng và quán cà phê tại Việt Nam. Chúng tôi đang xem xét **Viettel S-Invoice là đối tác tích hợp ưu tiên**, trước mắt triển khai thí điểm với một đơn vị kinh doanh nhà hàng được ủy quyền hợp lệ, sau đó mở rộng cho nhiều thương nhân có mã số thuế và đăng ký hóa đơn riêng biệt.

KiU đã có phân hệ Fiscal Core theo kiến trúc độc lập với nhà cung cấp. Chúng tôi cần xác nhận khả năng đáp ứng **Luật Quản lý thuế số 108/2025/QH15, Nghị định 254/2026/NĐ-CP và Thông tư 91/2026/TT-BTC**, có hiệu lực từ ngày 01/07/2026.

Kính đề nghị Quý đơn vị cung cấp/xác nhận:

1. **Tài liệu API mới nhất và phiên bản áp dụng** cho hóa đơn khởi tạo từ máy tính tiền, hóa đơn có mã/không mã, lập/phát hành, tra cứu trạng thái, tải XML/PDF, đường dẫn/mã QR, điều chỉnh và thay thế hóa đơn.
2. **Môi trường sandbox**, tài khoản thử nghiệm, quy trình cấp quyền, danh sách IP, request/response mẫu, mã lỗi và đầu mối kỹ thuật.
3. **Xử lý trạng thái chưa xác định:** nếu request bị timeout nhưng hệ thống đã phát hành hoặc chuyển hóa đơn đến cơ quan thuế, chúng tôi có thể truy vấn theo mã tham chiếu ổn định/idempotency key hay không? Viettel ngăn phát hành trùng như thế nào? Có webhook/callback hay phải polling? Thông tin xác nhận từ cơ quan thuế được thể hiện ra sao?
4. Điều kiện dành cho **đơn vị tích hợp SaaS** và cho **nhà hàng là bên bán/bên lập hóa đơn**: chương trình đối tác, tài khoản/API credential riêng theo MST, quyền hạn, hợp đồng xử lý dữ liệu, ủy quyền và thủ tục đăng ký với cơ quan thuế.
5. Hồ sơ pháp lý của nhà hàng và công ty tích hợp; yêu cầu chứng thư số/HSM riêng đối với loại hóa đơn từ máy tính tiền theo quy định 2026; hỗ trợ thủ tục đăng ký và xử lý hóa đơn sai sót.
6. **Báo giá bằng văn bản** cho thí điểm 1 địa điểm và mô hình 5/25/100 địa điểm: phí khởi tạo/tích hợp, giá từng hóa đơn, mức tối thiểu, phí API/hỗ trợ, hạn mức sandbox, chiết khấu và điều kiện ưu đãi.
7. **SLA và bảo mật:** cam kết thời gian hoạt động, hỗ trợ sự cố, giới hạn truy vấn, thời gian khắc phục, nơi lưu trữ dữ liệu, nhà thầu phụ, DPA và đầu mối escalation.
8. Các bước kiểm thử nghiệm thu/certification/UAT, xác nhận đủ điều kiện phát hành và lộ trình từ sandbox đến tài khoản production của nhà hàng.

Chúng tôi sẽ **không phát hành hóa đơn thật** cho đến khi hoàn tất đăng ký của đơn vị bán, kiểm tra pháp lý và nghiệm thu kỹ thuật. Có thể cung cấp sơ đồ kỹ thuật và dữ liệu thử nghiệm giả lập qua kênh bảo mật được thống nhất.

Rất mong Quý đơn vị kết nối chúng tôi với phụ trách hợp tác và kỹ thuật, đồng thời gửi bộ tài liệu và đề xuất lịch trao đổi.

Trân trọng,
[Họ tên]
[Chức vụ] · KiU POS / [Tên pháp nhân chính xác nếu đã đăng ký]
[Email công việc] · [Số điện thoại/Zalo]

## Email B1 — MISA meInvoice (English)

**To:** MISA meInvoice Open API / Developer Partnerships (via developer.misa.vn / official contact form)

**Subject:** KiU POS × MISA meInvoice — confirm cash-register invoice API v2026, sandbox and SaaS partner pilot

Dear MISA meInvoice Developer Partnerships Team,

We build **KiU POS**, a restaurant/café POS product for Vietnam. We are evaluating MISA meInvoice in parallel with another provider as a **full technical and commercial alternative** for our initial live restaurant pilot.

We located your public meInvoice documentation for the POS cash-register issuance endpoint `code/itg/invoice-calculating/invoiceandpublish` with `IsInvoiceCalculatingMachine=true`, a token endpoint, and `status` with `invoiceCalcu` parameters. Before implementation, we need your confirmation that these API families and their response semantics are current for **Law 108/2025/QH15, Decree 254/2026/NĐ-CP and Circular 91/2026/TT-BTC**.

Could you please confirm and supply:

1. Current official **meInvoice POS invoice API specification**, version and supported tax regimes, including the relevant new July 2026 requirements and template/series.
2. How to obtain sandbox account and `appid`; recommended **meInvoice-specific** authentication (your general Developer Portal mentions OAuth 2.0, while public meInvoice integration docs describe a token with appid/tax code/user account). Please clarify which applies to a SaaS integrator.
3. Error/result taxonomy for **issued vs tax-submitted vs accepted/rejected**, unknown network outcomes and status reconciliation by our immutable `RefID`/business idempotency key; whether webhook is available and duplicate issuance protections.
4. Exact API workflow for invoice replacement/adjustment and retrieval of signed XML, PDF, QR and buyer lookup; correction rules for machine-generated e-invoices under 2026 law.
5. Per-merchant authorization, independent tax codes and credentials, tenant isolation, partner/reseller licensing, permission to offer the service embedded inside a third-party POS.
6. Onboarding list for the merchant and software company, tax registration acceptance and any signing/HSM/USB-token requirement for the chosen POS regime.
7. Written prices for 1k/5k/10k documents and 1/5/25/100 outlets, setup charges, API/integration/support fees, validity periods, minimum volumes, discounts, SLA, support hours, rate limits and data-residency/DPA terms.
8. A named technical contact, sandbox/UAT test plan and steps for a controlled production merchant pilot.

We will use synthetic test data first and will not enable real fiscal issuance before the authorized restaurant's legal registration and explicit go-live approval.

Thank you. We would appreciate the latest technical pack and an introductory integration call.

Regards,
[Full name]
[Role] · KiU POS / [legal entity name, if registered]
[Work email] · [Phone/Zalo]

## Email B2 — MISA meInvoice (Vietnamese)

**Chủ đề:** KiU POS × MISA meInvoice — xác nhận API hóa đơn máy tính tiền theo quy định 2026, sandbox và chương trình đối tác SaaS

Kính gửi Bộ phận Open API / Đối tác Tích hợp MISA meInvoice,

Chúng tôi phát triển **KiU POS**, giải pháp POS cho nhà hàng và quán cà phê tại Việt Nam. Chúng tôi đang đánh giá MISA meInvoice song song với một nhà cung cấp khác như **đối tác tích hợp và giải pháp dự phòng đầy đủ** cho giai đoạn thí điểm.

Chúng tôi đã tham khảo tài liệu API công khai của meInvoice về hóa đơn khởi tạo từ máy tính tiền (`code/itg/invoice-calculating/invoiceandpublish`, `IsInvoiceCalculatingMachine=true`), API token và API tra cứu trạng thái (`status`, `invoiceCalcu`). Xin xác nhận các API và mã trạng thái này còn áp dụng theo **Luật 108/2025/QH15, Nghị định 254/2026/NĐ-CP và Thông tư 91/2026/TT-BTC** kể từ 01/07/2026.

Kính đề nghị MISA hỗ trợ:

1. Tài liệu **API chính thức hiện hành** cho hóa đơn khởi tạo từ máy tính tiền và các chế độ hóa đơn tương ứng, mẫu/ký hiệu hóa đơn.
2. Quy trình cấp tài khoản **sandbox**, AppID và phương thức xác thực đúng cho API meInvoice: tài liệu cũ dùng token theo AppID/MST/tài khoản, còn Developer Portal nêu OAuth 2.0 — xin làm rõ cho đối tác SaaS.
3. Mã trạng thái: đã phát hành, gửi CQT, CQT tiếp nhận/từ chối, request bị timeout nhưng đã xử lý; tra cứu theo `RefID`/mã tham chiếu và đảm bảo không phát hành trùng; webhook/callback nếu có.
4. API thay thế/điều chỉnh hóa đơn máy tính tiền, tải XML/PDF, đường dẫn/mã QR tra cứu cho khách và quy trình xử lý sai sót theo quy định mới.
5. Điều kiện hợp tác **đối tác phần mềm POS đa khách hàng**, tài khoản/MST/credential riêng theo từng thương nhân, bảo mật dữ liệu, quyền nhúng chức năng hóa đơn vào KiU POS.
6. Hồ sơ của công ty tích hợp và nhà hàng; đăng ký sử dụng HĐĐT được CQT chấp nhận; yêu cầu chữ ký số/HSM riêng theo loại hóa đơn.
7. Báo giá bằng văn bản cho 1.000/5.000/10.000 hóa đơn, 1/5/25/100 địa điểm; phí khởi tạo, API, hỗ trợ, thời hạn gói, SLA, giới hạn truy cập, hợp đồng xử lý dữ liệu và nơi lưu trữ dữ liệu.
8. Đầu mối kỹ thuật, bộ test UAT và thủ tục kích hoạt tài khoản production cho nhà hàng thí điểm.

Giai đoạn đầu chúng tôi chỉ dùng **dữ liệu giả lập**. Chúng tôi sẽ không phát hành hóa đơn thật khi chưa có đầy đủ đăng ký của nhà hàng, đánh giá tuân thủ và chấp thuận go-live.

Mong nhận bộ tài liệu tích hợp và lịch làm việc với phụ trách kỹ thuật/đối tác.

Trân trọng,
[Họ tên]
[Chức vụ] · KiU POS / [Tên pháp nhân nếu đã đăng ký]
[Email công việc] · [Điện thoại/Zalo]

## Short follow-up to either provider (send after a reasonable business interval; NOT SENT)

**EN subject:** Follow-up: KiU POS cash-register e-invoice sandbox and partner API

Hello, following up on our request for your current 2026 POS e-invoice integration kit and pilot partner conditions. Could you introduce a technical account manager and share the sandbox onboarding procedure, invoice status/reconciliation API, quote and required merchant documents? We can provide a synthetic UAT matrix. Thank you.

**VI subject:** Nhắc lại yêu cầu — tích hợp KiU POS với API hóa đơn từ máy tính tiền

Kính chào Quý đơn vị, chúng tôi xin gửi lời nhắc về yêu cầu tài liệu API HĐĐT từ máy tính tiền theo quy định 2026 và điều kiện hợp tác thí điểm. Nhờ Quý đơn vị kết nối đầu mối kỹ thuật và cung cấp quy trình sandbox, API tra cứu/đối soát trạng thái, báo giá và danh mục hồ sơ thương nhân. Chúng tôi có bộ UAT với dữ liệu giả lập. Xin cảm ơn.
