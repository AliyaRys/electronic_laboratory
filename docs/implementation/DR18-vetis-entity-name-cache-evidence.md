# DR18 — Названия участников из кэша ВетИС (vetis_reference_names): доказательства реализации

Дата: 13.11.2026 · Ветка: `feature/DR18-vetis-entity-name-cache` (база main 39c2495) · worktree: `C:\electronic_lab_dev-dr18`

## Что сделано

- **Модель/таблица** (`backend/src/modules/integrations/vetis/models.py`, миграция
  `backend/migrations/versions/0018_vetis_reference_names.py`): `vetis_reference_names` с моделью §5 —
  композитный PK `(contour, entity_kind, guid)`, `name` nullable, `source ∈ {SOURCE_XML, VETIS_LOOKUP}`
  (nullable — у записи PENDING имени ещё не было), `status ∈ {PENDING, RESOLVED, ERROR}`, `active`,
  `source_created_at/source_updated_at`, очередь в самой записи (`last_checked_at/next_check_at/failure_count`),
  `last_problem_code`, `updated_at`; CHECK-ограничения на contour/kind/source/status/failures; индекс очереди
  `(status, next_check_at)`. R-DR18-1: kind и contour никогда не смешиваются, отсутствие `name` не удаляет
  запись и не создаёт подставного имени. `CURRENT_SCHEMA_REVISION = "0018_vetis_reference_names"` (readiness-гвард
  `/health/ready` и тест консистентности — обновлены согласованно). Даунгрейд удаляет только новую таблицу.
- **Импорт** (`backend/src/modules/arrivals/commands.py::upsert_incoming`): при каждом импорте/реимпорте
  `upsert_reference_names` в SAVEPOINT — name есть → `SOURCE_XML`/RESOLVED (при изменении source name имя
  обновляется; VETIS_LOOKUP-имя пустым не перетирается), name нет → PENDING (source=None, due немедленно).
  Импорт никогда не задерживается и не отклоняется: любой сбой обогащения только логируется
  (`reference_name_upsert_failed`). Повторный sync не создаёт дублей (дедуп по PK — R-DR18-3). Нормализатор
  сохраняет теперь и `uuid` предприятия на уровне `dt:enterprise` (`_participant.enterprise_uuid`).
- **Worker** (`backend/src/modules/integrations/vetis/reference_names.py` + `worker.py::reference_names_tick`,
  cron каждую минуту вместе с тиком словаря назначений): дедуплицированная очередь — `FOR UPDATE SKIP LOCKED`
  по due-записям (PENDING/ERROR + RESOLVED старше 24 ч), lease 5 мин на ключ; read-only методы
  `GetEnterpriseByGuid v2` и `GetBusinessEntityByGUID` (каскад `ent:name → ent:fullName → ent:fio`) через
  EnterpriseService. Endpoint (`enterprise_endpoint`), namespace (`registry_definitions`) и SOAP actions —
  только из закреплённого manifest (`backend/resources/vetis/manifest.json`, schema обновлён; R-DR18-4), НЕ из
  ВСД XML. Ответ проверяется на `active=true` и `last=true` — неактивная/не-последняя запись не заменяет
  корректное имя (`VETIS_REFERENCE_NOT_LAST`/`INACTIVE`). Ошибки (HTTP/XML/permission/timeout) — retryable:
  exponential backoff `min(60с·2^(n-1), 24ч)`, прежнее имя сохраняется, диагностика честная. Write-методы
  недостижимы (в баундари есть только два read-only метода; `is_read_only_operation`).
  Запросов на каждый просмотр страницы нет; обновление используемых записей не чаще 24 ч.
- **Read model** (§6, R-DR18-2): `reference_names.resolve_participants` — приоритет: XML name текущей ревизии →
  cache `SOURCE_XML` (прежняя ревизия того же документа) → cache `VETIS_LOOKUP` → fallback. Старые ключи
  сохранены; добавлены `senderOwner/senderEnterprise/receiverOwner/receiverEnterprise` и их состояния
  `<key>NameSource ∈ {SOURCE_XML, VETIS_LOOKUP, PENDING, ERROR, MISSING}`. Включено в `IncomingView.external.fields`
  (`queries.build_incoming_view`) и в сверку (`reconciliation.source_projection(..., names=...)` — GET
  `/arrivals/{party_id}/reconciliation` и сохранение/валидация/ответ PUT используют единый источник).
  Обогащение не трогает raw XML/checksum/revision, reconciliation/receipt факты (тест). GUID/UUID пользователю
  вместо названия не отдаются. Кэш читается только внутри лабораторно-scoped эндпоинтов (public API нет).
