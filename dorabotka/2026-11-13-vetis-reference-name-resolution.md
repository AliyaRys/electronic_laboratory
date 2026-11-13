# ТЗ на исправление разрешения названий получателя из справочника ВетИС

Дата: 13.11.2026  
Тип задачи: исправление конфигурации worker/read model + обновление страницы сверки

## 1. Симптом

При переходе к сверке партии в карточке «Сведения о получателе» отображаются:

```text
Предприятие                 Уточняем названия организаций…
Хозяйствующий субъект       Уточняем названия организаций…
```

Ожидается, что оба значения будут получены из локального справочника
`vetis_reference_names`, заполненного read-only вызовами ВетИС:

- предприятие — `GetEnterpriseByGuid v2`;
- хозяйствующий субъект — `GetBusinessEntityByGUID`.

Существующую архитектуру из ТЗ DR18/DR21 сохранять: браузер не обращается к
ВетИС, GUID не показывается пользователю, второй справочник не создаётся.

## 2. Подтверждённая причина

Проблема находится в composition root worker, а не в JSX или CSS.

### 2.1. Что означает текущий текст

`ReconciliationForm` показывает «Уточняем названия организаций…», когда API
возвращает:

```text
<key>NameSource = PENDING
<key> = null
```

`resolve_participants()` только читает локальный cache и не выполняет запросов
ВетИС из GET сверки. Поэтому текст означает, что запись в cache создана, но
worker ещё не выполнил успешное разрешение имени.

### 2.2. Данные окружения и кодовый разрыв

В рабочей БД на момент расследования присутствовали PENDING-записи получателя:

```text
PILOT / BUSINESS_ENTITY / 0ed40ab2-cda6-4daa-9302-1e21187be0e1
PILOT / ENTERPRISE      / d562919c-05d8-442f-840d-4c37d41dcae1
```

У них отсутствуют `name` и `last_checked_at`, а `next_check_at` уже просрочен.
Значит, очередь импорта создана, но lookup не был выполнен.

Причина:

1. `backend/resources/vetis/manifest.json` содержит
   `schema_pins.status = "PENDING"`.
2. Установленный runtime-файл `/run/secrets/vetis-pins.json` содержит
   `status = "PINNED"`, WSDL и четыре XSD с checksum.
3. `compose_read_adapter()` накладывает runtime pin overlay через
   `load_manifest_with_pins()`.
4. `reference_names_tick()` загружает только `load_manifest(manifest_path)` и
   не накладывает `/run/secrets/vetis-pins.json`.
5. `compose_reference_transport()` видит committed manifest со статусом
   `PENDING` и возвращает `INTEGRATION_NOT_CONFIGURED` до любого сетевого
   вызова.

Проверка в контейнере воспроизводит результат:

```text
reference_names_tick() -> {'result': 'NOT_CONFIGURED',
                           'problem': 'INTEGRATION_NOT_CONFIGURED'}
```

Таким образом, `GetBusinessEntityByGUID` и `GetEnterpriseByGuid` для этих
строк фактически не вызываются. Worker логирует только выполнение cron-задачи,
но не публикует результат `reference_names_tick()`, поэтому причина незаметна
оператору. Frontend честно отображает состояние `PENDING`.

## 3. Цель и результат

После исправления:

1. worker использует тот же проверенный runtime manifest с pin overlay, что и
   основной VetIS read adapter;
2. due-записи `PENDING` разрешаются read-only вызовами ВетИС;
3. названия сохраняются в `vetis_reference_names` как `VETIS_LOOKUP/RESOLVED`;
4. GET сверки возвращает `receiverEnterprise` и `receiverOwner` с именами;
5. уже открытая страница сверки обновляет значения после завершения lookup без
   повторного перехода на страницу;
6. ни один write-вызов ВетИС не выполняется.

Ожидаемый результат в интерфейсе:

```text
Предприятие                 <название предприятия получателя>
Хозяйствующий субъект       <название хозяйствующего субъекта получателя>
```

## 4. Обязательное чтение перед реализацией

- `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`;
- `dorabotka/2026-11-12-vetis-entity-name-cache.md`;
- `dorabotka/2026-11-13-participant-enterprise-owner-fields.md`;
- `backend/src/modules/integrations/vetis/manifest.py`;
- `backend/src/modules/integrations/vetis/worker.py`;
- `backend/src/modules/integrations/vetis/reference_names.py`;
- `backend/src/modules/integrations/vetis/transport.py`;
- `backend/src/modules/arrivals/queries.py`;
- `backend/src/modules/arrivals/reconciliation.py`;
- `frontend/src/pages/ReconciliationPage.tsx`;
- `frontend/src/features/arrivals/api.ts`;
- `frontend/src/features/arrivals/ReconciliationForm.tsx`;
- `docs/implementation/DR18-vetis-entity-name-cache-evidence.md`;
- `docs/implementation/DR21-participant-fields-evidence.md`;
- `docs/TZ_development/plans/mercury-test-integration-contract.md`;
- существующие backend/frontend tests DR18 и DR21.

