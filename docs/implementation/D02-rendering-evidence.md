# D02 — Renderer и пользовательский вывод (ТЗ-07)

Task: `feat: render controlled Russian PDF and spreadsheet documents` (branch `feature/D02-renderer`, from main `370abee`).
Spec sources: API-07/08, INPUT-04, FT-DOC-05, SPEC-05/06, SC-050–064, AT-06/13.

## Delivered

### Backend

- `backend/src/modules/documents/resources.py` — контролируемый резолвер ресурсов (INPUT-04):
  `load_manifest(form_id)` читает `backend/resources/forms/manifest.json` и проверяет SHA-256 шаблона;
  `read_template` повторно проверяет существование и хеш; `font_file` резолвит шрифт строго внутри
  `backend/resources/fonts/` с проверкой хеша. `resolve_within` отвергает URL-схемы (http:, file:),
  абсолютные пути, диски, `..`, пустые сегменты — внешний ресурс недостижим. Всё нарушение →
  `RendererUnavailable` (503 `RENDERER_UNAVAILABLE`), файл не формируется.
  `FormManifest{form_id,version,date,template_sha256,official,required_fields,paper,margins_mm,repeat_headers,noncalculated_cells,ton_precision,fonts[{resource,sha256,license}]}` — по INPUT-04.
- `backend/src/modules/documents/pdf.py` — `render_pdf(model: DocumentView, form: FormManifest) -> bytes`:
  HTML-шаблоны из `backend/resources/forms/`, все значения экранируются (`html.escape`) до подстановки;
  шрифт подключается через `@font-face` с обратным вызовом, который резолвит только имена внутри
  `resources/fonts/` и отвергает любой внешний URI (SPEC-05, formula/external injection);
  ошибка движка/ресурса → 503; результат проверяется на `%PDF-` и формат страницы A4 (595×842 pt).
  `official=false` → метка «Предварительная форма» в выводе. `pdf_filename` — безопасное имя
  Content-Disposition (без path/control/device-символов), отправляется как `filename*=UTF-8''`.
  Обе ветки union: `ConclusionView` (LOCAL/PREVIOUS — разные шаблоны) и `ReportDocumentView` (5-вет,
  шапка матрицы повторяется на каждой странице через `<thead>`).
- `backend/src/modules/documents/xlsx.py` — `render_xlsx(model: ReportDocumentView, form) -> bytes`:
  коды шапки («001», …) пишутся как **текстовые** ячейки (`data_type='s'`, inlineStr, не coerced);
  числовые значения остаются числами с точностью `ton_precision` (6 знаков до официальной точности);
  текст, начинающийся с `=`, сохраняется как inline-строка — в XML нет `<f>`, формулы не создаются;
  неавтоматические ячейки → «Не рассчитывается» (INPUT-04); отсутствующее значение → «—».
  `xlsx_filename` = `5-вет_раздел-III_<лаборатория>_<год>_<полугодие>` с очисткой опасных символов (API-08).
- `backend/src/modules/documents/schemas.py` — `ReportDocumentView{form_id,laboratory,year,half,period,codes,columns,matrix,versions,ton_precision,official,warnings}` (API-08 projection; строится только из сохранённого snapshot, без запросов текущих ВСЭ) + `DocumentView = ConclusionView | ReportDocumentView` (union, различается по `form_id`: каждый `form_id` принадлежит ровно одному виду).
- `backend/src/modules/documents/router.py` — `GET /arrivals/{party_id}/conclusion.pdf`: тот же
  `build_conclusion` (авторизация повторно по живым таблицам на каждый вызов — доступ нельзя обойти),
  затем manifest + рендер; `Cache-Control: no-store`; только чтение — запись «Выдано» не создаётся
  (её в системе нет вообще); недоступный шаблон/движок → 503 Problem без файла; 422 неполного основания
  возвращается как `application/problem+json`.
- Ресурсы: `backend/resources/forms/{manifest.json,conclusion-local.html,conclusion-previous.html,report-5vet.html}`
  (три отдельных манифеста/шаблона, A4, поля, repeat_headers у 5-вет, noncalculated_cells, ton_precision=6,
  `official=false` — официального образца нет, «Предварительная форма»), `backend/resources/fonts/DejaVuSans.ttf`
  с лицензионным текстом `LICENSE-DejaVuSans.txt` (DejaVu: Bitstream Vera + public domain) и README.

### Frontend

- `frontend/src/features/documents/api.ts` — типы + `fetchConclusion` (preview) и
  `fetchConclusionPdf`: проверка Problem **до** создания Blob/скачивания/печати; печать открывает те же
  байты; retry повторяет тот же GET по тому же `party_id` — ВСЭ измениться не может; запись «Выдано» не пишется.
- `frontend/src/features/documents/ConclusionPreview.tsx` — рендерит **ту же** модель (`fields`,
  порядок пробелов INPUT-04), честная метка «Предварительная форма» при `official=false`, подпись —
  пустое место, длинные данные переносятся (`overflow-wrap: anywhere`, `table-layout: fixed`).
- `frontend/src/features/documents/DocumentActions.tsx` — «Скачать PDF» / «Печать» из одних и тех же
  байтов; состояние ошибки с кодом и русским detail; никаких записей при открытии/отмене печати.
- `documents.css`, `documents.stories.tsx` (обычное, длинные данные, действия), unit-тесты,
  `frontend/tests/e2e/documents.spec.ts` (1440/390, скриншоты).

## TDD evidence

