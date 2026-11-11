# CHK: карта полей исходного эВСД (ТЗ-10 V01)

Статус: закреплена по обезличенным fixtures; живые operational UUID в Git не помещаются.
Основание: [10-field-catalog](../Функциональные%20требования/v2.0/10-field-catalog.md),
[mercury-test-integration-contract](../TZ_development/plans/mercury-test-integration-contract.md), 09.11.2026.

## 1. XML-источник

Страница результата `receiveApplicationResultRequest` (namespace
`http://api.vetrf.ru/schema/cdm/application/v2`) содержит
`getVetDocumentListResponse` с повторяющимися `vetDocument` элементами.

| Префикс | Namespace |
| --- | --- |
| `bs` | `http://api.vetrf.ru/schema/cdm/base` |
| `mer` | `http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2` |

Базовый XPath документа: `/receiveApplicationResultResponse/getVetDocumentListResponse/vetDocument[n]` (далее `VD`).

## 2. Карта полей CHK ← эВСД

| CHK | Поле | XPath (относительно `VD`) | Комментарий |
| --- | --- | --- | --- |
| CHK-F01 | Номер эВСД | `bs:uuid` (единый термин интерфейса — UUID ВСД; `bs:issueNumber`/`bs:issueSeries` остаются в source snapshot, но не показываются как UUID) | информационное; DR5 2026-11-11 |
| CHK-F02 | Дата оформления ВСД | `bs:issueDate` | информационное; plain date без часового пояса |
| CHK-F03 | Статус эВСД | `bs:status` | допуск операции: только `CONFIRMED` проходит предикат; код сохраняется вместе с русской подписью, неизвестный код — «Неизвестный статус» |
| CHK-F04 | Назначение груза | `bs:type` + `certifiedConsignment/authentication/purpose` (`bs:guid`/`bs:uuid`); название по contour-scoped справочнику `mercury_purpose_guid` (read-only `GetPurposeList` раз в 14 суток) | предикат требует `TRANSPORT`; `INCOMING` задаёт scope запроса; промах справочника не блокирует импорт |
| CHK-F05 | Отправитель — предприятие | `mer:certifiedConsignment/mer:consignor/mer:enterprise/bs:guid` + `bs:name` | сверка обязательна |
| CHK-F06 | Отправитель — владелец | `mer:certifiedConsignment/mer:consignor/mer:businessEntity/bs:guid` + `bs:name` | сверка обязательна |
| CHK-F07 | Получатель — предприятие | `mer:certifiedConsignment/mer:consignee/mer:enterprise/bs:guid` + `bs:name` | предикат: guid = закреплённая площадка |
| CHK-F08 | Получатель — владелец | `mer:certifiedConsignment/mer:consignee/mer:businessEntity/bs:guid` + `bs:name` | сверка обязательна |
| CHK-F09 | Вид транспорта | `mer:certifiedConsignment/mer:transportInfo` (тип) | сверка обязательна |
| CHK-F10 | Номер ТС | `mer:certifiedConsignment/mer:transportInfo/mer:transportNumber` | сверка обязательна |
| CHK-F11 | Номер прицепа | `mer:certifiedConsignment/mer:transportInfo/mer:trailerNumber` | «Без прицепа», если элемента нет |
| CHK-F12 | Способ хранения | `mer:certifiedConsignment/mer:batch/mer:transportStorageType` | сверка обязательна |
| CHK-F15 | Тип продукции | `mer:certifiedConsignment/mer:batch/mer:productType` | предикат: строго `1`; отсутствующий/неразбираемый не равен `1` |
| CHK-F16 | Продукция (2-й уровень) | `.../mer:batch/mer:product` → `bs:guid`, `bs:uuid`, `bs:name` | свой источник name |
| CHK-F17 | Вид продукции (3-й уровень) | `.../mer:batch/mer:subProduct` → `bs:guid`, `bs:name` | хранится отдельно |
| CHK-F18 | Название продукции (4-й уровень) | `.../mer:batch/mer:productItem` → `bs:guid`, `bs:name` | отдельное поле, не подменяет F16 |
| CHK-F19 | Производитель | `.../mer:batch/mer:producer/mer:enterprise/bs:guid` + `bs:name` | недопустимое изменение блокирует принятие |
| — | Объём/количество | `.../mer:batch/mer:volume`, `mer:packageList/mer:package/mer:quantity` (максимальный уровень упаковки) | точность Decimal сохраняется; количество мест ≠ масса, volume в quantity не подставляется (DR5) |
| — | Единица измерения | `.../mer:batch/mer:unit/bs:guid` + `bs:name` | сравнение только одинаковых unit |
| — | Сопроводительные документы | `mer:certifiedConsignment/mer:accompanyingForms` | UUID электронного ВСД |

