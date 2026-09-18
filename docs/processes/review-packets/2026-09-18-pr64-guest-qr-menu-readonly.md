=== ПАКЕТ ДЛЯ CHATGPT (безопасный handoff) ===

Проект: MillQ / KiU
Тема: Guest QR Menu — read-only MVP (Level B)
Origin PR: https://cursor.com/codebase/millqdev/MillQ/pull/64
Ветка: feature/guest-qr-menu-readonly @ 6b45854
База: Origin main = GitHub main = fa107d1 (EQUALITY_OK)
Автономия: Level B — НЕ мержить до независимого APPROVE

## Цель
Минимально платное электронное меню гостя по QR, поверх уже существующего MenuResolver.
Не второй Menu source-of-truth.

## Пайплайн
MenuDefinition → immutable MenuPublication → MenuResolver → GuestMenuProjection → PublicMenuLink → /m/{token} UI

## Что сделано
1. Миграция 022: outlet_capability_config, presentation_media_asset, catalog_item_presentation, public_menu_link
2. Модуль apps/api/src/modules/guest-menu/ (PublicMenuLinkService + GuestMenuProjectionService)
3. Публичный API GET /api/v1/public/guest-menu/:opaqueToken?lang=
4. Operator API: create/revoke/rotate link + set capability guest_menu.qr
5. Guest mobile UI /m/{token} (VI/EN/RU switch, photos, price, availability)
6. Acceptance A–F + non-regression Menu/POS/Golden/commercial

## Ключевые решения
- SalesContext: orderChannel DIRECT (новый GUEST_QR канал НЕ вводился)
- Capability: только guest_menu.qr через outlet_capability_config (без package forks)
- Media: минимальный PresentationMediaAsset (в репо не было готовой абстракции)
- Localization: catalog_item_presentation locale + fallback RU→EN→canonical name
- AllergenResolver отсутствует в runtime → allergen поля не выдумываем
- Table: table_ref soft string, optional; Floor FK нет
- Token: opaque, token_hash=sha256 at rest, revoke/rotate
- publicItemRef = sha256(tenant:catalogItemId)[:16] — без UUID в ответе

## Публичный DTO (упрощённо)
GuestMenuDto: language, outlet.name, brand.name, tableRef?, menuPublicationVersion, categories[], items[]
Item: publicItemRef, name, description, imageUrl, availability, price{status,amountMinor,currency,exponent}
НЕ отдаём: COGS, recipe, supplier, employee, tenant/outlet UUID, margin

## Тесты
- Guest A–F: 7 PASS
- Menu: 19 PASS
- POS: 5 PASS
- Golden Restaurant: 17 PASS
- Commercial snapshot + C1.1: 20 PASS
- typecheck api+web: PASS

## Подтверждения
- нет второго Menu truth
- GET меню → ZERO Orders / Payments / Fiscal
- нет Tax/Fiscal/COGS изменений
- Golden остаётся green

## Риски / follow-up
- PackageEntitlement runtime ещё нет — только OutletCapabilityConfig
- AllergenResolver deferred
- Кэш in-memory TTL 15s (не distributed)
- Self-order / cart сознательно НЕ строились
- QR bitmap не хранится (SoT = public URL/token)

Просьба: стратегический/архитектурный review; merge только после независимого APPROVE.

=== КОНЕЦ ПАКЕТА ===
