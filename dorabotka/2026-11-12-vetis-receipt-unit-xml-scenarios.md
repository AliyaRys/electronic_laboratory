# ТЗ на исправление сверки и корректного гашения входящего ВСД

Дата: 12.11.2026  
Тип задачи: backend + frontend + XML mapping + offline tests

## 1. Цель

Исправить маршрут сверки и гашения входящего транспортного ВСД для страницы:

`http://127.0.0.1:8080/labs/2812e437-facc-432f-9242-5162c9d9f49f/arrivals/c584f24a-63d0-4d47-bdce-d7b8c727f3e2/reconciliation`

После исправления пользователь должен заполнить сверку, сохранить её, выбрать
полное гашение/частичное гашение/полный возврат и получить XML правильного
сценария. Масса, количество мест и единица измерения передаются раздельно.

Живой вызов гашения агентом, тестами или диагностикой запрещён по O-13.
Шесть сценариев проверяются обезличенными fixtures и transport spy.

## 2. Подтверждённая причина CHK-F20

Проверка live API показала:

- `classification.unit.id` содержит GUID единицы;
- `documentary.unit_id` пустой;
- новая `GET /reconciliation` возвращает пустой `unit_id` у delivered,
  accepted и returned;
- в интерфейсе есть только подписи «Вес, кг» и «Количество», но нет поля или
  read-only значения единицы.

Поэтому форма отправляет положительные количества с пустой единицей, а сервер
закономерно выдаёт `CHK-F20`. Корень проблемы — unit GUID не переносится из
исходного ВСД в `IncomingView` и начальную `ReconciliationView`.

## 3. Обязательные источники

До работы прочитать:

- `AGENTS.md`;
- `docs/TZ_development/plans/API REQUESTS.txt`;
- `docs/TZ_development/plans/2026-11-06-04-arrivals.md`;
- `docs/TZ_development/plans/2026-11-06-11-vetis-receipt.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `docs/TZ_development/plans/field-mapping.md`;
- `docs/TZ_development/plans/mercury-test-integration-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- `Функциональные требования/v2.0/12-changes-and-mockups.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/08-field-catalog.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/12-receipt-weight.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/13-receipt-decision-and-paid-services.md`;
- `backend/src/modules/arrivals/{schemas,queries,reconciliation,validation}.py`;
- `frontend/src/features/arrivals/{api,ReconciliationForm,ReceiptDecision,ReceiptOperation}.tsx`;
- `backend/src/modules/integrations/vetis/{receipt,receipt_mapping,evidence}.py`;
- существующие tests `backend/tests/arrivals/test_reconciliation.py` и
  `backend/tests/vetis/test_receipt_mapping.py`.

## 4. Сохранность данных и внешний write

1. Не удалять/пересоздавать пользователей, лаборатории, ВСД, партии, сверки,
   ВСЭ, пробы, отчёты или PostgreSQL volume.
2. Не выполнять `docker compose down -v`, destructive seed/reset или очистку БД.
3. Не выполнять `ProcessIncomingConsignment` в тестах и диагностике.
4. Не коммитить credentials, apiKey, issuerId, логины, пароли и полный SOAP XML.
5. `VETIS_WRITE_ENABLED` агент не включает. Production write проверяется
   только через fixtures/spy.

## 5. Исправление единицы и количества

### 5.1. Канонический source unit

В normalized snapshot единица хранится как external reference с `guid`, но
`queries.py::_quantity_set` ищет `unit.id`. Исправить на source GUID.
`source_projection()` также должен использовать GUID в `fields.unitId`; имя
единицы предназначено только для UI.

`IncomingView.documentary.unit_id` должен быть равен source unit GUID.

Новая сверка автоматически заполняет одним source unit GUID:

- `delivered.unit_id`;
- `accepted.unit_id`;
- `returned.unit_id`.

Пользователь не вводит произвольную единицу. На странице отображается
read-only значение, например `кг`. Если исходный ВСД не содержит unit GUID,
гашение блокируется понятной ошибкой.

### 5.2. Раздельные размерности

Расширить `ReceiptIntent` и preview DTO отдельными полями:

```text
documentary_mass_kg, documentary_quantity,
delivered_mass_kg, delivered_quantity,
accepted_mass_kg, accepted_quantity,
returned_mass_kg, returned_quantity, unit_id
```

Запрещено использовать quantity для `<vd:volume>` или массу как fallback
количества. Для каждого accepted/returned consignment XML обязан содержать:

