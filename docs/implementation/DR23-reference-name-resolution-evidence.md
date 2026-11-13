# DR23 — Разрешение названий получателя из справочника ВетИС (evidence)

Дата: 2026-11-13. Ветка: `feature/DR23-reference-name-resolution`.
ТЗ: `dorabotka/2026-11-13-vetis-reference-name-resolution.md` (§1–9), rulings R-DR23-1..6.

## 1. Подтверждение причины (ТЗ §2)

`reference_names_tick()` загружал только committed
`backend/resources/vetis/manifest.json` (`load_manifest`) со статусом
`schema_pins.status = "PENDING"` и никогда не накладывал runtime overlay
`VETIS_SCHEMA_PINS` (`/run/secrets/vetis-pins.json`, статус `PINNED`).
`compose_reference_transport()` при `PENDING` возвращает
`INTEGRATION_NOT_CONFIGURED` до любого сетевого вызова →
`GetBusinessEntityByGUID`/`GetEnterpriseByGuid` не выполнялись, PENDING-строки
оставались неразрешёнными, UI показывал «Уточняем названия организаций…».
Worker публиковал только факт cron-запуска, не результат тика.

Воспроизведено тестом `test_11_not_configured_result_is_visible_and_safe`
(без pins → `{"result": "NOT_CONFIGURED", "problem": "INTEGRATION_NOT_CONFIGURED"}`).

## 2. Общий loader (ТЗ §5.1, R-DR23-1)

`backend/src/modules/integrations/vetis/manifest.py`:

- `manifest_path()` — расположение committed манифеста;
- `load_runtime_manifest()` — ЕДИНЫЙ путь: committed manifest →
  `VETIS_SCHEMA_PINS` → `load_manifest_with_pins()` (SHA-256 WSDL/XSD и
  наличие файлов) → статус `PINNED` только после успешной проверки;
  отсутствующий/нечитаемый pins-файл, статус `PENDING` →
  `ProblemError INTEGRATION_NOT_CONFIGURED`; checksum mismatch →
  `ManifestPinError INTEGRATION_SCHEMA_PIN_MISMATCH`; сеть не вызывается.

Использование единого пути:

- `compose_read_adapter()` (worker) — при неустроенной конфигурации честно
  сохраняет прежнее поведение «503 без сети» через committed manifest;
- `purpose_sync_tick()` — `NOT_CONFIGURED` при отказе конфигурации;
- `reference_names_tick()` — см. §3.

Runtime overlay не изменяет committed manifest на диске (тест
`test_1_...`: после загрузки на диске остаётся `PENDING`), не попадает во
frontend и логи (в диагностике только счётчики и коды проблем).

## 3. Исправление тика (ТЗ §5.2, R-DR23-2)

`reference_names_tick()`: runtime manifest → `compose_reference_transport` →
`resolve_due_reference_names(session, transport, contour=manifest.contour)`.
Добавлен контурный фильтр клейма: тик одного контура не читает и не меняет
строки другого контура (PILOT не трогает PRODUCTION, тест 8). Write-методы
(`ProcessIncomingConsignment`, submit, receive) недостижимы: спай-транспорт
фиксирует только `GetEnterpriseByGuid`/`GetBusinessEntityByGUID` (тест 10).
Успех строки: name, source=VETIS_LOOKUP, status=RESOLVED, last_checked_at,
next_check_at=now+NAME_REFRESH_INTERVAL, failure_count=0,
last_problem_code=null (тест 6). Повторный тик идемпотентен (тест 9).
Ручные SQL UPDATE имён не выполнялись; raw XML/checksum/revision/партии/
сверки/гашения не тронуты (в диффе только worker/manifest/reference_names/
тесты/frontend).

## 4. Диагностика (ТЗ §5.3, R-DR23-3)

`_log_reference_names_tick()` публикует структурированную запись
`reference_names_tick` в логгер `vetis.worker` с полями result, claimed,
resolved, retried, problem_code, contour. Без credentials/apiKey/issuerId/
raw SOAP/XML (тест 11 проверяет отсутствие запрещённых строк).
`INTEGRATION_NOT_CONFIGURED` возвращает `result=NOT_CONFIGURED` с нулевыми
счётчиками и проблемным кодом — не выглядит как успешный пустой тик.

