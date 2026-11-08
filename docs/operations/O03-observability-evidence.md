# O03 — evidence: наблюдаемость, нагрузка и выпуск локального контура

Дата: 08.11.2026. Пользовательские среды и тома не использовались; нагрузка —
только против одноразовых контейнеров с `--rm`.

## Автоматические проверки (RED → GREEN)

RED-запуск до реализации (модули `core/audit` отсутствовали):

- `uv run --frozen pytest backend/tests/operations/test_redaction.py -v`
  → `ImportError: cannot import name 'audit' from 'backend.src.core'`
  (затем 5 failed, 4 passed по мере появления файлов; полный RED
  зафиксирован в журнале сессии).

GREEN после реализации:

- `uv run --frozen pytest backend/tests/operations -v`
  → 9 новых тестов `test_redaction.py` passed; 54 passed / 1 failed —
  см. «Известный pre-existing flake» ниже;
- `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85`
  → 473 passed / 1 failed (тот же flake), TOTAL coverage 93.44% (порог 85%);
- `uv run --frozen ruff check <новые файлы>` → All checks passed;
- `uv run --frozen ruff format --check <новые файлы>` → 4 files already formatted;
- `uv run --frozen mypy backend/src/core/audit.py backend/src/core/metrics.py`
  → Success: no issues found in 2 source files;
- кириллица проверена побайтно после `ruff format`
  (utf-8 чтение находит русские литералы в файлах).

## Именованные утверждения (все в test_redaction.py)

- **Log redaction**: password/cookie/apiKey/medical payload реально отсутствуют
  в записях лога (`redact_text`/`redact_dict`), структурный аудит несёт только
  разрешённые поля; секреты заменяются маркером, не удаляются ключи.
- **Retention**: 90d technical / 365d security / 30d diagnostic SOAP
  (`retention_plan`); бизнес-факты (подтверждения/UNKNOWN/пробы/утилизации/
  snapshots и др.) в `NEVER_PURGED_TABLES`, `assert_purgable` отклоняет их
  очистку.
- **Snapshot key rotation**: 90d / old 9h — константы и поведение существующего
  `core/keyring.py` подтверждены тестом (old key verify 8h ok, 10h None,
  подпись после 90d → ошибка ротации).
- **Alerts**: UNKNOWN>0; age>15min high; backup>26h; WAL lag>10min; outbox>5min;
  disk<20% — `evaluate_alerts` + `ALERT_THRESHOLDS`.
- **Load assertions**: FULL_PROFILE соответствует Global Constraints
  (30min/80/20/100 concurrent/100 labs/500 users/5000 arrivals-day/100k
  sources/8vCPU-32GiB-500GiB SSD; p95 2с/3с; ошибки<1%; расчёт≤60с);
  100k payload ≤32MiB — измерено: 7 233 032 B ≤ 33 554 432 B (<60 с).
- **Атомарность аудита**: `write_structured_audit` только добавляет строку в
  открытую транзакцию команды (fake session: added=да, commits=0).
- **SOAP диагностика**: маскированные значения/credentials, чтение только
  `vse_service`, срок 30d.

## Реальный короткий нагрузочный прогон (изолированный стек)

Одноразовые контейнеры (`docker run --rm`): `postgres:18.6` на
127.0.0.1:5499 (vse-load-pg) и `redis:8.10.3-alpine3.23` на 127.0.0.1:6399
(vse-load-redis). Команда:

```
uv run python tests/load/local-scenarios.py --short \
  --database-url postgresql+asyncpg://postgres:postgres@127.0.0.1:5499/vse \
  --redis-url redis://127.0.0.1:6399/0 --duration 120 \
  --json-out tmp/o03-load-short.json
```

Сценарий: `alembic upgrade head` → засев (2 лаборатории, VET+scope, 150
партий + 1 чужая, политики casbin) → uvicorn 127.0.0.1:8321 → логин по HTTP
(csrf+login) → preflight корректности и утечки объёма → 120 с смеси 80/20,
8 одновременных.

Preflight (все passed):

- список прибытий: total = 150 = засеянному;
- чужая лаборатория → 403; чужая партия → 403/404;
- отключённый ВетИС sync → 503 `INTEGRATION_NOT_CONFIGURED`;
- бюджет payload: 100000 источников = 7 233 032 B ≤ 32 MiB.

Измерения (120 с, 4272 запросов, ошибок 0, наруше­ний ограничений нет):

| Операция | count | p50 | p95 | max | ошибки |
| --- | --- | --- | --- | --- | --- |
| read_detail (GET reconciliation) | 1140 | 0.111 с | 0.143 с | 0.219 с | 0 |
| read_me | 1139 | 0.106 с | 0.138 с | 0.240 с | 0 |
| read_page (GET arrivals) | 1139 | 0.413 с | 0.499 с | 0.596 с | 0 |
| write_save (PUT reconciliation) | 854 | 0.256 с | 0.362 с | 0.649 с | 0 |

Пороги: p95 чтения ≤2 с, p95 сохранения ≤3 с, ошибки <1% — выполнено с
большим запасом. Конфликт ревизии (409 REVISION_CONFLICT) при параллельной
записи обрабатывается повторным чтением ETag и одной повторной попыткой.

