# Платформа и доступ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать воспроизводимую платформу и безопасный доступ четырёх ролей.

**Architecture:** Модульный FastAPI-монолит от закреплённого форка, PostgreSQL и Redis SessionTransport. Casbin принимает единственное решение о доступе из актуальных SQL-политик; REST — по общему контракту.

**Tech Stack:** SPEC-03; async SQLAlchemy/Alembic, crudauth, Casbin, Redis, pytest, GitVerse.

**Spec:** [Общая спецификация](specification.md), DATA-01/05, API-01/02/09; ФТ 01/13, ADR-001–006/011/013–017/024.

## Global Constraints

- «Локальная роль не равна полномочиям Меркурия»; deny by default; отзыв со следующего запроса.
- «минимум 12 символов пароля, максимум 128»; «сеанс максимум 8 часов, простой 30 минут».
- Источник форка `4deb9c45f4298d4a84f005126f6ee8ccd823acf8`; uv sync --frozen; никаких demo/Faker/публичной регистрации.
- Общие SPEC-01–06 и приложения обязательны. Предметные модули здесь не реализуются.

## Review Focus

- Запрос другим worker после отзыва назначения: тест I02 проверяет немедленный запрет.
- Два одновременных создания логина: I03 допускает ровно одну запись.
- Последние администраторы удаляются одновременно: I03 сохраняет одного уполномоченного.
- Redis недоступен: I02 возвращает 503 без ослабления проверки.
- Секрет в ошибке/истории: I03 проверяет отсутствие введённых паролей и hash.

### Task I01: Baseline, миграции и CI

**Files:** создать `docs/implementation/baseline.md`, `backend/tests/test_platform.py`, `backend/src/core/{contracts,database,clock,problems,commands}.py`, `backend/src/modules/identity/{models,schemas,router}.py`, `backend/migrations/versions/0001_identity.py`, `.gitverse/workflows/verify.yml`, `deploy/{backend.Dockerfile,frontend.Dockerfile}`, `docker-compose.yml`, `docker-compose.dev.yml`; адаптировать корневые pyproject/uv.lock и структуру форка только в пределах SPEC-02.

**Interfaces:** потребляет fork SHA/ADR; производит `Clock`, `UnitOfWork`, `CommandContext`, Problem/Page и API-01/09. Локальный command journal и outbox DATA-05 создаются здесь; внешняя обработка позже.

- [x] Написать `test_no_public_signup`, `test_ready_rejects_wrong_schema`, `test_command_rollback`, `test_etag_and_problem_contract`: assert signup=404, ready=503 при старой схеме, после injected exception нет записи/idempotency-success, errors включает code/trace_id.
- [x] Запустить `uv run --frozen pytest backend/tests/test_platform.py -v`; до реализации ожидается FAIL, не ошибочный успешный пропуск тестов.
- [x] Внести закреплённый форк в backend с MIT notices; сохранить baseline lock; удалить tier/SQLAdmin/SQLite/Memcached/Taskiq и неиспользуемые брокеры. Ввести схемы DATA-01/05, one-shot Alembic и общий middleware ошибок/ревизий/идемпотентности SPEC-04. Redis/arq compatibility smoke, без реального VetIS adapter. Создать closed bootstrap CLI `uv run --frozen python -m backend.src.modules.identity.bootstrap` с вводом секретов без shell argv/log; повтор при непустом реестре запрещён.
- [x] Запустить frozen install, миграцию с нуля/повтор head и тесты I01; CI lint/type/coverage и миграция PostgreSQL обязательны. Намеренно сломанная миграция/тип должны блокировать pipeline. Compose base не публикует DB/backend, dev DB только 127.0.0.1; /api/v1 не переписывается.
- [x] Просмотреть diff и зафиксировать адресные файлы: `feat: establish pinned platform and API infrastructure`.

### Task I02: Сеанс и единая авторизация

**Files:** создать `backend/src/modules/identity/{authz,session,passwords,policies}.py`, `backend/tests/identity/test_sessions.py`, `backend/tests/identity/test_permissions.py`; изменить auth wiring форка и identity router, не создавать второй JWT authorizer.

**Interfaces:** `authorize(actor_id,action,scope,attributes) -> None`, API-02 auth/me/contexts; `require_session` получает server-side session identity, roles читает SQL.

- [x] Написать parametrized `test_four_roles_scope_matrix` по inputs.md; `test_revocation_next_worker_request` assert GET=404 и mutation denied после смены назначения; `test_redis_failure_closed` assert503; `test_login_limit` assert шестая попытка в 15 мин=429, после 15 минут разрешена; `test_logout_and_password_revoke` assert старые сеансы=401.
- [x] Запустить `uv run --frozen pytest backend/tests/identity/test_sessions.py backend/tests/identity/test_permissions.py -v`, зафиксировать исходный FAIL.
- [x] Реализовать cookie SessionTransport Redis, CSRF/Origin, лимит login/IP 5 ошибок/15 мин с блоком 15 мин; Argon2id 64MiB/3/1, 12..128 символов, без смеси классов/периодической смены. Casbin sync adapter отдельным ограниченным пулом через threadpool, snapshot политик на каждый запрос; фильтрация области **до** поиска/count/pagination. Нет Redis →503, а не fallback.
- [x] Проверить все роли на read/search/count/export/mutation; CSRF без токена/с чужим Origin даёт отказ, cookie не доступна JS; max8h/idle30m управляемыми часами. Запустить тесты и quality gates SPEC-06.
- [x] Зафиксировать: `feat: enforce sessions and current scoped authorization`.

### Task I03: Пользователи, делегирование, профиль

**Files:** создать `backend/src/modules/identity/{commands,queries,bootstrap}.py`, `backend/tests/identity/test_users.py`; изменить models/schemas/router, migrations для недостающих constraints.

**Interfaces:** API-02 users/me/history/change/reset/block/delete; UserView/UserWrite; текущий пользователь не меняется при просмотре другого.

- [x] Написать `test_parallel_duplicate_login` assert один 201/один 409; `test_cannot_delegate_republic_analyst` assert403 и нет записи; `test_parallel_last_admin_delete` assert остался ≥1; `test_linked_user_delete_blocked` assert409, после block автор ВСЭ прежний; `test_history_redacts_passwords` assert нет пароля/hash, no-op update не создаёт события.
- [x] Запустить `uv run --frozen pytest backend/tests/identity/test_users.py -v`, убедиться в FAIL до изменений.
- [x] Реализовать CRUD и историю в одной транзакции с реальными changed_fields, блокировкой области при критических admin-операциях; выдача четырёх ролей только в delegation scope, self-escalation запрещён. Reset не меняет active/scopes, смена/reset отзывают все сеансы. DELETE linked/self/last-admin отказ, несвязанного — физически. Внешний initiator — отдельная защищённая связь без выдачи локальной ролью; credentials не в UserView.
- [x] Выполнить тесты I03 и все identity/platform; проверить PostgreSQL concurrency и чужие UUID. Адресная приёмка FT-ACC-01–11, FT-ADM-01/02, AT-20/24; UI проверяется в ТЗ-02.
- [x] Зафиксировать: `feat: add scoped user administration and profile`.
