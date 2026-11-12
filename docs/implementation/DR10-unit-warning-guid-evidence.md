# DR10 — признание GUID единицы исходного эВСД без dt:name (evidence)

Дата: 2026-11-12. Ветка: `feature/DR10-unit-warning-guid` (base 53335f4, DR9).
ТЗ: `dorabotka/2026-11-12-vetis-unit-warning-source-guid.md` §1–10; rulings R-DR10-1..7.

## 1. Подтверждённая причина (§1)

- Backend canonical contract уже был верен (DR8): `documentary.unit_id` = `batch.unit.guid`
  (`backend/src/modules/arrivals/queries.py::_quantity_set`), `classification.unit.id` — тот же
  GUID (`commands._classification_snapshot` → `_entry(batch.unit)`), source projection
  публикует `unitId`/`unitName` раздельно (`reconciliation.source_projection`).
- Ложное сообщение давал frontend: `api.ts::partyUnit()` возвращал только
  `classification.unit.name` (а `external.fields.unitId` ранее не публиковался);
  `ReconciliationForm` показывал предупреждение при пустой строке имени, хотя
  GUID единицы присутствует (`e13bda81-…`: `batch.unit.guid = 21ed96c9-…` без `dt:name`).

## 2. Канонический контракт единицы (§4 / R-DR10-1..2)

`frontend/src/features/arrivals/api.ts`:

- `partyUnit(view): { id, name }` — приоритет `documentary.unit_id` →
  `classification.unit.id` → `external.fields.unitId`; имя (`external.fields.unitName` →
  `classification.unit.name`) — только отображение;
- `hasSourceUnit(view)` — единица считается присутствующей ТОЛЬКО при валидном
  GUID (UUID-regex); пустая строка, масса «500.0», количество «8», текст «кг» — не единица;
- `partyUnitLabel(view)` — имя, иначе честный fallback «Единица из ВСД (GUID: …)»;
- отдельный input GUID не добавлялся (R-DR10-1).

## 3. Backend read model и hardening (§5 / R-DR10-3)

- `queries._external_fields` теперь публикует `unitName` (display-only, `None` при
  отсутствии имени); отсутствие имени не означает отсутствие единицы.
- `receipt.build_receipt_preview`: код ошибки отсутствующего GUID источника изменён
  с `VALIDATION_ERROR` на диагностический `UNIT_MISSING` (§5, §8-2).
- `reconciliation.save_reconciliation`: источник GUID наследуется ДО валидации —
  новая сверка получает GUID во все три QuantitySet (клиентский unit не
  переопределяет); существующая сверка с пустым ИЛИ несовпадающим сохранённым
  unit безопасно нормализуется из неизменного snapshot (fix round 1: источник —
  единственный авторитет единицы, несоответствие не сохраняется). Отдельный
  конфликт CHK-F20 возникает только при несогласованности частей между собой,
  а не при расхождении с источником — расхождение с источником устраняется
  нормализацией, поэтому XML с пустой/чужой единицей невозможен.
- `reconciliation.build_reconciliation_view`: view существующей сверки с пустым
  сохранённым unit нормализуется из `_source_unit_id(document_row)`.
- Preview-gate (§7 / R-DR10-4) подтверждён тестами: GUID источника существует;
  три `*_unit_id` == source GUID; checksum/revision актуальны (`SOURCE_CHECKSUM_MISMATCH`,
  `REVISION_CONFLICT`); отсутствие `dt:name` ≠ UNIT_MISSING.

## 4. Frontend (§6 / R-DR10-5)

- `ReconciliationForm`: предупреждение «Исходный эВСД не содержит единицу измерения…»
  показывается ТОЛЬКО при пустом/невалидном canonical GUID (`hasSourceUnit`); при
  GUID без имени — «Единица из ВСД (GUID: …)»; при имени — имя + GUID в `title`
  (доступная подсказка); метка «Количество (имя)» только при наличии имени;
  `initialValues` берёт unit из canonical `partyUnit().id`.
