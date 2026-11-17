# Просмотр сохранённой ВСЭ и данные завершённых поступлений Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:systematic-debugging` to verify the documented root causes before proposing a fix, then use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Выполнение вести в отдельном worktree: для каждой задачи — свежий implementer-субагент, затем отдельный task-reviewer с двумя вердиктами (соответствие ТЗ и качество кода); после всех задач — независимый whole-branch review.

**Goal:** Привести страницу просмотра сохранённой карточки ВСЭ к композиции макета `vse-view.html` с актуальными полями системы и заполнить реальными данными столбцы «ВСЭ», «Стоимость», «Срок реализации», «Автор ВСЭ» во вкладке «Завершенные».

**Architecture:** Источником исторических данных остаются сохранённые снимки `Examination`, `Reconciliation` и исходный нормализованный XML партии. `IncomingView` получает компактную серверную сводку ВСЭ и вычисленную сервером общую стоимость, чтобы таблица не выполняла запрос на каждую строку и не складывала деньги в браузере. Страница просмотра переиспользует существующие React-секции формы, реестр исследований, сохранённые оценки и pricing snapshot; бизнес-правила создания/редактирования ВСЭ не меняются.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy/PostgreSQL, Decimal, React 19, TypeScript, React Router, TanStack Query, OpenAPI-generated types, Vitest/Testing Library/MSW, Storybook, Playwright, Docker Compose.

**Spec:** `Функциональные требования/v2.0/03-examination.md` (FT-VSE-01–11, особенно FT-VSE-10), `Функциональные требования/v2.0/06-pricing-and-directories.md`, `docs/TZ_development/plans/2026-11-06-06-examinations.md` (E04), `product-design-records/v1.9/02-product-design-records.md`, `product-design-records/v1.9/14-vse-product-and-participants.md`, `product-design-records/v1.9/15-party-level-vse-research.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, `vse-view.html`, `vse-view.css`, `arrivals-accepted.html`, а также настоящее ТЗ.

## Global Constraints

- Перед изменением интерфейса полностью прочитать `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, текущую реализацию и похожий экран.
- Макет `vse-view.html` задаёт композицию, размеры, визуальную иерархию и вид readonly-карточки, но его демонстрационные данные и прежняя модель результатов по отдельным тушам не переносятся.
- Актуальная модель: один результат каждого исследования на принятую партию; не создавать строки исследований по каждой туше/части.
- Не менять правила создания, WAITING/COMPLETED, позднего завершения, редактирования в день создания, удаления, авторизации или расчёта тарифов.
- Сохранённые `pricing_snapshot` сверки и ВСЭ неизменяемы; старые суммы не пересчитываются по текущим справочникам.
- Деньги складываются только на сервере через `Decimal`, без `float`, `parseFloat`, `Number` или клиентского `toFixed`.
- `0.00` — реальная сумма, а не отсутствие; отсутствующий или повреждённый компонент не подменяется нулём.
- Автор ВСЭ в интерфейсе — сохранённое `Examination.specialist_name`, то есть точное значение выбранного поля «Специалист Госветслужбы». Не подменять его `created_by`, текущим пользователем, логином или UUID. Для legacy-записи допустим только существующий серверный fallback из `specialist_id/created_by`.
- Срок реализации — исходный `vd:expiryDate` партии. Сохранить тип значения: одна дата, интервал или `informalDate`; не вычислять новый срок от даты ВСЭ.
- Одна дата отображается `до ДД.ММ.ГГГГ`, интервал — `с ДД.ММ.ГГГГ по ДД.ММ.ГГГГ`, `informalDate` — исходным текстом. Отсутствие — `—`. Часы из `ComplexDate` остаются частью source/audit согласно действующему DR20 и не превращаются браузером в часовой пояс.
- Общая стоимость завершённой партии = frozen total сверки + frozen total ВСЭ. Если хотя бы один обязательный snapshot отсутствует/повреждён или валюты различаются, итог отсутствует (`null`/`—`) и проблема диагностируется; нельзя считать отсутствующий компонент нулём.
- Общие компоненты расширять, а не копировать; иконки сначала добавлять в канонический реестр и Storybook, затем использовать в React adapter.
- Все маршруты, доступные имена, focus-visible, клавиатурное управление, русский язык и responsive 1440/1024/768/390 px сохраняются.
- Не выполнять реальные VetIS write-вызовы, гашение, удаление данных или очистку PostgreSQL volumes в рамках тестов.

