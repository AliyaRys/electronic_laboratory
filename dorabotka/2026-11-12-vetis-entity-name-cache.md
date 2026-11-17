# ТЗ на фоновое разрешение названий получателя и отправителя по GUID

Дата: 12.11.2026  
Тип задачи: VetIS read integration + local cache + API/read model + frontend

## 1. Цель

В блоке «Участники перевозки» страницы сверки показывать названия объектов,
которые приходят во входящем ВСД только идентификаторами:

```xml
<vd:consignee>
  <dt:businessEntity>
    <bs:uuid>3e188573-0de9-42c1-ab14-1f3e8391cb3e</bs:uuid>
    <bs:guid>0ed40ab2-cda6-4daa-9302-1e21187be0e1</bs:guid>
  </dt:businessEntity>
  <dt:enterprise>
    <bs:uuid>8fb3e002-0997-4ffc-a7bc-d8a5d80975e0</bs:uuid>
    <bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid>
  </dt:enterprise>
</vd:consignee>
```

Пользователь должен видеть:

```text
Сведения о получателе
Хозяйствующий субъект: <businessEntity.name>
Предприятие: <enterprise.name>
```

То же правило применить к отправителю и всем экранам, где уже показываются
участники ВСД.

## 2. Выбранная архитектура

Использовать гибридный вариант:

1. если `name` присутствует в исходном XML, использовать его немедленно;
2. если `name` отсутствует, сохранить GUID/UUID и поставить объект в фоновую
   очередь разрешения имени;
3. worker вызывает read-only методы ВетИС по конкретному GUID;
4. результат сохраняется в contour-scoped локальный cache;
5. API/read model получает имя из cache, а браузер никогда не обращается к
   ВетИС напрямую;
6. не реже одного раза в сутки обновлять только используемые и устаревшие
   записи cache, а не загружать полный список всех организаций без
   необходимости.

Полная ежедневная загрузка `GetRussianEnterpriseList` и
`Exportcenter:GetBusinessEntityList:v2.0` не является базовым вариантом:
она создаёт большой объём данных и лишнюю нагрузку. Полный список допустим
только как отдельная операция первичного backfill, если API/владелец явно
потребуют его.

## 3. Источники и обязательное чтение

До реализации прочитать:

- `AGENTS.md`;
- `docs/TZ_development/plans/2026-11-06-10-vetis-read.md`;
- `docs/TZ_development/plans/mercury-test-integration-contract.md`;
- `docs/TZ_development/plans/data-contract.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `docs/TZ_development/plans/inputs.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/07-common-behavior.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- материалы foundation v1.9 о входящих ВСД и участниках;
- `backend/src/modules/integrations/vetis/{normalizer,adapter,transport,worker,models}.py`;
- `backend/src/modules/arrivals/{schemas,queries,reconciliation}.py`;
- `frontend/src/features/arrivals/{api,ReconciliationForm,ComparisonField}.tsx`;
- все текущие потребители `senderOwner`, `receiverOwner`,
  `senderEnterprise`, `receiverEnterprise`.

## 4. Границы задачи

### Входит

- локальный справочник/cache названий `businessEntity` и `enterprise`;
- read-only адаптеры методов разрешения по GUID;
- фоновая очередь с retry/backoff и защитой от повторов;
- первичное заполнение cache по существующим incoming documents;
- API/read model для названий отправителя и получателя;
- блоки участников на сверке и других существующих экранах;
- тесты fixtures/spy и браузерная проверка.

### Не входит

- запросы ВетИС из браузера;
- внешние write-вызовы, гашение, аннулирование или изменение ВСД;
- удаление или перезапись raw XML;
- изменение UUID/GUID объектов;
- создание полноценного административного реестра всех организаций без
  отдельного требования;
- блокировка импорта ВСД, сверки или гашения из-за временного отсутствия
  человекочитаемого имени.

## 5. Каноническая модель объекта

Для каждого объекта хранить отдельно:

```text
contour: PILOT | PRODUCTION
entity_kind: BUSINESS_ENTITY | ENTERPRISE
guid: стабильный GUID
uuid: UUID версии, nullable
name: название, nullable
source: SOURCE_XML | VETIS_LOOKUP | MANUAL_NOT_ALLOWED
active/status: состояние ответа
source_created_at: nullable
source_updated_at: nullable
last_checked_at: nullable
next_check_at: nullable
failure_count: integer
last_problem_code: nullable
updated_at: timestamp
```

