# DR38 — Исправление XML частичного гашения и шести сценариев ProcessIncomingConsignment v2 (evidence)

Дата: 2026-11-16. Ветка: `codex/fix-vetis-receipt-discrepancy-xml`.
ТЗ: `dorabotka/2026-11-16-vetis-receipt-discrepancy-xml-schema.md`.

## 1. Инцидент и корневая причина

ВетИС отклонил заявку частичного гашения (`applicationId` инцидента сохранён в
локальном журнале операций; в evidence не публикуется) с ответом
`Wrong application data format... Элемент 'info' не предусмотрен`.

Официальные типы (help.vetrf.ru):

- `DiscrepancyReport v2.0` — после данных документа допускает только
  `reason` (`vd:DiscrepancyReason`, `0..1`) и `description` (`xs:string`,
  `0..1`). Элемент `info` внутри `discrepancyReport` схемой не предусмотрен.
- `DeliveryInspection v2.0` — `responsible` (`1`), `result` (`1`),
  `info` (`0..1`) — «особые отметки»; именно здесь находится описание
  фактических расхождений.
- `VeterinaryAuthentication v2.0` — `specialMarks` — тип `bs:Text`
  (`0..1`), «строковый тип без ограничения максимальной длины».

Корневые дефекты в `backend/src/modules/integrations/vetis/receipt_mapping.py`:

1. `vd:info` с описанием расхождений писался непосредственно в
   `mercvu:discrepancyReport` — XSD-невалидно.
2. Причина возврата писалась кодом без префикса `Причина возврата:`, а для
   `OTHER_REASON` создавались два элемента `specialMarks` (кардинальность
   `0..1` нарушена).

## 2. Исправления

- `receipt_mapping.py`: `vd:info` перемещён в `docInspection` после
  `responsible → result` (только при `MISMATCH`); в акте вместо запрещённого
  `info` — `description`; `reason/name` содержит понятную причину акта
  «Причина несоответствия (акт)». Порядок внутри акта: реквизиты документа
  (`issueNumber`) → `reason` → `description`.
- Одно детерминированное описание расхождений строится один раз из полного
  набора mismatch-полей закреплённого intent (`build_discrepancy_description`)
  в стабильном порядке полей сверки (FIELD_SPECS); для каждого поля — русское
  название (без технических CHK-ID), исходное значение из frozen read model
  (`source_projection` по checksum-verified snapshot), фактическое значение
  и причина. Превышение предохранителя объёма текста (2000 символов;
  XSD-лимита нет — защита от практических лимитов шины) — отказ до submit,
  без тихой обрезки.
- `format_return_reason`: ровно один `specialMarks` в формате
  `Причина возврата: <ID>`, для `OTHER_REASON` —
  `Причина возврата: OTHER_REASON <текст ≤240>`. Код проверяется по
  справочнику `RETURN_REASON_CODES` (ФТ-10). Существующие особые отметки
  исходного ВСД не теряются молча: объединяются с фразой причины возврата в
  одно значение; старая фраза причины возврата не дублируется.
- `receipt.py`: mismatch-поля intent получают `label` и `source` из
  закреплённого read model, порядок — FIELD_SPECS, а не порядок dict checks.
- `evidence.py`: доказательством причины возврата является полная фраза
  `Причина возврата: <ID>` (для `OTHER_REASON` — с текстом) в
  `specialMarks` возвратного ВСД; старый формат «голого кода» больше не
  подтверждает причину.

## 3. Матрица шести сценариев (точные XPath)

| Сценарий | `docInspection` | `decision` | `delivery/consignment` | `docInspection/info` | `discrepancyReport` | `returnedDelivery` | `specialMarks` |
|---|---|---|---|---|---|---|---|
| 1.1.1 | `CORRESPONDS` | `ACCEPT_ALL` | вся принятая часть | нет | нет | нет | нет |
| 1.1.2 | `CORRESPONDS` | `PARTIALLY` | принятая часть | нет | нет | возвращаемая часть | 1 × `Причина возврата: CODE` |
| 1.1.3 | `CORRESPONDS` | `RETURN_ALL` | отсутствует | нет | нет | вся доставленная партия | 1 × `Причина возврата: CODE` |
| 1.2.1 | `MISMATCH` | `ACCEPT_ALL` | фактически принятое | обязательно | `reason` + `description` | нет | нет |
| 1.2.2 | `MISMATCH` | `PARTIALLY` | принятая часть | обязательно | `reason` + `description` | возвращаемая часть | 1 × `Причина возврата: CODE` |
| 1.2.3 | `MISMATCH` | `RETURN_ALL` | отсутствует | обязательно | отсутствует | вся доставленная партия | 1 × `Причина возврата: CODE` |

