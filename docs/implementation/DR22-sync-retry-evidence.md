# DR22 — Доказательства: ручное обновление поступлений с повторами внутри одной операции

Дата: 13.11.2026 · Ветка: `feature/DR22-sync-retry` · ТЗ: `dorabotka/2026-11-13-vetis-manual-refresh-retry.md` (§1–10), решения R-DR22-1..6.

## Причина (§1, подтверждена кодом)

`sync.run_sync` отвечал на ЛЮБУЮ ошибку `adapter.list_incoming` немедленным
`_fail_operation` (`VETIS_SYNC_FAILED`), а `run_claimed` помечал outbox-row
`delivered`. Первая временная ошибка чтения делала операцию окончательно
FAILED, outbox закрывался — пользователю требовалось второе нажатие.

## Что изменено

- `backend/src/modules/integrations/vetis/sync.py`:
  - §5.1 классификация `_classify_failure`: повторяемые — timeout/connect,
    HTTP 5xx (502/503/504), временный SOAP gateway fault, временный
    malformed/incomplete result (в т.ч. `VETIS_CURSOR_CONTRACT_VIOLATED`);
    неповторяемые — `INTEGRATION_NOT_CONFIGURED`, `INTEGRATION_SCOPE_MISSING/REVOKED`,
    `INTEGRATION_INITIATOR_MISSING`, schema pin (`INTEGRATION_SCHEMA_PIN_MISMATCH`,
    `INTEGRATION_SCHEMA_IMPORT_REJECTED`), manifest/credentials, постоянная auth
    (HTTP 401/403 → `VETIS_AUTH_ERROR`), локальный `VETIS_IMPORT_FAILED`,
    `VALIDATION_ERROR` и любой 4xx. Исходный problem code сохраняется; в
    diagnostics — только тип исключения/HTTP-статус, без credentials/raw SOAP.
  - §5.2 `_schedule_retry`: повторяемая ошибка НЕ фейлит операцию — она
    возвращается в `PENDING` с номером попытки (`poll_attempts`), исходным
    problem code/detail и `next_poll_at`; outbox-lease освобождается,
    `next_attempt_at` = теперь + backoff (2/5/10/30/60 с, ограничено);
    максимум 6 попыток (`MAX_SYNC_ATTEMPTS`), исчерпание → FAILED с исходной
    причиной. `operation_id` и idempotency intent неизменны; SUCCESS очищает
    транзиентный problem code. Восстановление после рестарта:
    `recover_pending_operations` (dispatcher) уже восстанавливает PENDING/stale
    RUNNING; новая outbox-row создаётся с `next_attempt_at = next_poll_at`,
    счётчик попыток сохраняется.
  - §5.3 overlap: `_overlapping_operation` (PENDING/RUNNING — retry-wait это
    PENDING) возвращает существующую операцию; новая operation/outbox row не
    создаются; lease/SKIP LOCKED исключает две одновременные попытки.
  - §6 порядок сохранён: полный проход всех страниц → импорт → freshness
    (DR9) → операция SUCCESS → commit; SUCCESS виден через GET только после
    одного коммита (binding.last_success == operation.last_success).
- `frontend/src/pages/ArrivalsPage.tsx` (§7):
  - retry-wait (PENDING + problem при активной операции) → busy
    «Повторяем обновление…», без финальной ошибки, кнопка заблокирована;
  - PENDING/RUNNING → «Обновление…»; SUCCESS → refetch таблицы и трёх
    счётчиков (`refetch({ cancelRefetch: true })` — защита от stale-ответа,
    ожидание актуального запроса) + итоги sync; окончательный FAILED →
    понятная причина (карта кодов) и ручной повтор доступен;
    NOT_CONFIGURED/scope/auth → действие администратора, без автоповтора;
  - безопасные counters: страницы, получено, импортировано, исключено,
    попытка; без секретов/raw SOAP.

## Миграция

НЕ требуется: retry-состояние переиспользует существующие колонки
`vetis_operations.poll_attempts` (для SYNC ранее не использовались) и
`next_poll_at`, а расписание повтора живёт в outbox `next_attempt_at`.

## Тесты

- Новые: `backend/tests/vetis/test_sync_retry.py` — 16 тестов, покрытие всех
  10 backend-пунктов §8 (транспорт-спы, живой ВетИС не вызывается,
  `ProcessIncomingConsignment` не вызывается — `SpyTransport.write_calls == 0`,
  write-port spy).
- Обновлены под новый контракт: `test_sync.py` (3 теста — exhaustion вместо
  немедленного FAILED), `test_presence_sync.py` (3 места), фиксрура `sync_env`
  перенесена в `backend/tests/vetis/conftest.py` (переиспользование без
  shadow-импорта), `test_sync_all_pages.py` (импорт).
- Frontend: +5 сценариев в `ArrivalsPage.test.tsx` (§8: один POST, polling
  той же операции, retry-wait, refetch после SUCCESS с новой партией,
  финальный FAILED с ручным повтором, empty/keyboard). Реальные ширины
  1440/1024/768/390 — только реальный браузер (playwright e2e, здесь не
  запускался — jsdom, честно disclosed).

## Результаты гейтов (на закоммиченном дереве)

- `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis -q` —
  319 passed.
- `backend/tests/examinations/test_delete.py` — 2 pre-existing failures
  (не связаны с DR22, существуют на main).
- `npm.cmd run format:check` / `typecheck` / `lint` (0 errors; 1 pre-existing
  warning в `use-catalog-context.ts`, есть на main) / `test -- --run`
  (348 passed) / `build` / `build-storybook` — успешно.

## Честно не выполнено

- Playwright e2e (`frontend/tests/e2e/vetis-read.spec.ts` и реальные ширины)
  не запускались: требуют поднятых контейнеров/реального браузера — вне
  локального гейта (контроллер пересобирает Docker).
- Живой ВетИС (PILOT) не вызывался — запрещено ТЗ; read retry проверен
  спаями на закреплённых fixture.
- Docker rebuild и merge в main — контроллер (не задача субагента).
