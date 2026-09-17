# KiU POS — P0 Counter-Service Review Packet

=== ПАКЕТ ДЛЯ CHATGPT (безопасный handoff) ===

Проект: MillQ / KiU POS  
Роль получателя: независимый стратегический и архитектурный ревьюер  
Задача: оценить блок перед merge и вернуть `APPROVE` или `REQUEST CHANGES`.

## 1) Цель блока

Довести первый реальный vertical slice для Vietnamese counter-service кафе:

```text
bootstrap OPEN CashShift
→ takeaway Order DRAFT
→ products + modifiers
→ authoritative commercial pricing
→ cash checkout
→ Payment success
→ Order SUBMITTED
→ production tasks
→ receipt payload + preview
```

## 2) Ссылки

- Branch: `feature/p0-counter-service`
- Tip commit: `3ca15886f33ded958ef8966f3989cf5e43425c50`
- Short commit: `3ca1588`
- Base: Origin `main` at `c94afe0`
- Origin branch: `feature/p0-counter-service`
- GitHub backup branch: `feature/p0-counter-service`
- PR: ещё не создан
- Checkpoint: `docs/processes/current-state.md`
- Product brief: `docs/product/p0-counter-service-cash-checkout.md`
- ADR: `docs/decisions/ADR-0033-counter-service-cash-checkout-slice.md`

## 3) Контекст продукта

KiU — реальный POS для F&B. Первый пилот — кафе без столов, Vietnamese-first,
с поддержкой RU/EN/VI. Критерий качества: operational correctness, скорость,
ясность и устойчивость к ошибкам важнее декоративности.

## 4) Что сделано

- Добавлен реальный `CashShift` через development bootstrap fixture.
- Добавлены минимальные modifiers: required/optional, min/max, zero-price и fixed price delta.
- Modifier selections сохраняются вместе с `OrderLine`.
- Fixed modifier delta участвует в backend authoritative commercial calculation.
- Добавлен `SUBMITTED` как post-checkout Order state; `OPEN` сохранён как техническое имя draft.
- Cash checkout использует canonical Settlement и provider-neutral Payments Core.
- Product-level `PAID` отображается через Payments Core lifecycle `SUCCEEDED`.
- Cash evidence хранится в `CashShiftTransaction`: tendered и change.
- После submit создаются idempotent production tasks для kitchen items.
- Создаётся canonical receipt payload и UI preview; физический принтер не имитируется.
- В `apps/web` добавлены modifier drawer, cash payment panel, receipt preview и KiU touch tokens.
- Settlement coverage reader теперь видит только активные allocations от `SUCCEEDED` payments.

## 5) Сознательно не сделано

- QR/VietQR provider и конкретный gateway.
- Fiscal/e-invoice provider и tax-law UX.
- Физический 80 mm printer adapter.
- Полноценный KDS и production state progression до `READY/COMPLETED`.
- Отдельный production UI `Open Shift / Close Shift`.
- Tables, reservations, split payment, refunds и void.
- Offline payment semantics.

## 6) Решения

### Accepted

- Первый slice — counter-service/takeaway без tables.
- Payment не делает Order `COMPLETED`.
- Kitchen tasks создаются после Order submission, не от basket tap и не напрямую от Payment.
- Fiscal не блокирует первый cash pilot.
- Receipt — payload + preview; физическая печать — future adapter.
- Origin остаётся canonical host; этот файл и branch также отправлены в GitHub как backup.

### Scaffolding

- Cash tender definition `CASH` bootstrap-ится при первом cash checkout.
- Development context остаётся bootstrap-only и не является production Identity.
- В первом slice используются synthetic-realistic fixture data.

## 7) Проверки

- Backend: `262 passed` across `20` test files.
- ADR-0033 acceptance: golden cash route, modifier pricing, underpayment, idempotency — passed.
- Web: `26 passed`.
- Monorepo `pnpm typecheck` — passed.
- Web production build — passed.
- `git diff --check` — passed.
- Dev API bootstrap and cash shift endpoint проверены вручную.

## 8) Риски и вопросы

- Нужно проверить migration path на чистой БД, где Payments Core ещё не существует в отдельной ветке.
- Нужна независимая проверка того, что текущая canonical Payments Core schema совпадает с Origin runtime contract.
- Нужен staff test на touch display 10–15" с RU/EN/VI strings.
- Нужно подтвердить продуктовую терминологию: показывать кассиру `Paid`, оставляя в backend `SUCCEEDED`.
- Визуальный live screenshot review не выполнен: доступного browser surface в рабочем окружении не было; выполнены build и component tests.

## 9) Рекомендация исполнителя

`APPROVE WITH CHANGES` для review stage: блок достаточно целостен для независимого
review и staff test, но merge должен ждать проверки migration contract и ручного
touch/localization прохода.

## 10) Просьба к ревьюеру

Ответь структурировано:

A. Вердикт: `APPROVE` / `REQUEST CHANGES`  
B. Почему — 2–5 пунктов  
C. Обязательные правки до merge  
D. Отдельно проверь Order/Payment/Production lifecycle и Settlement coverage  
E. Что должно войти в следующее ТЗ: QR, KDS, shift close, fiscal или другое

=== КОНЕЦ ПАКЕТА ===