Контейнеры остановлены (`docker stop`), одноразовые тома удалены автоматически
(`--rm`). Полный JSON: `tmp/o03-load-short.json` (tmp вне Git по правилам).

## Честный not-run

- **Полный 30-минутный профиль** (30min/100 concurrent/100 labs/500 users/
  5000 arrivals-day/100k sources на выделенном хосте 8vCPU/32GiB/500GiB SSD) —
  **не выполнялся**; он документирован в `capacity.md` (planned-not-run) и не
  заменяется коротким прогоном. Короткий прогон объявляет только свои числа.
- **Официальная готовность** (INPUT-02–05 реальные данные владельца, backup на
  фактическом хосте) — not-run; см. `local-release-checklist.md`:
  fixture-данные не объявляются real ВетИС, release локальных модулей
  write/read=false, SC/AT external остаются not-run до V01/V02.
- Metrics HTTP-endpoint на стенде — not-run (выполняется при установке
  после V01); сборка метрик/условий алертов покрыта тестами.
- Browser e2e фронтенда в O03 не изменялся и не запускался — frontend не
  тронут (нет правок `frontend/`, старого каталога и stories).

## Известный pre-existing flake (не от O03)

`test_configuration.py::test_migration_lock_blocks_when_holder_lives`
нестабилен вне O03: в 4 локальных прогонах 2 passed / 2 failed. Гонка в самом
тесте: обе стороны стартуют одновременно, и вторая может первой подключиться к
advisory lock (тогда она владеет замком, спокойно держит его 6 с и выходит с
кодом 0). Файлы O03 (`core/audit.py`, `core/metrics.py`, `test_redaction.py`,
`tests/load/`) `deploy/migrate_lock.py` не импортируют и на этот тест не
влияют. Тест не исправлялся (не мой объём), зафиксировано для контроллера.

## Fix round 1 — реальный исполнитель retention (ревью, Important)

Адресовано: сроки 90/365/30d были константами без исполнителя.

Изменения (`backend/src/core/audit.py`):

- `SoapDiagnostics.record(..., at=...)` хранит wall-clock время каждой строки;
  `expired(now)` теперь реально вычисляет просроченные trace_id (>30d), а
  `purge_expired(now)` удаляет их и возвращает счётчик;
- новый исполнитель `apply_retention(session, *, now, soap=None,
  stores=PURGABLE_STORES)`: применяет отсечки `retention_plan` к
  `technical_events` (без префикса `SECURITY.`), `security_events` (те же
  строки с префиксом `SECURITY.`) и `soap_diagnostics`; бизнес-таблицы
  отклоняются `assert_purgable`; возвращает счётчики по хранилищам; сам не
  коммитит (транзакция у вызывающего);
- одноразовая команда обслуживания `python -m backend.src.core.audit`
  (`run_retention_command` + `main`): применяет план и коммитит один раз,
  печатает JSON со счётчиками, отказ — exit 1 и stderr;
- тест `test_purge_executor_applies_cutoffs_and_leaves_business_facts`
  (реальный PostgreSQL): смешанные возрасты в каждом хранилище → удалены
  только просроченные, счётчики {technical:1, security:1, soap:1}, свежие
  строки живы, засеянный бизнес-факт (users) нетронут, запрос бизнес-таблицы
  как store → ValueError;
- расширен `test_masked_soap_diagnostics_service_account_only`: expiry по
  wall-clock времени, purge 1 из 2.

Команды и результаты:

- `uv run --frozen pytest backend/tests/operations -v` → **56 passed**
- `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85`
  → **475 passed / 0 failed**, coverage **93.16%** (flake этого прогона не
  воспроизвёл; ранее 2/4 standalone прогонов падали — гонка в самом тесте)
- `ruff check backend` → All checks passed; `mypy backend/src` → Success (89
  files); `ruff format --check` на файлах O03 → clean. ⚠️ На прекоммитном
  дереве O02 (`core/durability.py`, `test_durability_recovery.py`) `ruff
  format --check backend` просит переформатирование — pre-existing, вне
  адресованного объёма, не тронуто.
- Кириллица проверена побайтно после `ruff format` (UTF-8 intact).

Сквозная проверка одноразовой команды (disposable `postgres:18.6`, migration
head, 4 seeded technical_events 100/5/400/10 дней + JSON):

```
{"purged": {"technical_events": 1, "security_events": 1, "soap_diagnostics": 0},
 "at": "2026-11-08T17:53:30.352361+00:00"}
```

— удалены ровно просроченные (100d tech, 400d security), свежие живы.
Контейнер остановлен, одноразовые тома удалены (`--rm`).

Документы обновлены: `docs/operations/retention.md` (исполнитель, одноразовая
команда, счётчики в журнале), `docs/operations/monitoring.md` (SOAP-строки
несут wall-clock время). Minors ревью не трогались.

## Файлы задачи

- `backend/src/core/audit.py`, `backend/src/core/metrics.py`;
- `backend/tests/operations/test_redaction.py`;
- `tests/load/local-scenarios.py`;
- `docs/operations/{monitoring,capacity,retention,maintenance,local-release-checklist}.md`.
