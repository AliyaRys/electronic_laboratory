# Baseline: платформа, миграции и CI (Task I01)

Дата: 2026-11-06 · Ветка: `feature/01-platform` · Форк: `4deb9c45f4298d4a84f005126f6ee8ccd823acf8`

Документ фиксирует фактически выполненные проверки первого платформенного этапа
«Электронной лаборатории ВСЭ». Статусы только `passed` / `failed` / `not-run` с
причиной; никакая проверка не объявляется пройденной без вывода команды.

## 1. Окружение (фактические версии)

| Параметр | Значение | Статус |
| --- | --- | --- |
| uv | 0.13.7 (316c827e0) | passed |
| Python | 3.15.2 (cpython, uv-managed) | passed |
| Docker Engine | 29.8.2 | passed |
| Docker Compose | 5.6.0 | passed |
| PostgreSQL (образ) | postgres:18.6 `sha256:bd5dfa494…478583` | passed |
| Redis (образ) | redis:8.10.3-alpine3.23 `sha256:71885d8cc6…1fb80` | passed |
| Node | 24.x (на машине) — frontend в I01 не собирается | not-run (по плану) |

Backend-версии закреплены в `uv.lock` и соответствуют исходным версиям форка
(`git show 4deb9c45…:uv.lock`): fastapi 0.136.1, sqlalchemy 2.0.49, alembic 1.18.4,
pydantic-settings 2.14.1, uvicorn 0.46.0, pytest 9.0.3, pytest-asyncio 1.3.0,
ruff 0.15.12.

## 2. Версии зависимостей и доказанная несовместимость

Точка старта — `uv.lock` форка. При закреплении Python 3.15.2 и добавлении
обязательных зависимостей SPEC-03 выявлена **доказанная несовместимость**,
исправленная минимальными точечными правками lock (ADR-014: не молча, с
диагностикой):

| Пакет | Было (форк) | Стало | Причина |
| --- | --- | --- | --- |
| greenlet | 3.5.0 | 3.5.6 | нет cp315-колёс (нужен SQLAlchemy asyncio) |
| asyncpg | 0.31.0 | 0.32.0 | нет cp315-колёс |
| pydantic | 2.13.4 | 2.14.3 | pydantic-core 2.41.5 без cp315; 2.50.4 с cp315 |
| mypy | 2.0.0 | 2.4.1 | librt 0.10.0 без cp315; 2.4.1 требует librt≥0.16.0 |
| pywin32 (Win) | 311 | 312 | нет cp315 (только testcontainers/docker SDK) |
| **redis** | **7.4.0** | **5.3.1** | **arq 0.28.0 требует `redis[hiredis]<6`** (несовместим с redis-py 6+) |

Новые зависимости SPEC-03 (закреплены): casbin → `pycasbin` 2.8.0 (import
`casbin`), sqlalchemy-adapter 1.9.0, argon2-cffi 25.1.0, arq 0.28.0,
psycopg[binary] 3.3.8, pytest-cov 7.1.0.

> **Расхождение со SPEC-03:** таблица README называет «casbin 1.43.0» со ссылкой
> на `pypi.org/pypi/casbin`. Официальный адаптер `sqlalchemy-adapter 1.9.0`
> (ADR-004) требует `pycasbin>=2.0.0`; legacy-пакет `casbin` (1.43.0) конфликтует
> с ним (оба поставляют `import casbin`). Выбран `pycasbin` (реальный casbin).

Удалены демо-части форка: tier, SQLAdmin, SQLite (aiosqlite), Memcached
(aiomcache), Taskiq + RabbitMQ-брокеры (taskiq-aio-pika/aio-pika), faker,
fastcrud, user-agents — и их тесты.

## 3. Команды SPEC-06 (из корня репозитория)

Все команды выполнялись из `C:\electronic_lab_dev` с `$env:Path` = uv-каталог +
`SSL_CERT_FILE` очищен (на машине установлен битый `SSL_CERT_FILE`).

| Команда | Exit | Результат |
| --- | --- | --- |
| `uv sync --frozen` | 0 | passed (65 пакетов + dev-группа) |
| `uv run --frozen ruff check backend` | 0 | passed |
| `uv run --frozen ruff format --check backend` | 0 | passed |
| `uv run --frozen mypy backend/src` | 0 | passed (strict, 23 файла) |
| `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85` | 0 | **23 passed, coverage 93%** |

## 4. Тесты (TDD)

Исходный прогон `pytest backend/tests/test_platform.py -v` до реализации — **RED**
(`ModuleNotFoundError: No module named 'backend.src.core.database'`). После
реализации — **GREEN**.