## Review Focus

- Старые карточки без `specialist_name`: показывается разрешённый серверный fallback, но не UUID и не текущий пользователь; тест в Task 2.
- Один из двух pricing snapshots отсутствует или повреждён: общая стоимость остаётся `—`, а не частичной суммой; тест в Task 2.
- `expiryDate` задан единичной датой, интервалом, `informalDate` или отсутствует: все четыре формы отображаются без потери типа; тест в Task 4.
- Неизвестный historical `indicatorId`: страница просмотра не падает и честно показывает сохранённое значение с понятной резервной подписью; тест в Task 5.
- WAITING-карточка: новый дизайн не показывает несуществующий итог/заключение и сохраняет отдельное действие позднего завершения; тест в Task 6.

---

## 1. Результаты systematic-debugging

### 1.1. Страница просмотра ВСЭ

Текущий `frontend/src/pages/ExaminationViewPage.tsx` собран из legacy-блоков `.vse-exam-block` и списков `<dl>`, поэтому визуально не повторяет секционную композицию `vse-view.html` и уже обновлённую страницу создания.

Дополнительные причины:

- сведения о партии выводятся через старый `PartyReadonlyFacts`, хотя существуют `ExaminationFactsSection`, `ParticipantsSection`, `FormSection`, `ReadonlyField` и общие иконки;
- исследования подписываются как `Показатель <indicatorId>` вместо названий из канонического `INDICATORS`;
- значения исследований форматируются отдельной упрощённой логикой, отличной от формы;
- сохранённый pricing snapshot сводится к одному полю «Расчёт стоимости» и не показывает строки, тарифы, суммы, нормы и оценки;
- физическая проба показывается текстом «Отбор пробы этой партии», хотя дата и масса сохранены в `SampleCollection`;
- mockup содержит старые строки по каждой туше, но актуальные ФТ и PDR требуют один результат исследования на всю партию; копирование этих строк было бы регрессией бизнес-модели.

### 1.2. Вкладка «Завершенные»

В `frontend/src/features/arrivals/ArrivalTables.tsx` значения `vse`, `cost`, `deadline`, `vseAuthor`, `vseNumber` жёстко заданы как `—`. Это не ошибка XML-парсинга:

- `vd:expiryDate` уже нормализуется в typed `GoodsDate` и публикуется как `expiresOn`, `expiresOnFrom`, `expiresOnTo`, `expiresOnInformal`;
- итог, номер, frozen pricing и выбранный специалист уже хранятся в `Examination`;
- frozen pricing сверки уже присутствует в `IncomingView.reconciliation`;
- список получает только `examination_id`, но не получает compact examination summary, поэтому frontend не может честно заполнить остальные столбцы.

**Подтверждённая гипотеза:** дефект устраняется единым bulk read-model сводки ВСЭ на страницу поступлений и переиспользованием существующих typed formatters/components. Запрос `GET /examinations/:id` из каждой строки, клиентский денежный расчёт или повторный разбор raw XML являются симптоматическими и запрещены.

## 2. Целевой серверный контракт

Добавить к `IncomingView` необязательное поле `examination: ExaminationSummary | null`:

```text
ExaminationSummary
  id: str
  number: str
  status: WAITING | COMPLETED
  outcome: FIT | UNFIT | null
  specialist_name: str | null
  pricing: PricingSnapshot | null
  combined_total: DecimalString | null
  currency: str | null
```

Использовать именно DTO `ExaminationSummary` и поле `IncomingView.examination`; значения и их источники:

- `outcome` — `Examination.outcome`;
- `number` — `Examination.number`;
- `specialist_name` — сохранённое `Examination.specialist_name`, затем только существующий legacy fallback;
- `pricing` — строгая валидация frozen `Examination.pricing_snapshot` через `PricingSnapshot`;
- `combined_total` — серверная сумма `Reconciliation.pricing_snapshot.total + Examination.pricing_snapshot.total`;
- `currency` — только при совпадающей валюте обоих snapshots.

Сводки всей страницы загружать одним SQL/bulk-read по `party_id`. Уникальность `Examination.party_id` не должна создавать дубли строк. Тот же контракт возвращать в single-arrival view. Не добавлять отдельный frontend-запрос на каждого пользователя/ВСЭ и не вызывать VetIS/SOAP.

Для страницы просмотра добавить в `ExaminationView` обязательное поле `sample: ExaminationSampleView`:

```text
ExaminationSampleView
  id: str
  collected_on: YYYY-MM-DD
  mass_kg: DecimalString
  revision: int
```

Данные брать через `ExaminationSample -> SampleCollection`, а не поиском связанной пробы среди первых 20 элементов общего списка. Миграция БД не ожидается.

## 3. Целевая таблица «Завершенные»

| Столбец | Значение |
|---|---|
| ВСЭ | `FIT → Пригодно`, `UNFIT → Непригодно`; без направления и причины в этой компактной колонке |
| Стоимость | `examination.combined_total` через существующий `moneyLabel`, например `1230,00 ₽`; ноль показывается как `0,00 ₽` |
| Срок реализации | существующий `formatGoodsDate(view.external.fields, "expiresOn")` |
| Автор ВСЭ | точное сохранённое `examination.specialist_name` |
| Номер ВСЭ | `examination.number` в уже существующем optional-столбце |

У заголовка «Стоимость» справа добавить круглую иконку `?`. Текст подсказки строго: **«Стоимость сверки данных + стоимость ВСЭ»**.

Подсказка:

- открывается при hover и keyboard focus;
- остаётся доступной без мыши (`aria-describedby` или эквивалентная корректная связь);
- закрывается при уходе hover/focus и по Escape;
- не является только `title`-атрибутом;
- не сдвигает заголовки/строки и не обрезается table scroller;
- сама иконка имеет доступное имя «Что входит в стоимость».

Для поддержки составного заголовка расширить `DataTableColumn` обратно совместимым полем `headerNode?: ReactNode`, сохранив обязательный строковый `header` как доступное имя и тестовый контракт. Не превращать все заголовки в произвольную разметку без текстового источника.

Если иконки вопроса нет, сначала добавить её в `components/icons/VseIcon.js`, документацию/Storybook канонического реестра и `frontend/src/shared/ui/legacy-icons.ts`; не рисовать локальный SVG или символ в `ArrivalTables.tsx`.

## 4. Целевая страница просмотра ВСЭ

Маршрут остаётся `/labs/:labId/examinations/:examinationId`. Внешний вид выводится из `vse-view.html`, но данные и правила — из актуальной React-системы.

### 4.1. Заголовок

- eyebrow «Просмотр записи»;
- `h1` строится helper-функцией `examinationTitle(number: string): string`: после trim значение, начинающееся с `№`, даёт `ВСЭ ${number}`, иначе — `ВСЭ №${number}`;
- справа — существующие разрешённые действия исправления и удаления в компактном title-actions блоке;
- действие исправления использует общую иконку, доступное имя и те же same-day/role rules;
- удаление не исчезает из бизнес-сценария из-за отсутствия в mockup: оно остаётся доступно по действующим правилам и открывает существующий `DeleteDialog`.

### 4.2. Секции

1. **«Сведения об экспертизе»** — номер ВСЭ, дата/время создания в Europe/Moscow, UUID ВСД, дата оформления ВСД, статус карточки.
2. **«Участники и продукция»** — те же правильные поля и названия, что на странице создания: отправитель/получатель, предприятие/хозяйствующий субъект, четыре уровня классификации, принятый вес и количество, ветеринарное клеймо.
3. **«Исследования ВСЭ»** — только действительно сохранённые исследования; названия из `INDICATORS`, значения с типоспецифичным форматированием, применённая оценка/критерий из frozen pricing snapshot, болезни отдельными readonly-строками. Обязательные исследования сохраняют согласованный светло-синий тон; зелёный/красный относятся только к серверной оценке и всегда сопровождаются текстом.
4. **«Проба»** — дата отбора и масса связанной физической пробы; признак отправки в спецлабораторию показывается как сохранённый факт.
5. **«Итог экспертизы»** — результат (`Пригодно`/`Непригодно`), направление, причина при наличии, специалист Госветслужбы и дата первого завершения. Для WAITING итог/направление/причина не фабрикуются; отдельная форма позднего завершения сохраняется.
6. **«Расчёт стоимости услуг»** — строки сохранённого pricing snapshot: исследование, количество, единица, тариф, сумма, оценка; footer с frozen итогом. Никакого live preview и пересчёта на странице просмотра.

Страница просмотра должна использовать те же `FormSection`, `ReadonlyField`, icon map, research definitions и форматтеры, что создание/Storybook. Допустимо выделить `SavedResearchResults` и `SavedPricingTable`, если они одновременно используются страницей и stories. Нельзя копировать весь `ExaminationForm` или HTML mockup.

