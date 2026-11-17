# ТЗ на добавление сверки способа хранения продукции при перевозке

Дата: 12.11.2026  
Тип задачи: VetIS XML normalization + API/read model + reconciliation UI

## 1. Цель

В блоке сверки:

«Ветеринарно-санитарная оценка и идентификация транспорта»

добавить сравниваемое поле:

```text
Способ хранения продукции при перевозке
```

Значение должно приходить из:

```xml
<vd:transportStorageType>CHILLED</vd:transportStorageType>
```

Пользователь должен увидеть русское название, выбрать «Совпадает» или «Не
совпадает», а при несоответствии ввести фактическое значение и причину.

## 2. Подтверждённая причина отсутствия поля

Сейчас:

1. `backend/src/modules/integrations/vetis/normalizer.py` не извлекает
   `vd:transportStorageType` при разборе XML.
2. В `backend/src/modules/arrivals/reconciliation.py::source_projection()`
   поле `storage` принудительно заполняется `None`.
3. `frontend/src/features/arrivals/api.ts::comparedFields()` не добавляет
   `CHK-F12` в транспортный блок.
4. В `backend/src/modules/arrivals/validation.py` `CHK-F12` уже описан как
   обязательное недопустимое расхождение, но пользователь не может его
   отметить в интерфейсе.

В результате блок получателя/транспорта не показывает поле, хотя исходный XML
его содержит.

## 3. Каноническая карта кодов

Использовать единый backend/domain mapping:

| Код XML | Русское название |
| --- | --- |
| `FROZEN` | Замороженный |
| `CHILLED` | Охлажденный |
| `COOLED` | Охлаждаемый |
| `VENTILATED` | Вентилируемый |

Сохранять одновременно:

- исходный код `storageCode` для бизнес-правил, XML и диагностики;
- русское `storage`/`storageLabel` для интерфейса.

Не переводить код в frontend отдельным словарём. Один словарь должен быть
источником для API, сверки и любых документов.

Если ВетИС передал неизвестный будущий код:

- сохранить исходный код;
- показать «Неизвестный способ хранения»;
- записать диагностическую информацию;
- не считать его соответствующим автоматически;
- не отбрасывать весь ВСД.

## 4. Обязательное чтение

До работы прочитать:

- `AGENTS.md`;
- `docs/TZ_development/plans/API REQUESTS.txt`;
- `docs/TZ_development/plans/field-mapping.md`;
- `docs/TZ_development/plans/2026-11-06-04-arrivals.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/08-field-catalog.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/09-checklist-reconciliation.md`;
- `backend/src/modules/integrations/vetis/{normalizer,schemas}.py`;
- `backend/src/modules/arrivals/{schemas,reconciliation,validation,queries}.py`;
- `frontend/src/features/arrivals/{api,ReconciliationForm,ComparisonField}.tsx`;
- существующие XML normalizer/reconciliation/frontend tests.

## 5. Backend и read model

### 5.1. Normalizer

Расширить типизированную модель `VdDocument`/эквивалентное source snapshot
полем `transportStorageType` и извлекать его namespace-aware путём:

```text
vd:certifiedConsignment/vd:transportStorageType
```

Не искать по произвольному `local-name` и не читать значение из UI.

Сохранять код в source snapshot рядом с остальными реквизитами ВСД. Raw XML,
checksum и исходная revision остаются неизменными.

### 5.2. Source projection

В `source_projection()` сформировать:

```text
storageCode = исходный код XML
storage = русская расшифровка кода
```

При отсутствии поля source value остаётся отсутствующим: поле не требуется
отмечать фиктивно. При неизвестном непустом коде source value присутствует и
требует явной отметки сравнения.

### 5.3. ExternalFields/API

Расширить `IncomingView.external.fields` согласованными ключами:

- `storageCode` — исходный код;
- `storage` или `storageLabel` — русское название.

Старые поля API не удалять. Сгенерировать/обновить TypeScript schema после
изменения OpenAPI.

Для уже сохранённых incoming documents выполнить безопасный backfill из
`vetis_source_documents.raw_xml`/source snapshot:

- обновить только производное поле хранения;
- не менять raw XML, checksum, source identity, ETag и local facts;
- повторный backfill идемпотентен.

