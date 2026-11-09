# V02 — Полный проход, outbox и UI обновления (evidence)

Дата: 09.11.2026. Ветка `feature/V02-reconciliation` (от main fd96cf7).
Коммит: `feat: synchronize complete incoming runs without write operations`.

## Deliverables

- `backend/migrations/versions/0012_vetis_operations.py` — расширение семейства журналов
  DATA-05 (head был `0011_examination_tombstones`; нумерация брифа `0007` устарела): 
  `vetis_bindings` (площадка↔ХС/контур, read-инициатор-имя, `revoked_at`, checkpoint
  `last_success`), `vetis_operations` (kind SYNC/RECEIPT, состояния PENDING/RUNNING/SUCCESS/
  FAILED/CONFIRMED/REJECTED, `party_id` nullable для ТЗ-11, problem_code/detail, trace_id,
  pages_done/imported), `vetis_source_documents` (raw XML по внешнему UUID: checksum,
  revision, updated_at). Дублирования DATA-05 нет: `technical_events`/`outbox` не тронуты.
- `backend/src/modules/integrations/vetis/models.py` — ORM-зеркала трёх таблиц.
- `backend/src/modules/integrations/vetis/sync.py` — атомарный intent+outbox
  (`start_sync`, идемпотент: перекрывающийся PENDING/RUNNING переиспользуется), полный
  проход страниц (`run_sync`) с re-check read identity/scope из SQL перед КАЖДЫМ SOAP,
  постраничные коммиты, checkpoint (`last_success` на binding+operation) ТОЛЬКО после
  успешного полного прохода; import через существующий A01 `upsert_incoming` (нет party при
  `productType!=1` — фильтр V01; импорт не стирает local facts, отсутствие строки не
  аннулирует документ); raw XML + checksum/revision/updated_at в `vetis_source_documents`;
  write-port — честный seam для W01: пока `VETIS_WRITE_ENABLED=false`, worker его не
  вызывает; 15-минутный scheduler (`schedule_scheduled_syncs`) с защитой от перекрытия;
  dispatcher (`recover_pending_operations`) — восстановление PENDING и stale-RUNNING из SQL.
- `backend/src/modules/integrations/vetis/dispatcher.py`, `worker.py` — composition:
  lease worker (outbox `SKIP LOCKED` + lease 10 мин), `run_sync(operation_id: UUID) -> None`,
  compose read-адаптера из закреплённого manifest (PENDING-pins → честный 503
  INTEGRATION_NOT_CONFIGURED внутри операции, checkpoint не двигается), arq WorkerSettings
  (тот же backend image, Redis).
- `backend/src/modules/arrivals/router.py` — POST /arrivals/sync → **202 SyncRun**
  `{operation_id,state,status_url}`; VET/HEAD (матрица `vetis:sync`); без binding → 422
  `INTEGRATION_SCOPE_MISSING` до записи intent. API readiness не зависит от ВетИС.
- `backend/src/modules/catalog_pricing/router.py` — GET /operations/:id разрешает и
  `vetis.sync` (CommandState, scope-проверка arrivals:list) — по прецеденту
  examination_deletion.
- `backend/src/infrastructure/config/settings.py` — `vetis_write_enabled: bool = False` (seam
  W01).
- `backend/src/modules/integrations/vetis/{contracts,normalizer,adapter}.py` —
  `IncomingPage.raw_documents` + `extract_raw_documents` (raw vetDocument XML остаётся
  внутри пакета vetis).
- `backend/tests/vetis/test_sync.py` — 8 тестов (5 именованных + 3 seam); API-тест 202/422/403
  + GET operations в `backend/tests/arrivals/test_api.py`; conftest — truncate новых таблиц.
- Frontend: `features/arrivals/api.ts` — `syncArrivals`/`fetchOperationState` (202 SyncRun,
  polling GET /operations/:id); `pages/ArrivalsPage.tsx` — кнопка «Обновить» активна только
  VET/HEAD, polling, честные статусы («Обновление выполняется…» / «Поступления обновлены из
  ВетИС.» / «Обновление не выполнено…»), source `name` показывается как получено из ВетИС;
  MSW-тесты ArrivalsPage (VET-успех, ANALYST-disabled, FAILED-честность); e2e
  `frontend/tests/e2e/vetis-read.spec.ts` (3 сценария); `arrivals.spec.ts` обновлён (реальный
  экран A02 вместо устаревшего плейсхолдера «Задача A02.» — падение воспроизводилось на базе).
- `docker-compose.dev.yml` — сервис `vetis-worker` (arq, Redis, тот же backend image).
- `CURRENT_SCHEMA_REVISION` = `0012_vetis_operations` (identity/router.py, guard-тест).

## TDD evidence

