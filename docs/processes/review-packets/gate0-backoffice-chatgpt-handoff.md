# Gate 0 Backoffice — safe ChatGPT handoff copy

Copy the block below into the strategic ChatGPT thread. No secrets.

```text
=== ПАКЕТ ДЛЯ CHATGPT (безопасный handoff) ===
Проект: MillQ / KiU Backoffice
Роль получателя: стратегический ревьюер / помощник Product Owner
Задача: оценить GATE 0 (docs-only) и сказать: approve / правки / блокеры; что делать с Notion export и следующим PR

1) Цель блока
- Сверка Origin runtime с PO-handoff Backoffice от 13.10.2026 и план зависимостей (TaskService + первый Manager vertical).
- Без runtime, без миграций, без merge, без Accept OFFICE1.1 Proposed ADR.

2) Ссылки
- Branch: docs/backoffice-gate0-reconciliation
- Base / canonical: Origin main @ 18316b8f8aa2da6d045b04aebbde3c5434ea046e
- Migration head: 032_fisc11_payment_collection_fiscal_core.sql
- Checkpoint: docs/architecture/backoffice-gate0-architecture-reconciliation.md
- PR #82 (OFFICE1.1, draft, не трогать Accept): tip 142adb26632526d06e9e63f8160335f4cd918477
- Open issues PR #82: docs/architecture/office1.1-pr82-open-review-issues.md

3) Контекст продукта (кратко)
- Нужны кабинеты Owner / Manager / Accountant / Chef / Bar на общем TaskService (четыре цвета).
- Q Place / Q Card — отдельный discovery-stream.
- Notion handoff 13.10.2026 агенту недоступен (login wall «Илья Елизавета's Space»); локального export не найдено.

4) Что сделано в этом блоке
- Зафиксированы SHA + migration head; PR #82 сохранён; 5 OPEN issues отдельно.
- PO REVIEW: APPROVE WITH CHANGES — delta: any-color priority moves (нет ban RED→YELLOW), channels A–D, fail-closed scope.
- Notion Markdown export 00–07 + parent потреблён; матрица Notion→Origin; Q Place+Q Card page отсутствует в папке.
- TaskService Proposed (displayPriority ≠ originalSeverity ≠ gates); PR-T0 = отдельный ADR-0041.
- Независимые ревью Architecture/FinSec/Privacy APPROVE (на tip до delta).

5) Что сознательно НЕ сделано
- Не прочитаны страницы Notion (недоступны) — требования со страниц не выдуманы.
- Нет runtime / migrations / merge.
- Нет Accept Amendment A / ADR-0040.
- Нет OFFICE1.1 runtime и Backoffice implementation.
- Floor/Table, payroll, fiscal provider, biometrics, full Accounting не входят в первый Manager vertical.

6) Решения
- Accepted (не менялись): ADR-0008/0010/0014/0015/0022/0036/0039 (docs), FISC1.1 на main, и др. на baseline.
- Proposed (нужно решение PO): TaskService ADR (C-BO-02); Notion handoff Accept после export (C-BO-01); OPEN issues PR #82 (C-BO-03); ApprovalRequest vs Task subtype (C-BO-04).
- Scaffolding: нет.

7) Проверки
- Тесты: не запускались (docs-only).
- Spot-check кода: нет TaskService/dispatcher в репозитории; routes = identity/cash/payments/pos/goods-receipts/guest-menu/health; web = cashier + guest.
- Независимые ревью (отдельные контексты): Architecture APPROVE; Financial Security APPROVE; Privacy APPROVE.
- Что не проверялось: содержимое Notion child pages; export archive (отсутствует).

8) Риски и вопросы к Product Owner
- БЛОКЕР: предоставить export архива handoff 13.10.2026 (или доступ Notion) для полной матрицы требований.
- Приоритет: закрыть PR #82 OPEN issues vs стартовать TaskService ADR draft?
- Подтвердить запрет понижения display priority ниже priorityFloor / обхода финансовых гейтов.
- Пустой LE/Outlet scope = fail-closed (R82-3) — подтвердить для Task scopes.

9) Рекомендация агента-исполнителя
- Не merge Gate 0 и не runtime до G0-NOTION + G0-PO.
- Следующий шаг после export: addendum-матрица Notion→Origin; затем PR-T0 TaskService ADR (Level C docs) по решению PO.
- PR #82 не Accept/merge из Gate 0.

10) Просьба к ChatGPT-ревьюеру
Ответь структурировано:
A. Вердикт: APPROVE / APPROVE WITH CHANGES / BLOCK
B. Почему (2–5 пунктов)
C. Обязательные правки до merge docs (если есть)
D. Можно ли мерджить Gate 0 docs отдельно от Notion matrix addendum
E. Что должно войти в следующее ТЗ / следующий блок (export? Task ADR? OFFICE1.1?)
=== КОНЕЦ ПАКЕТА ===
```
