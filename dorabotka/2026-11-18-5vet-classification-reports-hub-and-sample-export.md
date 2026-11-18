# Классификация 5-вет, интерфейс отчётов и экспорт «Учёта проб» — Implementation Plan

> **Для ИИ-агента:** ОБЯЗАТЕЛЬНЫЕ НАВЫКИ: сначала применить `superpowers:systematic-debugging` и подтвердить описанные причины на актуальном `main`; затем выполнять план через `superpowers:subagent-driven-development` — отдельный implementer на каждую задачу, после него отдельный reviewer соответствия ТЗ и отдельный reviewer качества кода. Для UI и шаблонов документов обязательно использовать `frontend-design`, `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md` и `STORYBOOK.md`. После задач провести независимый whole-branch review. Все шаги вести чекбоксами `- [ ]`.

**Цель:** восстановить расчёт 5-вет посредством одной утверждённой версии классификации продукции, убрать лишние тексты и правильно разместить действия в отчётных экранах, а также добавить безопасный PDF/XLSX-экспорт отчёта «Учёт проб» с остатками и полной историей выбранного периода.

**Архитектура:** классификация 5-вет остаётся отдельной версионированной картой стабильных GUID второго уровня Меркурия, но новая версия атомарно заменяет старую и в установленной системе всегда существует ровно одна версия. Экспорт «Учёта проб» строится на сервере из согласованного read-snapshot в момент нажатия: текущие остатки плюс вся история утилизаций по применённому фильтру, независимо от экранной пагинации. PDF и XLSX используют отдельные контролируемые проекции и шаблоны, а не HTML страницы или клиентский пересчёт.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, PostgreSQL/Alembic, React 19, TypeScript, TanStack Query, OpenAPI, xhtml2pdf/ReportLab, openpyxl, Vitest/Testing Library/MSW, pytest, Storybook, Playwright, Docker Compose.

**Spec:** настоящее ТЗ; решение владельца от 2026-11-18 о сопоставлении мяса и субпродуктов; `docs/TZ_development/plans/inputs.md` INPUT-04/05; `Функциональные требования/v2.0/09-reports.md`; `frontend/src/pages/ReportsPage.tsx`; `frontend/src/pages/SampleAccountingPage.tsx`; `backend/src/modules/reporting/snapshots.py`.

## Global Constraints

- [ ] Начать от актуального `main` в ветке `feature/DR49-5vet-classification-and-sample-export`.
- [ ] Настоящее ТЗ добавить в эту же ветку отдельным первым коммитом.
- [ ] Не менять формулы строк 166–172 и 240–242, набор печатных колонок, правила включения завершённых ВСЭ, seven-code form и frozen snapshot сохранённого 5-вет.
- [ ] Не определять классификацию по русскому названию во время расчёта. Runtime lookup выполняется только по стабильному `mercury_species_id`/GUID.
- [ ] Мясо и субпродукты одного вида животных получают одну животную колонку, но разные `material_kind`: `MEAT` и `OFFAL`. Это необходимо для разделения строк 241 и 242.
- [ ] Не превращать неизвестный или неоднозначный вид автоматически в `OTHER_ANIMALS`. Неизвестный вид по-прежнему блокирует расчёт целиком с `REPORT_MAPPING_INVALID`.
- [ ] Не вызывать ВетИС и не обновлять Mercury-справочник при построении отчёта.
- [ ] Экспорт «Учёта проб» доступен только пользователю с уже существующим `sample:read` в выбранной лаборатории. Экспорт не расширяет доступ, не добавляет новой роли и повторно проверяет scope на сервере.
- [ ] Не выгружать технические GUID продукции, `actor_id`, внутренние revision или trace-id в пользовательские PDF/XLSX.
- [ ] Не строить PDF из screenshot/DOM и не собирать XLSX в браузере. Оба файла формирует backend из серверной проекции.
- [ ] Все экспортные ответы `Cache-Control: no-store`; Problem JSON проверяется до создания Blob/скачивания.
- [ ] Не копировать SVG, кнопки и download logic в страницу. Использовать `Button`, `Icon('admin-download')` и вынесенный компонент действий.
- [ ] Сохранить пользовательское изменение `.gitignore` и любые несвязанные изменения рабочего дерева; не включать их в feature-коммиты.

## Review Focus

- Нулевая, одна и две legacy-версии классификации: пустая установка получает каноническую карту, одна пользовательская версия не повреждается миграцией, две версии не выбираются произвольно.
- Мясо/субпродукты одного животного: одинаковая колонка, но уничтоженный вес попадает соответственно в 241 или 242, а контроль `240 = 241 + 242` сохраняется.
- Экспорт при пагинированной истории: в файл попадают все строки выбранного периода, а не только видимые 20.
- Экспорт одновременно с утилизацией: остатки и история берутся из одного согласованного read-snapshot и не противоречат друг другу.
- Пустые остатки или пустая история: файл остаётся корректным, содержит заголовок раздела и понятное пустое состояние, а не пустой/сломанный лист.