### 4.3. Состояния

- loading — стабильные секционные skeleton/status без ложных прочерков;
- network/not-found — действующие `StatusView` и breadcrumb;
- WAITING — жёлтый статус, нет итогового заключения, доступно позднее завершение по текущей роли;
- COMPLETED/FIT и COMPLETED/UNFIT — различимые текстом и тоном, не одним цветом;
- legacy unknown indicator — резервная подпись «Исследование» с техническим кодом в дополнительном тексте, сохранённое значение остаётся видимым;
- long number/FIO/product — перенос или безопасное сокращение с полным доступным текстом;
- 390 px — секции и поля в одну колонку, horizontal scroll допустим только внутри таблицы стоимости.

## 5. План реализации

### Task 1: Зафиксировать дефекты read-model тестами

**Files:**
- Create: `backend/tests/arrivals/test_examination_summary.py`
- Modify: `backend/tests/arrivals/test_dr5_views.py`
- Modify: `frontend/src/features/arrivals/ArrivalTables.test.tsx`

**Interfaces:**
- Consumes: текущие `IncomingView.reconciliation`, `Examination`, `formatGoodsDate`.
- Produces: тестовый контракт `IncomingView.examination` и точные значения таблицы для Tasks 2–4.

- [ ] **Step 1:** Добавить backend RED-тест завершённой партии: summary содержит `FIT`, номер, frozen `specialist_name`, pricing ВСЭ и `combined_total`, равный строковой decimal-сумме frozen сверки и ВСЭ.
- [ ] **Step 2:** Добавить RED-тесты `0.00 + 0.00 = 0.00`, отсутствующий/corrupt snapshot → `combined_total=null`, разные валюты → `null`, legacy `specialist_name=null` → существующий resolved fallback.
- [ ] **Step 3:** Запустить `uv run --frozen pytest backend/tests/arrivals/test_examination_summary.py -v`; ожидаемый результат — FAIL из-за отсутствия examination summary.
- [ ] **Step 4:** В `ArrivalTables.test.tsx` заменить ожидания жёстких прочерков RED-тестами точных значений «Пригодно», общей суммы, срока и специалиста.
- [ ] **Step 5:** Добавить fixtures единичной expiry date, интервала, informal и отсутствия; зафиксировать точные русские строки.
- [ ] **Step 6:** Запустить `npm.cmd --prefix frontend test -- ArrivalTables.test.tsx`; ожидаемый результат — FAIL на незаполненных колонках.
- [ ] **Step 7:** Commit: `test: cover examination data in completed arrivals`.

### Task 2: Добавить bulk examination summary и серверную сумму

**Files:**
- Modify: `backend/src/modules/arrivals/schemas.py`
- Modify: `backend/src/modules/arrivals/queries.py`
- Modify: `backend/src/modules/arrivals/router.py`
- Test: `backend/tests/arrivals/test_examination_summary.py`

**Interfaces:**
- Consumes: `ReconciliationSummary.pricing`, `Examination`, `User`, `PricingSnapshot`, `DecimalString`.
- Produces: `ExaminationSummary` и `examination_summaries(db, party_ids) -> dict[UUID, ExaminationSummary]`; `IncomingView.examination`.

- [ ] **Step 1:** Добавить строгую `ExaminationSummary` с полями раздела 2 и `examination: ExaminationSummary | None` в `IncomingView`.
- [ ] **Step 2:** Реализовать один bulk SQL-read для всех `party_ids` страницы; не добавлять запрос на строку и не дублировать `Party` при join.
- [ ] **Step 3:** Валидировать оба snapshots через `PricingSnapshot`; суммировать только совпадающие currency через `Decimal`, вернуть scale-2 строку. Ноль сохранять как данные.
- [ ] **Step 4:** Для имени предпочесть frozen `specialist_name`; legacy fallback выполнить на сервере bulk join, не в браузере.
- [ ] **Step 5:** Передавать bulk summaries из list router в `build_incoming_view`; single view загружает одну summary тем же helper.
- [ ] **Step 6:** Добавить query-count/transport spy: один page read не создаёт N запросов examinations/users и не вызывает VetIS.
- [ ] **Step 7:** Запустить `uv run --frozen pytest backend/tests/arrivals/test_examination_summary.py backend/tests/arrivals/test_dr5_views.py backend/tests/arrivals/test_reconciliation_list_metadata.py -v`; ожидаемый результат — PASS.
- [ ] **Step 8:** Commit: `feat: expose examination summary for completed arrivals`.

