# ТЗ на исправление ложного сообщения об отсутствии единицы ВСД

Дата: 12.11.2026  
Тип задачи: frontend/API read model + receipt preview + tests

## 1. Проблема

При открытии сверки система показывает:

> Исходный эВСД не содержит единицу измерения: гашение будет недоступно, пока единица не появится в документе.

Пользователь видит это сообщение для ВСД:

`e13bda81-7cf6-4b2b-b1aa-3c99e25adaac`

Однако исходный normalized snapshot содержит единицу:

```text
batch.unit.guid = 21ed96c9-337b-4a27-8761-c6e6ad3c9f5b
```

Также `classification.unit.id` в `IncomingView` содержит этот GUID.

Проблема не в отсутствии единицы в исходном ВСД, а в рассогласовании API и
frontend:

1. backend хранит и возвращает canonical unit GUID в
   `documentary.unit_id`/`classification.unit.id`;
2. `frontend/src/features/arrivals/api.ts::partyUnit()` ищет только
   `external.fields.unitId` или `classification.unit.name`;
3. `external.fields.unitId` в текущем `IncomingView` не публикуется;
4. человекочитаемое имя `кг` в фактическом XML может отсутствовать;
5. frontend получает пустую строку и ошибочно блокирует гашение.

## 2. Цель

Если в исходном ВСД есть `batch.unit.guid`, система должна:

- считать единицу присутствующей;
- показывать её в сверке как read-only значение;
- передавать этот GUID в delivered/accepted/returned QuantitySet;
- разрешать подготовку preview после заполнения остальных обязательных полей;
- не требовать от пользователя ручного ввода GUID;
- сформировать XML с `<vd:unit><bs:guid>` этого исходного GUID.

Сообщение об отсутствии единицы показывать только если canonical unit GUID
действительно отсутствует или невалиден.

## 3. Обязательные источники

До работы прочитать:

- `AGENTS.md`;
- `dorabotka/2026-11-12-vetis-receipt-unit-xml-scenarios.md`;
- `docs/implementation/DR8-receipt-unit-xml-evidence.md`;
- `docs/TZ_development/plans/field-mapping.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/08-field-catalog.md`;
- `backend/src/modules/arrivals/queries.py`;
- `backend/src/modules/arrivals/reconciliation.py`;
- `backend/src/modules/integrations/vetis/receipt.py`;
- `frontend/src/features/arrivals/api.ts`;
- `frontend/src/features/arrivals/ReconciliationForm.tsx`;
- `frontend/src/features/arrivals/ReceiptOperation.tsx`.

## 4. Canonical contract единицы

Использовать следующий приоритет источников:

1. `IncomingView.documentary.unit_id` — canonical GUID единицы партии;
2. `IncomingView.classification.unit.id` — совместимый fallback;
3. `external.fields.unitId` — только если API его явно публикует как тот же
   GUID;
4. `unit.name` — только отображаемое имя, никогда не идентичность XML.

Нельзя считать единицей:

- пустую строку;
- `undefined`/`null`;
- массу `500.0`;
- количество мест `8`;
- локальный текст «кг», если отсутствует GUID.

Не добавлять отдельный пользовательский input для GUID. Единица приходит из
исходного ВСД и должна быть недоступна для произвольного редактирования.

## 5. Backend read model

Проверить и закрепить контракт `IncomingView`:

- `documentary.unit_id` всегда берётся из `vdDocument.batch.unit.guid`;
- `classification.unit.id` содержит тот же GUID;
- при наличии source name можно дополнительно отдавать `unitName` для UI;
- отсутствие source name не означает отсутствие единицы;
- валидный UUID/GUID без имени достаточен для preview и XML;
- действительно отсутствующий GUID даёт диагностическое состояние
  `UNIT_MISSING`, но не подменяется именем/массой.

При создании новой reconciliation все три поля должны наследовать source GUID:

```text
delivered.unit_id = source_unit_guid
accepted.unit_id  = source_unit_guid
returned.unit_id  = source_unit_guid
```

Сохранённая сверка с устаревшим/пустым unit ID должна либо безопасно
нормализоваться из неизменного source snapshot, либо получить понятную ошибку
конфликта с предложением обновить сверку. Нельзя разрешать XML с пустой
единицей.

