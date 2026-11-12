# DR12 — «В работе» только после гашения (queue semantics) — evidence

Ветка: `feature/DR12-queue-work-receipt` (от `main`).

## Решение владельца (2026-11-12, binding)

«В работе» = только ВСД, погашенные через систему (существует локальный
`ReceiptConfirmation`). Начатая/сохранённая OPEN-сверка НЕ переводит документ
в WORK — сверка продолжается из EXPECTED.

## Изменения

- `backend/src/modules/arrivals/queries.py::_queue_condition`:
  - EXPECTED: `~conf & source_presence == "CURRENT_CONFIRMED"` (начатая сверка больше не исключает);
  - WORK: `conf & ~(accepted & exam_done)` — `rec` убран из условия;
  - ACCEPTED: без изменений (`accepted & exam_done`);
  - комментарий DR9 §6 обновлён ссылкой на решение владельца 2026-11-12.
- `backend/src/modules/arrivals/queries.py::queue_of`: метка партии приведена к той же семантике
  (`has_reconciliation` больше не влияет на метку).
- `backend/tests/arrivals/test_dr9_presence.py`:
  - `test_expected_excludes_stale_and_open_reconciliation_stays_expected` — OPEN-сверка держит
    свежий документ в EXPECTED, WORK=0; устаревший документ исключён из обеих очередей;
  - `test_receipt_confirmation_moves_to_work` — до гашения WORK=0; после `ReceiptConfirmation` →
    WORK, метка `queue_of` согласована.
- Frontend: без изменений логики. Действие строки «Перейти к сверке данных» в EXPECTED
  безусловное — продолжение OPEN-сверки из EXPECTED доступно. Счётчики StageTabs API-driven.

## Гейты

- `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis` — 216 passed.
- `backend/tests/examinations`: 2 failure (`test_delete.py::test_concurrent_delete_and_disposal_preserve_the_disposal_fact`,
  `::test_delete_http_204_and_unknown_202`) — предсуществующие на `main` (проверено ручным прогоном без изменений
  DR12), не связаны с очередями (валидация даты утилизации).
- Frontend: `format:check`, `typecheck` (0), `lint` (0 errors, 1 предсуществующее предупреждение в
  `use-catalog-context.ts`), `test -- --run` (0), `build` (0), `build-storybook` (0). Node v26.13.0.

## Живая проверка (read-only, dev DB, транзакция READ ONLY)

Лаборатория `2812e437-facc-432f-9242-5162c9d9f49f`:

- EXPECTED=3, WORK=0, ACCEPTED=0.
- Обе OPEN-сверки (`a560d943-…`, `6c9b4349-…`) → EXPECTED. Гашения нет — WORK пуст.
- Третье поступление `0c436119-…` (CURRENT_CONFIRMED, OPEN-сверка, без гашения) также корректно
  в EXPECTED; прогноз «EXPECTED=2» в задании устарел (появилось новое поступление).
- Устаревший документ (`NOT_IN_CURRENT_CONFIRMED_LIST`) исключён из очередей.

Docker-контейнеры не пересобирались; `VETIS_WRITE_ENABLED` и `.env*`/compose/vetis-schema не менялись.