## 5. Backend: единый runtime manifest для всех read-only worker-задач

### 5.1. Общий loader

Создать или расширить общий composition helper, например
`load_runtime_manifest()`, который:

1. загружает committed `backend/resources/vetis/manifest.json`;
2. читает путь из `VETIS_SCHEMA_PINS`;
3. применяет `load_manifest_with_pins()`;
4. проверяет SHA-256 WSDL/XSD и наличие всех указанных файлов;
5. возвращает manifest со статусом `PINNED` только после успешной проверки;
6. при отсутствии файла, mismatch checksum или статусе `PENDING` возвращает
   контролируемую `INTEGRATION_NOT_CONFIGURED` либо
   `INTEGRATION_SCHEMA_PIN_MISMATCH` без сетевого вызова.

Нельзя дублировать собственную загрузку pin-файла в каждом worker-тикe.
`compose_read_adapter()`, `purpose_sync_tick()` и `reference_names_tick()` должны
использовать единый путь загрузки. Runtime overlay не должен менять committed
manifest на диске и не должен попадать во frontend или логи.

### 5.2. Исправление resolver tick

`reference_names_tick()` должен:

- загрузить runtime manifest через общий loader;
- собрать `compose_reference_transport(runtime_manifest)`;
- вызвать `resolve_due_reference_names()`;
- обработать все due-записи в пределах существующего лимита;
- сохранить результат отдельными транзакциями по существующему контракту;
- не выполнять `ProcessIncomingConsignment`, submit, receive или иные write
  операции.

Для текущих записей получателя должны выполняться разные read-методы:

```text
BUSINESS_ENTITY → GetBusinessEntityByGUID
ENTERPRISE      → GetEnterpriseByGuid v2
```

Сохранить проверки ответа:

- ответ относится к запрошенному GUID;
- запись активна (`active=true`);
- запись последняя (`last=true`);
- имя получено по каскаду `name → fullName → fio`;
- contour и `entity_kind` не смешиваются.

После успеха строка cache должна иметь:

```text
name = resolved name
source = VETIS_LOOKUP
status = RESOLVED
last_checked_at = заполнен
next_check_at = now + NAME_REFRESH_INTERVAL
failure_count = 0
last_problem_code = null
```

Существующие `PENDING`-строки обрабатывать автоматически следующим tick или
безопасным idempotent backfill. Не выполнять ручной SQL UPDATE имени в рамках
задачи и не менять raw XML, checksum, source revision, партии, сверки или
гашения.

### 5.3. Диагностика worker

Результат каждого `reference_names_tick()` должен быть виден в
структурированном безопасном логе/метрике:

- `result`;
- `claimed`;
- `resolved`;
- `retried`;
- `problem_code` при отказе конфигурации или транспорта;
- contour.

Не выводить credentials, apiKey, issuerId, raw SOAP, XML и полные секретные
профили. `INTEGRATION_NOT_CONFIGURED` не должен выглядеть как успешный пустой
тик.

## 6. Frontend: актуализация открытой сверки

### 6.1. Начальная загрузка

Сохранить текущий API и read-only модель:

- GET `/arrivals/{party_id}/reconciliation` читает cache;
- браузер не знает endpoint ВетИС и не вызывает его;
- GUID/UUID не показываются вместо имени;
- `SOURCE_XML` и `VETIS_LOOKUP` показываются как имя.

### 6.2. Ожидание фонового lookup

Если ответ содержит `PENDING` для одного или нескольких полей получателя или
отправителя, страница должна ограниченно перечитать reconciliation endpoint,
например раз в 1–2 секунды не дольше 30 секунд. Параметры зафиксировать в
константах и покрыть тестом.

Правила:

1. refetch запускается только при наличии `NameSource=PENDING`;
2. после получения имени polling прекращается;
3. после `ERROR` показывается «Название временно недоступно» и polling не
   превращается в бесконечные запросы;
4. при окончательном `MISSING` показывается «Название не получено»;
5. пользовательские фактические значения, отметки и причины mismatch не
   сбрасываются при обновлении names;
6. повторные GET не создают cache jobs и не вызывают ВетИС;
7. при закрытии страницы таймер/запрос отменяется.