---

## 1. Подтверждённая причина ошибки 5-вет

В рабочей PostgreSQL на момент анализа:

```text
SELECT version, count(*) FROM report_classifications GROUP BY version;
→ 0 rows
```

При этом существует одна завершённая ВСЭ с классификацией:

```text
GUID: e84f3cb2-0fd9-403e-8abf-9a2c7f1aa71f
Название: буйволятина
Статус: COMPLETED
```

`backend/src/modules/reporting/snapshots.py::_load_facts` выполняет `SELECT DISTINCT version` и при любом количестве, отличном от одного, возвращает:

```text
REPORT_MAPPING_INVALID
Для отчёта должна быть настроена ровно одна версия классификации продукции.
```

Следовательно, текущая ошибка вызвана отсутствием первоначальной версии, а не неправильной строкой ВСЭ. Дополнительный дефект: `create_classification_version` удаляет только строки с тем же названием версии. Создание следующей версии оставляет старую, после чего расчёт снова ломается из-за двух `distinct version`.

## 2. Каноническая версия классификации 5-вет

### 2.1. Версия и источник

Создать каноническую версию:

```text
version = meat-mvp-2026-11-18
source = Решение владельца от 18.11.2026 + pilot-снимок GetProductByTypeList productType=1
```

`product_type_id` для строк — `1`, `product_state_id` — `null`. Русское название приводится ниже только как проверяемое пояснение миграции и тестов; runtime key — GUID.

### 2.2. Утверждённые поддерживаемые строки

| GUID второго уровня | Название | animal_column | material_kind |
|---|---|---|---|
| `74269863-8169-ca83-e48e-37fc80e8c0a9` | баранина | `SHEEP_GOAT` | `MEAT` |
| `e84f3cb2-0fd9-403e-8abf-9a2c7f1aa71f` | буйволятина | `CATTLE` | `MEAT` |
| `362aa885-9b9f-ae95-05d0-f9570f4fbdc6` | говядина | `CATTLE` | `MEAT` |
| `13581a3b-c7c0-915e-62eb-fa9fc897573b` | козлятина | `SHEEP_GOAT` | `MEAT` |
| `64930556-cbb2-13db-bcdc-572eb188e45e` | конина | `OTHER_ANIMALS` | `MEAT` |
| `15a3d1e7-36d7-4749-b27f-568de76f612e` | мясо верблюда | `OTHER_ANIMALS` | `MEAT` |
| `ae99803f-c580-5b1d-80ce-a5139f74d71c` | мясо диких животных, рептилий и др. | `OTHER_ANIMALS` | `MEAT` |
| `207e346e-5a62-4396-b696-d154ad3bded9` | мясо диких птиц | `OTHER_BIRDS` | `MEAT` |
| `eab73d6b-b24d-5164-1c45-f9a39c2db9c7` | мясо кенгуру | `OTHER_ANIMALS` | `MEAT` |
| `cbd9f7c4-4033-75e2-d187-ee21a2a10246` | мясо китов | `OTHER_ANIMALS` | `MEAT` |
| `ce9828e8-1b07-f094-8eb9-8b450994153d` | мясо кролика | `RABBIT_NUTRIA` | `MEAT` |
| `527a0f5a-e880-e3ca-d41f-65aa63cc6313` | мясо морских животных | `OTHER_ANIMALS` | `MEAT` |
| `1e648587-4cb3-4369-8d1b-bbd200506164` | мясо нутрий | `RABBIT_NUTRIA` | `MEAT` |
| `e302358c-258a-93a4-3eb5-4385b30ff1d2` | мясо рептилий | `OTHER_ANIMALS` | `MEAT` |
| `62160578-dc4d-1934-b6bc-5dfa7a2ad4d1` | прочее мясо | `OTHER_ANIMALS` | `MEAT` |
| `57a674fd-ca2b-c523-6853-72d27b4ae32c` | свинина | `PIG` | `MEAT` |
| `f97d8683-89d2-d7f7-5015-cdeaab4be98f` | субпродукты и жиры говяжьи | `CATTLE` | `OFFAL` |
| `16d9f824-a5f3-6837-3073-e54c4ed5d74d` | субпродукты и жиры конские | `OTHER_ANIMALS` | `OFFAL` |
| `40dd45d4-75aa-b984-4fdb-291f84afad03` | субпродукты и жиры свиные | `PIG` | `OFFAL` |
| `0afdd23b-6fbb-ce96-669f-b0922b9efb85` | субпродукты мелкого рогатого скота | `SHEEP_GOAT` | `OFFAL` |
| `39157e2a-457a-f275-4bdb-c927f640be01` | субпродукты овец и коз | `SHEEP_GOAT` | `OFFAL` |
| `ada4ca0a-1698-27c2-fbb6-64c158b74677` | телятина | `CATTLE` | `MEAT` |

