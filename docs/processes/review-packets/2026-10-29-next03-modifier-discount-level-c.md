# Level C packet — NEXT-03 modifier contract + operator discount contract

- **Date:** 2026-10-29
- **Autonomy:** Level C (documents only)
- **Status:** PO review 2026-10-29 **APPROVE WITH CHANGES** recorded in ADR-0052 and ADR-0051. M1–M8 and D1–D6 (2026-10-28) stay accepted. `RevokeOrderMerchantDiscount` is outside v1.
- **Files:** `docs/decisions/ADR-0052-modifier-v1-contract.md`; `docs/decisions/ADR-0051-apply-order-merchant-discount-v1.md`; worksheets under `docs/processes/next01/`

No runtime, no migration, no GitHub push, and no merge-when-ready in this change.

## What Origin already had

- ADR-0049 short Accept and modifier configure runtime on `main` (migration 037, POS configure). Effective Recipe deltas are stored. `CompleteOrder` still consumes the base graph.
- ADR-0051 short Accept. No cashier discount HTTP.

## What this change asks the PO to confirm

- Modifier M1–M8 as operational rules, including per-unit price through ADR-0030 and consumption from frozen deltas.
- Discount contract: narrow `ApplyOrderMerchantDiscount`, approve-grant, 20% cap, order-level only, before payment.

=== ПАКЕТ ДЛЯ CHATGPT (безопасный handoff) ===
Проект: MillQ / KiU POS
Роль получателя: стратегический ревьюер Product Owner (не Origin APPROVE)
Задача: подтвердить или поправить два Level C контракта. Совет PO; не формальный merge gate.

1) Цель блока
- Зафиксировать узкую модель модификаторов (капучино: обязательное молоко, необязательный сироп, цена, рецепт, расход, аллергены, кухня, история).
- Зафиксировать узкую кассовую команду скидки заведения, без произвольного редактирования коммерческих условий.
- Runtime в этом блоке не начинался.

2) Ссылки
- Branch: локальные незакоммиченные документы на рабочей копии; в Origin не отправлялись
- Tip commit: не создавался
- Base: Origin main уже содержит короткий ADR-0049, миграцию 037 и кассовую настройку модификаторов; короткий ADR-0051 без HTTP скидки
- PR: ещё не создан
- Issue: нет
- Checkpoint doc: docs/processes/next01/NEXT03_STATUS.md

3) Контекст продукта (кратко)
- Меню публикует группы и опции. Заказ хранит снимок строки. Рецепты считают фактический состав. Аллергены только читают этот состав. Склад списывает один документ отпуска по замороженному плану.
- Скидка — отдельная команда. Кассир запрашивает, другой человек с правом подтверждения применяет. Потолок 20% от товарной суммы. После оплаты и завершения факты не переписываются.

4) Что сделано в этом блоке
- ADR-0052: восемь ответов помечены PROPOSED, контракт, тесты T1–T12, план PR M1–M5.
- ADR-0051: короткий Accept D1–D6 сохранён; добавлен PROPOSED-контракт API, матрица прав, тесты D1–D12, план PR D1–D5.
- Рабочие листы: docs/processes/next01/NEXT03_MODIFIER_V1_LEVEL_C_PACKET.md и NEXT03_DISCOUNT_LEVEL_C_PACKET.md.

5) Что сознательно НЕ сделано
- Нет правок CompleteOrder, миграций, кассового кода скидки, GitHub push, production migrate.

6) Решения
- Accepted ранее: ADR-0049 (коротко), ADR-0051 D1–D6 (коротко), ADR-0024, ADR-0025, ADR-0028, ADR-0029, ADR-0030, ADR-0036.
- Proposed (нужно решение PO): ADR-0052 целиком; раздел Contract в ADR-0051.
- Расхождения с уже выложенным кодом модификаторов (не чинились): надбавка прибавляется к строке один раз, а не на единицу через существующее округление; дельты рецепта не применяются при завершении заказа; текст гостя смешан с кухонными кодами; метка заморозки конфигурации не записывается.

7) Проверки
- Тесты: не запускались (только документы).
- Build/typecheck: не запускались.
- Что не проверялось: кассовый сценарий в браузере, расход ингредиентов, скидка.

8) Риски и вопросы к Product Owner
- Подтвердить M2: надбавка на каждую единицу, затем существующее округление строки.
- Подтвердить, что завершение заказа списывает замороженный фактический рецепт, одним документом, без второго списания базового рецепта.
- Подтвердить потолок скидки 20% и для владельца, только на весь заказ, с отдельным подтверждением и обязательной причиной.
- Страницы Notion, на которые ссылаются короткие ADR, из этого подключения не открылись.

9) Рекомендация агента-исполнителя
- Не мержить код по этому пакету. Сначала подтверждение PO текстов ADR-0052 и ADR-0051 §Contract.
- Уже выложенный на Origin код модификаторов не откатывать этим пакетом.

10) Просьба к ChatGPT-ревьюеру
Важно: твой вердикт — совет Product Owner. Это не формальный Origin APPROVE и не замена Depot CI / Bugbot (Level B).
Ответь структурировано:
A. Вердикт для PO: APPROVE / APPROVE WITH CHANGES / BLOCK
B. Почему (2–5 пунктов)
C. Обязательные правки до подтверждения (если есть)
D. Можно ли подтвердить контракт отдельно от уже выложенного кода модификаторов
E. Остаточные риски
=== КОНЕЦ ПАКЕТА ===