Если за отведённое время worker не разрешил имя, оставить честное состояние
`PENDING` либо показать согласованный статус ошибки, но не показывать GUID и не
создавать фиктивное совпадение.

## 7. Тесты

### Backend/runtime configuration

1. `load_runtime_manifest()` накладывает runtime `PINNED` поверх committed
   `PENDING` и возвращает рабочий manifest.
2. Отсутствующий pins-файл, `PENDING` или checksum mismatch не вызывает сеть и
   возвращает ожидаемый ProblemError.
3. `reference_names_tick()` при runtime `PINNED` не возвращает
   `INTEGRATION_NOT_CONFIGURED` и передаёт resolver transport.
4. У PENDING businessEntity вызывается только `GetBusinessEntityByGUID`.
5. У PENDING enterprise вызывается только `GetEnterpriseByGuid`.
6. Успешный ответ переводит обе строки получателя в `RESOLVED/VETIS_LOOKUP` и
   GET сверки отдаёт `receiverOwner` и `receiverEnterprise`.
7. Ответ с другим GUID, `active=false`, `last=false`, отсутствующим именем,
   timeout и 5xx дают retry/backoff без потери прежнего имени.
8. Контур `PILOT` не читает и не изменяет строки `PRODUCTION`.
9. Повторный tick идемпотентен и не создаёт дубликаты строк/операций.
10. Worker не вызывает `ProcessIncomingConsignment` и другие write-методы.
11. Результат `NOT_CONFIGURED` и counters появляются в безопасной диагностике.

### Frontend/API

1. При `PENDING` первая карточка показывает текущий честный текст, затем после
   mock GET с `VETIS_LOOKUP` показывает название без навигации.
2. При двух PENDING-полях получателя обновляются обе карточки.
3. Polling прекращается после RESOLVED/ERROR/MISSING и после unmount.
4. В процессе refetch не сбрасываются введённые actual/reason и marks.
5. В браузере нет запросов на `api2.vetrf.ru`, `EnterpriseService` или SOAP.
6. Проверить состояния loading, resolved, error, missing, длинное название и
   узкий экран 390 px.

Тесты используют обезличенные fixtures и transport spy. Живые write-вызовы
ВетИС запрещены.

## 8. Docker, данные и Git

Перед запуском проверить, что **backend и vetis-worker** получают один и тот же
server-side `VETIS_SCHEMA_PINS` и `VETIS_SECRET_PROFILE`. Файлы не добавлять в
Git и не выводить в логи.

После реализации пересобрать контейнеры без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Проверить в контейнере безопасно, без вывода содержимого секретов:

```powershell
docker exec electronic_lab_dev-vetis-worker-1 python -c "import asyncio; from backend.src.modules.integrations.vetis.worker import reference_names_tick; print(asyncio.run(reference_names_tick()))"
```

Ожидается `result=SUCCESS` и `resolved > 0` для текущих PENDING-записей либо
честный диагностический код временной ошибки ВетИС. После этого открыть страницу
сверки и убедиться, что названия получателя отображаются.

Запрещено:

- `docker compose down -v`;
- удаление или пересоздание PostgreSQL volume;
- destructive seed/reset;
- ручное удаление пользователей, ВСД, партий, сверок, ВСЭ, проб и отчётов;
- выполнение VetIS write capability.

Работать в отдельной feature-ветке. Не затирать существующие изменения.
Вместе с кодом закоммитить этот файл ТЗ, затем:

1. выполнить backend/frontend tests;
2. отправить feature-ветку в GitHub;
3. обновить `main` через `git pull --ff-only`;
4. объединить feature-ветку с `main` без force-push;
5. отправить обновлённый `main` в GitHub.

При защищённой ветке `main` создать Pull Request с указанием файла:

`dorabotka/2026-11-13-vetis-reference-name-resolution.md`

## 9. Критерии готовности

- `reference_names_tick()` использует runtime `PINNED` manifest, а не только
  committed `PENDING` manifest;
- текущие PENDING-записи получателя разрешаются двумя правильными read-only
  методами;
- в API появляются `receiverEnterprise` и `receiverOwner` с именами и
  состоянием `VETIS_LOOKUP`;
- открытая страница сверки обновляет обе карточки без повторной навигации;
- браузер не выполняет запросы ВетИС;
- ошибки конфигурации и транспорта диагностируются, а не маскируются
  бесконечным «Уточняем…»;
- данные пользователей, партий, ВСД, сверок, ВСЭ и volume сохранены;
- тесты проходят, контейнеры пересобраны;
- feature-ветка вместе с ТЗ объединена с `main` и отправлена в GitHub либо
  создан Pull Request.
