# Исправление XML частичного гашения и шести сценариев ProcessIncomingConsignment v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить XSD-невалидный XML гашения ВетИС и доказать офлайн-контрактными тестами корректность полного принятия, частичного принятия и полного возврата — как без расхождений, так и с расхождениями.

**Architecture:** Решение о приёмке и результаты сверки замораживаются в `ReceiptIntent`. Один serializer строит `ProcessIncomingConsignment v2` из закреплённого raw XML входящего эВСД. Описание расхождений формируется один раз и размещается в двух допустимых XSD-полях: `deliveryFacts/docInspection/info` и, только для `MISMATCH + ACCEPT_ALL/PARTIALLY`, `discrepancyReport/description`. Причина возврата передаётся одним `specialMarks` в формате Меркурия. Перед внешним submit XML проходит локальную структурную/XSD-проверку; тесты никогда не выполняют живое гашение.

**Tech Stack:** Python, FastAPI, Pydantic, SQLAlchemy, `xml.etree.ElementTree`/официальная XSD-проверка, pytest, PostgreSQL, существующий outbox и асинхронный submit/poll ВетИС.

**Spec:** W01–W03; API-04/API-10; FT-ARR-06–15; O-12/O-13; `mercury-test-integration-contract.md`; шесть успешных примеров из закрытого `API REQUESTS.txt`; официальная документация [`ProcessIncomingConsignment v2`](https://help.vetrf.ru/wiki/ProcessIncomingConsignment_v2), [`DeliveryInspection v2.0`](https://help.vetrf.ru/wiki/DeliveryInspection_v2.0), [`DiscrepancyReport v2.0`](https://help.vetrf.ru/wiki/DiscrepancyReport_v2.0).

## 1. Инцидент и подтверждённая причина

Партия:

- laboratory: `2812e437-facc-432f-9242-5162c9d9f49f`;
- party: `a560d943-38e3-467f-956c-e2a885514cad`;
- решение: частичное гашение;
- расхождения: вес и количество;
- причина возврата: `QUANTITY_DISCREPANCY` — «Расхождение по количеству».

Сохранённая попытка:

- operation: `bd332dfc-0f6b-5ab3-94dc-8b1781acf54a`;
- application: `31ad1307-3aa8-4e57-9460-e14093103554`;
- `doc_inspection=MISMATCH`;
- `decision=PARTIALLY`;
- принято: `60 кг`, `5 мест`;
- возвращается: `20 кг`, `1 место`;
- состояние: `REJECTED`;
- ответ ВетИС: `Wrong application data format... Элемент 'info' не предусмотрен`.

Причина находится в `backend/src/modules/integrations/vetis/receipt_mapping.py`:

```xml
<mercvu:discrepancyReport>
  <vd:reason>...</vd:reason>
  <vd:info>...</vd:info>
</mercvu:discrepancyReport>
```

Такая структура запрещена схемой. Тип `DiscrepancyReport` допускает после данных документа только:

```xml
<vd:reason>
  <vd:name>...</vd:name>
</vd:reason>
<vd:description>...</vd:description>
```

Поле `vd:info` относится к типу `DeliveryInspection` и должно находиться внутри `vd:docInspection` после `vd:result`:

```xml
<vd:docInspection>
  <vd:responsible>...</vd:responsible>
  <vd:result>MISMATCH</vd:result>
  <vd:info>Описание фактических расхождений</vd:info>
</vd:docInspection>
```

Текущие тесты закрепляют дефект: `test_discrepancy_report_carries_every_item` ищет `info` непосредственно внутри `discrepancyReport`, а параметризованный тест шести сценариев проверяет только количество элементов, но не их XSD-тип, порядок и допустимых родителей.

## 2. Второй связанный дефект: причина возврата

Для `PARTIALLY` и `RETURN_ALL` актуальная документация Меркурия требует передавать причину возврата в единственном поле:

```xml
<vd:specialMarks>Причина возврата: QUANTITY_DISCREPANCY</vd:specialMarks>
```

Для `OTHER_REASON`:

```xml
<vd:specialMarks>Причина возврата: OTHER_REASON Пояснение пользователя</vd:specialMarks>
```

Текущий код:

- записывает только код без обязательного префикса `Причина возврата:`;
- для `OTHER_REASON` создаёт два `specialMarks`;
- тип `VeterinaryAuthentication` допускает `specialMarks` максимум `0..1`.

Это необходимо исправить в той же задаче, иначе частичное гашение после устранения `info` останется семантически неверным или получит следующую XSD-ошибку.

## 3. Источники истины и безопасность

Перед реализацией прочитать полностью:

- `docs/TZ_development/plans/API REQUESTS.txt`, только раздел 4 и шесть сценариев 1.1.1–1.2.3; не копировать apiKey, логины и другие секреты в fixtures, логи, коммиты или evidence;
- `docs/TZ_development/plans/mercury-test-integration-contract.md`;
- `docs/TZ_development/plans/2026-11-06-11-vetis-receipt.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `docs/TZ_development/plans/field-mapping.md`, CHK-F20/21/34/35/44;
- `docs/integration/chk-xml-mapping.md`;
- `dorabotka/2026-11-12-vetis-receipt-unit-xml-scenarios.md` как историю решения, но не как источник XSD при расхождении;
- официальную документацию, указанную в заголовке этого ТЗ.

Приоритет:

1. Фактическая официальная XSD/документация ProcessIncomingConsignment v2.
2. Шесть успешных запросов владельца в `API REQUESTS.txt`.
3. Актуальные ФТ/TZ_development.
4. Старые локальные тесты и предыдущие ТЗ — их исправить, если они закрепляют неверный XML.

Запрещено:

- выполнять живой `ProcessIncomingConsignment` из unit/integration/e2e тестов;
- повторно отправлять уже отклонённый `application_id`;
- автоматически гасить любой существующий ВСД для доказательства исправления;
- выводить raw XML с apiKey/персональными полномочиями в CI/evidence;
- считать HTTP submit успешным гашением до результата `receiveApplicationResultRequest` со статусом `COMPLETED` и доказательствами операции.

## 4. Выбор одного из шести сценариев

Сценарий определяется двумя независимыми осями:

1. `docInspection.result` — совпадают ли документарные сведения с фактом;
2. `decision` — какая часть фактически прибывшего груза принимается.

`vetInspection.result` выбирается пользователем отдельно (`CORRESPONDS`, `MISMATCH`, `UNSUPERVISED`) и не вычисляется из `docInspection` или решения о приёмке.

### 4.1. Определение docInspection

- `CORRESPONDS`: все применимые сравниваемые поля отмечены «Совпадает»; причина возврата сама по себе не создаёт документарное расхождение.
- `MISMATCH`: хотя бы одно допустимое сравниваемое поле отмечено «Не соответствует» и содержит фактическое значение/причину.
- блокирующее расхождение не разрешает `ACCEPT_ALL`/`PARTIALLY`; доступен только `RETURN_ALL` согласно текущей матрице сверки.
- `UNSUPERVISED` не вводить автоматически: шесть утверждённых сценариев относятся к `CORRESPONDS`/`MISMATCH`.

### 4.2. Определение decision

Не менять решение пользователя молча. Проверять согласованность отдельно по массе и количеству мест:

- `ACCEPT_ALL`: принято всё фактически прибывшее; `returned=0`;
- `PARTIALLY`: принятая и возвращаемая части обе строго положительны; `accepted + returned = delivered` для массы и количества;
- `RETURN_ALL`: принято `0`; возвращается всё `delivered`.

Документарные масса/количество из входящего эВСД, фактически доставленные значения и разделение accepted/returned — разные сущности. Для описания расхождения сравнивать source с фактическим delivered, а не подменять факт принятой частью.

### 4.3. Матрица XML

| Сценарий | docInspection | decision | `delivery/consignment` | `docInspection/info` | `discrepancyReport` | `returnedDelivery` |
|---|---|---|---|---|---|---|
| 1.1.1: совпадает, принять всё | `CORRESPONDS` | `ACCEPT_ALL` | вся принятая часть | нет | нет | нет |
| 1.1.2: совпадает, принять часть | `CORRESPONDS` | `PARTIALLY` | принятая часть | нет | нет | возвращаемая часть |
| 1.1.3: совпадает, вернуть всё | `CORRESPONDS` | `RETURN_ALL` | отсутствует | нет | нет | вся доставленная партия |
| 1.2.1: расхождение, принять всё | `MISMATCH` | `ACCEPT_ALL` | фактическая принятая часть | обязательно | `reason` + `description` | нет |
| 1.2.2: расхождение, принять часть | `MISMATCH` | `PARTIALLY` | принятая часть | обязательно | `reason` + `description` | возвращаемая часть |
| 1.2.3: расхождение, вернуть всё | `MISMATCH` | `RETURN_ALL` | отсутствует | обязательно | отсутствует | вся доставленная партия |

Для `PARTIALLY`/`RETURN_ALL` в `returnedDelivery/.../authentication/specialMarks` находится ровно одна корректно сформированная причина возврата.

## 5. Правила описания расхождений

Сформировать один детерминированный `discrepancy_description` из полного набора mismatch-полей закреплённой ревизии сверки.

Для каждого элемента хранить/получать:

- `field_id`;
- человекочитаемое русское название поля;
- исходное значение из закреплённого source XML/snapshot;
- фактическое значение пользователя;
- указанную причину расхождения.

Пример содержания, не XML-экранирование вручную:

```text
Количество: в ВСД 5, фактически 6 (Фактическое количество больше заявленного); Вес, кг: в ВСД 60, фактически 80 (Фактический вес больше заявленного)
```

Требования:

- строка строится в стабильном порядке полей сверки, а не в случайном порядке dict;
- значения берутся из frozen source/reconciliation, не перечитываются из изменившегося ВСД после подтверждения;
- XML escaping выполняет serializer;
- ни одно mismatch-поле не теряется;
- не показывать пользователю технические `CHK-F20` вместо названия, но field_id можно сохранять в intent/evidence;
- итоговая строка не должна превышать фактический XSD/API-лимит; при превышении не обрезать молча — отказать до submit понятной ошибкой;
- для `MISMATCH` ту же строку записать в `docInspection/info`;
- для `MISMATCH + ACCEPT_ALL/PARTIALLY` ту же строку записать в `discrepancyReport/description`;
- `discrepancyReport/reason/name` содержит понятную причину акта; минимум одно из `reason`/`description` обязательно, в этой системе передаются оба;
- для `RETURN_ALL` описание остаётся только в `docInspection/info`, `discrepancyReport` не создаётся.

## 6. Причина возврата

Список кодов не менять и не переводить обратно в XML русской подписью. Для выбранного пользователем кода создавать ровно один `specialMarks`:

```python
def format_return_reason(code: str, text: str | None) -> str:
    # standard code
    # "Причина возврата: QUANTITY_DISCREPANCY"
    # OTHER_REASON
    # "Причина возврата: OTHER_REASON <trimmed text>"
```

Правила:

- поле существует только для `PARTIALLY`/`RETURN_ALL`;
- префикс в точности `Причина возврата:`;
- затем один допустимый ID из справочника ProcessIncomingConsignment v2;
- `OTHER_REASON` требует непустой текст после trim, не более 240 символов;
- стандартный код не дополняется русской подписью;
- не создавать второй `specialMarks`;
- если исходная authentication уже содержит особые отметки, не терять их молча: объединить существующий текст и фразу причины возврата в одно значение по официальному формату либо отказать до submit при превышении лимита; не дублировать старую причину возврата;
- preview/подтверждение показывает пользователю выбранную русскую подпись, но XML получает ID.

## 7. План реализации

### Task 1: Закрепить правильную структуру тестами

**Files:** изменить `backend/tests/vetis/test_receipt_mapping.py`; создать `backend/tests/fixtures/vetis/process_incoming_consignment/` с шестью обезличенными contract fragments; при доступности официальной схемы создать `backend/tests/vetis/test_receipt_xsd_contract.py` и закреплённые schema fixtures с SHA-256.

**Interfaces:** `build_process_incoming_application`; helpers чтения namespace-aware XML; проверка допустимых родителей/порядка элементов.

- [ ] Заменить неверный assert, ищущий `discrepancyReport/info`, на assert отсутствия такого элемента и наличия `discrepancyReport/description`.
- [ ] Для всех `MISMATCH` проверить `deliveryFacts/docInspection/info`; для `CORRESPONDS` — отсутствие `info`.
- [ ] Для шести сценариев проверить точный состав из матрицы, accepted/returned mass и package quantity, порядок элементов и namespaces.
- [ ] Добавить отдельные asserts: `RETURN_ALL` не содержит forward consignment и discrepancyReport; PARTIALLY содержит две consignment; ACCEPT_ALL не содержит returnedDelivery.
- [ ] Добавить contract tests `specialMarks`: стандартный код, OTHER_REASON, существующая отметка, лимит и строго один элемент.
- [ ] Валидировать шесть XML официальной XSD офлайн. Если полная XSD пока не закреплена, не подменять её самодельной схемой: выполнить точные contract-fragment assertions, зафиксировать SHA/pinning как обязательный блокер перед закрытием задачи и не запускать live write вместо проверки.
- [ ] Запустить адресный набор и получить RED по текущему `info`/`specialMarks`; зафиксировать `test: reproduce invalid receipt discrepancy xml`.

### Task 2: Исправить формирование discrepancy XML

**Files:** изменить `backend/src/modules/integrations/vetis/receipt_mapping.py`, `backend/src/modules/integrations/vetis/receipt.py`, `backend/src/modules/integrations/vetis/contracts.py`; тесты Task 1.

**Interfaces:** helper `build_discrepancy_description(items) -> str`; `_delivery_facts(...)` либо эквивалент; `ReceiptIntent.discrepancy_items` с source/label/actual/reason.

- [ ] Сформировать `discrepancy_description` один раз из всех items.
- [ ] После `docInspection/result=MISMATCH` добавить `vd:info`; для CORRESPONDS не добавлять.
- [ ] В `discrepancyReport` заменить недопустимый `vd:info` на `vd:description`.
- [ ] Передавать в intent исходные значения и русские названия из frozen read model; не подменять source текущим accepted value.
- [ ] Сохранить `discrepancyReport` только для MISMATCH + ACCEPT_ALL/PARTIALLY.
- [ ] Сохранить отсутствие акта при RETURN_ALL, но не терять `docInspection/info`.
- [ ] Проверить namespace и порядок `responsible → result → info`, а также document fields → reason → description.
- [ ] Запустить tests до GREEN и зафиксировать `fix: serialize discrepancy details in valid vetis elements`.

### Task 3: Исправить specialMarks причины возврата

**Files:** изменить `backend/src/modules/integrations/vetis/receipt_mapping.py`, при необходимости `contracts.py`; изменить `backend/tests/vetis/test_receipt_mapping.py`, `test_reconcile.py`.

**Interfaces:** `format_return_reason(code,text) -> str`; один `VeterinaryAuthentication.specialMarks`.

- [ ] Для `QUANTITY_DISCREPANCY` получить точное значение `Причина возврата: QUANTITY_DISCREPANCY`.
- [ ] Для OTHER_REASON получить `Причина возврата: OTHER_REASON <text>` одним элементом.
- [ ] Проверить полный справочник разрешённых ID, trim и лимит 240 для свободного пояснения.
- [ ] Не удалять без объяснения исходные особые отметки; корректно объединять в одно поле и контролировать общий XSD-лимит.
- [ ] Обновить неверные старые tests/ТЗ, которые ожидали два specialMarks или код без префикса.
- [ ] Запустить tests и зафиксировать `fix: encode vetis return reason in one special mark`.

### Task 4: Проверить preview, retry и асинхронный результат

**Files:** изменить `backend/tests/vetis/test_receipt_failures.py`, `test_receipt_api.py`/фактический endpoint test, `test_reconcile.py`; production flow менять только при обнаруженной регрессии.

**Interfaces:** preview → explicit confirmation → outbox submit → application_id → receiveApplicationResult → CONFIRMED/REJECTED/UNKNOWN.

- [ ] Проверить, что исправленный preview/fingerprint содержит новый XML и старый подтверждённый fingerprint не переиспользуется.
- [ ] REJECTED попытка является terminal; повтор после исправления создаёт новую operation и новый localTransactionId, не переотправляет старый application_id.
- [ ] Повторный submit блокируется для QUEUED/SUBMITTING/PROCESSING/UNKNOWN; доступно только reconcile результата.
- [ ] COMPLETED считается успехом только при совпадении decision, accepted/returned mass+quantity, return reason/evidence; REJECTED сохраняет код/текст ВетИС.
- [ ] Добавить spy transport tests: submit ровно один раз, poll по application_id, живых внешних вызовов ноль.
- [ ] Запустить адресные backend tests и зафиксировать `test: verify safe receipt retry and async result`.

### Task 5: Обновить интеграционный контракт

**Files:** изменить `docs/TZ_development/plans/mercury-test-integration-contract.md`, `docs/integration/chk-xml-mapping.md`, при необходимости `dorabotka/2026-11-12-vetis-receipt-unit-xml-scenarios.md`; создать `docs/implementation/vetis-receipt-discrepancy-xml-evidence.md`.

**Interfaces:** документированная таблица шести сценариев и точные XPath.

- [ ] Явно записать `docInspection/info` и `discrepancyReport/description`; удалить двусмысленную формулировку «передать info» без родителя.
- [ ] Исправить формат specialMarks и правило одного элемента.
- [ ] Записать, что return reason и discrepancy reason — разные данные и не подменяют друг друга.
- [ ] В evidence сохранить только обезличенные XML fragments, результаты XSD/tests и хеши схем; секреты и полный production raw XML не включать.
- [ ] Зафиксировать `docs: clarify six receipt xml scenarios`.

### Task 6: Итоговая проверка и поставка

**Files:** это ТЗ, изменения Tasks 1–5; без миграции БД, если модель intent остаётся JSON-compatible.

**Interfaces:** feature branch → `main`; backend/vetis-worker images должны быть построены из одного commit.

- [ ] Работать в отдельной ветке `codex/fix-vetis-receipt-discrepancy-xml`, не включать чужие незавершённые файлы и секреты.
- [ ] Запустить `uv run --frozen pytest backend/tests/vetis/test_receipt_mapping.py backend/tests/vetis/test_reconcile.py backend/tests/vetis/test_receipt_failures.py -v` и связанные API tests.
- [ ] Запустить backend lint/type/coverage gates проекта; отдельно подтвердить XSD/contract tests всех шести сценариев.
- [ ] Не выполнять живое гашение автоматически. Если владелец отдельно разрешит контрольный write, использовать только специально указанный ВСД и один submit; иначе завершить offline evidence.
- [ ] Закоммитить это ТЗ вместе с кодом/evidence, влить ветку в `main` без force/reset и запушить настроенный remote.
- [ ] Пересобрать одинаковым commit контейнеры `backend` и `vetis-worker`, перезапустить без удаления PostgreSQL volume; проверить health и отсутствие старого image у worker.
- [ ] Для партии инцидента разрешить пользователю заново подготовить preview после terminal REJECTED; не отправлять автоматически. Новый preview должен показывать те же 60/5 accepted и 20/1 returned и новый fingerprint.
- [ ] В финальном отчёте указать коммиты, тесты, XSD evidence, container image IDs и честные not-run.

## 8. Обязательные критерии приёмки

- [ ] В XML нигде нет `discrepancyReport/info`.
- [ ] Каждый `MISMATCH` содержит непустой `docInspection/info` со всеми расхождениями.
- [ ] MISMATCH + ACCEPT_ALL/PARTIALLY содержит `discrepancyReport/reason` и `discrepancyReport/description`.
- [ ] MISMATCH + RETURN_ALL не содержит discrepancyReport.
- [ ] CORRESPONDS не содержит ни docInspection/info, ни discrepancyReport.
- [ ] ACCEPT_ALL содержит accepted consignment и не содержит returnedDelivery.
- [ ] PARTIALLY содержит положительные accepted/returned части, обе пары суммируются в delivered.
- [ ] RETURN_ALL не содержит forward consignment; returnedDelivery содержит весь delivered.
- [ ] Масса и количество мест не подменяют друг друга; `dt:quantity` остаётся целым XSD-значением.
- [ ] `QUANTITY_DISCREPANCY` передаётся одной строкой `Причина возврата: QUANTITY_DISCREPANCY`.
- [ ] OTHER_REASON передаётся одним specialMarks и требует пояснение до 240 символов.
- [ ] Ветосмотр остаётся независимым от документарного расхождения.
- [ ] Все шесть обезличенных XML проходят официальный offline XSD/contract gate.
- [ ] Старый REJECTED application_id не отправляется повторно; новая попытка имеет новый localTransactionId.
- [ ] Submit выполняется один раз, результат получается асинхронно через `receiveApplicationResultRequest`.
- [ ] Backend и vetis-worker после обновления работают из одного commit/image generation.

## 9. Review Focus

- Не ограничиваться переименованием тега: `info` нужно переместить в `docInspection`, а в акте использовать `description`.
- Не потерять описание расхождений в RETURN_ALL, где акта нет, но `docInspection/info` остаётся.
- Не путать фактически доставленное количество с принятой после частичного возврата частью.
- Не смешивать причину возврата `QUANTITY_DISCREPANCY` с причиной/описанием акта несоответствия.
- Не создавать два `specialMarks`: cardinality `0..1`.
- Не продолжать тестировать XML только подсчётом тегов без проверки родителя, порядка, namespace и XSD.
- Не считать полученный application_id успехом: окончательный исход приходит асинхронно.
- Не выполнять живой write для автоматической проверки и не гасить пользовательские ВСД без отдельного явного разрешения.