Все строки таблицы имеют `supported=true`.

### 2.3. Явно неподдерживаемые неоднозначные строки

Эти значения включить в ту же версию с `supported=false`, `animal_column=null`, `material_kind=null`. Нельзя фабриковать колонку или тип материала для смешанного значения.

| GUID | Название | Причина |
|---|---|---|
| `2482379d-fd70-d125-cd74-030244f62d28` | мясо и пищевые субпродукты, солёные/сушёные/копчёные | одновременно неизвестный вид животного и смешаны мясо/субпродукты |
| `337f79dc-4376-6e33-dabe-d5447913b97d` | мясо птицы | второй уровень не отличает кур от других птиц |
| `bd1bb8ca-6e18-4062-8e7c-32b95b1b1354` | неподконтрольная продукция | не является поддерживаемой продукцией отчёта |
| `9351133c-b114-9cb1-3cdd-84a89c1b9138` | свинина и субпродукты свиные | одна строка смешивает `MEAT` и `OFFAL` |
| `d7a44d7a-1863-dbff-2581-c03fae1ab447` | субпродукты и жиры птицы | второй уровень не отличает кур от других птиц |
| `2f055312-2167-4716-bb95-d541ca9cb54a` | Тест | тестовое внешнее значение |

Если завершённая ВСЭ содержит одну из этих строк, расчёт честно завершается `REPORT_MAPPING_INVALID` с названием/идентификатором проблемной классификации в server-side diagnostic, но пользовательский UI не показывает сырой GUID как основное сообщение.

### 2.4. Схема неподдерживаемых строк

**Files:**

- Modify: `backend/src/modules/catalog_pricing/models.py`
- Modify: `backend/src/modules/catalog_pricing/schemas.py`
- Modify: `backend/src/modules/reporting/schemas.py`
- Modify: `backend/src/modules/reporting/calculator.py`
- Test: `backend/tests/catalog_pricing/test_pricing.py`
- Test: `backend/tests/reporting/test_calculator.py`

- [ ] Сделать `animal_column` и `material_kind` nullable в ORM и write/read DTO.
- [ ] Добавить model validation: при `supported=true` оба значения обязательны; при `supported=false` оба должны быть `null`.
- [ ] `SpeciesClassification` следует тому же контракту.
- [ ] `_resolved` сначала проверяет `supported`; только после этого narrowing гарантирует ненулевые column/kind.
- [ ] Не использовать `cast()` для превращения `None` в допустимое значение.

### 2.5. Миграция и первичная загрузка

**Files:**

- Create: `backend/migrations/versions/0024_report_classification_seed.py`
- Test: `backend/tests/reporting/test_migration_0024.py`

- [ ] Изменить nullable constraints колонок и checks так, чтобы поддерживаемая строка требовала оба значения, а неподдерживаемая — оба `NULL`.
- [ ] Если в `report_classifications` нет ни одной версии, вставить ровно 28 строк версии `meat-mvp-2026-11-18` по таблицам выше.
- [ ] Если уже существует ровно одна версия, не перезаписывать операторскую конфигурацию миграцией.
- [ ] Если legacy-база содержит больше одной версии, остановить миграцию с явной диагностикой и перечнем версий; не выбирать «последнюю» по имени/дате.
- [ ] Upgrade должен быть идемпотентен на состоянии после миграции.
- [ ] Downgrade удаляет только строки канонической версии, если именно их создал upgrade, и возвращает старые NOT NULL/checks только когда неподдерживаемых nullable-строк нет; иначе останавливается до разрушительного DDL.

### 2.6. Атомарная замена версии

**Files:**

- Modify: `backend/src/modules/catalog_pricing/commands.py`
- Modify: `backend/src/modules/catalog_pricing/router.py`
- Modify: `backend/src/modules/reporting/snapshots.py`
- Test: `backend/tests/catalog_pricing/test_pricing.py`
- Test: `backend/tests/reporting/test_snapshots.py`