| Тест | Файл | Результат |
| --- | --- | --- |
| `test_no_public_signup` | backend/tests/test_platform.py | passed (signup=404) |
| `test_ready_rejects_wrong_schema` | backend/tests/test_platform.py | passed (ready=503 при старой схеме) |
| `test_command_rollback` | backend/tests/test_platform.py | passed (нет записи/idempotency-success) |
| `test_etag_and_problem_contract` | backend/tests/test_platform.py | passed (code + trace_id) |
| `test_core.py` (19 тестов: clock, Problem, ревизии/идемпотентность, БД, live, bootstrap) | backend/tests/test_core.py | passed |

Интеграционные тесты выполняются на реальном PostgreSQL `postgres:18.6`
(testcontainers); миграция применяется настоящим `alembic upgrade head`
(никогда `create_all`, никогда SQLite).

## 5. Миграции (реальный PostgreSQL, docker)

```
docker run -d --name vse-pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vse \
  -p 127.0.0.1:55432:5432 postgres:18.6
uv run --frozen alembic -c backend/alembic.ini upgrade head   # exit 0: -> 0001_identity
uv run --frozen alembic -c backend/alembic.ini upgrade head   # exit 0: no-op
```

Схема (11 таблиц): `alembic_version`, `territories`, `laboratories`, `users`,
`user_scopes`, `delegation_grants`, `user_events`, `casbin_rule`,
`command_records`, `technical_events`, `outbox`. `alembic_version.version_num =
0001_identity`. Проверено: повторный `upgrade head` идемпотентен (не применяет
миграцию повторно).

## 6. Redis / arq smoke

```
docker run -d --name vse-redis-test -p 127.0.0.1:56379:6379 redis:8.10.3-alpine3.23
```

Скрипт smoke (redis-py 5.3.1 + arq 0.28.0, без worker и без VetIS-адаптера):
`redis-py ping: True`, `arq enqueued job: <id>`. Совместимость redis-py 5.3.1 ↔
Redis 8.10.3 и arq 0.28.0 подтверждена.

## 7. Намеренная поломка (локальная, откачена)

- Сломанная типизация (`_broken: int = "..."`) → `mypy backend/src` exit 1
  (`Incompatible types in assignment`). Откачено.
- Сломанная миграция (`SELECT * FROM intentionally_broken_table`) →
  `alembic upgrade head` exit 1 (`UndefinedTableError`). Откачено.

В репозиторий поломка **не** закоммичена.

## 8. Compose / CI / deploy

- `docker compose config` валиден для base и base+dev.
- Base не публикует DB/backend (только `expose`); публикуется лишь frontend
  `127.0.0.1:8080`. Dev публикует БД только на `127.0.0.1:${DB_PUBLISHED_PORT:-5432}`.
- `/api/v1` не переписывается: `deploy/nginx.conf` проксирует `location /api/`
  через `proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};` без завершающего `/`.
- CI `.gitverse/workflows/verify.yml`: ruff check, ruff format --check, mypy,
  pytest+cov, миграция с нуля + повтор `upgrade head` (postgres-сервис).

## 9. Решения и ограничения

1. **Python 3.15.2 несовместим с исходным lock форка** (cp315-колёса появились
   позже исходных версий). Исправлено точечными upgrade-правками (см. §2) — это
   легитимное «upgrade-коммит с диагностикой» по ADR-014, а не молчаливое
   обновление.
2. **arq 0.28.0 ↔ redis-py 7.x несовместимы** — redis-клиент понижен до 5.3.1
   (`<6`, требование arq), сервер остаётся Redis 8.10.3.
3. **frontend не собирается в I01**: `frontend/` появится в ТЗ-02. Создан
   `deploy/frontend.Dockerfile` и `deploy/nginx.conf` как закреплённый рецепт;
   CI в этой задаче backend-only и не трогает frontend.
4. GitVerse CI не исполняется локально (нет runner-токена): синтаксис workflow
   сверен с `gitverse.ru/docs/cicd`, сами gates проверены локально.
5. `casbin_rule` создаётся миграцией по схеме официального sqlalchemy-adapter;
   сам sync-адаптер Casbin и авторизация подключаются в I02.
6. Bootstrap — закрытая CLI (stdin, без argv/log, повтор запрещён при непустом
   реестре); явная область/делегирование добавляются в I03.
7. `bootstrap.py::main()` (чтение stdin) не покрыт unit-тестом; покрытие его
   хелперов (hash/verify/validate/count/create/run/ensure) — 73%, общее 93%.
