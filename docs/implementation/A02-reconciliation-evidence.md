# A02 — Валидатор CHK и самостоятельное сохранение (Поступления), свидетельства выполнения

Задача A02 плана `docs/TZ_development/plans/2026-11-06-04-arrivals.md`; ветка `feature/A02-reconciliation` (от `feature/A01-queues` 935c001). Коммиты: `bc33fad` (backend), `bf9fd48` (frontend), оба `feat: implement typed reconciliation and receipt decision rules`, push в origin.

## Backend (`backend/src/modules/arrivals/`)

- `validation.py` — чистый валидатор `validate_receipt(payload: ReconciliationWrite, source: IncomingDocument, capabilities: ReceiptCapabilities) -> ReceiptValidation` (errors / blocking / allowed_decisions / act / route; `complete` = ни неполноты, ни блокировок):
  - реестр всех 44 CHK полей (`FIELD_SPECS`/`FIELD_REGISTRY`) по `field-mapping.md`, порядок блоков документ → участники → транспорт → продукция → сопроводительные → прежняя ВСЭ → результаты → стоимость (FT-ARR-03); явные marks требуются только для сравниваемых полей с присутствующим source («информационное отсутствие» не требует фиктивной отметки); фиктивные marks на readonly/отсутствующих полях — blocking.
  - граница веса ±5% включительно (FT-ARR-07): отклонение = (доставленный − документальный)/документальный × 100; 95/105 от 100 кг — act=false, 94.999/105.001 — act=true; нулевой/невалидный документальный вес деление не допускает (проверка источника), недостача никогда не создаёт возвратный груз.
  - строгая матрица (FT-02): недопустимые основания (участники F05–08, вид транспорта F09, хранение F12, классификация F15–17/19, дата выработки F22) запрещают ACCEPT_ALL/PARTIAL, оставляя RETURN_ALL (внешний контракт сужается через `ReceiptCapabilities.external_return_allowed`); допустимые (ТС/прицеп F10/11, название F18, количество F20, вес F21 сверх ±5%, срок F23, транспортный документ F25–27) требуют факта (CHK-F42) и причины (CHK-F43) и дают элементы акта; «неблагоприятное состояние отделения/совместная перевозка» само ничего не блокирует.
  - количественные факты (FT-ARR-06/DATA-02): ACCEPT_ALL accepted=delivered, returned=0; PARTIAL требует обе положительные части и сохранение в каждой применимой единице (никакого равного деления туш), conservation проверяется по весу и количеству; RETURN_ALL accepted=0, returned=delivered; сравнение только одинаковых unit ID; отрицательные величины запрещены; неприбытие/нулевая доставка не допускают ни одного решения (гашение/возврат отсутствующего груза невозможны) и прежнее недопустимое решение блокируется сообщением «выберите заново».
  - причина возврата (CHK-F35): справочник Меркурия (`RETURN_REASON_CODES`, ФТ-10 дословно), OTHER_REASON требует текста (blocking → 422); акт (CHK-F44) derived — RETURN_ALL никогда не обещает акт ветки; акт доступен только ACCEPT_ALL/PARTIAL без отдельного решения «с актом».
  - повторная ВСЭ (CHK-F36–38): блок только при сведениях прежней ВСЭ; required → обязательны основание и № акта; без previous local повторная запрещена (без фиктивного выбора); transaction «Нет» очищает тип; fair=false по умолчанию; маршрут: RETURN_ALL → NONE, повторная не требуется при previous → CONCLUSION, иначе EXAMINATION.
  - `normalize_payload`: серверная нормализация перед записью (повторная без необходимости не хранит основание/акт, тип транзакции при «Нет» не сохраняется).