Печатное заключение ВСЭ (`forms/conclusion-local.html`,
`forms/conclusion-previous.html`) показывает этот же верхнеуровневый
`bs:uuid` под меткой «UUID ВСД»; `issueNumber` остаётся в source snapshot и
в печати не подставляется вместо UUID.

## 3. Правила нормализации

- Каждый вложенный объект сохраняется со своими `guid`/`uuid`/`name` из source XML;
  имя второго уровня никогда не подменяется именем номенклатуры.
- Неизвестный в общем локальном справочнике GUID не блокирует импорт, если есть
  source `name` (`mercury_product_guid_lvl_2` больше не источник UI-имён).
- Складские GUID/UUID (`product`/`productItem`) хранятся отдельно от UUID эВСД
  (`vetDocument/bs:uuid` → `evsd_uuid`).
- Защита: XML ≤32 МиБ, глубина ≤128, DTD/внешние сущности отключены.

## 4. Доказательство

Контрактные проверки XPath/namespace и отдельных уровней выполняются в
`backend/tests/vetis/test_read_contract.py` на обезличенных fixtures
(де-идентифицированные UUID, без credentials).

## 5. Гашение: CHK → ProcessIncomingConsignment (W01/W02)

XML preview строится только из закреплённой ревизии исходного XML и сохранённой
сверки. Текущий складской остаток в расчёте не участвует. Перед постановкой в
очередь сервер повторно проверяет checksum XML, получателя, `CONFIRMED`, объём,
единицу, ревизию сверки и fingerprint preview.

| Решение | `acceptedConsignment` | `returnedDelivery` | `discrepancyReport` |
| --- | --- | --- | --- |
| `ACCEPT_ALL` | весь доставленный объём | отсутствует | обязателен при `docInspection=MISMATCH` |
| `PARTIALLY` | положительная принятая часть | положительный остаток + причина | обязателен при `docInspection=MISMATCH` |
| `RETURN_ALL` | отсутствует | весь доставленный объём + причина | отсутствует |

- `vetCertificatePresence=ELECTRONIC`, исходный UUID берётся из входящего эВСД.
- `vetInspection` (`CORRESPONDS`/`MISMATCH`/`UNSUPERVISED`) выбирается отдельно
  от результата документарной сверки.
- `OTHER_REASON` всегда требует текст. Блокирующее расхождение допускает только
  полный возврат. Причина возврата передаётся в `authentication/specialMarks`
  строкой `Причина возврата: <ID>`; для `OTHER_REASON` после ID добавляется
  пояснение до 240 символов.
- `localTransactionId` — локальная неизменяемая идентичность, `applicationId` —
  отдельный ответ шлюза; одно не подменяет другое.
- Перед сетью журнал долговечно переходит в `SUBMITTING`. Потеря ответа submit
  без `applicationId` означает `UNKNOWN` и запрещает автоматический повтор.
- Только полный ответ с совпавшими исходным UUID, получателем, принятой и
  возвращённой частью создаёт `receipt_confirmation`. `REJECTED`, timeout и
  неполные связи не открывают локальную ВСЭ.

Проверки находятся в `backend/tests/vetis/test_receipt_mapping.py`,
`test_receipt_failures.py` и `test_reconcile.py`. Они используют только
обезличенные fixtures/spy; живой `ProcessIncomingConsignment` не выполняется
согласно O-13.