## 6. Frontend исправление

Исправить `partyUnit()` и все проверки наличия единицы:

```text
unitId = documentary.unit_id || classification.unit.id || external.fields.unitId
unitName = external.fields.unitName || classification.unit.name || "Единица из ВСД"
```

Важно: наличие `unitId` означает, что единица есть, даже если `unitName`
пустой.

В блоке количества показывать:

```text
Единица измерения (из эВСД)
Единица из ВСД (GUID: 21ed96c9-...)
```

Если есть человекочитаемое имя, показывать его и при необходимости GUID в
доступной подсказке. Если имени нет, не показывать ложное «единица
отсутствует».

Сообщение «Исходный эВСД не содержит единицу измерения» показывать только при
пустом/невалидном canonical `unitId` после проверки всех разрешённых полей.

При смене входящего source snapshot frontend должен перечитать party и
reconciliation, а не сохранять старое состояние единицы в локальном storage.

## 7. Preview и XML

Перед формированием preview backend обязан проверить:

1. `source_snapshot.vdDocument.batch.unit.guid` существует;
2. `reconciliation.delivered_unit_id`, `accepted_unit_id` и
   `returned_unit_id` равны этому GUID;
3. source checksum/revision актуальны.

Если эти условия выполнены, не выдавать `UNIT_MISSING` только из-за отсутствия
`dt:name`.

В XML:

```xml
<vd:unit>
  <bs:guid>21ed96c9-337b-4a27-8761-c6e6ad3c9f5b</bs:guid>
</vd:unit>
```

Масса и количество передаются раздельно:

- `<vd:volume>` — масса;
- `<dt:package><dt:quantity>` — количество мест;
- `<vd:unit><bs:guid>` — source unit GUID.

Не использовать имя `кг` как `bs:guid`, не использовать массу/количество как
единицу и не создавать фиктивный GUID.

## 8. Тесты

### Backend

Добавить/проверить:

1. snapshot с unit GUID и без unit name → preview разрешён;
2. snapshot без unit GUID → preview блокируется `UNIT_MISSING`;
3. новая reconciliation наследует GUID во всех трёх QuantitySet;
4. `IncomingView.documentary.unit_id` и `classification.unit.id` совпадают;
5. пустая reconciliation с source GUID не выдаёт ложную ошибку отсутствия;
6. несовпадение сохранённого unit ID с source GUID блокируется;
7. XML содержит source GUID и правильные mass/quantity;
8. никакой внешний write-вызов не выполняется тестом.

### Frontend

1. При `documentary.unit_id` без имени предупреждение не показывается.
2. На странице отображается read-only unit GUID/название-заглушка.
3. В payload сохранения unit ID не пустой.
4. `Подготовить гашение` не блокируется именно из-за отсутствия имени единицы.
5. При реально отсутствующем GUID отображается понятное предупреждение.
6. Серверная ошибка `UNIT_MISSING` и `CHK-F20` привязываются к блоку
   количества/единицы, а не только к общему баннеру.
7. Проверить 1440/1024/768/390 px и клавиатурный доступ.

## 9. Безопасность, Docker и Git

Не удалять пользователей, ВСД, ВСЭ, партии или volume. Не выполнять
`docker compose down -v` и не включать `VETIS_WRITE_ENABLED` для проверки.

После реализации пересобрать:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Работать в отдельной ветке, проверить `git status`, отправить ветку в GitHub,
обновить `main` через `git pull --ff-only`, объединить без force-push и
отправить `main`. При защищённом main создать Pull Request.

## 10. Критерии готовности

- система распознаёт unit GUID из исходного ВСД даже без `dt:name`;
- ложное сообщение об отсутствии единицы исчезает;
- пользователь может сохранить сверку и подготовить гашение;
- XML содержит правильный unit GUID, массу и количество;
- реально отсутствующая единица по-прежнему блокирует гашение честной ошибкой;
- backend/frontend tests проходят;
- живой write ВетИС не выполнялся;
- контейнеры пересобраны, ветка отправлена и объединена с main либо создан PR.