- `ReconciliationFeedback`/форма: серверный `UNIT_MISSING` и CHK-F20 без
  разрешимой части привязаны к блоку количества/единицы (§8-6), не только к баннеру.
- `ReceiptConfirmationDialog`: строка «Единица измерения (из эВСД)» использует
  `partyUnitLabel` (GUID fallback при пустом имени).
- `ReconciliationPage`: при изменении ревизии party (source snapshot) reconciliation
  перечитывается из сервера (`invalidateQueries`), локальное состояние unit не хранится.

## 5. Тесты (§8)

Backend (`backend/tests/arrivals/test_dr10_unit_guid.py`, `backend/tests/vetis/test_dr10_unit_guid.py`):

1. snapshot с GUID без имени → preview разрешён; 2. без GUID → `UNIT_MISSING`;
3. новая сверка наследует GUID в 3 QuantitySet; 4. `documentary.unit_id` ==
   `classification.unit.id`; 5. пустая сверка с GUID без ложной ошибки;
6. несовпадение сохранённого unit с source GUID → нормализация при сохранении
   (fix round 1), а на уровне preview — блокировка (`VALIDATION_ERROR`); 7. namespace-aware XML:
   `vd:unit/bs:guid` == source GUID, `vd:volume` = масса, `dt:quantity` = места,
   «кг» никогда не bs:guid; 8. никакой внешний write: тесты вызывают только
   `build_receipt_preview` (offline XML), transport не создаётся,
   `VETIS_WRITE_ENABLED` не изменялся.

Frontend (vitest): DR10 describe в `ReconciliationForm.test.tsx` (§8-1..3, §8-5, §8-6)
и `ReceiptOperation.test.tsx` (§8-4: «Подготовить гашение» не блокируется из-за
отсутствия имени; диалог показывает GUID fallback). Все фикстуры — msw, без живой сети.

## 6. Результаты гейтов

- `uv run --frozen ruff check backend frontend/tests/e2e` — passed.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis` — 203 passed.
- `npm.cmd run format:check` (после prettier --write), `typecheck`, `lint`
  (0 errors; 1 предсуществующий warning в `use-catalog-context.ts`, не из этой задачи),
  `test -- --run` — 50 файлов / 281 passed, `build`, `build-storybook` — passed.

## 7. Не выполнено / честно not-run

- §8 frontend-7: проверка 1440/1024/768/390 px и клавиатурного доступа в реальном
  браузере НЕ выполнялась (пересборка Docker-контейнеров — шаг контроллера; живой
  стенд недоступен). Изменения используют существующие компоненты `Field`,
  нативные radio/checkbox (клавиатура), CSS-классы переиспользованы без новых
  брейкпоинтов. Требуется визуальная проверка после пересборки.
- Пересборка контейнеров и merge в main — контроллер (R-DR10-7).
- Живой VetIS write не выполнялся; `VETIS_WRITE_ENABLED`, `.env*`, compose,
  `vetis-schema/` не тронуты; данные (пользователи/ВСД/ВСЭ/партии) не удалялись.
- Миграции не потребовались.

## Fix round 1 (по ревью, 2026-11-12)

- Исправлена неточность формулировок: CHK-F20 в `validation.py` возникает только при
  несогласованности трёх частей МЕЖДУ собой; полностью согласованный, но отличный от
  источника GUID ранее проходил сохранение и падал только на preview. Формулировки
  настоящего файла и отчёта исправлены.
- Добавлена серверная гарантия (§5/R-DR10-3): в `save_reconciliation` выбрана семантика
  НОРМАЛИЗАЦИИ — пустой, устаревший ИЛИ несовпадающий unit в любой части приводится к
  source GUID неизменного snapshot до валидации и записи; несоответствие источнику
  невозможно сохранить; view (_quantities) показывает ту же нормализацию.
- Переписан тест нормализации: теперь через реальный `save_reconciliation` на БД
  (db_session), с проверкой сохранённых unit_id (пустой → GUID; чужой GUID → GUID) и view.