- [ ] `create_classification_version` под одним transaction-scoped advisory lock валидирует весь новый набор, удаляет **все** строки прежней версии/версий и вставляет новый набор в одной транзакции.
- [ ] Ни один читатель не должен увидеть промежуточное состояние «0 версий»: preview продолжает использовать REPEATABLE READ snapshot.
- [ ] Два конкурентных POST сериализуются; после commit существует только одна цельная версия, не смесь строк.
- [ ] Повтор POST с тем же idempotency key не заменяет карту второй раз.
- [ ] Сохранённые 5-вет не меняются: payload уже содержит frozen `classification_version`, матрицу и вклады.
- [ ] `_load_facts` различает причины: 0 версий → «Классификация продукции для отчёта не настроена»; >1 → «Обнаружено несколько версий классификации; требуется исправление конфигурации».
- [ ] После миграции preview для текущей завершённой «буйволятины» успешно строится и даёт +1 в колонке `CATTLE` строки 166.
- [ ] Добавить интеграционный контроль: свинина/свиные субпродукты обе идут в `PIG`, но уничтоженный вес разделяется между 241/242; аналогично КРС, овцы/козы и другие животные.

## 3. Страница создания 5-вет

**Files:**

- Modify: `frontend/src/features/reports/ReportParameters.tsx`
- Modify: `frontend/src/pages/ReportCreatePage.tsx`
- Modify: соответствующие tests/stories

- [ ] Удалить `<p data-testid="applied-period">…</p>` из `ReportParameters`.
- [ ] Удалить второй standalone echo `<p data-testid="preview-period">…</p>` после успешного preview: причина требования — выбранный период уже виден в trigger фильтра.
- [ ] Не удалять период из подписанного payload, preview matrix, сохранённого отчёта, PDF/XLSX 5-вет или error context.
- [ ] После preview trigger продолжает показывать применённый диапазон; изменение диапазона по-прежнему инвалидирует preview и коды.
- [ ] Удалить неиспользуемый `appliedRangeLabel` import из page/parameters.

## 4. Раздел «Отчёты»

### 4.1. Удаляемые элементы

**Files:**

- Modify: `frontend/src/pages/ReportsPage.tsx`
- Modify: `frontend/src/features/reports/reports.css`
- Test: `frontend/src/pages/ReportsPage.test.tsx`

Полностью удалить из DOM:

- `.vse-reports-subtitle` с текстом «Формирование регламентированной отчётности…»;
- `.vse-reports-lab` с названием лаборатории под заголовком;
- нижний `.app-field-message` о PDF/XLSX, снимке и `AT-18`.

Название лаборатории при этом остаётся в данных сохранённых отчётов и их документах. Не удалять scoped laboratory query, если оно используется для подписей строк сохранённых отчётов; если после изменения query больше нигде не нужен — удалить запрос и query key, а не оставлять сетевой вызов без UI-потребителя.

### 4.2. «Создать отчёт» внутри карточки 5-вет

- [ ] Удалить верхнюю primary-кнопку из `.vse-reports-title-row` и `useNavigate`, если он больше не используется.
- [ ] Расширить существующий `ReportHubItem` без копирования карточки: карточка 5-вет получает `to=/labs/:labId/reports/new`, visible label **«Создать отчёт»**, accessible name **«Создать отчёт 5-вет (раздел III)»**.
- [ ] Действие рендерится только при `access.create5vet`.
- [ ] Если пользователь может читать список, но не создавать — карточка остаётся без кнопки; права просмотра не расширяются.
- [ ] Ссылка использует те же `app-button secondary`, min-height, padding и правую колонку `.vse-reports-hub-actions`, что кнопки «Открыть» в соседних карточках.
- [ ] Desktop: кнопки трёх карточек имеют одинаковую ширину по содержимому, высоту и правую границу; центры находятся на одной вертикальной линии.
- [ ] ≤720 px: action переходит под текст карточки по существующему responsive-правилу и занимает доступную ширину без выхода за border.

## 5. «Учёт проб»: упрощение экрана

### 5.1. Удалить ссылку 5-вет

**Files:**

- Modify: `frontend/src/pages/SampleAccountingPage.tsx`
- Modify: `frontend/src/features/samples/samples.css`
- Test: `frontend/src/pages/SampleAccountingPage.test.tsx`

- [ ] Удалить ссылку «Отчёт 5-ВЕТ (раздел III)» и контейнер `.vse-samples-links`.
- [ ] Удалить `Link`, `canReadReports` и связанные неиспользуемые вычисления/imports.
- [ ] Не менять header navigation и маршруты отчётов.

### 5.2. Убрать видимый caption истории

**Files:**

- Modify: `frontend/src/features/samples/DisposalHistory.tsx`
- Modify: `frontend/src/shared/ui/DataTable.tsx` только если необходим общий именованный вариант
- Test: tests `DisposalHistory`/`DataTable`