- **Backfill**: `backfill_reference_names` (idempotent, только производные записи), запускается на старте
  worker (`_startup`, сбой не блокирует worker); повторный прогон создаёт ничего нового (тест).
- **Frontend** (`ReconciliationForm.tsx`, `api.ts`, `reconciliation.css`): карточки «Сведения об отправителе» /
  «Сведения о получателе» — неизменяемые поля «Хозяйствующий субъект» и «Предприятие» с честными состояниями:
  loading «Уточняем названия организаций…», resolved — название, missing «Название не получено» (сверка не
  блокируется), error «Название временно недоступно» (повтор делает worker, не клик). GUID/UUID не показываются;
  длинные названия переносятся (`overflow-wrap`). TS-схема перегенерирована (`gen:api`) — diff нулевой,
  контракты совместимы.
- **Тайна**: endpoint/actions без секретов; apiKey/issuerId/raw SOAP не попадают в frontend/Git/логи (логи
  несут только counters/contour/problem code); write capability остаётся выключенной; write-операции
  недостижимы через lookup-границу (только два read-метода, без submit/receive пути; тест проверяет
  classifier и отсутствие write-методов у boundary); TLS/ограничения XML сохранены (transport наследует
  guards словарного транспорта).

## Тесты

- Backend (`backend/tests/vetis/test_reference_names.py`, 12): XML-имена по своим уровням; GUID-only → PENDING
  нужных kind; дедуп; kind/contour не смешиваются; успешный GetEnterpriseByGuid сохраняет имя (вкл. uuid,
  24ч-обновление); каскад name→fullName→fio; ошибка сохраняет прежнее имя + retry, not-last не заменяет имя;
  идемпотентный backfill; обогащение не меняет raw XML/checksum/revision и факты сверок; worker вызывает только
  read-only методы; пиннед-конструкторы запросов/парсеры. Fix round 1: регрессионный тест изоляции kind на
  read-пути (один GUID в двух kind → каждое имя из СВОЕЙ строки) и тест guard'а эха GUID (mismatch не
  применяется, диагностика + retry); тест write-границы заменён честным (classifier + отсутствие write-методов
  у boundary, без самоподнимаемого исключения).
- API/read model (`backend/tests/arrivals/test_dr18_participant_names.py`, 4): эндпоинт сверки возвращает
  названия из единого read model (PENDING → VETIS_LOOKUP), без GUID; приоритет XML → cache в projection;
  честные тексты состояний; отсутствие имени не блокирует сверку.
- Frontend (`ReconciliationForm.test.tsx`, 6 новых): оба поля в обеих карточках; loading/missing/error
  состояния; форма остаётся рабочей при missing; GUID не выводится; длинное название; отсутствие внешних
  запросов ВетИС из браузера (MSW-ловушка на `api2.vetrf.ru`).

## Gate-результаты (на закоммиченном дереве)

- `uv run --frozen ruff check backend frontend/tests/e2e` — пройдено.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis backend/tests/catalog_pricing -q` —
  пройдено (заранее известные 2 падения `backend/tests/examinations/test_delete.py` не относятся к DR18 и
  воспроизводятся на main; см. отчёт).
- Frontend: `format:check`, `typecheck`, `lint` (1 предсуществующее предупреждение в
  `catalogs/use-catalog-context.ts`, не из DR18), `test -- --run`, `build`, `build-storybook` — пройдено.

## Честно не выполнено / за контроллером

- Живой read-only вызов ВетИС (обе операции) — за контроллером после деплоя (в тестах запрещён и не выполнялся).
- Пересборка Docker-контейнеров — контроллер (docker-команды агентом не выполнялись).
- Полный список организаций (GetRussianEnterpriseList/GetBusinessEntityList) — сознательно не реализован (§2).
- Структурированный объект `{guid, uuid, name, name_source, resolved_at}` в API — опционален (§9); реализованы
  плоские поля + состояния `NameSource`, структуры отложены до требования владельца.