### Task 3: Расширить ExaminationView данными связанной пробы

**Files:**
- Modify: `backend/src/modules/examinations/schemas.py`
- Modify: `backend/src/modules/examinations/queries.py`
- Modify: `backend/tests/examinations/test_create.py`
- Modify: `backend/tests/examinations/test_lifecycle.py`

**Interfaces:**
- Consumes: `ExaminationSample`, `SampleCollection`.
- Produces: `ExaminationSampleView{id, collected_on, mass_kg, revision}` в обязательном `ExaminationView.sample`.

- [ ] **Step 1:** Написать RED-тест: `GET /examinations/:id` возвращает дату, массу и id именно связанной пробы, даже если она не находится на первой странице общего списка.
- [ ] **Step 2:** Добавить строгий nested DTO и получить sample одним join/select в `build_view`.
- [ ] **Step 3:** Не менять физический факт пробы, баланс, disposal и правила EDIT/NEW; это read-only расширение API.
- [ ] **Step 4:** Проверить legacy/current cards и удалённую карточку по существующим lifecycle tests.
- [ ] **Step 5:** Запустить адресные tests до PASS.
- [ ] **Step 6:** Commit: `feat: include linked sample in examination view`.

### Task 4: Заполнить таблицу «Завершенные» и добавить доступную подсказку

**Files:**
- Modify: `frontend/src/shared/ui/DataTable.tsx`
- Modify: `frontend/src/shared/ui/DataTable.test.tsx`
- Create: `frontend/src/shared/ui/HelpTooltip.tsx`
- Create: `frontend/src/shared/ui/HelpTooltip.test.tsx`
- Modify: `components/icons/VseIcon.js`
- Modify: `components/icons/README.md`
- Modify: соответствующий icon Storybook/adapter `frontend/src/shared/ui/legacy-icons.ts`
- Modify: `frontend/src/features/arrivals/ArrivalTables.tsx`
- Modify: `frontend/src/features/arrivals/ArrivalTables.test.tsx`
- Modify: `frontend/src/features/arrivals/arrivals.stories.tsx`

**Interfaces:**
- Consumes: generated `IncomingView.examination`, `formatGoodsDate(fields, "expiresOn")`, `moneyLabel`.
- Produces: backward-compatible `DataTableColumn.headerNode?: ReactNode`; `HelpTooltip{text: string, accessibleName: string}`; `examinationOutcomeLabel(value: "FIT" | "UNFIT" | null): string` в `frontend/src/features/examinations/api.ts`.

- [ ] **Step 1:** Регенерировать OpenAPI types штатной командой `npm.cmd --prefix frontend run gen:api`; generated-файл не править выборочно вручную.
- [ ] **Step 2:** Написать RED component tests `HelpTooltip`: hover, focus, Escape, `aria-describedby`, accessible name и отсутствие tooltip в закрытом состоянии.
- [ ] **Step 3:** Добавить `headerNode` в `DataTableColumn`, сохранив строковый `header`; существующие таблицы и tests должны работать без изменений.
- [ ] **Step 4:** Добавить question/help icon в канонический реестр, README, Storybook и adapter; не вставлять локальный SVG.
- [ ] **Step 5:** Реализовать `examinationOutcomeLabel(value)` с точным mapping `FIT → Пригодно`, `UNFIT → Непригодно`, `null → —`; заполнить `vse`, `cost`, `deadline`, `vseAuthor`, `vseNumber` по таблице раздела 3, не дублировать словарь в таблице.
- [ ] **Step 6:** Добавить к заголовку стоимости `HelpTooltip` с точным текстом «Стоимость сверки данных + стоимость ВСЭ».
- [ ] **Step 7:** Проверить FIT/UNFIT, zero, missing summary, single/range/informal/absent expiry, long specialist, optional columns и 390 px stories.
- [ ] **Step 8:** Запустить `npm.cmd --prefix frontend test -- DataTable.test.tsx HelpTooltip.test.tsx ArrivalTables.test.tsx` и `npm.cmd --prefix frontend run typecheck`; ожидаемый результат — PASS.
- [ ] **Step 9:** Commit: `feat: fill completed arrival examination columns`.