Точный порядок элементов запроса: `localTransactionId → initiator →
delivery → deliveryFacts → [discrepancyReport] → [returnedDelivery]`.
Внутри `deliveryFacts`: `vetCertificatePresence → docInspection →
vetInspection → decision`; внутри `docInspection`: `responsible → result →
[info]`. Возвратный `authentication` находится внутри
`accompanyingForms/vetCertificate` (пример владельца, раздел 4
`docs/TZ_development/plans/API REQUESTS.txt`).

Обезличенные contract-fragments шести сценариев:
`backend/tests/fixtures/vetis/process_incoming_consignment/scenario-1.1.1.xml` …
`scenario-1.2.3.xml`; тест
`test_six_scenarios_match_deidentified_owner_fragments` сверяет точную
структуру (локальные имена + порядок) построенного XML с фрагментами.
Секреты (apiKey, логины, issuerId владельца) в фрагменты не включены.

## 4. Статус XSD

Официальная XSD ProcessIncomingConsignment v2 **не закреплена офлайн**;
самодельная схема не подменяет её. Выполнены точные contract-fragment
assertions (родители, порядок, namespaces `mercvu`/`vd`/`bs`/`dt`) и
структурные проверки по страницам `DiscrepancyReport v2.0`,
`DeliveryInspection v2.0`, `VeterinaryAuthentication v2.0` (help.vetrf.ru,
получены 2026-11-16).

**Блокер перед закрытием задачи (не снят этим исполнителем):** закрепить
официальную XSD (шифр схемы Меркурия для Platform services 2.0) в
репозитории с SHA-256 pinning и добавить офлайн-валидацию шести
обезличенных XML этой XSD (`test_receipt_xsd_contract.py`).

## 5. Команды и результаты

- `uv run --frozen pytest backend/tests/vetis/test_receipt_mapping.py -q` —
  RED до исправления: 19 failed / 23 passed (в т.ч.
  `test_reproduce_invalid_receipt_discrepancy_xml`: `assert not any(info in
  discrepancyReport)` и `test_reason_code_then_other_reason_text_in_special_marks`:
  `2 != 1`). После исправления — GREEN.
- `uv run --frozen pytest backend/tests/vetis/test_receipt_mapping.py
  backend/tests/vetis/test_reconcile.py backend/tests/vetis/test_receipt_failures.py -q`
  — 69 passed (Task 2/3), затем 24 passed по failures (Task 4).
- Полные наборы: `backend/tests/vetis` + `backend/tests/arrivals` —
  372 passed / 2 failed до правки fixture `classification_snapshot`
  (DR10-тесты), после правки — pass; контрольный прогон см. отчёт задачи.
- `uv run ruff check backend/src/modules/integrations/vetis backend/tests/vetis`
  — All checks passed; `ruff format` применён к изменённым файлам.
- `uv run --frozen mypy backend/src` — 37 ошибок на ветке против 40 на базе
  `93c1d53` (все предсуществующие, новые не добавлены).

## 6. Честные not-run

- Живой `ProcessIncomingConsignment` не выполнялся (запрещено ТЗ §3);
  фактическое повторное гашение партии инцидента — только по явному
  разрешению владельца.
- Официальная XSD-валидация не выполнялась: схема не закреплена офлайн
  (см. §4, блокер).
- `dorabotka/2026-11-12-vetis-receipt-unit-xml-scenarios.md` не изменён:
  файл не входит в дерево ветки (не отслеживается git на базовом коммите);
  его раздел 6.2 с двумя `specialMarks` устарел — исправить при возврате
  файла в дерево.
- Пересборка/перезапуск контейнеров `backend` и `vetis-worker`, merge в
  `main` и push — вне зоны ответственности исполнителя задачи DR38.