Обязательные ограничения:

- уникальность `(contour, entity_kind, guid)`;
- `BUSINESS_ENTITY` и `ENTERPRISE` с одинаковым GUID никогда не объединять;
- контуры `PILOT` и `PRODUCTION` никогда не смешивать;
- GUID — ключ сопоставления, UUID хранится как версия/диагностика;
- отсутствие `name` не должно удалять запись или создавать подставное имя.

Рекомендуемое имя таблицы: `vetis_reference_names`.
Для очереди можно использовать поля `next_check_at/failure_count` в этой же
таблице либо отдельную `vetis_reference_resolution_jobs`; решение не должно
создавать повторные задания для одной пары contour/kind/guid.

## 6. Приоритет названий

Для read model применять следующий приоритет:

1. `name`, пришедшее в исходном XML текущей source revision;
2. локально сохранённое source name из прежней версии того же документа;
3. имя из `vetis_reference_names`, полученное read-only методом ВетИС;
4. честный fallback `Название не получено`.

Raw XML и source snapshot сохраняют исходные значения и не изменяются только
из-за обогащения cache. Обновление cache не меняет checksum/revision ВСД,
не инвалидирует сверку и не переписывает подтверждённые юридические факты.

Для поддержки можно отдавать `name_source` и `resolved_at`, но технические
GUID/UUID не показывать пользователю вместо названия.

## 7. Импорт и постановка в очередь

При нормализации каждого incoming document:

1. извлечь `businessEntity.guid/uuid/name` и `enterprise.guid/uuid/name` для
   отправителя и получателя;
2. сохранить каждый объект на своём уровне и со своим `entity_kind`;
3. если name есть — upsert cache со `source=SOURCE_XML`;
4. если name отсутствует — upsert запись со статусом `PENDING` и поставить
   read-only resolution job;
5. дедуплицировать задания по `(contour, entity_kind, guid)`;
6. не задерживать импорт ВСД и не отклонять документ из-за отсутствия name.

При повторном sync тот же GUID не должен создавать новые cache-записи или
дубли заданий. Изменение source name должно обновить отображаемое имя, но не
менять юридические snapshots прошлых операций.

Добавить безопасный backfill по уже сохранённым `incoming_documents`:

- прочитать source snapshots;
- создать cache/job для отсутствующих businessEntity/enterprise names;
- не трогать raw XML, checksum, revision и local facts;
- повторный backfill идемпотентен.

## 8. Read-only методы ВетИС

Для cache miss использовать серверные методы:

- `GetEnterpriseByGuid v2` для `entity_kind=ENTERPRISE`;
- `GetBusinessEntityByGUID` для `entity_kind=BUSINESS_ENTITY`.

Оба метода вызываются через `EnterpriseService`:

```text
https://api2.vetrf.ru:8002/platform/services/2.0/EnterpriseService
```

Официальные контракты:

- `https://help.vetrf.ru/wiki/GetEnterpriseByGuid_v2`;
- `https://help.vetrf.ru/wiki/GetBusinessEntityByGUID`.

Для `GetEnterpriseByGuid v2`:

- request: `ws:getEnterpriseByGuidRequest`;
- input: `bs:guid` предприятия;
- response: `dt:enterprise`;
- name: `dt:name`;
- сохранять также response `bs:uuid`, `bs:guid`, `bs:active`, `bs:last`,
  `bs:status`, `bs:createDate`, `bs:updateDate`.

Для `GetBusinessEntityByGUID`:

- request: `ws:getBusinessEntityByGuidRequest`;
- input: `bs:guid` хозяйствующего субъекта;
- response: `ent:businessEntity`;
- для названия использовать `ent:name`, а если оно отсутствует —
  `ent:fullName`, затем `ent:fio`;
- сохранять также response `bs:uuid`, `bs:guid`, `bs:active`, `bs:last`,
  `bs:status`, `bs:createDate`, `bs:updateDate`.

Namespace и XML-типы брать из официального контракта метода и закреплённого
manifest, а не угадывать по входящему ВСД. `GetEnterpriseByGuid v2` возвращает
последнюю активную запись предприятия; worker должен проверять `active/last` и
не заменять корректное имя ошибочной или устаревшей версией ответа.

Требования:

- запросы выполняет только backend worker;
- credentials, apiKey, issuerId и raw SOAP не попадают в frontend, Git или
  пользовательские логи;
- endpoint, namespaces, SOAP actions и XSD/WSDL берутся из закреплённого
  manifest/allowlist;
