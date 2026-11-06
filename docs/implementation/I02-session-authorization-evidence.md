# I02: сеанс и единая авторизация — доказательства

Дата: 2026-11-06 · Ветка: `feature/02-session-auth` · Код: `fcd5151`
(`feat: enforce sessions and current scoped authorization`).

Статусы ниже означают только фактически выполненные проверки.

## Реализовано

- Redis SessionTransport с непрозрачным идентификатором в cookie
  `HttpOnly; Secure; SameSite=Lax`, абсолютным сроком 8 часов и idle 30 минут.
- Анонимный CSRF bootstrap для входа; все сессионные изменения требуют совпадения
  CSRF и Origin. Закрытые ответы имеют `Cache-Control: no-store`.
- Login/IP rate limit: пять ошибок за 15 минут, шестая попытка получает 429,
  блок действует 15 минут. Ошибка Redis всегда даёт 503, fallback отсутствует.
- Argon2id 64 MiB / 3 итерации / 1 lane; пароль 12–128 Unicode-символов.
  Смена пароля блокирует строку пользователя и отзывает все сеансы.
- Каноническая AUTHZ-матрица четырёх ролей. Текущие role/active/scopes/grants
  перечитываются из SQL на каждый запрос. Финальное решение принимает Casbin;
  официальный sync sqlalchemy-adapter работает в отдельном пуле из 4 потоков и
  загружает новый снимок SQL-политик на каждый вызов.
- Миграция `0002_auth_policy_adapter`: официальные NULL-семантики v0…v5 и
  канонические начальные политики. Это исправляет обнаруженный при production-
  тесте `invalid policy size` от пустых v2…v5 схемы I01.
- API-02: `GET /auth/csrf`, `POST /auth/login`, `POST /auth/logout`, `GET /me`,
  `GET /contexts`, `POST /me/change-password`. JWT или второй authorizer не
  добавлялись; публичной регистрации нет.

## Адресные файлы

- `backend/src/modules/identity/{authz,session,passwords,policies}.py`
- `backend/src/modules/identity/{router,schemas,models,bootstrap}.py`
- `backend/migrations/versions/0002_auth_policy_adapter.py`
- `backend/src/infrastructure/{app_factory.py,config/settings.py}`
- `backend/tests/identity/{test_sessions,test_permissions}.py`
- `backend/tests/{conftest,test_platform}.py`

## TDD и критические сценарии

Исходный прогон двух обязательных файлов до реализации: **failed** при сборке —
модули `identity.session` и `identity.authz` отсутствовали. После реализации:

| Проверка | Статус / доказательство |
| --- | --- |
| `test_four_roles_scope_matrix` | passed; каждая строка матрицы × 4 роли × own/foreign × active/blocked |
| `test_revocation_next_worker_request` | passed; второй Authorizer после удаления назначения: GET 404, mutation 403 |
| `test_redis_failure_closed` | passed; вход при отказе Redis → 503 `DEPENDENCY_UNAVAILABLE` |
| `test_login_limit` | passed; 5×401, шестая 429, после 15 минут вход разрешён |
| `test_logout_and_password_revoke` | passed; старый и параллельный сеансы удалены, старый пароль 401 |
| CSRF / Origin / cookie | passed; нет токена и чужой Origin →403, session cookie HttpOnly/Lax |
| max 8h / idle 30m | passed на управляемых часах |
| официальный SQL adapter | passed; VET allow, ADMIN deny, отдельный sync pool |
| миграция I01 → I02 | passed на PostgreSQL 18.6; после upgrade политики присутствуют |

## Команды и результаты

| Команда | Exit | Результат |
| --- | ---: | --- |
| `uv sync --frozen` | 0 | passed; 63 пакета проверены, lock не изменён |
| `uv run --frozen ruff check backend` | 0 | passed |
| `uv run --frozen ruff format --check backend` | 0 | passed; 38 файлов |
| `uv run --frozen mypy backend/src` | 0 | passed; strict, 27 файлов |
| `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85` | 0 | passed; 115 тестов, 95% |
| `uv run --frozen pytest backend/tests/identity --cov=backend/src/modules/identity --cov-fail-under=90` | 0 | passed; 89 тестов, 90%; `authz.py` 96%, `session.py` 100% |

Интеграционные тесты использовали настоящий контейнер `postgres:18.6`, Alembic
с нуля и отдельный путь обновления с `0001_identity` до
`0002_auth_policy_adapter`. SQLite и `create_all` не использовались.

## Ограничения этапа

- CRUD пользователей, делегирование и reset/block/delete относятся к I03.
- Предметные роутеры ещё не созданы; они обязаны вызывать готовый Authorizer до
  поиска/count/pagination и перед mutation. Матрица и scope snapshot для этого
  опубликованы I02.
- Внешние полномочия Меркурия не выводятся из локальной роли; personal initiator
  и фактические ВетИС-проверки остаются V01/W01.