- [ ] Удалить видимый `<caption>Утилизации за выбранный период (неизменяемые факты)</caption>`.
- [ ] Заголовок секции и её доступное имя привести к форме **«История утилизаций»** (множественное число), одинаковой в UI, PDF и XLSX.
- [ ] Не ухудшать доступность таблицы. Предпочтительный контракт: `h2` получает стабильный id, а таблица — `aria-labelledby` на этот id; общий `DataTable` получает named prop для внешнего accessible heading и в этом варианте не рендерит `<caption>`.
- [ ] Не использовать пустой caption и не скрывать его произвольным page CSS.
- [ ] Остальные таблицы `DataTable` сохраняют свои текущие captions без регрессии.

## 6. Операционный отчёт: кнопка периода

**Files:**

- Modify: `frontend/src/pages/OperationalReportPage.tsx`
- Test: `frontend/src/pages/OperationalReportPage.test.tsx`

- [ ] Кнопка submit имеет текст ровно **«Применить»**.
- [ ] Передать `variant="primary"` общему `Button`; итоговый DOM соответствует `<button type="submit" class="app-button primary"><span>Применить</span></button>` с учётом внутреннего API общего компонента.
- [ ] Сохранить submit формы, URL-параметры `from/to`, query key и loading/error поведение.
- [ ] Не создавать локальный CSS для имитации primary-кнопки.

## 7. Серверная проекция экспорта «Учёта проб»

### 7.1. Контракт endpoint

**Files:**

- Modify: `backend/src/modules/samples/router.py`
- Create: `backend/src/modules/samples/export_service.py`
- Create: `backend/src/modules/samples/export_schemas.py`
- Modify: `backend/src/modules/samples/queries.py`
- Test: `backend/tests/samples/test_export.py`

Добавить два read-only endpoint:

```text
GET /api/v1/samples/accounting/export.pdf
GET /api/v1/samples/accounting/export.xlsx

query:
  laboratory_id: UUID, required
  date_from: date, optional
  date_to: date, optional
```

- [ ] Оба endpoint требуют session и `sample:read` для указанной лаборатории; ADMIN и чужая лаборатория получают текущий fail-closed ответ.
- [ ] CSRF и Idempotency-Key для GET не требуются.
- [ ] `date_from > date_to` → 422 с русским detail до renderer.
- [ ] Пустые обе границы означают всю историю; одна граница означает открытый интервал с соответствующей стороны.
- [ ] История выбирается **полностью**, без `PAGE_SIZE`, offset и page. Экранная пагинация никогда не ограничивает файл.
- [ ] Балансы не зависят от периода и отражают текущее состояние на момент формирования.
- [ ] Сервис открывает короткую `REPEATABLE READ`, read-only транзакцию и в ней загружает лабораторию, balances и disposals. `generated_at` фиксируется один раз после получения snapshot.
- [ ] Не выполнять N+1: названия продукции и ФИО исполнителя разрешаются joins/aggregation тем же способом, что экранный read model.
- [ ] `SampleAccountingDocumentView` содержит только:
  - `laboratory_name`;
  - `generated_at` (timezone-aware UTC, отображение Europe/Moscow);
  - `date_from/date_to` optional;
  - `balances[{product_name,mass_kg}]`;
  - `disposals[{disposed_on,product_name,mass_kg,external_vsd_number,actor_name}]`.
- [ ] Fallback отсутствующего имени — «Данные не найдены», как на экране; сырой ID не выводить.
- [ ] Массы остаются `Decimal`, без промежуточного `float` в projection.

### 7.2. Общий порядок данных

- Остатки сортируются по русскому названию продукции (`lower(name)`), затем по стабильному GUID только как невидимый tie-breaker.
- История сортируется `recorded_at DESC, id DESC`, как экранная история.
- UI и export используют один query/projection helper, чтобы названия и порядок не расходились.

### 7.3. Имена файлов и headers

```text
Учёт_проб_<безопасное-название-лаборатории>_<from-or-all>_<to-or-all>.pdf
Учёт_проб_<безопасное-название-лаборатории>_<from-or-all>_<to-or-all>.xlsx
```

- Удалить path/control/device characters; пустой результат sanitize → `Учёт_проб`.
- `Content-Disposition: attachment; filename*=UTF-8''...`.
- PDF: `application/pdf`.
- XLSX: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- Оба: `Cache-Control: no-store`.
- Renderer failure → 503 `RENDERER_UNAVAILABLE`, без частичного файла.

## 8. PDF «Учёт проб»: точный шаблон

**Files:**

- Create: `backend/resources/forms/sample-accounting.html`
- Modify: `backend/resources/forms/manifest.json`
- Create: `backend/src/modules/documents/sample_accounting_pdf.py`
- При необходимости refactor: общий безопасный HTML→PDF engine из `documents/pdf.py` без изменения существующих заключений/5-вет
- Test: `backend/tests/documents/test_sample_accounting_rendering.py`

