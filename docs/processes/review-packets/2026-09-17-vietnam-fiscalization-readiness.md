=== ПАКЕТ ДЛЯ CHATGPT (безопасный handoff) ===
Проект: MillQ
Роль получателя: стратегический ревьюер / помощник Product Owner
Задача: оценить блок перед merge и сказать: approve / правки / блокеры

1) Цель блока
- P0 Vietnam Fiscalization Readiness Review: research + architecture only.
- Ответить: достаточно ли Accepted ADR-0014 для VN e-invoice 2026, или нужны ADR delta / Tax ADR / legal unknown.
- Без runtime, без tax engine, без выбора провайдера, без payment adapter.

2) Ссылки
- Branch: feature/vietnam-fiscalization-readiness-2026
- Base: main @ 1390758879e3764557c0b6930fe640b00547b749 (Origin == GitHub verified)
- PR: (создаётся после commit)
- Checkpoint: docs/processes/current-state.md
- Docs:
  - docs/research/vietnam-fiscalization-readiness-2026.md
  - docs/research/vietnam-fiscalization-gap-matrix-2026.md
  - docs/research/vietnam-fiscalization-ux-scenarios-2026.md
  - docs/research/vietnam-fiscalization-open-questions-2026.md

3) Контекст продукта (кратко)
- C1.1 / S1.1 / PAY1.1 CLOSED. Acquiring Profile CLOSED. Payment provider NOT SELECTED.
- FiscalCheckoutGate production = UNAVAILABLE fail-closed.
- ADR-0014 Accepted (граница Fiscalization). Tax/VAT в runtime нет; settlement tax ABSENT.

4) Что сделано в этом блоке
- Проверен baseline 1390758…
- Исследован режим 2026: Luật 108/2025, Nghị định 254/2026 (hiệu lực 01/07/2026), Thông tư 91/2026 (firm alerts).
- Corporate restaurant → hóa đơn điện tử khởi tạo từ máy tính tiền (Đ.6), если уже có mã/không mã — не обязаны переключаться.
- Вердикт: NEEDS_TAX_ARCHITECTURE (primary). ADR-0014 граница в целом ок; secondary ADR_DELTA + LEGAL_UNKNOWN.
- Gap matrix / UX / open questions / current-state checkpoint.

5) Что сознательно НЕ сделано
- FISC1.1 runtime, migrations, provider adapter, VAT engine, credentials, payment adapter, refunds UI.

6) Решения
- Accepted (не менялись): ADR-0014, 0012, 0016, 0025, 0028, 0030, 0032.
- Proposed (нужно решение PO): запуск Level C Tax/VAT Architecture ADR перед FISC1.1.
- Scaffolding: нет.

7) Проверки
- Тесты: N/A (docs only).
- Independent review: APPROVE WITH CHANGES → правки Art.10 evidence label + UX timing soft; затем merge-ready.
- Что не проверялось: полный PDF Circular 91 counsel review; provider certification.

8) Риски и вопросы к Product Owner
- Primary blocker: нет Tax snapshot (ex-VAT / rate / VAT / inc-VAT) для doanh nghiệp khấu trừ.
- Secondary: offline windows, dine-in timing edges, Circular 91 correction path — LEGAL_UNKNOWN parallel.
- Не путать household 1B VND с corporate restaurant rules.

9) Рекомендация агента-исполнителя
- Merge research docs checkpoint.
- Следующий блок: Level C Tax/VAT Architecture ADR (не FISC1.1).
- Payment adapter по-прежнему ждать sales/legal.

10) Просьба к ChatGPT-ревьюеру
Ответь структурировано:
A. Вердикт: APPROVE / APPROVE WITH CHANGES / BLOCK
B. Почему (2–5 пунктов)
C. Обязательные правки до merge (если есть)
D. Можно ли мерджить research docs отдельно от кода (да — этот блок)
E. Что должно войти в следующее ТЗ: Tax/VAT Architecture ADR (Level C)

FINAL VERDICT (архитектура): NEEDS_TAX_ARCHITECTURE
=== КОНЕЦ ПАКЕТА ===