## 5. Frontend (ТЗ §6, R-DR23-4)

- `frontend/src/features/arrivals/api.ts`: константы
  `NAME_POLL_INTERVAL_MS = 1500`, `NAME_POLL_MAX_MS = 30000` и
  `hasPendingParticipantNames()` — refetch только при
  `NameSource=PENDING` хотя бы у одного из четырёх полей.
- `frontend/src/pages/ReconciliationPage.tsx`: ограниченный polling открытой
  страницы — каждые 1.5 с перечитывает arrival + reconciliation endpoint,
  не дольше 30 с; остановка после RESOLVED/ERROR/MISSING; таймер снимается
  при закрытии экрана, in-flight запросы отменяются через AbortSignal
  react-query. Повторные GET — только чтение локального read model, никаких
  обращений к api2.vetrf.ru/EnterpriseService/SOAP (проверено тестом с
  перехватом всех запросов). Пользовательские actual/reason/отметки не
  сбрасываются: react-hook-form defaultValues читаются только при монтировании
  (тест «keeps the entered actual value…»).

Тексты состояний без изменений (DR18): «Уточняем названия организаций…» /
«Название временно недоступно» / «Название не получено»; GUID/UUID никогда не
показываются.

## 6. Тесты (ТЗ §7)

Backend — `backend/tests/vetis/test_dr23_runtime_manifest.py` (§7.1–7.11):
1 runtime PINNED поверх committed PENDING (диск не изменяется); 2a отсутствующий
pins-файл; 2b PENDING; 2c checksum mismatch; 2d отсутствующий закреплённый файл
— все ProblemError без сети; 3 тик с runtime PINNED → SUCCESS и передаёт resolver
transport; 4 PENDING businessEntity → только GetBusinessEntityByGUID;
5 PENDING enterprise → только GetEnterpriseByGuid; 6 успех → RESOLVED/VETIS_LOOKUP
и read model отдаёт receiverOwner/receiverEnterprise; 7 timeout/5xx/чужой GUID/
active=false/last=false/без имени → retry/backoff с сохранением прежнего имени;
8 PILOT не трогает PRODUCTION; 9 повтор идемпотентен; 10 никаких write-методов;
11 NOT_CONFIGURED + счётчики в безопасной диагностике.
API-уровень — `backend/tests/arrivals/test_dr23_reference_names_api.py`:
разрешение воркером достигает GET `/reconciliation`.

Frontend:
- `frontend/src/pages/ReconciliationPage.polling.test.tsx` — 6 тестов:
  честный текст → имя после mock GET без навигации; два PENDING-поля;
  остановка polling после RESOLVED/unmount; ввод не сбрасывается; нет запросов
  к ВетИС из браузера; константы опроса.
- `frontend/src/features/arrivals/ParticipantNameStates.test.tsx` — состояния
  loading/resolved/error/missing, длинное название целиком, карточка получателя
  на 390 px. Визуальная проверка вёрстки на 390 px в jsdom ограничена
  наличием/подписью блока (CSS-раскладку подтверждает Storybook, сборка
  каталога выполнена).

Все тесты — на обезличенных fixtures и transport-спае; живые вызовы ВетИС
запрещены и отсутствуют.

## 7. Гейты (результаты на закоммиченном дереве)

- `uv run --frozen ruff check backend frontend/tests/e2e` — pass.
- `uv run --frozen pytest backend/tests/vetis backend/tests/arrivals -q` — см. §8.
- Frontend: format:check, typecheck, lint, test, build, build-storybook — см. §8.

(Конкретные итоги — в отчёте контроллеру; известные 2 предсуществующих
падения `backend/tests/examinations/test_delete.py` не связаны с DR23.)

## 8. Честные оговорки (не выполнялось)

- Пересборка контейнеров и живая проверка тика в контейнере — за контроллером
  (ТЗ §8): `docker compose ... up -d --build backend frontend vetis-worker`,
  затем `reference_names_tick()` в контейнере: ожидается `result=SUCCESS` и
  `resolved > 0` для текущих PENDING-записей либо честный диагностический код
  временной ошибки ВетИС.
- Merge в main и публикация ветки — за контроллером.
