# Evidence: Task F03 — Вход, профиль и администрирование

Дата: 2026-11-07 · Ветка: `feature/F03-identity` (от `26720c5`) · Среда: Windows 11, PowerShell, Node v26.13.0 / npm 12.2.2

Страницы входа, восстановления пароля, профиля и администрирования пользователей подключены к реальному backend (команды I03, API-01/02) против PostgreSQL 18.6 + Redis 8.10.3 (SPEC-06, FT-ACC-01…10, AT-20/AT-24).

## 1. Инфраструктура e2e (реальный backend)

Compose-сервисы I01 не использованы: известный дефект volume-mount (postgres 18, см. F01 evidence §2) — контейнеры поднимались standalone:

```powershell
docker run -d --name vse-pg-f03 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vse -p 127.0.0.1:55433:5432 postgres:18.6
docker run -d --name vse-redis-f03 -p 127.0.0.1:56380:6379 redis:8.10.3-alpine3.23
uv run --frozen alembic -c backend/alembic.ini upgrade head   # -> 0003_user_admin_constraints
```

Порт 8000 занят устаревшим процессом backend (без доступа к БД), он не тронут; backend запущен на **8001** (`uvicorn backend.src.interfaces.main:app`, DATABASE_URL `…55433/vse`, REDIS_URL `…56380/0`, SESSION_COOKIE_SECURE=false, SECRET_KEY f03-e2e-secret-key). `/health/ready` → `{"status":"ready","schema_revision":"0003_user_admin_constraints"}`.

Vite dev-сервер e2e: порт 4173, `VITE_API_PROXY_TARGET=http://127.0.0.1:8001` (прокси `/api` в `vite.config.ts`; playwright webServer переиспользует уже запущенный сервер).

Сид данных: `frontend/tests/e2e/seed_identity.py` (запуск `uv run` с теми же env) — создаёт `e2e-admin` (ADMIN) и `e2e-vet`, `e2e-head`, `e2e-analyst`, `e2e-blocked` (неактивный VET), `e2e-linked` (VET с авторскими UserEvent, для USER_HAS_REFERENCES), лаборатории labA/labB. Пароли: admin `e2e-admin-password-1`, остальные `e2e-user-password-1`, новый пароль `e2e-reset-password-1`. Идентификаторы labA/product пишутся в `frontend/tests/e2e/identity-seed.local.json` (в `.gitignore`, секретов не содержит — только логины/пароли тестовых пользователей и UUID).

⚠️ Состояние: `test_at_24_linked_user_delete_blocked` переводит `e2e-linked` в неактивное состояние и не восстанавливает его. Перед повторным прогоном e2e выполните `docker exec vse-pg-f03 psql -U postgres -d vse -c "UPDATE users SET active = true WHERE login = 'e2e-linked';"` либо перезапустите сид.

## 2. TDD: RED → GREEN

RED зафиксирован до реализации: `npm run test:e2e -- identity.spec.ts` → **6 failed / 0 passed** (все экраны отсутствовали), unit-тесты identity — падение (файлы не существовали), exit 1.

GREEN (итог, все exit 0):

| Гейт         | Команда                   | Результат                                       |
| ------------ | ------------------------- | ----------------------------------------------- |
| typecheck    | `npm run typecheck`       | exit 0                                          |
| lint         | `npm run lint`            | exit 0 (0 ошибок, 0 предупреждений)             |
| format:check | `npm run format:check`    | exit 0                                          |
| unit-тесты   | `npm run test`            | **17 файлов / 74 passed / 0 failed**            |
| build        | `npm run build`           | exit 0                                          |
| storybook    | `npm run build-storybook` | exit 0                                          |
| e2e          | `npm run test:e2e`        | **11 passed / 0 failed** (6 identity + 5 shell) |

Именованные e2e (реальный backend, `--workers=1`):