### Task 5: Собрать readonly-компоненты сохранённой карточки

**Files:**
- Create: `frontend/src/features/examinations/SavedResearchResults.tsx`
- Create: `frontend/src/features/examinations/SavedResearchResults.test.tsx`
- Create: `frontend/src/features/examinations/SavedPricingTable.tsx`
- Create: `frontend/src/features/examinations/SavedPricingTable.test.tsx`
- Modify: `frontend/src/features/examinations/ResearchFields.tsx` только если нужен общий formatter/renderer, без копирования business mapping
- Modify: `frontend/src/features/examinations/PricingPreview.tsx` для выделения общего snapshot-table renderer
- Modify: `frontend/src/features/examinations/examinations.css`
- Modify: `frontend/src/features/examinations/examination.stories.tsx`

**Interfaces:**
- Consumes: `INDICATORS`, saved `ExaminationView.researches`, findings, `PricingSnapshotView`, `evaluationLabel`, `normCriterion`, общие formatters.
- Produces: `SavedResearchResults{view}` и `SavedPricingTable{snapshot}`.

- [ ] **Step 1:** Написать RED-тесты отображения BOOLEAN/DECIMAL/ENUM/TEXT/DOSIMETRY, otherText, invasive/noncontagious findings, required tone и server evaluation text.
- [ ] **Step 2:** Добавить unknown-indicator тест: компонент не падает, показывает сохранённое значение и резервную подпись с кодом.
- [ ] **Step 3:** Реализовать lookup по `indicatorId` через `INDICATORS`; не показывать generic «Показатель UUID» для известных исследований и не строить результаты по отдельным тушам.
- [ ] **Step 4:** Выделить из `PricingSection` общий renderer таблицы snapshot, чтобы live preview и readonly view использовали одну разметку строк/денег/оценок; readonly компонент не делает запросов и не пересчитывает.
- [ ] **Step 5:** Добавить stories: completed fit, completed unfit, waiting, fair zero, long values, unknown legacy indicator, 390 px.
- [ ] **Step 6:** Запустить адресные tests и `npm.cmd --prefix frontend run build-storybook`; ожидаемый результат — PASS.
- [ ] **Step 7:** Commit: `feat: add readonly examination result components`.

### Task 6: Привести ExaminationViewPage к `vse-view`

**Files:**
- Modify: `frontend/src/pages/ExaminationViewPage.tsx`
- Modify: `frontend/src/pages/ExaminationViewPage.test.tsx`
- Modify: `frontend/src/features/examinations/ExaminationSections.tsx`
- Modify: `frontend/src/features/examinations/examinations.css`
- Modify: `frontend/src/features/examinations/examination.stories.tsx`

**Interfaces:**
- Consumes: `ExaminationFactsSection`, `ParticipantsSection`, `FormSection`, `ReadonlyField`, `SavedResearchResults`, `SavedPricingTable`, `ExaminationView.sample`.
- Produces: сохранённая карточка в секционной композиции раздела 4 без изменения command APIs.

- [ ] **Step 1:** Расширить page tests точными заголовками шести секций, реальным названием исследования, sample date/mass, итогом, специалистом и frozen pricing total.
- [ ] **Step 2:** Добавить WAITING regression: нет результата/направления/причины и заключения, но отдельное действие позднего завершения доступно по прежним правам.
- [ ] **Step 3:** Заменить legacy `.vse-exam-block` read-only layout на `FormSection`/grid композицию; заголовок оформить как «Просмотр записи» + `ВСЭ №…` + title actions.
- [ ] **Step 4:** Переиспользовать актуальные participant/product fields страницы создания; не возвращать поля «голова/органы», per-carcass rows или демонстрационные адреса из mockup.
- [ ] **Step 5:** Показать пробу из `view.sample`, сохранённый sent flag, outcome/direction/reason/specialist и first completion с принятыми московскими форматтерами.
- [ ] **Step 6:** Подключить `SavedResearchResults` и `SavedPricingTable`; не вызывать pricing preview на view route.
- [ ] **Step 7:** Сохранить edit/delete/late-completion commands, guards, cache invalidation и ошибки без изменения серверной логики.
- [ ] **Step 8:** Удалить page-level запрос общего списка проб, если после `view.sample` он больше не нужен; не оставлять мёртвый fetch.
- [ ] **Step 9:** Проверить browser layout 1440/1024/768/390, focus order, long data, WAITING/COMPLETED и отсутствие console errors.
- [ ] **Step 10:** Запустить `npm.cmd --prefix frontend test -- ExaminationViewPage.test.tsx SavedResearchResults.test.tsx SavedPricingTable.test.tsx`, typecheck, lint, build.
- [ ] **Step 11:** Commit: `feat: match saved examination view to approved mockup`.

