# I03: пользователи, делегирование, профиль — доказательства

Дата: 2026-11-06 · Ветка: `feature/03-users` · Код: см. commit
`feat: add scoped user administration and profile`.

Статусы ниже означают только фактически выполненные проверки.

## Реализовано

- API-02, маршруты `/api/v1/users`: `GET ""` (страница с фильтрами
  `role/status/laboratory_id/product_scope_id/q/page`, сортировка
  `created_at DESC, id DESC`, фиксированные 20 строк), `POST ""` (201 +
  `Location` + `ETag`), `GET /:id`, `PUT /:id` (If-Match → 422 REVISION_REQUIRED
  / 409 REVISION_CONFLICT), `POST /:id/block`, `POST /:id/unblock`,
  `POST /:id/reset-password` (204, отзыв всех сеансов), `GET /:id/history`
  (страница `user_events`), `DELETE /:id` (204; 409
  `USER_HAS_REFERENCES`/`SELF_DELETE_FORBIDDEN`/`LAST_ADMIN`).
- Все операции в одной транзакции с реальными `changed_fields` в `user_events`
  (без паролей и хешей: секретное поле всегда `{"password_hash": "REDACTED"}`),
  блокировка строк целевых администраторов в детерминированном порядке для
  критических операций. Команды сами завершают транзакцию — как
  `change-password` из I02.
- Область: решения Casbin по матрице I02 (`users:list/read/history/create/
  update/block/unblock/reset-password/delete` — только ADMIN) + проверка, что
  целевой пользователь/назначение лежит в делегированном дереве территории;
  чужой UUID → 404 без реквизитов. Создание/смена роли на ADMIN через API
  запрещено (403): выдача полномочий администратора — закрытый bootstrap OPS-01.
  Само-эскалация запрещена: нельзя менять собственную роль/назначения и
  блокировать/удалять себя.
- Пароли: создание и reset требуют пару `password/confirmation`, 12..128
  Unicode, Argon2id (уже I02); reset не меняет `active`/scopes; смена пароля и
  reset отзывывают все сеансы (вне SQL-транзакции). Смена назначения отзывает
  доступ со следующего запроса (перечитывание SQL из I02). Credentials не
  попадают в UserView (schemas: `UserView` без полей пароля).
- Scope-модель: VET — лаборатория+продукция; HEAD/ANALYST — лаборатория
  (отсутствующий `product_scope_id` сохраняется как «вся продукция
  лаборатории»: составной PK требует ненулевой третий столбец); UserWrite
  отвергает старые permission-флаги (`extra="forbid"`).
- Bootstrap (закрытый CLI) расширен: после создания администратора создаётся
  начальное само-делегирование `may_delegate=True` на корневую территорию
  (по умолчанию «Республика Татарстан», вводится в CLI с дефолтом) и событие
  `create` без секретов. Повторный запуск по-прежнему запрещён.
- Миграция `0003_user_admin_constraints` (новая, 0001/0002 не редактировались):
  `UNIQUE(target_id, role, territory_id)` на `delegation_grants`,
  `CHECK btrim(login) <> ''` на `users`, индекс `user_events(target_user_id, at)`.
- Ledgered minors из I01 (в моей зоне): убран дубль `unique=True` на
  `users.login` в ORM-метаданных; в `problems.py` добавлен catch-all handler →
  500 `INTERNAL_ERROR` без утечки деталей.

## TDD: RED → GREEN

Прогон `uv run --frozen pytest backend/tests/identity/test_users.py -v` до
реализации: **9 failed, 1 passed** — все маршруты `/users` отсутствовали
(404), начальное делегирование в bootstrap отсутствовало. После реализации —
10 passed. Итоговый набор (имена обязательных тестов плана сохранены):

| Тест | Статус / доказательство |
| --- | --- |
| `test_parallel_duplicate_login` | passed; два параллельных POST `/users` с одним логином: ровно один 201 (Location+ETag), один 409 `ALREADY_EXISTS`; в БД одна строка |
| `test_cannot_delegate_republic_analyst` | passed; ANALYST по чужому району → 403 `ACCESS_DENIED`, ни пользователя, ни гранта, ни события |
| `test_parallel_last_admin_delete` | passed; два параллельных DELETE последних администраторов района: один 204, один 409 `LAST_ADMIN`; уполномоченный администратор остался (FOR UPDATE в порядке возрастания id исключает дедлок) |
| `test_linked_user_delete_blocked` (AT-24) | passed; пользователь с назначением/авторством: DELETE 409 `USER_HAS_REFERENCES`; block 200, `active=false`, назначение и автор записи прежние; вход заблокированного 403 `ACCOUNT_BLOCKED` |
| `test_history_redacts_passwords` | passed; в истории нет введённого пароля, старого пароля и `$argon2…`; `changed_fields` = `{password_hash: REDACTED}`; reset не меняет active/scopes; no-op PUT не создаёт событие и не увеличивает rev |
| `test_user_lifecycle_crud` (SC-089/090/091) | passed; create 201/Location/ETag, список с фильтрами, PUT с If-Match (409 при старой ревизии), block/unblock, unlink, физическое удаление несвязанного |
| `test_foreign_uuid_is_hidden` | passed; GET/PUT/DELETE/history чужого UUID → 404 |
| `test_self_protection_and_role_issuance` | passed; self-delete 409 `SELF_DELETE_FORBIDDEN`, self-эскалация 403, выдача ADMIN через API 403, HEAD видит `/users` 403 |
| `test_me_unchanged_when_viewing_other` | passed; `GET /me` не меняется при просмотре другого пользователя |
| `test_bootstrap_grants_initial_delegation` | passed; bootstrap создаёт корневую территорию и само-делегирование `may_delegate=true`, повтор запрещён |

