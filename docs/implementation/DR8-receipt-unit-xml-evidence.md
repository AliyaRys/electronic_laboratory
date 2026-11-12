# DR8 — receipt unit propagation and XML scenarios: evidence

Дата: 2026-11-12. Ветка: `feature/DR8-receipt-unit-xml` (от main a684236).
Задание: `dorabotka/2026-11-12-vetis-receipt-unit-xml-scenarios.md` (§1–13) + rulings R-DR8-1..9.

## 1. Корневая причина CHK-F20 и её устранение

- Подтверждено: `queries.py::_quantity_set` читал `unit.id` из snapshot, тогда как
  DR5-нормализатор хранит единицу как external reference (`guid`). Теперь
  `_quantity_set` берёт `batch.unit.guid` → `IncomingView.documentary.unit_id`
  равен source unit GUID (тест `test_documentary_quantity_set_carries_source_unit_guid`).
- `source_projection()` публикует `fields.unitId` = GUID и отдельное
  `fields.unitName` (имя — только для UI)
  (тест `test_source_projection_publishes_unit_guid_and_name_separately`).
- Новая сверка: пустой `ReconciliationView` и первая запись (`save_reconciliation`,
  ветка `row is None`) автоматически подставляют source GUID во все три
  QuantitySet (delivered/accepted/returned)
  (тест `test_new_reconciliation_view_inherits_unit_in_all_three_quantity_sets`).
- Нет GUID у исходного ВСД → гашение блокируется честной ошибкой
  `build_receipt_preview` («Исходный эВСД не содержит единицу измерения…»);
  расхождение единицы сверки с исходной → 422.

## 2. Раздельные размерности (R-DR8-2)

- `ReceiptIntent` расширен полями `documentary/delivered/accepted/returned_*_mass_kg`
  и `*_quantity` (8 полей вместо 4 смешанных). Preview берёт массу из колонок
  `*_mass_kg` сверки, количество из `*_quantity`.
- XML: `<vd:volume>` = масса; `dt:package/dt:quantity` = количество мест
  (верхний уровень packaging; отсутствующий packageList создаётся честно);
  `<vd:unit><bs:guid>` = source GUID. Проверки: `test_volume_is_mass_and_package_quantity_is_places`.
- Conservation проверяется отдельно по массе и по количеству
  (`validate_receipt_intent`). Никакой подмены quantity↔volume, масса не делится.
- Evidence parser проверяет массу и количество отдельно по stockEntry и
  RETURNABLE-документу (`test_mass_without_places_count_is_unknown`,
  `test_complete_partial_evidence_confirms_frozen_composition`).

## 3. Purpose и причины возврата (R-DR8-3/4)

- returnedDelivery сохраняет purpose исходного ВСД (копия authentication),
  при отсутствии purpose в исходном XML неполный возвратный XML не формируется
  (тесты `test_returned_delivery_copies_source_purpose`,
  `test_return_without_source_purpose_is_refused`).
- Причины: 14 кодов из таблицы §6.2 с точными русскими подписями в UI
  (`RETURN_REASON_CODES` в `frontend/.../api.ts`); payload — точный код;
  XML `<vd:specialMarks>`: сначала код, затем `OTHER_REASON: текст`
  (тест `test_reason_code_then_other_reason_text_in_special_marks`);
  evidence принимает только точный код, русская подпись кодом не считается
  (`test_wrong_reason_code_in_return_document_is_unknown`).
- OTHER_REASON: текст 1–240 символов — сервер (422) и клиент (zod + maxLength=240).

## 4. Матрица 6 сценариев (§8) и vetInspection

- `docInspection` = MISMATCH при отмеченных расхождениях, иначе CORRESPONDS;
  `vetInspection` передаётся независимо, три значения покрыты тестом
  `test_vet_inspection_is_independent`.
- 6 сценариев (docInspection × ACCEPT_ALL/PARTIALLY/RETURN_ALL) покрыты
  параметризованным `test_six_contract_scenarios`; RETURN_ALL — forward delivery
  без consignment (`test_return_all_forward_delivery_has_no_consignment`) и без
  discrepancyReport (`test_return_all_has_no_discrepancy_report`);
  mismatch+ACCEPT_ALL/PARTIALLY → полный discrepancyReport со всеми items
  (source/actual/reason) + `vd:info`
  (`test_discrepancy_report_carries_every_item`).

## 5. Даты (R-DR8-6)

- `issueDate` = server time формирования запроса (frozen в intent; submit
  эхом передаёт `issue_date` preview, fingerprint остаётся тем же);
- `deliveryDate` = введённая дата поступления;
- новый ввод «Дата и время возврата» в UI (только PARTIAL/RETURN_ALL) →
  `returnedDelivery/vd:deliveryDate`. Дата запроса никогда не подставляется.
- Тест: `test_request_dates_are_not_mixed`; UI-тесты
  (`demands the return date…`, `shows the §9 summary facts…`).

## 6. UI (§10)

- CHK-F20 привязан к блоку единицы/количества конкретной части
  (delivered/accepted/returned) — серверные ProblemItem по `path` рендерятся
  в соответствующей карточке (тест `binds the server CHK-F20 problem…`).
- Read-only единица отображается над блоками количеств; ввод единицы отсутствует.
- Ввод не очищается при ошибке (RHF-состояние; Regress-тесты A02 сохранены).
- Повторная отправка заблокирована (`useCommand`, UNKNOWN-состояние; backend
  `queue_receipt` отказывает при живой операции).
- Диалог подтверждения показывает §9-список: ревизии/checksum, единица, массы и
  места, даты поступления/возврата, осмотры, причина, акт, маршрут, fingerprint.
- Адаптивность: сетка количеств уже имеет брейкпоинт ≤800px (1 колонка),
  строка единицы тянется на всю ширину (`grid-column: 1 / -1`).

## 7. Тесты и ворота

Backend (`uv run --frozen pytest backend/tests/arrivals backend/tests/vetis`):
**176 passed, 1 failed — `test_sync.py::test_no_write_on_read_stage`,
предсуществующий отказ, зависящий от окружения** (владелец включил
`VETIS_WRITE_ENABLED=true`; проверено на чистом дереве через git stash — падает
и без моих изменений). Агент VETIS_WRITE_ENABLED не менял.
`ruff check backend frontend/tests/e2e` — чисто.

Frontend: `format:check` ✓ (включая предсуществующий неформатированный
`tests/e2e/catalogs.spec.ts` — приведён к стилю без смысловых правок),
`typecheck` ✓, `lint` ✓ (0 errors, 1 предсуществующий warning),
`test -- --run` ✓ **272 passed**, `build` ✓, `build-storybook` ✓.

Схема API: `frontend/src/shared/api/schema.d.ts` перегенерирована
`npm run gen:api` из OpenAPI-документа этого бэкенда (локальный дамп, без Docker).

## 8. Запрет живого write (§4)

- Ни один тест/диагностика не вызывали живой `ProcessIncomingConsignment`;
  в тестах только fixtures + spy/транспорт-заместители (ZeepApplicationTransport
  с заглушкой `_post`).
- `.env*`, compose, `vetis-schema/` — не тронуты. Контейнеры не пересобирались
  (шаг контроллера, R-DR8-9). Dev-БД: никаких удалений/сбросов.

## 9. Честные пропуски

- e2e (Playwright): не запускались — требуют поднятого стека (пересборка
  контейнеров принадлежит контроллеру). Дополнения к e2e не добавлялись,
  покрытие экрана выполнено компонентными тестами.
- `test_sync.py::test_no_write_on_read_stage` — предсуществующий
  env-зависимый отказ (см. §7).
