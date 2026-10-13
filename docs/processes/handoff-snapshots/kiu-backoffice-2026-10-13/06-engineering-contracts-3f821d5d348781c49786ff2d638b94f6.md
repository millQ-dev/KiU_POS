# 06 — Сквозные контракты | права, задачи, документы, события

**Здесь есть утверждённые продуктовые инварианты и предложенные технические сущности.** Имена DTO/event/state — инженерные предложения, **НЕ принятые ADR или готовые API**.

## 1. Identity / scope / authorizations

- Базовые субъекты: GlobalAccount, TenantMembership, ProfessionalProfile + ClientAccessGrant; Outlet, LegalEntity, Warehouse/Location, Station, Employee, Role, CapabilityGrant. Глобальный @username только alias/invitation; immutable account ID — principal. Scoped server validation для каждой mutation; denied by default.
- Пример granular capabilities: outlet.view, [sales.read](http://sales.read), expense.create, [invoice.review](http://invoice.review), document.approve, supplier.purchase, goods.receive, inventory.count, [inventory.post](http://inventory.post), recipe.draft, recipe.publish_approve (Owner only), [production.post](http://production.post), kitchen.stoplist.manual, bar.stoplist.manual, reservation.create/edit/cancel/seat, shift.schedule, shift.swap.approve, cash.deposit/withdraw/close, riskpolicy.manage, staff.hire_request, staff.hire_approve, [equipment.repair](http://equipment.repair).order, bar.openitem.create, bar.compliment.write, promotion.publish, [accountant.client.read/write](http://accountant.client.read/write). Список — предложение для modeling, не буквальные имена endpoints.
- Владелец настраивает access, лимиты и закупочные маршруты; отдельное право на approve непереносимо на права отправки банк/подписи; права self-grant запрещены без админполномочия.

## 2. Tasks / four-color priority engine

- Предлагаемые сущности: Task, TaskSourceRef, TaskPriorityHistory, TaskReminder, TaskAssignment, TaskCompletionProof, TaskApprovalDecision, CommentAttachment, OwnerEscalation, EventNotification.
- Initial priority: **Red / Orange / Yellow / White**, конфигурируемая матрица risk/urgency, может быть предложена rule engine. Любой manual transition менеджера требует explanation; event history append-only. Приоритет не равен food safety/risk enforcement. Не менять приоритет событий постфактум без history.
- Manager home supports contextual «Создать задачу» из заказа, жалобы, смены, сотрудника, счёта, ремонта, склада. Employee receives via KiU Mobile; local action/mentions/reminders; optional reviewRequired flag chosen when task is created. If false, marked-done completes; if true, marked-done → awaiting_manager_review → approve/reopen.
- **Manager dispatcher notification policy**: manager only; owner only by explicit manual «Отправить владельцу». Owner may always audit manager task performance without push. Исключения из этого правила — отдельные, явно принятые owner approval и domain-compliance events, НЕ manager dispatcher.
- Need deterministic dedupe/idempotency for same system event, delivery ACK, reconnect, notification retries, shift fallback and expired assignments; reminders/escalation timing is configuration OPEN.

## 3. Shared document state machine

- Одна сущность первичного документа связана с SourceFile, OCR draft, PhysicalReceipt, FinancialReview, LegalDocument, PaymentRequest, ApprovalDecision, Audit. Разные стадии физического складского posting, account entry и bank payment. Не присваивать документу ложный единый статус «успешно», если внешний провайдер не подтвердил отдельный этап.
- Photos uploaded via Mobile and OCR draft; web «Загрузить» / «Сканировать» (deep link + store fallback). OCR confidence, edits and original evidence must be stored; prevent duplicate imported document by identity/doc fingerprint and allow override with explanation.
- Document approval threshold by Operation + Outlet/LegalEntity + permission. A request to authorize != actual bank payment, tax submission, e-invoice acceptance or inventory movement.

## 4. Kitchen/bar production and stock

- Recipe owner-approved version → authoritative production batch issue/receipt posted by Chef/Bar Manager; off-norm explanation required but workflow continues. Food safety blocks are independent. Physical inventory count vs posting — separate grants.
- Units: material-specific base UOM; **bar beverage volumetric balances in ml**, aggregated per SKU × location. Kitchen count/mass/volume as applicable; preserve precision and conversion rules. Shared physical warehouse not duplicated by two departments or outlets.
- Orders route to station KDS by authoritative ProductionRoute; guest order cannot magically be canceled by a local UI state. Kitchen HOLD on explicit waiter cancellation requiring manager approval, ACK and RESUME available. Restaurant/table-service future track distinct from C0 prepay.
- Stop-list manual publish Chef/Bar Manager; **system inferred low balance → recommend to Manager only**, not automatic stop. Availability checks on actual order server command remain required.

## 5. Pricing, comp, promotions

- Open item config Owner enables; BarPOS composer records ingredient ID/quantity ml and price. Allowed only if price >= sum of prorated approved portion prices with explicit rounding/tax policy (OPEN). **No per-order override for any role**. All open drinks audited.
- Bar comp — non-sale complimentary service with zero guest charge and separate inventory expense and Bar Manager configured allowance caps. Waste/spill — distinct reason, exact system timestamp plus actual occurred_at if entered.
- Schedule promotions: baseline POS, authorized roles Owner/Manager/Bar Manager. Promotion cannot break open-drink hard floor.

## 6. Guest info/CRM

- Tenant CRM may manage guest profiles, preferences, receipts, service issues and loyalty with legal purpose. Global Q Card/Q Place needs separate privacy/data processing/product agreements. Do not cross-link personally identified spend across tenants without proper consent and technical controls.

## Conflict / reconciliation queue for engineering

- Owner approval paths (recipe, expense/payment thresholds, Chef off-norm direct Owner notice) versus latest manager-only dispatcher policy: these are **different event channels**. Need explicit channel types: operational alert vs approval request vs statutory/safety warning; legal-required notifications cannot be suppressed by UI preference.
- Manager default notifications owner NONE; Owner dashboards can query manager task journal at will.
- Existing external account grants must be revalidated; assistant PO direction does not supersede Accepted security ADR.
- Prototype role-menu navigation ≠ authorization; secure all actions server-side.