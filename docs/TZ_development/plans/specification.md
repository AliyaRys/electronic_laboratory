# Общая техническая спецификация

## SPEC-01. Источники и граница работ

Нормативны [ФТ v2.0](../../../Функциональные%20требования/v2.0/README.md), [O-01–11](../../../Функциональные%20требования/v2.0/owner-decisions.md), [ADR 1.1](../../adr/README.md). Подтверждение R-01–09 берётся из ADR/agent-handoff, поэтому прежний текст ФТ «для обзора» не означает повторного согласования. Каждый FT включает собственный раздел «Приёмка»; он обязателен дополнительно к тестам плана. Все поля и словари из каталога 10 входят в объём. Технические имена этого пакета — детализация ADR, не изменение ФТ.

Разрабатывается мясной MVP: 15-минутное получение входящих транспортных эВСД из тестового профиля ВУ, локальный отбор `productType=1`, сверка, полностью реализованный и офлайн-проверенный контракт приёмки/возврата, одна местная ВСЭ партии, физические пробы, нормы/стоимость, заключения и отчётность. Живое гашение ни в одном контуре текущего выпуска не выполняется, но его XML preview/intent/submit/poll/reconcile должны быть готовы за закрытым transport gate. Нет молочного/растительного контура, полноценной рыбы/птицы, повторных ветосмотров, склада, продаж/кассы/смен, исходящих после ВСЭ/для проб, 1-вет, электронной подписи, email-восстановления, медицинской истории версий, восстановления удалённой ВСЭ. Повторная ВСЭ в модели приёмки входит; она не является повторным ветосмотром.

## SPEC-02. Структура реализации

`backend/` — закреплённый форк FastAPI; `frontend/` — новая React SPA; `docs/` — контракты и эксплуатация; `deploy/` — образы/nginx/настройки; `.gitverse/workflows/` — CI. Старые HTML, обычные JS и `components/` остаются эталонами и работают по своим API. Добавление одного компонента в макет не разрешает смену его runtime. Новая SPA — отдельная реализация, принятая ADR-007, а не массовая переделка макетов.

Backend: `backend/src/modules/{identity,arrivals,samples,examinations,catalog_pricing,reporting,documents,integrations/vetis}/`. В каждом используемом модуле `models.py` — ORM, `schemas.py` — DTO, `commands.py` — изменения, `queries.py` — чтение, `router.py` — HTTP; отдельные focused-файлы выделены в задачах. `backend/src/core/` — общие часы/БД/авторизация/транзакции/ошибки; существующая инфраструктура форка адаптируется, не дублируется. Корневой `pyproject.toml` и `uv.lock` сохраняют workspace форка; тесты — `backend/tests/`.

Frontend: `src/app/`, `pages/`, `features/<module>/`, `entities/`, `shared/{api,ui,lib}/`. `shared/api/schema.d.ts` генерируется; предметные DTO вручную не дублируются. Stories находятся рядом с единственным компонентом. Правки старого каталога требуют его сборки, auth — также UI-тестов.

## SPEC-03. Стек и воспроизводимость

Воспроизвести выбранный baseline из ADR README с checksum в sources-manifest, **не** трактовать таблицу как доказательство установленной совместимости. Backend fork SHA `4deb9c45f4298d4a84f005126f6ee8ccd823acf8`, uv frozen; PostgreSQL 18.6, Python 3.15.2; исходные версии backend — из uv.lock. Новые зависимости: Casbin 1.43.0 / sqlalchemy-adapter 1.9.0 (sync psycopg 3.3.8 через threadpool), argon2-cffi 25.1.0, arq 0.28.0, Zeep 4.3.3 на последнем этапе, WeasyPrint 70.0, openpyxl 3.1.5. Redis 8.10.3-alpine3.23. Casbin 1.43.0 закрепляется при платформенном compatibility-check.

Node 26.13.0/npm 12.2.2, React 19.3.1, TS 7.0.2 strict, Vite 8.3.6; TanStack Query 5.106.1, Zustand 5.0.16, openapi-fetch 0.17.0, openapi-typescript 7.13.0, Router 8.5.1, RHF 7.91.0, Zod 4.6.7, Radix Dialog 1.3.1. Версии quality tooling — ADR README; @radix-ui/themes, Axios, Redux, Next/SSR не добавлять. nginx 1.30.6; Docker Engine 29.9.3/Compose 5.7.0; registry Distribution 3.1.2, образы по digest ADR либо проверенному release manifest. Lock нельзя молча обновлять: при доказанной несовместимости отдельный upgrade-коммит с диагностикой и полным CI, без самовольной смены стека.

## SPEC-04. Общий контракт команды

