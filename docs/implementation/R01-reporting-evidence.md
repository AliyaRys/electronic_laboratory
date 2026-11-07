# R01 — Расчёт и операционные показатели (ТЗ-08)

Task: `feat: calculate scoped operational and 5-vet contributions` (branch `feature/R01-reporting`, from main `633e379`).
Spec sources: ФТ 09 (таблица строк 166–172/240–242), API-08, DATA-04/05, INPUT-04/05, AT-14–17/22, SPEC-06.

## Delivered

- `backend/src/modules/reporting/schemas.py` — `ReportSource{id, revision, first_completed_at, classification, accepted_mass_kg, performed_indicator_ids, sent_to_lab, outcome, direction, fair, internal}`, `SpeciesClassification`/`ClassificationMap` (INPUT-05), `ReportMatrix` (только автоматические строки 166–172/240–242, 8 колонок каталога, точные `Decimal`, 240–242 в тоннах после единственного финального преобразования), `OperationalView`/`ReportPeriod` (API-08).
- `backend/src/modules/reporting/calculator.py` — чистый без IO `calculate_5vet(sources, mapping) -> ReportMatrix` по точной таблице ФТ 09; `build_classification_map` отвергает неоднозначную карту (две записи одного вида) до существования матрицы; неизвестный/неподдержанный вид → `422 REPORT_MAPPING_INVALID` на весь расчёт, частичной матрицы не бывает (AT-22); дедупликация по id (новейшая ревизия) — корректировка завершённой карточки считается один раз; `period_bounds`/`sources_for_period` — полуоткрытые границы `[01.01; 01.07)`/`[01.07; 01.01)` в Europe/Moscow, ровно 01.07 00:00 → II полугодие (AT-17); внутренний guard 240 = 241 + 242.
- `backend/src/modules/catalog_pricing/mandatory.py` — добавлены идентификаторы VSE-F22..F29 (люминесцентный анализ, бактериоскопия, микроскопия, pH, проба варки, медь, пероксидаза, дозиметрия) той же детерминированной деривацией `uuid5(MANDATORY_NAMESPACE, "elab-vse://field/VSE-Fxx")`, что уже используется для VSE-F18..21; значения совпадают с константами `examinations/validation.py` (один namespace, один URL).
- `backend/src/modules/reporting/queries.py` — `operational_query(db, laboratory_id, from, to) -> OperationalView`: счёт по завершённым фактам сверки (`CONFIRMED/RETURNED`, `completed_at ∈ [from; to)`), внутренняя транзакция исключается только из «обработанных партий», каждая выполненная услуга — ровно одна единица показателя независимо от тарифного множителя, полный возврат без услуги не добавляет её показатель, OPEN-сверка не считается, остатки проб — текущие живые суммы (`balance_list`), не зависящие от периода истории; `list_report_sources(...)` — проекция завершённых локальных ВСЭ полугодия (вид из снимка партии, вес из неизменяемого подтверждения приёмки, выполненные показатели из снимка исследований).
- `backend/tests/reporting/{__init__,test_calculator,test_operational}.py` — 48 тестов (36 чистых, 12 на реальном PostgreSQL testcontainers).

## TDD evidence

- RED: `uv run --frozen pytest backend/tests/reporting/test_calculator.py backend/tests/reporting/test_operational.py -v` → `ModuleNotFoundError: No module named 'backend.src.modules.reporting.calculator'` (pristine collection error; тесты написаны до реализации).
- GREEN: 48 passed:
  - одна ВСЭ → 166=1, прочие строки 0; bact+micro → 167=2; trich → 168=1; pH+пероксидаза+медь → 169=3; дозиметрия с двумя показаниями → 170=1 (не +2); варка+люминесценция+температура → 171=3; отправка после завершения → 172=1; органолептика/идентификация/болезни не добавляют; находка трихинеллёза не дублирует 168; приёмка ФТ-RPT-04 (166:1, 167:2, 169:2, 171:1) — точные тесты;
  - уничтожение 250 кг мяса → 240=0.25/241=0.25/242=0; DISPOSAL и утилизация проб 240 не добавляют; AT-16: 250 кг мясо + 50 кг субпродукты → 240=0.3/241=0.25/242=0.05 и 240=241+242; агрегирование Decimal до отображения (100.5+100.25 кг → 0.20075 т);
  - WAITING исключён, ярмарочные/внутренние включены; корректировка завершённой карточки — один вклад; неоднозначная/неподдержанная/отсутствующая классификация → fail-loud всего расчёта (AT-22);
  - внутренняя сверка с 2 услугами → processed 0 / product 1 / transport 1 (AT-14); границы периода по времени завершения факта; изоляция лаборатории; остатки проб — текущие независимо от периода истории; 01.07 00:00 → II полугодие (AT-17).

## Gates (против зафиксированного дерева 2b136da)

- `git status --porcelain` — пусто; `uv sync --frozen` ok; compileall 0; `import backend.src.interfaces.main` ok.
- `ruff check backend` — All checks passed; `ruff format --check backend` — 125 files formatted. После format проверены байты новых файлов: без BOM, кириллица — явный UTF-8 (strict-декодирование без ошибок); `except (A, B)`-кортежей в новых файлах нет.
- `mypy backend/src` — Success: no issues found in 79 source files.
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` → **395 passed, TOTAL 94.50%**.
- Reporting coverage: calculator 100%, schemas 100%, queries 98% (99% ≥ порога 90%).

## Сопоставление

- AT-14 (ярмарочная/внутренняя: 0 обработанных, реальные исследования и строки) — тесты `test_fair_party_is_counted`, `test_internal_with_two_services`, строки считаются при fair/internal (`test_fair_and_internal_parties_are_included`).
- AT-15 (услуга × количество: тариф множится в C01, отчёт даёт 1 факт и 167=2, не +8) — `test_service_fact_is_one_unit_regardless_of_multiplier`, дедупликация строк по id показателей.
- AT-16 — `test_at_16_meat_and_offal_destruction` + запрет утилизационных направлений и утилизации проб.
- AT-17 — параметризованные границы + интегральная проверка `list_report_sources` ровно на 01.07.
- AT-22 — три fail-loud теста карты, частичная матрица невозможна.
- R-04/SC-065–066 (корректировка не сдвигает первое завершение) — дедупликация по id с выбором новейшей ревизии; неизменяемость `first_completed_at` обеспечена E02.

## Notes / concerns

1. Печатная форма ФТ 09 перечисляет 7 колонок («птица — куры/другие»), DATA-04 — 8 значений `animal_column` (CHICKEN и OTHER_BIRDS отдельно). Калькулятор считает в 8 колонках каталога (контракт карты, «колонки строго mapping»); объединение «птицы» при печати — решение проекции R02/R03 (`ReportDocumentView.columns`).
2. RETURNED (полный возврат) считается «обработанной партией» — «подтверждённо завершённая сверка»; оговорка ФТ о полном возврате относится к показателю услуги. Зафиксировано тестом; при решении владельца меняется одна строка фильтра.
3. `ROW_NAMES` — рабочие русские названия строк по таблице ФТ 09; официальный образец не утверждён (INPUT-04), переименование не влияет на арифметику.
4. Одна непокрытая ветка `queries.py` (снимок классификации без продукта) — 98% покрытия модуля.