### 8.1. Формат страницы

- A4 portrait, поля: верх/низ 14 мм, слева/справа 13 мм.
- Шрифт: существующий проверенный DejaVu Sans из manifest; внешний network/file fetch запрещён.
- Footer каждой страницы: слева `Сформировано: ДД.ММ.ГГГГ ЧЧ:ММ (МСК)`, справа `Страница N из M`.
- Табличный header повторяется на следующей странице; строка не разрывается между страницами.
- Цвета повторяют рабочий интерфейс, без декоративного редизайна:
  - основной текст `#17323a`;
  - вторичный `#566e75`;
  - границы `#dfe9e9`;
  - header fill `#eaf6f4`;
  - акцентная линия/заголовок `#146c73`;
  - фон бумаги `#ffffff`.

### 8.2. Верх документа

Порядок сверху вниз:

1. `Учёт проб` — 18 pt, semibold, слева.
2. Название лаборатории — 11 pt.
3. `История утилизаций: <период>` — 9 pt muted:
   - обе даты: `ДД.ММ.ГГГГ — ДД.ММ.ГГГГ`;
   - только начало: `с ДД.ММ.ГГГГ`;
   - только конец: `по ДД.ММ.ГГГГ`;
   - без дат: `за всё время`.
4. Тонкая акцентная линия; без логотипа, которого нет в утверждённых ресурсах.

### 8.3. Раздел «Остатки проб»

Заголовок `Остатки проб`, затем таблица:

| Вид продукции | Остаток, кг |
|---|---:|

- Ширины: 75% / 25%.
- Название слева, масса справа.
- Масса: русская десятичная запятая, без лишних нулей (`0,8`, `12`, `1,125`).
- При отсутствии строк одна объединённая строка: `Положительных остатков нет.`.

### 8.4. Раздел «История утилизаций»

После 8 мм вертикального интервала, не обязательно с новой страницы:

| Дата утилизации | Вид продукции | Вес, кг | Номер исходящей эВСД | Провёл |
|---|---|---:|---|---|

- Ширины: 14% / 23% / 11% / 27% / 25%.
- Дата `ДД.ММ.ГГГГ`, масса как выше.
- Номер и длинные ФИО переносятся внутри ячейки; размер текста не уменьшается ниже 7.5 pt.
- При отсутствии строк: объединённая строка `За выбранный период утилизаций нет.`; без фильтра — `Утилизаций пока нет.`.
- Не выводить UUID вида продукции, actor id, revision и внутренний id утилизации.

### 8.5. Безопасность шаблона

- Все текстовые значения HTML-escaped.
- Template и font закреплены SHA-256 в manifest.
- Никаких inline base64/user HTML, внешних картинок, ссылок, скриптов.
- Тест hostile values (`<script>`, `&`, длинная строка, leading `=`) подтверждает текстовое безопасное отображение.
- Render test проверяет `%PDF-`, A4, число страниц, извлечённый русский текст, повтор header и отсутствие GUID.

## 9. XLSX «Учёт проб»: два листа

**Files:**

- Create: `backend/src/modules/documents/sample_accounting_xlsx.py`
- Test: `backend/tests/documents/test_sample_accounting_rendering.py`

Workbook содержит **ровно два листа** в этом порядке:

1. `Остатки проб`
2. `История утилизаций`

### 9.1. Общий стиль листов

- `A1` — заголовок `Учёт проб`, объединён по ширине таблицы; fill `#146C73`, белый bold 15 pt.
- `A2` — `Лаборатория: <name>`, объединён.
- `A3` — `Сформировано: ДД.ММ.ГГГГ ЧЧ:ММ (МСК)`, объединён.
- `A4`:
  - на остатках: `Состояние остатков на момент формирования`;
  - на истории: `Период истории: <label>`.
- Строка 6 — header таблицы, fill `#EAF6F4`, bold, border `#DFE9E9`.
- Freeze panes: `A7`; autofilter по строке 6; печатные заголовки повторяют строки 1–6.
- Gridlines выключены, page orientation portrait для остатков и landscape для истории, `fitToWidth=1`, разумные margins.
- Защиту листа не включать: файл предназначен для анализа, но исходные данные не содержат формул.

### 9.2. Лист «Остатки проб»

| A | B |
|---|---|
| Вид продукции | Остаток, кг |

- Ширины: A=46, B=16.
- Масса — numeric cell на основе Decimal, number format `0.######`; не строка.
- Пустое состояние — `A7:B7` merge, текст `Положительных остатков нет.`.