- RED: `uv run --frozen pytest backend/tests/documents/test_rendering.py` →
  `ModuleNotFoundError: No module named 'backend.src.modules.documents.pdf'` (pristine collection error).
- GREEN: 19 именованных тестов в `test_rendering.py`:
  - PDF nonempty/A4/кириллица/принятая масса; экранирование text; длинные owner/product без обрезки
    (полный текст присутствует в извлечённом слое, `_squeezed`-сравнение); шапка матрицы повторяется на
    второй странице; PREVIOUS-шаблон выбирается по form_id;
  - rejected renderer: неизвестная форма → 503 `RENDERER_UNAVAILABLE`; отсутствующий шаблон → 503;
    подменённый хеш шаблона → 503; подменённый хеш шрифта → 503;
  - резолвер: внешние URL, `C:/…`, `../…`, `/etc/passwd`, `file:` — все отвергнуты; легальное имя внутри fonts — ok;
  - XLSX: код «001» — текст; числа числовые с 6-значным квантованием; `=…` — inline-строка, `<f>` в XML
    отсутствует; «Не рассчитывается» для неавтоматических; безопасное имя файла; 200 строк;
  - HTTP: 200 + no-store + attachment + application/pdf; 404 чужой/неизвестный; ADMIN запрещён;
    503 при сломанном рендере — `application/problem+json`, `%PDF` отсутствует; 422 неполного основания — problem+json.

## Gates (против зафиксированного дерева)

- `uv sync --frozen` ok; `ruff check backend` — All checks passed; `ruff format --check backend` — 118 files formatted.
- Проверка байт после format: без BOM, кириллица — явный UTF-8, compileall ok, `import backend.src.interfaces.main` ok.
- `mypy backend/src` — Success (75 files); для xhtml2pdf добавлен точечный override (`ignore_missing_imports`),
  для openpyxl/reportlab — типизированные dev-пакеты `types-openpyxl`, `types-reportlab`.
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` → **347 passed, coverage 94.32%** (final run
  against the committed tree); documents: pdf 80%, resources 88%, xlsx/schemas/router 100%, service 97%.
- Frontend: `lint` 0, `format:check` 0, `typecheck` 0, `test` 154 passed (включая новые ConclusionPreview ×3 и
  DocumentActions ×3), `build` 0, `build-storybook` 0.
- e2e `tests/e2e/documents.spec.ts` — 3 passed (Playwright, dev server + Storybook).

## Визуальная проверка (честно)

- Реально сформированные файлы: `tmp/d02-local.pdf`, `tmp/d02-previous.pdf`, `tmp/d02-long.pdf`,
  `tmp/d02-report-5vet.pdf`, `tmp/d02-report-5vet.xlsx` (через `tmp/make_documents.py`, tmp/ вне Git).
- Скриншоты интерфейса (коммитятся в `docs/implementation/evidence/`): `d02-preview-1440.png`,
  `d02-preview-long-1440.png`, `d02-preview-390.png` — сняты Playwright-тестом e2e.
- Страницы PDF конвертированы в PNG (`pdftoppm`, tmp/): `d02-local-page-1.png`, `d02-previous-page-1.png`,
  `d02-report-page-1.png`.
- **Ограничение:** в этом сеансе нет возможности просматривать изображения, поэтому пиксельное
  сравнение «два основания и длинные данные» глазами не выполнялось. Вместо него текстовый слой
  каждой страницы проверен программно (pypdf-извлечение): оба шаблона дают свой заголовок
  («местная ВСЭ» / «убойного пункта»), полные длинные реквизиты присутствуют без усечения, шапка
  5-вет повторяется на второй странице; формат страниц — A4; кириллические глифы встроены
  (DejaVuSans, glyph-предупреждения движка относятся только к `<title>`, который не рендерится).
  Владельцу формы стоит выполнить финальное визуальное сравнение с эталоном при официальной
  приёмке формы (INPUT-04: official=false, эквивалентность эталону не заявляется).

## Сопоставление

- SC-050–054/SC-060–064 — подтверждены D01-маршрутами; здесь закрыт пользовательский вывод:
  FT-DOC-05 (предпросмотр, скачивание PDF, печать, ошибки формирования) и печатная форма
  «Предварительная форма» до официального образца (INPUT-04, SC-050).
- AT-06/AT-13 — не изменены: PDF-маршрут переиспользует `build_conclusion`, поэтому 404/422/53
  поведения совпадают с preview (те же именованные тесты + три новых HTTP-теста).

## Notes / concerns

1. `official=false` и «Предварительная форма» — осознанное состояние до появления официального
   эталона; смена флага без эталона и визуального сравнения не допускается (INPUT-04).
2. Открытие PDF в новой вкладке для печати зависит от блокировщика pop-up; при блокировке выполняется
   fallback на скачивание тех же байтов (unit-тест покрывает проблему, не pop-up).
3. `fetchConclusionPdf`/`fetchConclusion` используют обычный fetch в модуле `features/documents/api.ts`,
   потому что маршруты документов ещё не в сгенерированной схеме (`gen:api` требует запущенный бэкенд);
   вызовы изолированы в этом модуле, страницы `fetch` не вызывают.
4. Тонна: 6 знаков после запятой до официальной точности (manifest `ton_precision: 6`).
5. Свежие ВСЭ в XLSX не участвуют: `ReportDocumentView` строится только из snapshot (R03 подтвердит
   проекцию матрицы; здесь renderer получает готовую проекцию).
