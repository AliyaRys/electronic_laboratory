# ТЗ на добавление даты выработки и срока годности в сверку ВСД

Дата: 13.11.2026  
Тип задачи: VetIS XML normalization + API/read model + reconciliation UI

## 1. Цель

В блоке сверки:

«Идентификация продукции по наименованию и визуальным осмотром»

добавить два comparison-поля:

1. «Дата выработки»;
2. «Срок годности».

Поля должны получать значения из исходного XML входящего ВСД:

```xml
<vd:dateOfProduction>
  <vd:firstDate>
    <dt:year>2026</dt:year>
    <dt:month>11</dt:month>
    <dt:day>3</dt:day>
    <dt:hour>0</dt:hour>
  </vd:firstDate>
</vd:dateOfProduction>

<vd:expiryDate>
  <vd:firstDate>
    <dt:year>2026</dt:year>
    <dt:month>11</dt:month>
    <dt:day>10</dt:day>
    <dt:hour>0</dt:hour>
  </vd:firstDate>
</vd:expiryDate>
```

Источник: `vd:certifiedConsignment/vd:batch/dateOfProduction` и
`vd:certifiedConsignment/vd:batch/expiryDate`.

## 2. Важное правило формата

Каждая дата ВетИС может быть:

1. единичной — заполнен только `firstDate`;
2. интервалом — заполнены `firstDate` и `secondDate`;
3. текстовой/неформализованной — заполнен `informalDate`;
4. отсутствующей.

Система обязана сохранять тип исходного значения и показывать его без потери
смысла:

| XML | Отображение |
| --- | --- |
| только `firstDate` | `03.11.2026` |
| `firstDate` + `secondDate` | `с 03.11.2026 по 10.11.2026` |
| `informalDate` | исходный текст с пометкой/доступным описанием, без выдуманной даты |
| значение отсутствует | поле не создаётся как фиктивное; отображается `—` только в read-only контексте |

Не сдвигать дату часовым поясом. `dt:year/month/day` — календарная дата,
`dt:hour` не превращать в локальное время при отображении даты.

## 3. Подтверждённый текущий пробел

Официальная документация `GetVetDocumentListOperation_v2` описывает эти поля
через тип `vd:GoodsDate`, который поддерживает `firstDate`, `secondDate` и
`informalDate`. В текущем проекте:

- normalizer не заполняет даты выработки и срока годности;
- `source_projection()` оставляет `producedOn` и `expiresOn` равными `None`;
- `comparedFields()` не добавляет `CHK-F22` и `CHK-F23`;
- backend validator уже содержит `CHK-F22`/`CHK-F23`, но UI не может показать
  пользователю исходные значения.

## 4. Обязательное чтение

До реализации прочитать:

- `AGENTS.md`;
- `docs/TZ_development/plans/API REQUESTS.txt`;
- `https://help.vetrf.ru/wiki/GetVetDocumentListOperation_v2`;
- `https://help.vetrf.ru/wiki/GoodsDate_v2.0`;
- `https://help.vetrf.ru/wiki/ComplexDate_v2.0`;
- `docs/TZ_development/plans/field-mapping.md`;
- `docs/TZ_development/plans/2026-11-06-04-arrivals.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/08-field-catalog.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/09-checklist-reconciliation.md`;
- `backend/src/modules/integrations/vetis/normalizer.py`;
- `backend/src/modules/arrivals/{schemas,queries,reconciliation,validation}.py`;
- `frontend/src/features/arrivals/{api,ReconciliationForm,ComparisonField}.tsx`;
- существующие normalizer/reconciliation/frontend tests.

## 5. Нормализация XML и хранение

### 5.1. Типизированная структура даты

Добавить в source snapshot типизированную структуру, сохраняющую исходную
форму:

```json
{
  "firstDate": "2026-11-03",
  "secondDate": "2026-11-10",
  "informalDate": null
}
```

Для единичной даты `secondDate` должен быть `null`, а не копией `firstDate`.
Для отсутствующего поля структура должна быть `null` либо эквивалентно
отсутствовать по существующему контракту.

### 5.2. Алгоритм XML-разбора

Для обоих полей использовать namespace-aware parsing:

```text
vd:batch/vd:dateOfProduction/vd:firstDate
vd:batch/vd:dateOfProduction/vd:secondDate
vd:batch/vd:dateOfProduction/vd:informalDate

vd:batch/vd:expiryDate/vd:firstDate
vd:batch/vd:expiryDate/vd:secondDate
vd:batch/vd:expiryDate/vd:informalDate
```

Из `ComplexDate` собрать календарную дату из `year/month/day`. Час хранить
отдельно, если он нужен source/audit, но не добавлять час к пользовательскому
отображению даты без требования.

Невалидную комбинацию даты не превращать в другую дату и не игнорировать
молча: сохранить контролируемую диагностическую ошибку нормализации, не
ломая импорт остальных реквизитов ВСД.

### 5.3. Backfill

Для уже сохранённых incoming documents выполнить безопасный backfill из
`vetis_source_documents.raw_xml`:

- переразобрать только эти два поля;
- обновить source snapshot/read projection;
- не менять raw XML, checksum, UUID, scope, revision без содержательного
  изменения source facts;