### Task 7: Сквозные проверки, merge и контейнеры

**Files:**
- Modify: `frontend/tests/e2e/examinations.spec.ts`
- Modify: `frontend/tests/e2e/arrivals.spec.ts`
- Create: `docs/implementation/examination-view-completed-arrivals-evidence.md`
- Include: `dorabotka/2026-11-17-examination-view-and-completed-arrivals-data.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: проверенный feature branch, evidence, merge в `main`, обновлённые healthy containers.

- [ ] **Step 1:** E2E: сохранить COMPLETED FIT карточку, открыть просмотр, проверить секции/исследования/пробу/итог/специалиста/стоимость, вернуться в ACCEPTED и проверить все пять значений строки.
- [ ] **Step 2:** E2E: COMPLETED UNFIT показывает «Непригодно» в таблице и направление/причину только в карточке; expiry interval отображается целиком.
- [ ] **Step 3:** E2E: WAITING view не фабрикует итог и не попадает в ACCEPTED; edit/delete/late completion не регрессировали.
- [ ] **Step 4:** Запустить backend examinations + arrivals tests, frontend unit/typecheck/lint/build, `build-storybook` и targeted Playwright; записать фактические команды, версии и результаты в evidence. Not-run не называть passed.
- [ ] **Step 5:** Выполнить финальный whole-branch review по diff относительно исходного `main`; исправить все Critical/Important замечания через SDD fix loop и повторный review.
- [ ] **Step 6:** Убедиться, что feature branch содержит код, tests, evidence и это ТЗ, но не содержит `.env`, credentials, XML/БД, `tmp/`, `.superpowers/sdd/` или чужие untracked-файлы.
- [ ] **Step 7:** После clean review использовать `superpowers:finishing-a-development-branch`, объединить feature branch в актуальный `main` без force/reset и push в настроенный remote. Пользователь явно разрешил merge и обновление контейнеров.
- [ ] **Step 8:** Пересобрать затронутые `backend` и `frontend` штатным Docker Compose overlay без `down -v`; миграция не ожидается.
- [ ] **Step 9:** Проверить `docker compose ps`, health endpoints, login, конкретный view route и ACCEPTED на `http://127.0.0.1:8080`.
- [ ] **Step 10:** Финальный отчёт: branch, commits, merge commit, pushed main, tests, container images/status, browser smoke и честные not-run.

## 6. Обязательные критерии приёмки

- [ ] Сохранённая карточка визуально следует `vse-view.html`: title row, белые секции, иконки, grid, readonly-поля, исследования, итог и invoice.
- [ ] Из mockup не перенесены демонстрационные данные и прежняя модель исследования каждой туши.
- [ ] Известные исследования показываются русскими названиями, а не `Показатель <UUID>`.
- [ ] Страница показывает участников, продукцию, accepted quantities, клеймо, пробу, результаты, оценки, болезни, sent flag, статус, итог/причину, стоимость и сохранённого специалиста.
- [ ] WAITING не показывает ложный итог и сохраняет действующий late-completion workflow.
- [ ] В ACCEPTED «ВСЭ» показывает ровно «Пригодно» или «Непригодно».
- [ ] «Стоимость» показывает frozen сумму сверки + frozen сумму ВСЭ; `0,00 ₽` не заменяется прочерком.
- [ ] В заголовке стоимости справа есть доступная question-icon подсказка «Стоимость сверки данных + стоимость ВСЭ» по hover и focus.
- [ ] «Срок реализации» корректен для одной даты, интервала, informal и отсутствия.
- [ ] «Автор ВСЭ» показывает сохранённого выбранного специалиста, а optional «Номер ВСЭ» — реальный номер.
- [ ] Список не делает N+1 запросов examinations/users и не вызывает VetIS.
- [ ] Текущие сортировка/фильтры/pagination ACCEPTED, optional columns и переход по eye action не регрессировали.
- [ ] На 390 px нет горизонтальной прокрутки всей страницы; доступность и клавиатура работают.
- [ ] ТЗ и код находятся в `main`, remote обновлён, контейнеры пересобраны и healthy.