- RED: первый прогон `uv run --frozen pytest backend/tests/vetis/test_sync.py -v` →
  **ImportError: cannot import name 'sync'** (модуль не существовал). Промежуточные прогоны
  во время реализации фиксировали честные отказы (AttributeError write_structured_audit,
  MissingGreenlet, 422 REVOKED) до зелёного.
- GREEN: `backend/tests/vetis backend/tests/arrivals` → **77 passed**; финальный vetis-набор —
  **28 passed** (8 исходных + lease-worker/dispatcher/composition seam).
- Контракт (именованные тесты):
  - `test_final_page_failure_no_checkpoint` — сбой на последней странице: op FAILED
    (`VETIS_TRANSPORT_ERROR`), `last_success` binding остался прежним (PAST), страница 1
    импортирована честно (1 party), страница 2 — нет;
  - `test_repeat_job_no_duplicates` — повторный полный проход: 2 parties/2 documents, raw XML
    2 строк (checksum 64, revision≥1), пропавшая строка не аннулируется;
  - `test_revocation_before_next_page` — отзыв binding после страницы 1: следующая SOAP не
    вызывается (adapter calls==1), op FAILED `INTEGRATION_SCOPE_REVOKED`, partial pass, без
    checkpoint;
  - `test_empty_vs_error` — HTTP 502 → FAILED, `last_success` не двигается (не «успех с 0
    записями»); действительно пустая полная страница → SUCCESS, checkpoint двигается;
  - `test_no_write_on_read_stage` — `vetis_write_enabled is False`, spy write-port never
    called, SpyTransport write_calls==0, product_service_calls==0, run SUCCESS;
  - seam-тесты: atomic/idempotent intent+outbox (1 outbox row на op), 15-мин scheduler
    (overlap protection + интервал), dispatcher восстановление после рестарта (потерянный
    outbox row + stale RUNNING lease → PENDING + новый outbox row).

## Live leg — not-run по причине

Выданный тестовый комплект ВУ отсутствует (`VETIS_SECRET_PROFILE` не существует; V01
дополнительно доказал 401 от шлюза). Живой read-only полный проход и повтор — not-run;
поведение доказано контрактно на обезличенных fixture (spy/транспорт, без сети). Никаких
write credentials не существует; `ProcessIncomingConsignment` deny-list V01 не изменён.
API readiness не зависит от ВетИС: POST /arrivals/sync отвечает 202 без ВетИС; незакреплённая
схема честно валит саму операцию (FAILED, checkpoint прежний), не readiness.

SC-001/FT-ARR-01 по-прежнему НЕ полный маршрут: создание ВСЭ остаётся заблокированным до
verified receipt (W01–W03).

## Quality gates (exit 0 на закоммиченном дереве)

| Gate | Результат |
| --- | --- |
| `ruff check backend` | All checks passed |
| `ruff format --check backend` | все файлы, кроме 2 pre-existing (`core/durability.py`, `tests/operations/test_durability_recovery.py` — воспроизводятся на базе; вне области) |
| `mypy backend/src` | Success (96 files) |
| `pytest backend/tests --cov=backend/src --cov-fail-under=85` | 505 passed, 2 failed (pre-existing `examinations/test_delete.py`, подтверждены на чистом base-дереве), total **92.79%** |
| vetis coverage | sync 90%, models/contracts 100%, transport 97%, adapter 93%, normalizer 89%, manifest 88%; worker/dispatcher покрыты seam-тестами (`test_worker_claims_and_runs_due_lease`, `test_dispatcher_module_restores_through_composition`, `test_composed_adapter_refuses_live_calls_without_pins`) |
| frontend lint / format:check / typecheck / test / build / build-storybook | все exit 0; vitest **178 passed (42 files)** |
| e2e `npx playwright test vetis-read arrivals` | **5 passed** |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` | OK (с SECRET_KEY/REPORT_PREVIEW_KEYS в env) |
| UTF-8/bytes | BOM снят после случайного PowerShell-rewrite; кириллица — валидный UTF-8 (проверено байтами); `except`-кортежей в изменённых файлах нет |

## Concerns

1. Живая нога not-run (нет выданного комплекта) — по-прежнему главный риск этапа; PINNED
   перевода не было.
2. 2 pre-existing падения `backend/tests/examinations/test_delete.py` (409 vs 204, race/timing)
   — воспроизводятся на чистом base-дереве, вне области V02.
3. e2e `arrivals.spec.ts` имел pre-existing падение (устаревший плейсхолдер «Задача A02.»
   после приземления реального A02) — исправлен в рамках обновления этого же файла: экран
   сверки мокается на уровне single read.
4. arq-воркер для compose — command-based (`python -m arq --redis-url …`); arq-путь в
   юнит-тестах не прогоняется (Redis не в тестовом контуре), но `run_sync`/scheduler/dispatcher
   протестированы напрямую; `docker compose config` проверен.