- не удалять сверки, гашения, ВСЭ, пробы и отчёты;
- повторный backfill идемпотентен.

## 6. API/read model

Расширить `ExternalFields.fields` или согласованный typed read model полями:

```text
producedOn
producedOnFrom
producedOnTo
producedOnInformal
expiresOn
expiresOnFrom
expiresOnTo
expiresOnInformal
```

Допустим эквивалентный объект `DateRange`, если он используется единообразно
для обоих полей. Нельзя отдавать только строку, если это приводит к потере
различия между единичной датой и интервалом.

API должно возвращать одновременно machine-readable значение для формы и
formatted display value для UI либо frontend должен форматировать только
структурированный объект без повторного разбора raw XML.

## 7. Frontend-сверка

В `frontend/src/features/arrivals/api.ts::comparedFields()` добавить в блок
`product` в таком порядке:

1. существующие поля продукции;
2. `CHK-F22` — «Дата выработки»;
3. `CHK-F23` — «Срок годности».

Оба поля должны использовать общий `ComparisonField`.

### 7.1. Отображение исходного значения

Примеры:

```text
Дата выработки       03.11.2026       [✓] [×]
Срок годности        до 10.11.2026    [✓] [×]
```

Для интервала:

```text
Дата выработки       с 03.11.2026 по 05.11.2026
Срок годности        с 10.11.2026 по 16.11.2026
```

Подписи интервала должны быть однозначными. Не показывать только первую дату
и не заменять интервал одной приблизительной датой.

### 7.2. Фактическое значение

При выборе «Не совпадает» использовать `<input type="date">` для формальной
единичной даты, если текущий контракт фактического значения допускает только
одну дату. Если бизнес-контракт допускает фактический интервал, расширить
карточку двумя полями «С»/«По» и передавать структурированное значение.

Для текущего CHK-контракта не менять тип данных молча: сначала согласовать
payload/API, добавить server validation и только затем расширять UI.

Причина несоответствия обязательна по существующему правилу `CHK-F43`.

## 8. Backend validation

- `CHK-F22` и `CHK-F23` должны требовать явную отметку только при наличии
  исходного значения;
- отсутствие исходной даты не должно создавать фиктивную обязательную
  отметку;
- mismatch требует фактическую дату/интервал и причину;
- даты должны проходить строгую календарную проверку;
- `expiryDate` раньше `dateOfProduction` — ошибка валидации source/факта;
- недопустимое расхождение должно участвовать в существующих правилах
  `ACCEPT_ALL/PARTIAL/RETURN_ALL`;
- фактическая дата не должна изменять source snapshot;
- при формировании discrepancyReport передавать source, actual и reason;
- source XML и его checksum используются для preview/submit без подмены.

## 9. Tests

### XML/backend

1. Единичная дата выработки разбирается и отображается как одна дата.
2. Единичный срок годности разбирается и отображается как одна дата.
3. `firstDate + secondDate` сохраняются как интервал без потери второй даты.
4. `informalDate` не превращается в выдуманную календарную дату.
5. Час/таймзона не сдвигают календарный день.
6. `CHK-F22` и `CHK-F23` появляются в source projection.
7. Отсутствующие поля не требуют фиктивной отметки.
8. Mismatch требует actual и reason.
9. Неверный порядок дат блокируется с понятной ошибкой.
10. Backfill raw XML идемпотентен и не изменяет local facts.

### Frontend

1. В product-блоке видны оба поля в указанном порядке.
2. Отображаются единичные даты и интервалы в правильном формате.
3. Для mismatch открывается date input с кнопками общего компонента.
4. Сохранённые отметки и фактические значения восстанавливаются после reload.
5. Ошибки привязаны к конкретной карточке.
6. Проверить 1440/1024/768/390 px, keyboard focus и длинные значения.

Все автоматические тесты используют обезличенные XML fixtures. Живой внешний
write ВетИС не выполняется.

## 10. Docker, данные и Git

После реализации пересобрать контейнеры без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять пользователей/ВСД/ВСЭ и не
включать `VETIS_WRITE_ENABLED` агентом.

Работать в отдельной feature-ветке. Вместе с кодом добавить этот файл ТЗ в
тот же коммит и ту же ветку. После тестов:

1. проверить `git status` и `git diff`;
2. отправить feature-ветку в GitHub;
3. обновить `main` через `git pull --ff-only`;
4. объединить feature-ветку с `main` без force-push;
5. отправить обновлённый `main` в GitHub.

При защищённой ветке `main` создать Pull Request и указать связь с этим файлом:

`dorabotka/2026-11-13-production-expiry-date-reconciliation.md`

## 11. Критерии готовности

- «Дата выработки» и «Срок годности» отображаются в product-блоке сверки;
- единичные даты отображаются как единичные, интервалы — как интервалы;
- исходные значения берутся из `dateOfProduction/expiryDate` XML;
- CHK-F22/CHK-F23 сохраняются и валидируются сервером;
- timezone не сдвигает календарные даты;
- mismatch формирует actual/reason и участвует в существующей матрице решений;
- raw XML и существующие факты не удаляются;
- backend/frontend tests проходят, контейнеры пересобраны;
- файл ТЗ закоммичен вместе с кодом, feature-ветка объединена с `main` и
  `main` отправлен в GitHub либо создан Pull Request.
