=== ПАКЕТ ДЛЯ CHATGPT (безопасный handoff) ===
Проект: MillQ
Роль получателя: стратегический ревьюер / помощник Product Owner
Задача: оценить ADR-0026 (architecture-only Level C) перед merge

1) Цель блока
- ADR-0026 Actual COGS & Food Cost Reporting Semantics
- Autonomy: **Level C** architecture-only
- PO LAUNCH binding decisions already recorded in ADR

2) Ссылки
- Branch: `cursor/adr-0026-actual-cogs-food-cost-9abc`
- Base: `main` @ `b2174ee56a7417b4a4db516ae3ea1855ed470f0a` (D1.3B merged)
- ADR: `docs/decisions/ADR-0026-actual-cogs-food-cost-reporting.md`
- Hygiene: `docs/processes/current-state.md`, `docs/architecture/block-d1.3b-goods-issue-sale-writeoff.md`

3) Контекст
- D1.3B даёт исторический sale write-off cost
- ADR-0019: economic metrics = derived/read-side; UNKNOWN≠0; original currency
- Food Cost Ratio / Revenue Basis — ещё нет SoT

4) Что сделано
- ADR-0026 Accepted (PO binding): Actual COGS NOW; Food Cost Ratio DEFERRED
- Grain, metrics, certainty aggregation, reversals, chronology, currency, ownership, drill-down, historical stability, same-item aggregation, Theoretical vs Actual
- D1.4A scoped as next implementation; not started
- Docs: D1.3B → Merged (PR #32, SHA b2174ee, backup verified)

5) Что сознательно НЕ сделано
- Application code / migrations / schema / HTTP / UI
- D1.4A implementation
- Revenue Basis / Food Cost % / Gross Profit / FX / Theoretical Recipe Cost

6) Решения
- Accepted: ADR-0026 (this PR)
- Proposed: нет
- Contradictions: none unresolved (alignment notes in ADR §)

7) Просьба к ChatGPT-ревьюеру
A. Вердикт APPROVE / CHANGES / BLOCK
B. Корректна ли развилка Actual COGS vs Food Cost Ratio
C. Готовность ТЗ D1.4A после merge
D. Не стартовать D1.4A без явного PO launch

=== КОНЕЦ ПАКЕТА ===
