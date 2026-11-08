# R03 — Список, preview и экспорт отчётности (ТЗ-08)

Task: `feat: connect report generation and immutable exports` (branch `feature/R03-list`, from main `538e8d0`).
Spec sources: API-08, SC-076–088, AT-16–20/22, SPEC-06.

## Delivered

### Backend (contract fixes required by API-08 — the brief's list/export routes did not exist)

- `backend/src/modules/reporting/schemas.py` — `ReportSummary` (без payload) и `ReportSummaryPage`
  (`items/total/page/page_size`, форма как у остальных Page-view).
- `backend/src/modules/reporting/commands.py` — `list_reports(db, laboratory_id, page)`: пагинация
  сохранённых снимков по `year desc, half desc, saved_at desc`, payload из списка не выгружается.
- `backend/src/modules/reporting/projection.py` — проекция сохранённого payload →
  `ReportDocumentView` (D02): печатные колонки с объединением CHICKEN+OTHER_BIRDS в одну колонку
  «Птица — куры/другие» (решение проекции по заметке R01 п.1), две неавтоматические строки
  (manifest `noncalculated_cells`) печатаются «Не рассчитывается», версии и `official` берутся из
  payload; `report_pdf_filename`/`report_xlsx_filename` = `5-вет_раздел-III_<лаборатория>_<год>_<полугодие>`
  с очисткой опасных символов (API-08).
- `backend/src/modules/reporting/router.py` —
  `GET /api/v1/reports/5vet?laboratory_id&page` (authz `report:5vet-list`, только HEAD/ANALYST),
  `GET /api/v1/reports/5vet/{id}/export.pdf` и `/export.xlsx` (authz `report:5vet-export`,
  hide_foreign → чужой отчёт не существует, `no-store` + `attachment` + `filename*=UTF-8''`).
  Файлы строятся **только** из снимка (`load_report` + projection), никакая живая ВСЭ не читается.

### Frontend

- `frontend/src/features/reports/api.ts` — типы + транспорт: operational/preview/save/read/delete
  через openapi-fetch (`schema.d.ts`), список и файлы — честно документированный plain fetch
  (маршруты list/export ещё не в сгенерированной схеме; D02-прецедент, вызовы изолированы в модуле).
  Blob экспорта создаётся только после проверки Problem; повтор экспорта — тот же GET.
- `frontend/src/features/reports/matrix.ts` — projection-хелперы: слияние птичьих колонок, значения
  ровно из payload, «Не рассчитывается»/«—», версии; клиент никогда не пересчитывает снимок.
- `ReportParameters` (тип «5-вет, раздел III», год/полугодие, предупреждение stale),
  `ReportCodes` (7 текстовых кодов, ведущие нули сохраняются, trim nonblank),
  `ReportMatrix` (read-only таблица + «Предварительная форма» при `official=false`),
  `ReportActions` (PDF/XLSX/печать из снимка + delete-диалог: период/лаборатория, без
  восстановления, коррекция списка после удаления).
- Страницы: `ReportsPage` (список, ссылки и создание; меню не открывает row, ссылки — обычные
  `<a>`, keyboard-accessible; VET/ADMIN — честный forbidden), `ReportCreatePage`
  (params → signed preview → codes → save; смена параметров очищает preview и коды с
  предупреждением; сетевой отказ сохраняет и параметры, и коды; успешный save навигирует на карточку),
  `ReportViewPage` (summary + форма; «удалён в другом месте» → not-found), `OperationalReportPage`
  (период из URL, три показателя, текущие остатки проб — независимо от периода, SC-076–079).
- Маршруты подключены в `app/router.tsx` (заглушки R03 заменены; `/reports/samples` объявлен
  до `/reports/:reportId`).
- Stories: `reports.stories.tsx` — матрица (обычная, длинные данные, 390px), параметры со
  stale-предупреждением, коды с ошибками.

## TDD evidence

- RED: `npm.cmd run test -- src/pages/ReportCreatePage.test.tsx …` и `npx playwright test reports.spec.ts`
  до реализации → коллекционные ошибки `Cannot find module …/features/reports/api` (тесты написаны
  первыми). Backend: `test_list_export.py` написан против несуществующих маршрутов/функций
  (`AttributeError`/404 на прогоне до реализации).
- GREEN: frontend unit — **18 новых тестов** (matrix ×4, ReportsPage ×3, ReportCreatePage ×5,
  ReportViewPage ×3, OperationalReportPage ×3); e2e `reports.spec.ts` — **9 passed**; e2e
  `reports-visual.spec.ts` — 2 passed (1440/1024/768/390 + print-media); полный e2e прогон — 38 passed.