- `<vd:volume>` из соответствующей массы;
- `<dt:package><dt:quantity>` из соответствующего количества мест;
- `<vd:unit><bs:guid>` из source unit GUID;
- исходные product/productItem/участников и допустимые source-реквизиты.

Не делить массу искусственно и не дублировать маркировки в обеих частях,
если модель не позволяет безопасно определить их принадлежность.

## 6. Назначение груза и причина возврата

### 6.1. `purpose_guid` — назначение исходного ВСД

`purpose_guid` не является причиной возврата и не берётся из справочника
причин. Для `returnedDelivery` копировать из исходного XML:

```xml
vd:authentication/vd:purpose/bs:guid
vd:authentication/vd:purpose/bs:uuid
```

Не заменять purpose кодами причин. При отсутствии исходного purpose не
отправлять неполный возвратный XML.

### 6.2. Причина возврата `CHK-F35`

Поле показывается только для `PARTIAL` и `RETURN_ALL`. Пользователь видит
русские названия, payload хранит код:

| Код | Текст в интерфейсе |
| --- | --- |
| `DEFECTIVE_GOODS` | Брак / товар ненадлежащего качества |
| `PACKAGING_DAMAGE` | Нарушение целостности упаковки |
| `FOREIGN_MATERIAL_OR_SAFETY_VIOLATION` | Наличие посторонних включений / несоответствие безопасности |
| `LAB_TEST_MISMATCH` | Отсутствие, дублирование или несоответствие лабораторных исследований / ВСЭ |
| `PRODUCTION_VSD_ERROR` | Ошибки при оформлении производственного ВСД |
| `CRITICAL_EXPIRY_DATE` | Короткий / критический / истекающий остаточный срок годности |
| `MARKING_ISSUES` | Проблемы с маркировкой |
| `QUANTITY_DISCREPANCY` | Расхождение по количеству |
| `PRODUCT_DATE_MISMATCH` | Несоответствие даты выработки или срока годности в ВСД и на упаковке |
| `UNORDERED_PRODUCT` | Товар не по заявке / не заказывали / не по контракту |
| `WRONG_SPECIFICATION` | Пересорт (по наименованию, дате, партии, размеру и др.) |
| `CONSIGNOR_REJECTION` | Отказ торговой точки / покупателя |
| `CONTRACT_VIOLATION` | Нарушение условий поставки / договора |
| `OTHER_REASON` | Иное |

`OTHER_REASON` требует текста длиной 1–240 символов. В returned certificate
передавать код в `<vd:specialMarks>`:

```xml
<vd:specialMarks>CONSIGNOR_REJECTION</vd:specialMarks>
<vd:specialMarks>OTHER_REASON: текст пользователя</vd:specialMarks>
```

Русское название не передавать вместо кода. Старые сохранённые коды должны
отображаться новыми русскими названиями без потери значения.

## 7. Поля сверки

Read-only источник должен показывать UUID, дату, статус, участников,
транспорт, productType/product/subProduct/productItem, исходные массу,
количество и unit GUID/name, даты продукции, транспортные документы, purpose
GUID/UUID и прежнюю ВСЭ.

Пользовательские поля:

- отметки соответствия/несоответствия и факты/причины;
- состояние грузового отделения и совместная перевозка;
- доставленная, принятая и возвращаемая масса/количество;
- read-only единица исходного ВСД, автоматически во всех QuantitySet;
- решение, причина возврата, текст OTHER_REASON;
- повторная ВСЭ/основание/№ акта при наличии прежней ВСЭ;
- транзакция/ярмарка;
- `CORRESPONDS`, `MISMATCH` или `UNSUPERVISED` для ветосмотра;
- дата/время фактического поступления;
- отдельная дата/время возврата для PARTIAL/RETURN_ALL.

Поле даты возврата добавить для возвратных сценариев. Не подставлять дату
запроса вместо фактической даты возврата.
## 8. Валидация и матрица XML

Правила:

- `ACCEPT_ALL`: accepted = delivered, returned = 0, без причины;
- `PARTIAL`: accepted > 0 и returned > 0, сумма частей равна delivered отдельно для массы и количества, причина обязательна;
- `RETURN_ALL`: accepted = 0, returned = delivered, причина обязательна, акт этой ветки не формируется;
- граница веса ±5% включительна;
- нулевая доставка не допускает гашение отсутствующего груза.