| Тест ID                               | Что доказывает                                                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_four_role_landing`              | ADMIN → `/users` («Управление пользователями»), VET/HEAD → `/labs/{labA}/arrivals?queue=expected`, ANALYST → `/labs` (выбор одной лаборатории, 2 ссылки, без сводного журнала); после «Выйти» — `/login` |
| `test_admin_cannot_open_working_data` | прямая URL-навигация ADMIN на `/labs/{labA}/examinations` не показывает таблицу рабочих данных; все выполненные GET остаются в административном домене (<500)                                            |
| `test_password_reset_keeps_blocked`   | сброс пароля заблокированного пользователя через диалог (If-Match) не снимает блокировку; статус остаётся «Заблокирован»; вход заблокированного → 403 ACCOUNT_BLOCKED, остаётся на `/login`              |
| `test_no_email_recovery`              | `/password-help` собирает ничего и не отправляет ничего: 0 `input`, 0 не-GET запросов к `/api/`, нет «token» в телах (FT-ACC-07 — восстановление это задача администратора)                              |

Дополнительно (бонус, тот же файл): `test_ft_acc_01_wrong_password_and_logout` (неверный пароль → «Неверный логин или пароль», логин сохранён, пароль очищен; после logout прямой переход `/profile` → `/login`) и `test_at_24_linked_user_delete_blocked` (409 USER_HAS_REFERENCES в диалоге, блокировка работает, история без секретов: ни `$argon2`, ни пароля в `<main>`).

## 3. Что реализовано

- Экраны вне AppShell (паттерн auth.html): `pages/LoginPage.tsx`, `pages/RecoveryPage.tsx`; рабочие под `RequireSession`: `pages/ProfilePage.tsx`, `pages/UsersPage.tsx` (поиск/роль/статус в URL, пагинация, диалоги сброса/блокировки/разблокировки/удаления), `pages/UserEditorPage.tsx`, `pages/UserHistoryPage.tsx`, `pages/AnalystLabsPage.tsx`.
- Features/identity: `api.ts` (login/change-password, users CRUD/block/reset/history, `initialRouteFor`, `bootstrapCsrf`, `loginProblemText`), `session.ts` (`completeLogin`: очистка кэша → сброс lost-флага → CSRF из ответа → скоуп), формы `LoginForm`/`PasswordForm`/`UserEditor` (RHF + Zod, валидация `safeParse` в обработчиках — @hookform/resolvers не закреплён в SPEC-03), `identity.css`, stories.
- Ошибки сервера привязаны к полям по `field_id` из `Problem.errors` ( например «Такой логин уже занят.» → поле «Логин»); secrets очищаются после каждого сабмита/закрытия (ТЗ-02), пароли нигде не хранятся.
- Сеанс: 401 на закрытых чтениях один раз помечает `useSessionLost` (zustand, `entities/session/context.ts`) и очищает кэш; `RequireSession` при lost сразу уводит на `/login` — цикл clear→refetch больше не мешает стабильному редиректу. Logout очищает кэш и уводит на `/login` (роутер).
- CSRF (реальные правила backend): login-POST сравнивается с bootstrap-cookie `vse_csrf` (path `/api/v1`, невидим для JS на страницах приложения) → `bootstrapCsrf()` берёт токен из тела ответа; мутации сеанса сравниваются с токеном, выданным при логине (`completeLogin` хранит его в памяти). Submit логина дополнительно ожидает bootstrap, чтобы быстрый клик не обогнал ротацию cookie; параллельные вызовы bootstrap разделяют один запрос (StrictMode double-effect).
- Мелочи из журнала (ledgered minors): `shared/ui/Dialog.tsx` — статические id заменены на `useId`; `shared/ui/InfoField.tsx` — общий read-only компонент; кнопки «Выйти» и действия строк получили aria-label.

## 4. Известные ограничения / для доработки

- После полной перезагрузки страницы на рабочем маршруте in-memory session-CSRF недоступен (backend не отдаёт токен сеанса через GET-эндпоинт; `/auth/csrf` выдаёт только anonymous bootstrap-токен). Мутации, начатые сразу после F5 на `/users`, получат CSRF_REJECTED до повторного входа. Это ограничение контракта I03 — стоит вынести в бэклог backend (например, возвращать `csrf_token` в `/me`).
- `test_at_24` меняет состояние сид-данных (см. §1).
- Compose volume-mount backend-сервисов остаётся дефектом I01 (обход — standalone-контейнеры).
- Порт 8000 занят устаревшим процессом вне задачи F03 — не убивался.