- Backend: `backend/tests/reporting/test_list_export.py` — **7 passed** (проекция с слиянием птиц и
  «Не рассчитывается»; безопасные имена файлов; реальные PDF/XLSX из снимка: текстовый ОКУД и
  числовые ячейки; пагинация списка без payload; HTTP: список HEAD 200, ADMIN 403/404, экспорт
  no-store+attachment+A4-PDF и XLSX, 404 неизвестного и 404 чужого, удалённый → 404).

## Gates

- Backend: `ruff check backend` — All checks passed; `ruff format --check backend` — 138 files
  formatted; `mypy backend/src` — Success (87 files); `pytest backend/tests -q` — **419 passed**;
  compileall ok; новые файлы — без BOM, строгий UTF-8.
- Frontend: `lint` 0; `format:check` 0; `typecheck` 0; `test` — 42 files / **173 passed**; `build` 0;
  `build-storybook` 0; `playwright test` — **38 passed** (включая 11 новых).

## Реальный walkthrough (честно)

- Реальные файлы из проекции снимка (`tmp/r03_make_documents.py`, tmp/ вне Git):
  `tmp/r03-report.pdf` (1 страница A4 595.3×841.9 pt, «ФОРМА 5-ВЕТ, РАЗДЕЛ III», «Предварительная
  форма», коды, «Не рассчитывается», куры/другие) и `tmp/r03-report.xlsx` (ОКУД «001» — текстовая
  ячейка type=s, 240 КРС 0.3 — числовая type=n, имя файла по API-08).
- Скриншоты интерфейса (коммитятся в `docs/implementation/evidence/`): список, создание с
  предупреждением и после сетевого отказа, сохранённая карточка, not-found, операционный экран,
  матрица на 1440/1024/768/390 и print-media — сняты Playwright-прогонами.
- OPS03 допроверка (R03-сторона, dev-стенка): payload 100 000 источников ≈ 5.34 МиБ, проекция
  <1 мс, PDF-рендер ≈60 мс, XLSX ≈5 мс. Нагрузочное доказательство целевого стенда остаётся за O03.

## Сопоставление

- SC-076–079 — OperationalReportPage (период, показатели по завершённым услугам, текущие остатки
  без влияния фильтра). SC-080–088 — создание/просмотр/экспорт 5-вет (только завершённое
  полугодие, ошибки preview с русскими заголовками, ручные коды, read-only матрица без пересчёта).
- AT-18/AT-19 — экспорт из снимка и диалог удаления; удаление снимка не трогает источники
  (бэкенд-тесты), конкурентность закреплена R02. AT-20 — роли: VET/ADMIN получают forbidden в UI и
  403/404 от API (бэкенд-тесты ADMIN). AT-22 — 422 `REPORT_MAPPING_INVALID` без частичной матрицы
  (R01) честно показывается как полный отказ расчёта.
- FT-DOC-05/A4/печать — кнопка «Печать» открывает те же PDF-байты снимка (e2e проверяет вызов и
  pop-up), формат A4 закреплён рендер-тестами D02 и прогоном `tmp/r03_make_documents.py`.

## Notes / concerns

1. Маршруты списка и экспорта добавлены на бэкенде, потому что API-08 требовал их, а ни один
   маршрутизатор их не предоставлял (в задании «подключить D02 report export router» не имел
   физического объекта). Это единственное изменение бэкенда; без него список и экспорт
   невозможно реализовать честно. `schema.d.ts` не перегенерирован (нужен живой бэкенд): список и
   файлы идут plain fetch с изоляцией в модуле — так же, как D02.
2. Печатная проекция объединяет CHICKEN+OTHER_BIRDS в «Птица — куры/другие» — решение R01
   п.1 («печатная форма перечисляет 7 колонок»); data layer остаётся 8-колоночным.
3. `official=false` и «Предварительная форма» — как в D02; экранный предпросмотр показывает ту же
   маркировку из payload, а не живое состояние.
4. Файлы XLSX/PDF walkthrough-прогонов лежат в `tmp/` и в Git не попадают; скриншоты закоммичены.
5. Реальный серверный walkthrough (запуск compose + браузер против живого API) в этой сессии не
   выполнялся — Docker-стенд не поднимался; компенсировано HTTP-тестами против ASGI-приложения
   и реальным рендером (тот же код маршрута). Для приёмки W03 это честно задокументировано.