## 6. Frontend-сверка

В `comparedFields()` добавить после номера ТС и до наблюдений транспорта:

```text
fieldId: CHK-F12
block: transport
label: Способ хранения продукции при перевозке
source: storageLabel
```

Поле должно использовать общий `ComparisonField`, а не локальную копию
разметки. Визуально оно должно соответствовать существующей карточке:

- русское исходное значение, например «Охлажденный»;
- кнопка «Совпадает» с `comparison-match`;
- кнопка «Не совпадает» с `comparison-mismatch`;
- при mismatch — фактическое значение и причина;
- placeholder фактического поля: `Фактический способ хранения`;
- кнопки «Отмена» и «Ок» — по существующему API карточки;
- доступное имя и visible focus сохраняются.

Пример для `CHILLED`:

```text
Способ хранения продукции при перевозке
Охлажденный       [✓] [×]
```

При выборе mismatch действующее правило `CHK-F12` должно ограничивать
доступные решения так, как уже определено backend-валидатором: полное и
частичное принятие запрещены, остаётся только допустимый полный возврат при
разрешённом внешнем сценарии.

Не разрешать выбрать «Совпадает» автоматически. Отметка должна быть явным
действием пользователя, как для остальных CHK-полей.

## 7. Сохранение и XML-гашение

При сохранении сверки:

- `CHK-F12` сохраняется в checks JSONB как обычный comparison;
- source-код и русская подпись не заменяются фактическим значением;
- mismatch требует фактического значения и причины по общему правилу CHK;
- текущие правила доступности `ACCEPT_ALL/PARTIAL/RETURN_ALL` не обходятся.

При формировании XML гашения:

- исходный `<vd:transportStorageType>` копируется из закреплённого source XML;
- пользовательский фактический storage используется только в разрешённом
  discrepancy/act payload, если это предусмотрено текущим контрактом;
- никакой русский текст не используется вместо внешнего XML-кода;
- source checksum/revision проверяются перед preview и submit.

## 8. Тесты

### Backend/normalizer

1. `CHILLED` разбирается из XML и публикуется как `Охлажденный`.
2. Аналогично проверить `FROZEN`, `COOLED`, `VENTILATED`.
3. Неизвестный код сохраняется, получает честный fallback и не считается
   совпадающим автоматически.
4. Отсутствующий узел не требует фиктивной отметки.
5. Backfill существующего raw XML добавляет storage без изменения checksum.
6. `CHK-F12` mismatch ограничивает decisions согласно validation rules.
7. Source code сохраняется отдельно от русской подписи.

### Frontend

1. В транспортном блоке появляется `CHK-F12` с исходным русским названием.
2. Для `CHILLED` отображается «Охлажденный», а не `CHILLED`.
3. Mismatch открывает поле с placeholder «Фактический способ хранения» и
   поле причины.
4. Отметка сохраняется и восстанавливается после повторного открытия.
5. Ошибки и disabled decisions доступны пользователю и клавиатуре.
6. Проверить 1440/1024/768/390 px, loading/error/unknown code.

### Интеграционные ограничения

Автоматические тесты используют обезличенные XML fixtures и transport spy.
Живой `ProcessIncomingConsignment` не вызывать.

## 9. Docker, данные и Git

После реализации пересобрать без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять пользователей/ВСД/ВСЭ и не
включать `VETIS_WRITE_ENABLED` агентом.

Работать в отдельной ветке, проверить `git status`, отправить ветку в GitHub,
обновить `main` через `git pull --ff-only`, объединить без force-push и
отправить `main`. При защищённом main создать Pull Request.

## 10. Критерии готовности

- поле «Способ хранения продукции при перевозке» видно в транспортном блоке;
- `CHILLED` отображается как «Охлажденный», остальные три кода также имеют
  русские названия;
- пользователь может явно отметить соответствие/несоответствие;
- `CHK-F12` участвует в серверной валидации и выборе решений;
- исходный XML-код сохраняется для XML-гашения;
- существующие данные не удалены;
- backend/frontend tests проходят, контейнеры пересобраны;
- ветка отправлена в GitHub и объединена с main либо создан Pull Request.