### 9.3. Лист «История утилизаций»

| A | B | C | D | E |
|---|---|---|---|---|
| Дата утилизации | Вид продукции | Вес, кг | Номер исходящей эВСД | Провёл |

- Ширины: A=16, B=38, C=14, D=42, E=32.
- Date cell — настоящее Excel date, format `DD.MM.YYYY`.
- Масса — numeric Decimal, format `0.######`.
- Название, номер и ФИО — принудительно text cells. Значения, начинающиеся с `=`, `+`, `-`, `@`, tab или CR, получают безопасный quotePrefix и никогда не становятся формулами.
- Wrap text, vertical top, высота строки auto/достаточная для двух строк.
- Пустое состояние объединяет `A7:E7` и использует тот же текст, что PDF.

### 9.4. XLSX tests

- [ ] Ровно два листа и правильный порядок.
- [ ] Проверены merged ranges, headers, widths, freeze panes, autofilter и print settings.
- [ ] Масса остаётся numeric без binary float drift; даты являются date cells.
- [ ] Номер `00123` сохраняется текстом с ведущими нулями.
- [ ] Formula injection не создаёт ячейку с `data_type='f'`.
- [ ] Файл открывается openpyxl после генерации и содержит все строки, включая >20 disposal rows.

## 10. Действия экспорта в React

**Files:**

- Modify: `frontend/src/features/samples/api.ts`
- Create: `frontend/src/features/samples/SampleExportActions.tsx`
- Modify: `frontend/src/pages/SampleAccountingPage.tsx`
- Modify: `frontend/src/features/samples/samples.css`
- Create/Modify: tests and Storybook stories

### 10.1. Размещение

- [ ] Создать heading row: слева `h1 «Учёт проб»`, справа группа действий.
- [ ] Две secondary-кнопки: **«Скачать PDF»** и **«Скачать XLSX»**. Использовать общий `Button`; допустима общая иконка `admin-download` перед текстом.
- [ ] Desktop: одинаковая высота, gap 8 px, правая граница совпадает с границей контентных блоков.
- [ ] ≤720 px: heading и actions перестраиваются в колонку; кнопки занимают доступную ширину, не выходят за viewport.
- [ ] Не добавлять отдельную карточку «Экспорт» и служебное пояснение.

### 10.2. Параметры и загрузка

- [ ] Кнопки передают **применённые** `historyFrom/historyTo` из URL, а не несохранённые draft-поля.
- [ ] Экспорт включает current balances независимо от периода.
- [ ] На время конкретного запроса обе кнопки disabled; нажатая показывает busy label `Формируем PDF…`/`Формируем XLSX…`.
- [ ] Успех создаёт Blob только после проверки status/content-type Problem и скачивает server filename.
- [ ] Ошибка показывает компактный `StatusView`/alert под actions с detail и кнопкой «Повторить»; broken Blob не скачивается.
- [ ] Повтор выполняет тот же kind и те же applied query params.
- [ ] При unmount запрос abort и object URL освобождается.

### 10.3. Frontend tests/stories

- [ ] PDF/XLSX GET содержит laboratory_id и применённые даты; draft не утекает.
- [ ] Пустые границы не сериализуются строкой `null`/`undefined`.
- [ ] 403/503 Problem не вызывает `URL.createObjectURL` и download click.
- [ ] Content-Disposition UTF-8 filename используется; при отсутствии — безопасный fallback.
- [ ] Storybook: normal, PDF busy, export error, long laboratory/context layout, narrow viewport.

## 11. Обновление документов и контрактов

- [ ] Обновить OpenAPI и сгенерированный `frontend/src/shared/api/schema.d.ts` штатной командой.
- [ ] Обновить `docs/TZ_development/plans/api-contract.md`: sample accounting exports, query params, media types, permissions.
- [ ] Обновить `docs/TZ_development/plans/data-contract.md` и INPUT-05: одна атомарно заменяемая версия, nullable mapping только для `supported=false`, утверждённая карта.
- [ ] Обновить ФТ раздела отчётов: экспорт «Учёта проб» содержит live balances и period-filtered disposal history.
- [ ] Зафиксировать owner decision о мясе/субпродуктах в `Функциональные требования/v2.0/owner-decisions.md` либо актуальном журнале решений.
- [ ] Не переписывать исторические evidence-файлы как будто решение существовало ранее.

## 12. Обязательный RED → GREEN

### Task A — классификация

- [ ] Написать failing migration/unit/integration tests из §2.
- [ ] Проверить RED: пустая БД даёт 0 версий и preview падает.
- [ ] Реализовать schema/migration/atomic replace.
- [ ] Проверить GREEN: ровно 28 строк одной версии; буйволятина строит preview.
- [ ] Commit: `fix: provision canonical 5vet classification`.