| Сценарий | docInspection | decision | delivery | discrepancyReport | returnedDelivery |
| --- | --- | --- | --- | --- | --- |
| 1.1.1 | CORRESPONDS | ACCEPT_ALL | полный accepted | нет | нет |
| 1.1.2 | CORRESPONDS | PARTIALLY | accepted часть | нет | returned часть |
| 1.1.3 | CORRESPONDS | RETURN_ALL | без consignment | нет | весь delivered |
| 1.2.1 | MISMATCH | ACCEPT_ALL | полный accepted | да | нет |
| 1.2.2 | MISMATCH | PARTIALLY | accepted часть | да | returned часть |
| 1.2.3 | MISMATCH | RETURN_ALL | без consignment | нет | весь delivered |

`vetInspection` (`CORRESPONDS`/`MISMATCH`/`UNSUPERVISED`) не вычислять автоматически из `docInspection`.

## 9. Формирование XML и операции

- `<apl:issueDate>` — server time формирования запроса;
- `<vd:deliveryDate>` — введённая дата поступления;
- `returnedDelivery/vd:deliveryDate` — введённая дата возврата;
- vetCertificate UUID — UUID входящего ВСД;
- initiator — server-side login;
- accepted/returned consignment получает правильные mass, quantity и unit;
- при mismatch + ACCEPT_ALL/PARTIALLY передаются `vd:info` и полный `discrepancyReport` со всеми source/actual/reason;
- при RETURN_ALL discrepancyReport не передаётся;
- returnedDelivery сохраняет исходное purpose и передаёт код/text в specialMarks.

Preview должен показывать source checksum/revision, unit, обе размерности, даты, inspections, decision, reason code/text, discrepancy items и маршрут. Submit отправляет один frozen intent с idempotency key. UNKNOWN запрещает повторный submit без reconcile. Evidence parser отдельно проверяет source UUID, receiver, accepted mass/quantity, returned mass/quantity, unit и reason.

## 10. Ошибки UI

- `CHK-F20` привязать к блоку единицы/количества, а не только к общему баннеру;
- показывать все `ProblemItem`, сохраняя trace ID как техническую деталь;
- при ошибке не очищать введённую сверку;
- повторную отправку блокировать;
- `OTHER_REASON` проверять на пустоту и длину 240;
- проверить 1440/1024/768/390 px и клавиатурный доступ.

## 11. Тесты

Добавить backend/XML tests:

1. Новая сверка наследует source unit GUID в трёх QuantitySet.
2. `documentary.unit_id` равен `batch.unit.guid`, а не пустой строке/«кг».
3. Source projection публикует unit GUID отдельно от имени.
4. Положительные quantities без unit блокируются.
5. Все шесть сценариев формируют правильные XML-ветки.
6. `vetInspection` независимо проходит три значения.
7. `volume` равен массе, package quantity равен количеству.
8. Purpose GUID/UUID returned ВСД копируется из исходного ВСД.
9. Причины сериализуются точными кодами, OTHER_REASON содержит код и текст.
10. Даты запроса, поступления и возврата не смешиваются.
11. Evidence отдельно проверяет массу, количество и unit.
12. UNKNOWN не создаёт второй submit.

Frontend tests должны проверить read-only unit, три QuantitySet, новые русские причины, коды payload, OTHER_REASON, дату возврата, preview и привязку CHK-F20 к конкретному полю. XML проверять namespace-aware parser, не живым ВетИС.

## 12. Docker, данные и Git

После реализации пересобрать без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять данные и не включать `VETIS_WRITE_ENABLED` агентом.

Работать в отдельной ветке, проверить `git status`, отправить ветку в GitHub, обновить `main` через `git pull --ff-only`, объединить без force-push и отправить `main`. При защищённом main создать Pull Request.

## 13. Критерии готовности

- CHK-F20 устраняется переносом source unit GUID, а не фиктивным вводом;
- масса/количество не смешиваются в payload/XML/evidence;
- русские причины соответствуют таблице, XML получает точные коды;
- purpose GUID/UUID returned ВСД берётся из исходного ВСД;
- все шесть сценариев формируют корректный XML;
- submit/poll/reconcile и UNKNOWN защищены от дублей;
- backend/frontend/XML tests проходят;
- живой write ВетИС не выполнялся;
- контейнеры пересобраны, ветка отправлена и объединена с main либо создан PR.