## Команды и результаты

| Команда | Exit | Результат |
| --- | ---: | --- |
| `uv sync --frozen` | 0 | 63 пакета проверены, lock не изменён |
| `uv run --frozen ruff check backend` | 0 | All checks passed |
| `uv run --frozen ruff format --check backend` | 0 | 42 files already formatted |
| `uv run --frozen mypy backend/src` | 0 | strict, 29 файлов, no issues |
| `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85` | 0 | 125 passed; 92.90% (порог 85) |
| `uv run --frozen pytest backend/tests/identity/test_users.py -v` (RED) | 1 | 9 failed / 1 passed до реализации — требуемый FAIL зафиксирован |
| миграция с нуля | 0 | conftest: `alembic upgrade head` на PostgreSQL 18.6 (testcontainers) при каждом прогоне |
| миграция I01 → head (0001→0003) | 0 | `test_migration_from_i01_to_i02` passed |

SQLite и `create_all` не использовались; конкурентные тесты идут через
настоящие параллельные транзакции PostgreSQL (asyncpg).

## Адресные файлы

- `backend/src/modules/identity/{commands,queries}.py` (новые)
- `backend/src/modules/identity/{router,schemas,bootstrap,models}.py`
- `backend/src/core/problems.py` (catch-all 500 INTERNAL_ERROR)
- `backend/migrations/versions/0003_user_admin_constraints.py`
- `backend/tests/identity/test_users.py`, `backend/tests/test_platform.py`
  (восстановление головы схемы в тесте `/health/ready` на актуальный head)

## Приёмка FT/AT

- FT-ACC-01/07/09/11, FT-ADM-01/02 — покрыты тестами выше (вход/блокировка/
  сброс/делегирование/удаление/история; UI — ТЗ-02).
- AT-20 (администратор не читает журнал/5-вет; матрица запретов) — обеспечено
  матрицей I02 (`test_four_roles_scope_matrix`, users-действия только у ADMIN);
  предметные маршруты отчётов/журнала появятся в своих ТЗ.
- AT-24 — `test_linked_user_delete_blocked` + `test_history_redacts_passwords`.
- SC-089/090/091 — `test_user_lifecycle_crud`, `test_history_redacts_passwords`,
  `test_bootstrap_grants_initial_delegation`.
- SC-092 (права Меркурия не возникают из локальной роли) — внешний initiator —
  отдельная защищённая связь, не роль; реализуется в V01/W01, здесь выдача
  локальных ролей ограничена делегированной областью.

## Ограничения и решения

- Составной PK `user_scopes` требует ненулевой `product_scope_id`; для
  HEAD/ANALYST отсутствие продукта сохраняется как «вся лаборатория»
  (`product_scope_id = laboratory_id`). Авторизация HEAD/ANALYST продукт не
  фильтрует (scope_allows I02), VET требует явный продукт.
- Выдача роли ADMIN через API запрещена (403): делегирования выдаются только
  закрытым bootstrap; новый ADMIN без гранта был бы «мертвой» учётной записью.
- Пользователь без территорий (после снятия назначений) остаётся видимым
  ADMIN: такие записи не несут территориальных данных; чужой отсутствующий
  UUID по-прежнему 404. При удалении аккаунта его собственный журнал
  (`user_events.target_user_id`) удаляется вместе с учётной записью (FK
  RESTRICT иначе навсегда блокирует любое удаление); записи, автором которых
  был пользователь, удаление блокируют (409 `USER_HAS_REFERENCES`).
- `Idempotency-Key` обязателен для `POST /users` и `DELETE /users/:id`
  (API-01 create/delete); block/unblock/reset — повторяемые по природе,
  требуют только If-Match.
- Внешний initiator Меркурия — отдельная защищённая связь, локальной ролью не
  выдаётся; фактическая реализация V01/W01.