### Task B — интерфейс 5-вет и hub

- [ ] Написать failing component tests на удалённые тексты и расположение action.
- [ ] Проверить RED.
- [ ] Реализовать §3–4.
- [ ] Проверить component tests, Storybook и responsive screenshot.
- [ ] Commit: `fix: simplify report creation and hub actions`.

### Task C — экран «Учёт проб» и operational button

- [ ] Написать failing tests на удаление ссылки/caption и primary «Применить».
- [ ] Проверить RED, реализовать §5–6, проверить GREEN.
- [ ] Commit: `fix: align sample and operational report controls`.

### Task D — sample export backend

- [ ] Написать failing auth, scope, snapshot, all-pages, PDF и XLSX tests.
- [ ] Проверить RED.
- [ ] Реализовать projection/endpoints/renderers/templates.
- [ ] Проверить GREEN и visual render PDF.
- [ ] Commit: `feat: export sample accounting to pdf and xlsx`.

### Task E — sample export frontend

- [ ] Написать failing transport/action tests и stories.
- [ ] Проверить RED, реализовать buttons/download/error flow.
- [ ] Проверить GREEN, build и браузер на реальном экране.
- [ ] Commit: `feat: add sample accounting export actions`.

## 13. Проверки

Минимальный набор команд, адаптировать только к актуальным scripts:

```powershell
uv run pytest backend/tests/reporting backend/tests/catalog_pricing backend/tests/samples backend/tests/documents backend/tests/config
cd frontend
npm.cmd run test -- --run
npm.cmd run build
npm.cmd run build-storybook
npm.cmd run test:e2e
```

Дополнительно:

- [ ] Миграция `0023 → 0024` на копии текущей БД и чистый upgrade `base → head`.
- [ ] SQL-проверка: одна distinct version и 28 строк.
- [ ] Живой локальный **preview** 5-вет для периода с завершённой буйволятиной; внешних VetIS-write операций нет.
- [ ] Скачать PDF/XLSX «Учёта проб», открыть PDF viewer и LibreOffice/Excel, проверить кириллицу, два листа, все строки и отсутствие GUID.
- [ ] PDF visual regression: 1 страница, несколько страниц, длинные значения, пустая история.
- [ ] 390 px и 200% zoom для Reports hub, create 5-vet, sample accounting и operational.

## 14. Merge, push и контейнеры

- [ ] Каждый task реализует отдельный subagent; после него spec reviewer и code-quality reviewer. Замечания возвращаются implementer-у до approve.
- [ ] Whole-branch reviewer сверяет diff с этим ТЗ, права доступа, migration safety, document security и отсутствие unrelated files.
- [ ] Настоящее ТЗ, код, шаблон, manifest, миграция и тесты находятся в feature-ветке.
- [ ] Слить feature в `main` merge commit без `reset --hard`, без force push и без потери `.gitignore`/чужих файлов.
- [ ] Запушить feature и `main` в настроенный remote.
- [ ] Сделать backup/checkpoint БД, применить migration, затем пересобрать и поднять штатные контейнеры с build.
- [ ] Проверить `docker compose ps`, healthchecks, migration head, backend/frontend logs.
- [ ] Smoke через UI: preview 5-вет, Reports hub, operational «Применить», PDF/XLSX «Учёта проб».
- [ ] Финальный отчёт: branch, commit hashes, merge commit, push status, migration result, container image/status, тесты и честные not-run.

## 15. Критерии приёмки

- Отчёт 5-вет за период с завершённой буйволятиной формирует preview без ошибки классификации; строка 166 увеличена в колонке КРС/яки/буйволы.
- Для каждого утверждённого вида мясо и его субпродукты находятся в одной животной колонке; `MEAT/OFFAL` разделяет строки 241/242.
- На create 5-вет нет отдельной подписи периода ни до, ни после preview.
- На hub нет subtitle, отдельного названия лаборатории и служебного текста про export; «Создать отчёт» находится справа внутри карточки 5-вет и симметрично «Открыть».
- В «Учёте проб» нет ссылки на 5-вет и видимого caption истории.
- В operational кнопка называется «Применить» и использует primary variant.
- PDF «Учёт проб» визуально повторяет два последовательных блока интерфейса, содержит текущие остатки и всю историю применённого периода.
- XLSX содержит ровно два оформленных листа: «Остатки проб» и «История утилизаций»; даты/массы имеют правильные типы, номера не теряют ведущие нули.
- Экспорт не показывает технические идентификаторы, не ограничен экранной страницей и не доступен вне `sample:read` scope.
- ТЗ и реализация присутствуют в `main`; контейнеры работают на merge commit.