`CommandContext(actor_id: UUID, idempotency_key: str, expected_revision: int | None)` передаётся прикладной команде. Роль/область и now не принимаются от клиента. UUID, date, timestamptz и Decimal сериализуются по api-contract. Идентичность сессии берётся сервером из Redis SessionTransport.

Порядок: проверить сеанс → начать unit of work → заблокировать актуальные назначения actor/целевой объект → проверить доступ/If-Match/состояние → получить серверное время **после** ожидания блокировок → проверить срок → захватить idempotency record → выполнить все изменения и техническое событие → commit → вернуть ответ. Изменение назначения использует ту же блокировку actor; старый запрос не обходит отзыв при фиксации. Повтор команды сперва проверяет актуальное право, затем hash/idempotency outcome; не возвращает ранее разрешённые данные отозванному пользователю.

Порядок блокировок: доступ → партия/сверка → ВСЭ → корзина проб laboratory/species → отборы по UUID. Блокировки нескольких объектов одного уровня берутся по UUID. READ COMMITTED + явные locks; preview отчёта — REPEATABLE READ. Сеть, renderer, poll вне SQL-транзакции. Repository не вызывает commit. Нельзя использовать одну AsyncSession в параллельных задачах.

`Idempotency-Key` обязателен для create/save/delete, списания, отчёта, массовой цены и приёмки. Scope `(actor_id, action, context_id, key)`, hash канонического запроса включает If-Match и тело. Повтор key/hash возвращает тот же result ID; другой hash — 409 IDEMPOTENCY_MISMATCH. In progress — 202 с operation_id для принятой фоновой команды; конфликт с другой неразрешённой командой — 409 OPERATION_UNRESOLVED. Локальные записи хранятся 30 дней; внешние UNKNOWN не очищаются. После refresh клиент читает сущность/операцию, не генерирует слепой повтор.

## SPEC-05. Время, числа, безопасность

День создания определяется Europe/Moscow по одному server instant команды. `created_at`, `created_by`, `first_completed_at` не меняются при исправлении. Номер ВСЭ уникален после trim, регистр/нули сохранены. Даты физического отбора/утилизации не будущие; утилизация не раньше включённых отборов. Decimal без float: массы NUMERIC(20,6), деньги NUMERIC(20,2), внешние количества NUMERIC без scale с unit ID. Вход выше поддержанной точности отклоняется. Комма/точка нормализуются клиентом в строку с точкой, сервер отклоняет NaN/Infinity/exponent/неполный ввод; пустое не равно нулю.

Сеанс cookie HttpOnly Secure SameSite=Lax; CSRF + Origin на mutations. Redis отказ → 503, deny by default. Политики Casbin читаются каждый защищённый запрос без межзапросного кеша. Идентичность автора не даёт доступа вне области. Кеш/формы очищаются при logout/отзыве. Тексты экранируются; XLSX пользовательский текст не становится формулой. Документы и закрытые ответы no-store. Демо, Faker и fixture endpoints отсутствуют в production. VetIS transport допускает разрешённое чтение тестового контура; write-операции отклоняются до сети во всех средах, `VETIS_WRITE_ENABLED=false`. Наличие test credentials не даёт write capability.

## SPEC-06. Сдача и доказательства

Каждому FT соответствует задача в traceability.md; каждому SC/AT — запись acceptance.md. Исполнитель создаёт `docs/implementation/<plan-id>-evidence.md`: commit/файлы, команды/exit codes, тестовые идентификаторы, скриншоты значимых состояний, подтверждённые параметры/ограничения. Статус теста только passed/failed/not-run с причиной; локальные заглушки не подтверждают ВетИС. Порог backend ≥85%, предметные authz/receipt/examination/samples/pricing/reports ≥90%; frontend ≥80%. Проценты не заменяют критические сценарии.

Обязательные команды backend из корня: `uv sync --frozen`, `uv run --frozen ruff check backend`, `uv run --frozen ruff format --check backend`, `uv run --frozen mypy backend/src`, `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85`. Отдельный gate проверяет предметные 90% по coverage.json. Миграции с нуля и предыдущего релиза на настоящем PostgreSQL, не SQLite.

В `frontend/` создать scripts `lint`, `format:check`, `typecheck`, `test`, `build`, `build-storybook`, `test:e2e`: ESLint, Prettier, tsc --noEmit, Vitest run, Vite build, Storybook build, Playwright test. Проверять `npm.cmd ci` и эти scripts в Windows; Linux CI использует npm. Старый каталог: из корня `npm.cmd run build-storybook`, при auth `npm.cmd run test:ui`. Новые scripts — результат реализации ТЗ, сейчас они не заявляются существующими.