- `reconciliation.py` — `save_reconciliation(ctx, party_id, payload)`: lock партии и строки сверки (`with_for_update`), If-Match — ревизия партии при первом создании, ревизия сверки далее (API-04), IdempotencyRecorder (SPEC-04), replay по ключу, blocking валидации → 422 VALIDATION_ERROR, подтверждённая/возвращённая сверка не перезаписывается (409 STATE_CONFLICT, FT-ARR-15), CHK-F33 авторство сохраняется, state OPEN; CONFIRMED/RETURNED ставит только внешнее подтверждение (ТЗ-11). Входы без колонок DATA-02 (F13/14/35) хранятся в `checks` JSONB под своими CHK ID; `build_reconciliation_view` пересчитывает allowed_decisions/act/route/errors при каждом чтении (смена фактов сбрасывает недопустимое прежнее решение).
- `schemas.py` — API-04 DTO (`Comparison`, `QuantitySet`, `ReconciliationWrite`, `ReconciliationView` с derived ServerView-полями, extra=forbid); `router.py` — GET/PUT `/api/v1/arrivals/:party_id/reconciliation` (ETag пустого представления несёт ревизию партии; If-Match + Idempotency-Key; чужой UUID → 404), права `arrivals:read`/`arrivals:write` (см. diff).

## Тесты (`backend/tests/arrivals/test_reconciliation.py`, 26 тестов; весь пакет arrivals 40 passed)

Все поименованные из брифа: `test_at_02_weight_boundary` (параметризовано 100→95/105 act=false; 94.999/105.001 act=true), `test_at_01_shortage_is_not_return_cargo` (doc 120/доставлено 100/принято 100/возврат 0 корректен), `test_at_04_partial_conservation` (120→100+20), `test_partial_violates_conservation_is_blocked`, `test_doc_mass_zero_no_division`, `test_at_03_foreign_receiver_blocks_acceptance` (другой получатель + допустимый вес → только RETURN_ALL), `test_unfavorable_compartment_does_not_block`, `test_missing_mark_names_chk_id`, `test_other_return_reason_without_text_is_422` (API, 422), плюс: причина возврата для PARTIAL/RETURN_ALL, неизвестный код, repeat без previous/reason/act, транзакция, нулевая доставка, unit mismatch, отрицательные, фиктивные marks, расхождение количества, API-тесты ETag-последовательности (party → reconciliation), незавершённого сохранения (state OPEN, неполный payload сохраняется), недопустимого решения (409/422) и замороженного состояния. TDD: первый полный прогон новых тестов зафиксировал RED-этап внутри разработки; отдельного pristine RED-транскрипта нет (см. отчёт).

## Гейты backend (финальное закоммиченное дерево, `bc33fad`)