- write capability остаётся выключенной;
- TLS/schema validation и ограничения размера XML сохраняются;
- timeout/HTTP/XML/permission ошибки переводят запись в retryable/error
  состояние, а не создают выдуманное имя;
- retry с exponential backoff и верхней границей попыток;
- одновременно не выполняются два job для одного ключа;
- worker не делает запрос на каждый просмотр страницы.

Периодическое обновление:

- новые cache miss обрабатываются после read-sync;
- используемые записи обновляются не чаще одного раза в 24 часа;
- успешный lookup обновляет `last_checked_at/next_check_at`;
- временная ошибка оставляет прежнее известное имя и фиксирует диагностику;
- при окончательно неразрешённом имени UI показывает `Название не получено`.

## 9. API и read model

Расширить `ExternalFields`/read model без потери старых полей:

```text
senderOwner: resolved businessEntity name
senderEnterprise: resolved enterprise name
receiverOwner: resolved businessEntity name
receiverEnterprise: resolved enterprise name
```

Допустимо добавить структурированный объект:

```json
{
  "guid": "...",
  "uuid": "...",
  "name": "...",
  "name_source": "SOURCE_XML|VETIS_LOOKUP|MISSING",
  "resolved_at": "..."
}
```

Старые строки для совместимости можно сохранить, но все новые экраны должны
использовать единый read model, а не делать самостоятельное сопоставление.

Кэшированные названия не должны быть получаемыми через публичный endpoint
без проверки scope лаборатории.

## 10. Интерфейс

В `ReconciliationForm` заменить пустую карточку получателя на два
неизменяемых поля:

```text
Сведения о получателе
Хозяйствующий субъект: <name или «Название не получено»>
Предприятие: <name или «Название не получено»>
```

То же сделать для отправителя, если соответствующий блок уже отображает его
данные. Не показывать GUID/UUID пользователю вместо названия.

Состояния:

- `loading` — «Уточняем названия организаций…»;
- `resolved` — показывается название;
- `missing` — «Название не получено», сверка при этом не блокируется;
- `error` — «Название временно недоступно», повтор выполняется worker,
  а не кликом по экрану.

Названия участников не являются обязательным условием сохранения сверки,
расчёта стоимости или гашения, если их GUID присутствуют и остальные
бизнес-поля валидны.

## 11. Тесты

Backend/normalizer:

1. XML с businessEntity/enterprise names сохраняет оба name на правильном
   уровне.
2. XML только с GUID создаёт две cache/job записи правильного kind.
3. Один GUID в двух документах contour создаёт одну cache-запись и одно
   deduplicated job.
4. Одинаковые GUID разных kind или contour не объединяются.
5. Успешный `GetEnterpriseByGuid` сохраняет enterprise name.
6. Успешный `GetBusinessEntityByGUID` сохраняет businessEntity name.
7. Ошибка API не удаляет прежнее имя и назначает retry.
8. Backfill существующих документов идемпотентен.
9. Cache update не меняет raw XML/checksum/revision и reconciliation facts.
10. Worker не вызывает никаких VetIS write methods.

API/frontend:

1. `GET /arrivals/{party_id}/reconciliation` возвращает названия получателя
   и отправителя из единого read model.
2. Карточка получателя содержит оба поля: хозяйствующий субъект и предприятие.
3. При отсутствии name показывается fallback, но форма остаётся рабочей.
4. Нет запросов ВетИС из браузера.
5. Проверить loading/missing/error/long name и ширины 1440/1024/768/390 px.

## 12. Docker, данные и Git

После реализации пересобрать без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять пользователей/ВСД/ВСЭ и не
включать VetIS write capability агентом.

Работать в отдельной ветке, проверить `git status`, отправить ветку в GitHub,
обновить `main` через `git pull --ff-only`, объединить без force-push и
отправить `main`. При защищённом main создать Pull Request.

## 13. Критерии готовности

- блок получателя показывает названия хозяйствующего субъекта и предприятия;
- названия получаются фоновым read-only worker и кэшируются;
- браузер не делает внешние запросы ВетИС;
- отсутствие name не блокирует сверку/гашение и не показывает сырой GUID;
- contour и entity kind изолированы;
- повторный sync/backfill не создаёт дубли;
- raw XML, checksum и юридические факты не изменяются из-за enrichment;
- backend/frontend tests проходят, контейнеры пересобраны;
- ветка отправлена в GitHub и объединена с main либо создан Pull Request.