- `ruff check backend` — All checks passed; `ruff format --check` — 78 files already formatted (format не переписывал файлы, порча `except (A, B)` не воспроизводилась); `compileall` — 0 ошибок; `import backend.src.interfaces.main` — OK.
- `mypy backend/src` — **Success: no issues found in 52 source files**.
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` — **241 passed, coverage 94.16%** (arrivals: commands 93%, models 100%, queries 89%, reconciliation 96%, router 91%, schemas 98%, **validation 92%**).

## Frontend

- `features/arrivals/api.ts` — fetch/save reconciliation, `comparedFields` (проекция сравниваемых полей с блоками), `revisionEtag`, справочники решений/причин; `schema.d.ts` перегенерирован (`openapi-typescript` из документа `app.openapi()` текущего backend; идентичный вывод `npm run gen:api` — одноразовый локальный helper в `tmp/` не коммитился).
- `ComparisonField.tsx` — исходное значение + явная отметка «Совпадает/Не совпадает» (радио), факт/причина раскрываются при несоответствии; клавиатура, подписи по CHK ID.
- `ReceiptDecision.tsx` — три решения в фиксированном порядке, недопустимые disabled с пояснением «Недоступно при отмеченных расхождениях», причина возврата (код + текст для OTHER_REASON), транзакция (Нет очищает тип), ярмарка; отдельного решения «с актом» нет. Аксессибл-имя радио — только название решения (примечание вынесено из label, `aria-describedby`).
- `ActPreview.tsx` — derived плашка: «Будет сформирован акт несоответствия» со списком (поле/исходное/факт/причина); для RETURN_ALL — «акт несоответствия этой ветки не формируется» (решение убирает обещание акта, но не местные факты расхождений); серверные ошибки с CHK ID.
- `ReconciliationForm.tsx` — экран в порядке блоков FT-ARR-03; RHF + zod (числа-десятичные, неотрицательные); `useCommand` с refresh при конфликте (никакого слияния) и сохранением ввода при сетевой ошибке; `useDirtyGuard` не теряет форму при навигации; незавершённая сверка сохраняется отдельно (O-09); завершение — внешняя приёмка (ТЗ-11), о чём честно написано.
- `pages/ReconciliationPage.tsx` — загрузка партии и (возможно ещё не созданной) сверки, маршрутизация по реальному party_id, состояние «уже подтверждена» без редактирования; маршрут подключён в `app/router.tsx` вместо заглушки A02.
- Stories `reconciliation.stories.tsx` (A02/Сверка эВСД): сравнение, решение доступное/запрещённое, акт/акт без возврата, форма начатая/заполненная/узкий экран 390.

## Гейты frontend (финальное закоммиченное дерево, `bf9fd48`)

- `lint` — ok; `format:check` — All matched files use Prettier; `typecheck` — ok; `test` — **109 passed (25 files)**, включая 12 новых тестов A02: отметка раскрывает факт/причину, порядок решений и disabled с пояснением, OTHER_REASON текст, «Нет» очищает тип, плашка акта, «RETURN_ALL не обещает акт», ошибки с CHK ID, порядок блоков, dirty-защита навигации, ввод не теряется при сетевой ошибке, disabled решения из серверной проекции.
- `build` — ok; `build-storybook` — exit 0 (в index.json сборки присутствуют все 9 story A02).
- Браузерная проверка (Playwright против dev Storybook 6006, `tests/e2e/reconciliation-storybook.spec.ts`, 2 passed): порядок блоков ровно FT-ARR-03 на 1440; на 390 форма сохраняет использование без горизонтального скролла; скриншоты `frontend/test-results/a02-form-1440.png` и `a02-form-390.png`.

## AT-01–04/06 (часть A02)

- AT-01 — автоматизирован (`test_at_01_shortage_is_not_return_cargo`): 120 документально/100 доставлено/100 принято → акт по весу, возврата 20 нет; часть «ВСЭ на 100» — W01/A03 (external intent/confirmation).
- AT-02 — автоматизирован (`test_at_02_weight_boundary`, параметризовано; также SC-024/025).
- AT-03 — автоматизирован (`test_at_03_foreign_receiver_blocks_acceptance`).
- AT-04 — часть A02 автоматизирована (`test_at_04_partial_conservation`, conservation и положительные части; карточка/цена только на принятое — W01/C01).
- AT-06 — частично относится к A02: клеймо без previous скрыто (`source_projection` не выставляет `previousStamp`, тест фиктивных marks; полный маршрут клейма — D01).

## Не выполнено / вне задачи A02

- Внешнее гашение/подтверждение (202 operation, frozen intent, evidence) — W01/W02/W03; `save_reconciliation` умышленно не двигает состояние из OPEN.
- Услуги (`services:[{code,performed}]`) принимаются и сохраняются, но их расчёт — C01/pricing.
- Реальный live-API e2e — требует постоянного стека F03/C02; сверка проверена MSW-тестами и Playwright против Storybook (разрешено контроллером).
- Примечание: локальный статический сервер `serve` на собранном `storybook-static` редиректит `iframe.html` → `/iframe` (потеря query), поэтому билд проверен на наличие story в `index.json`, а рендер — на dev Storybook 6006 (та же схема, что в shell.spec F02).
