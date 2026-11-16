# Метаданные сверки и фильтры очередей поступлений Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Для каждой задачи использовать нового implementer-субагента, затем отдельного reviewer-субагента на соответствие ТЗ и отдельного reviewer-субагента на качество кода; замечания исправлять и перепроверять до перехода к следующей задаче.

**Goal:** Убрать ложные прочерки в колонках «Стоимость сверки» и «Автор сверки данных» очереди «В работе», добавить очереди «В работе» сортировку по дате завершения сверки, а очереди «Завершенные» — фильтр по дате/периоду сверки и сортировку по той же дате.

**Architecture:** Расширить существующий `IncomingView` компактной серверной сводкой завершённой сверки. Источники истины — `Reconciliation.completed_at`, неизменяемый `Reconciliation.pricing_snapshot` и пользователь из `Reconciliation.actor_id`; клиент ничего не пересчитывает и не подменяет датой гашения. Сортировка и фильтрация выполняются в SQL до пагинации и подсчёта, а URL остаётся воспроизводимым после F5 и доступным по ссылке. Существующие `ArrivalsFilters`, `ArrivalsPage`, таблицы и дизайн-система расширяются без создания параллельного экрана.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy/PostgreSQL, React 19, TypeScript, React Router, TanStack Query, OpenAPI-generated types, Vitest/Testing Library/MSW, Storybook, Playwright, Docker Compose.

**Spec:** FT-ARR-01–02/15; API-01/API-04; DATA-02; `docs/TZ_development/plans/2026-11-06-04-arrivals.md`; `docs/TZ_development/plans/api-contract.md`; `docs/TZ_development/plans/field-mapping.md`; `DESIGN.md`; `UX-CONTRACT.md`; `STORYBOOK.md`; эталоны `arrivals-work.html` и `arrivals-accepted.html`.

## 1. Подтверждённая причина дефекта

Текущий код намеренно выводит прочерки, потому что API списка не отдаёт сведения о сверке:

- `frontend/src/features/arrivals/ArrivalTables.tsx` жёстко подставляет `—` в `cost`, `author` и дополнительный столбец `checkAuthor`;
- `backend/src/modules/arrivals/schemas.py::IncomingView` содержит `confirmation`, но не содержит сводку `Reconciliation`;
- дата в таблицах сейчас берётся из `confirmation.confirmed_at`, то есть из факта гашения, а не из канонического `Reconciliation.completed_at`;
- `backend/src/modules/arrivals/queries.py::arrival_page` всегда сортирует по `vd:issueDate`, хотя смысл сортировки зависит от очереди;
- `ArrivalsFilters` содержит только подписи сортировки для «Ожидаемых», а `ArrivalsPage` включает сортировку только для этой вкладки;
- параметры дат не представлены в URL, клиентском запросе и backend-контракте.

Нужные данные уже хранятся в БД. Новую таблицу, новый расчёт стоимости и изменение workflow сверки создавать не требуется.

## 2. Источники истины и семантика полей

| Поле интерфейса | Канонический источник | Правило |
|---|---|---|
| Дата сверки данных | `Reconciliation.completed_at` | Московское отображение `ДД.ММ.ГГГГ ЧЧ:ММ`; не использовать `ReceiptConfirmation.confirmed_at`, `saved_at`, дату оформления ВСД или время импорта |
| Стоимость сверки | `Reconciliation.pricing_snapshot.total` | Показывать зафиксированную при полной сверке сумму; не пересчитывать по текущим тарифам |
| Валюта | `Reconciliation.pricing_snapshot.currency` | Для текущего `RUB` использовать существующее отображение рублей; не пришивать валюту к данным вручную |
| Автор сверки данных | `User.full_name`, найденный по `Reconciliation.actor_id` | Не показывать UUID/login; `actor_id` сохраняет автора первой записи сверки по действующему контракту CHK-F33 |

`pricing_snapshot` является историческим снимком. Изменение тарифа после сверки не должно менять старую строку «В работе» или «Завершенные».

Если у старой/повреждённой записи действительно отсутствует сводка или отдельное значение, интерфейс может показать `—` только для отсутствующего значения. Числовой ноль является данными и отображается как `0,00 ₽`, а не как отсутствие. API не должен фабриковать нулевую цену, текущего пользователя или текущую дату.

## 3. Целевой API-контракт

Добавить в `IncomingView` необязательное поле `reconciliation` с отдельной строгой схемой, например:

```text
ReconciliationSummary
  completed_at: datetime | null
  author_name: string | null
  pricing: PricingSnapshot | null
```

Название итоговой схемы можно согласовать с принятым стилем проекта, но семантику менять нельзя. Не возвращать клиенту только `actor_id` с ожиданием, что фронтенд сам загрузит пользователя. Полный набор checks/services в список также не передавать.

Для `GET /api/v1/arrivals` сохранить существующие `sort=asc|desc`, но интерпретировать направление в контексте очереди:

- `queue=EXPECTED`: как сейчас, по `vdDocument.issueDate`;
- `queue=WORK`: по `Reconciliation.completed_at`;
- `queue=ACCEPTED`: по `Reconciliation.completed_at`.

Для даты завершённой сверки добавить параметры:

- `reconciled_on=YYYY-MM-DD` — один московский календарный день;
- `reconciled_from=<ISO-8601 datetime with offset>`;
- `reconciled_to=<ISO-8601 datetime with offset>`.

Правила:

- параметры даты допустимы только при `queue=ACCEPTED`, иначе честный `422`, а не молчаливое игнорирование;
- `reconciled_on` взаимоисключается с диапазоном;
- в режиме диапазона обязательны обе границы;
- `reconciled_from <= reconciled_to`, обе даты содержат смещение часового пояса;
- один день означает полуоткрытый московский интервал `[00:00, следующий день 00:00)`; использовать существующую семантику `moscowDayRange`;
- диапазон пользовательских `datetime-local` трактуется в `Europe/Moscow`; начало включительно, конец включительно для выбранной минуты. На wire его можно безопасно нормализовать в полуоткрытую верхнюю границу следующей минуты, что должно быть явно покрыто тестом;
- `null completed_at` всегда располагается после дат при `asc` и `desc` и не проходит активный фильтр;
- стабильный tie-breaker: `Party.created_at DESC`, затем `Party.id DESC`;
- сортировка и фильтр выполняются в БД до `offset/limit`; `total` считается с теми же условиями, что и строки.

Не добавлять фильтрацию только на загруженных 20 строках. Это нарушит пагинацию и счётчики.

## 4. Целевое поведение интерфейса

### 4.1 Вкладка «В работе»

- Колонка «Дата сверки данных» показывает `reconciliation.completed_at`.
- «Стоимость сверки» показывает `reconciliation.pricing.total` через существующий денежный formatter.
- «Автор сверки данных» показывает `reconciliation.author_name`.
- В блоке фильтров после поиска появляется поле `Сортировка`.
- Значения строго:
  - `asc` — «Сначала сверенные раньше»;
  - `desc` — «Сначала сверенные позже».
- По умолчанию `desc`; при выборе `asc` URL содержит `sort=asc`, при возврате к `desc` параметр можно убрать как значение по умолчанию.
- Любое изменение сортировки сбрасывает страницу на 1.

### 4.2 Вкладка «Завершенные»

- В блоке фильтров сохранить поиск, текущий фильтр результата и выбор столбцов.
- Добавить поле «Дата сверки данных» с trigger/popover по композиции `arrivals-accepted.html`:
  - режимы «Дата» и «Диапазон»;
  - режим «Дата» — одно нативное поле `date`;
  - режим «Диапазон» — поля «С» и «По» типа `datetime-local`;
  - действия «Сбросить» и «Применить»;
  - закрытие по Escape и клику вне popover с возвратом фокуса на trigger;
  - summary показывает выбранную дату/период по-русски, без технического ISO-текста.
- Добавить поле `Сортировка` со значениями:
  - `desc` — «Сначала новые»;
  - `asc` — «Сначала старые».
- Сортировка выполняется по `Reconciliation.completed_at`.
- Дополнительный столбец «Автор сверки данных», когда пользователь его включает, использует ту же `author_name`, а не `—`.
- Колонка «Дата сверки данных» также использует `completed_at`.
- Изменение/сброс даты или сортировки сбрасывает страницу на 1.

### 4.3 URL и переходы между вкладками

Фильтры должны переживать F5 и подходить для передачи ссылки. Использовать параметры `queue`, `q`, `result`, `sort`, `page`, `reconciled_on`, `reconciled_from`, `reconciled_to`.

- вне `ACCEPTED` параметры `reconciled_*` удаляются из URL и не отправляются;
- при переключении очереди `page` сбрасывается;
- сортировка получает значение по умолчанию новой очереди, чтобы значение с прежним смыслом не переносилось скрыто;
- смена поиска, результата, даты или сортировки не должна стирать остальные применимые параметры;
- запрос списка и React Query key включают все серверные фильтры;
- запросы счётчиков вкладок не должны случайно наследовать дату/сортировку активной таблицы и менять смысл общего счётчика очереди.

## 5. UI-ограничения

Перед реализацией полностью прочитать `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, затем открыть текущие `ArrivalsFilters`, `ArrivalsScreen`, `ArrivalsPage`, `ArrivalTables`, `arrivals.stories.tsx` и макеты `arrivals-work.html`, `arrivals-accepted.html`.

- Расширять существующий `ArrivalsFilters`; не создавать отдельную копию панели для каждой вкладки.
- Подписи сортировки передавать как queue-aware конфигурацию, а не заменять глобальную константу так, чтобы сломать «Ожидаемые».
- Date popover выделить в переиспользуемый компонент внутри `frontend/src/features/arrivals/`, если разметка не помещается разумно в `ArrivalsFilters`.
- Использовать существующие токены, кнопки, иконки и стили фильтров. Не копировать SVG и не создавать вторую дизайн-систему.
- Сохранить текущую ширину рабочей области и геометрию таблиц.
- На узком экране фильтры складываются без горизонтальной прокрутки всей страницы.
- Все controls доступны с клавиатуры, имеют label/accessible name и заметный `focus-visible`.
- Loading/error/empty состояния сохраняют выбранные URL-фильтры и не показывают устаревшие строки как окончательный результат.

## 6. План реализации

### Task 1: Зафиксировать backend-контракт сводки сверки тестами

**Files:** изменить `backend/tests/arrivals/test_dr5_views.py`, `backend/tests/arrivals/test_dr11_pricing.py` и/или создать адресный `backend/tests/arrivals/test_reconciliation_list_metadata.py`; изменить позже `backend/src/modules/arrivals/schemas.py`, `backend/src/modules/arrivals/queries.py`.

- [ ] Написать RED-тест: WORK-строка содержит `completed_at`, ФИО автора и frozen `pricing.total/currency` из сохранённой сверки.
- [ ] Доказать тестом, что изменение действующего тарифа после сверки не меняет сумму в списке.
- [ ] Добавить legacy/null cases: нет сводки — `reconciliation=null`; нулевая сохранённая сумма не превращается в null.
- [ ] Добавить query-count/spy проверку либо построить запрос так, чтобы имя автора и сводка не загружались отдельным SQL-запросом на каждую строку. Запрещён новый N+1.
- [ ] Запустить адресные тесты и сохранить ожидаемый RED в evidence.
- [ ] Коммит: `test: cover reconciliation metadata in arrivals list`.

### Task 2: Реализовать компактную серверную сводку

**Files:** изменить `backend/src/modules/arrivals/schemas.py`, `backend/src/modules/arrivals/queries.py`, при необходимости импорт `User` из `backend/src/modules/identity/models.py`; обновить backend tests.

- [ ] Добавить строгий `ReconciliationSummary` и необязательное поле в `IncomingView`.
- [ ] Получать `Reconciliation`, `pricing_snapshot` и `User.full_name` для страницы одним join/bulk read; не вызывать user endpoint и не делать SOAP/VetIS запросов.
- [ ] Валидировать сохранённый pricing через существующую `PricingSnapshot`, не вручную собранный loosely typed dict.
- [ ] Не менять `Reconciliation.actor_id`, CHK-F33 и историю тарифов.
- [ ] Вернуть сводку также в single-arrival view для консистентности одного schema contract.
- [ ] Довести адресные тесты до GREEN.
- [ ] Коммит: `feat: expose frozen reconciliation summary in arrivals`.

### Task 3: Добавить серверную сортировку и фильтр даты

**Files:** изменить `backend/src/modules/arrivals/router.py`, `backend/src/modules/arrivals/queries.py`, `backend/tests/arrivals/test_dr15_sorting.py`; создать/изменить тесты фильтра даты.

- [ ] Написать RED matrix для EXPECTED/WORK/ACCEPTED: EXPECTED остаётся по issueDate, WORK/ACCEPTED идут по `completed_at` в обоих направлениях.
- [ ] Покрыть одинаковые даты, nulls-last, стабильную пагинацию и отсутствие дублей после join.
- [ ] Покрыть `reconciled_on` на границе московских суток и оба режима диапазона.
- [ ] Покрыть 422: дата с другой queue, смешение single/range, неполный диапазон, обратный диапазон, datetime без offset.
- [ ] Применить один и тот же `where` к `count` и row query; сортировать до пагинации.
- [ ] Сохранить старый контракт EXPECTED и существующие deep-link URL.
- [ ] Запустить `backend/tests/arrivals/test_dr15_sorting.py` и новые тесты до GREEN.
- [ ] Коммит: `feat: sort and filter arrivals by reconciliation date`.

### Task 4: Обновить OpenAPI и типизированный клиент

**Files:** обновить OpenAPI-артефакт проекта и `frontend/src/shared/api/schema.d.ts`; изменить `frontend/src/features/arrivals/api.ts`.

- [ ] Сгенерировать схему штатной командой, не редактировать generated types выборочно вручную.
- [ ] Расширить `ArrivalsQuery` параметрами reconciliation date и отправлять только непустые значения.
- [ ] Уточнить комментарий `ArrivalSort`: направление сортировки очереди, а не только issueDate.
- [ ] Использовать существующие `moneyLabel`, `formatMoscowDateTime`/принятый formatter и `moscowDayRange`; не выполнять арифметику стоимости в браузере.
- [ ] Запустить `npm.cmd --prefix frontend run gen:api` и `npm.cmd --prefix frontend run typecheck`.
- [ ] Коммит: `chore: regenerate arrivals reconciliation contract`.

### Task 5: Вывести стоимость, автора и правильную дату

**Files:** изменить `frontend/src/features/arrivals/ArrivalTables.tsx`, `ArrivalTables.test.tsx`, fixtures/stories.

- [ ] Написать RED-тесты, которые запрещают жёсткие прочерки при наличии данных.
- [ ] WORK: вывести completed date, frozen total и author full name.
- [ ] ACCEPTED: вывести completed date и author в optional `checkAuthor`.
- [ ] Проверить формат `230.00 -> 230,00 ₽`, `0.00 -> 0,00 ₽`, null -> `—`.
- [ ] Длинное ФИО сокращается только визуально; полное значение доступно через нативный title/доступный текст согласно существующему `DataTable`.
- [ ] Не менять в этой задаче пока незаполненные колонки ВСЭ/срока реализации/общей стоимости завершённой ВСЭ.
- [ ] Обновить Storybook: normal, missing legacy metadata, zero cost, long author, narrow.
- [ ] Коммит: `fix: show reconciliation cost author and completion date`.

### Task 6: Сделать сортировку queue-aware

**Files:** изменить `frontend/src/features/arrivals/ArrivalsFilters.tsx`, `ArrivalsScreen.tsx`, `frontend/src/pages/ArrivalsPage.tsx`, `frontend/src/features/arrivals/ArrivalsPage.test.tsx`, stories.

- [ ] Заменить устаревший тест «sort select exists only on EXPECTED» матрицей трёх очередей.
- [ ] Оставить EXPECTED: «Сначала оформленные раньше/позже».
- [ ] Добавить WORK: «Сначала сверенные раньше/позже».
- [ ] Добавить ACCEPTED: «Сначала старые/новые».
- [ ] Один `asc|desc` contract, разные русские labels; не дублировать `<select>`.
- [ ] Сохранить sort в URL, сбрасывать page, включить sort в query key/request.
- [ ] При смене queue нормализовать сортировку к `desc` и не оставлять параметр со старым скрытым смыслом.
- [ ] Коммит: `feat: add queue-aware arrivals sorting`.

### Task 7: Реализовать фильтр даты завершённой сверки

**Files:** создать при необходимости `frontend/src/features/arrivals/ReconciliationDateFilter.tsx` и тест; изменить `ArrivalsFilters.tsx`, `ArrivalsScreen.tsx`, `ArrivalsPage.tsx`, `arrivals.css`, `arrivals.stories.tsx`, page tests.

- [ ] Сначала написать component tests режимов date/range, apply/reset, Escape, outside click, focus return и validation.
- [ ] Показывать компонент только в ACCEPTED.
- [ ] Не отправлять черновые значения до «Применить»; «Сбросить» удаляет все `reconciled_*`.
- [ ] В режиме date использовать `reconciled_on`; в range переводить московские локальные значения в ISO со смещением и нормализовать включительную минуту верхней границы.
- [ ] Неполный/обратный диапазон показать русской ошибкой у полей, не выполнять запрос.
- [ ] Сериализовать применённое состояние в URL и восстановить после F5/Back/Forward.
- [ ] Любое применение/сброс сбрасывает page=1, но сохраняет q/result/sort.
- [ ] Удалять параметры при уходе с ACCEPTED.
- [ ] Добавить stories: closed, single date, range, invalid range, long summary, 390px.
- [ ] Коммит: `feat: filter completed arrivals by reconciliation date`.

### Task 8: Сквозная проверка API, URL и доступности

**Files:** изменить `frontend/tests/e2e/arrivals.spec.ts`; добавить `docs/implementation/arrivals-reconciliation-metadata-filters-evidence.md`.

- [ ] E2E WORK: открыть вкладку, увидеть реальную сумму/автора/дату, переключить сортировку и проверить порядок + URL + F5.
- [ ] E2E ACCEPTED: применить один день, диапазон, сброс; проверить rows, total/page и сохранение после F5.
- [ ] Проверить, что дата вне ACCEPTED не уходит в API, а счётчики вкладок остаются общими.
- [ ] Проверить Back/Forward, пустой результат, сетевую ошибку, 390px, клавиатуру и отсутствие console errors.
- [ ] Запустить адресные backend tests, `npm.cmd --prefix frontend test -- ArrivalTables.test.tsx ArrivalsPage.test.tsx ReconciliationDateFilter.test.tsx`, `npm.cmd --prefix frontend run typecheck`, `lint`, `build`, `build-storybook` и targeted Playwright.
- [ ] В evidence записать фактические команды и результаты; not-run не выдавать за passed.
- [ ] Коммит: `test: verify reconciliation metadata and arrival filters`.

### Task 9: Финальное ревью, merge и обновление контейнеров

**Files:** это ТЗ, evidence и только относящиеся к задаче изменения.

- [ ] Начать с актуального `main` в отдельном worktree/ветке `codex/arrivals-reconciliation-metadata-filters`; перед работой проверить dirty files и не включать чужие изменения.
- [ ] В корне worktree создать локальную ignored-папку `sdd/` и ledger `sdd/tasks.md`; вести там статусы/коммиты субагентов, не коммитить служебный ledger.
- [ ] После каждого Task получить spec review и code-quality review от отдельных свежих субагентов, исправить все существенные замечания и повторить проверку.
- [ ] После всех Tasks вызвать отдельного финального reviewer-субагента на весь diff относительно `main`; проверить backend/frontend контракт, SQL-пагинацию, URL state и доступность.
- [ ] Использовать `superpowers:finishing-a-development-branch`; выполнить финальные тесты на чистом состоянии.
- [ ] Включить это ТЗ в тот же feature branch и историю задачи. Не добавлять `.env`, credentials, XML с персональными данными, БД, `tmp/`, `sdd/` или чужие незавершённые файлы.
- [ ] После зелёного финального ревью последовательно объединить feature branch в `main` и push в настроенный remote без force/reset. Пользователь этим ТЗ явно разрешил merge и обновление контейнеров.
- [ ] Пересобрать backend и frontend существующим Docker Compose профилем без удаления volumes/БД; применить штатные миграции только если реализация действительно потребовала миграцию (она не ожидается).
- [ ] Проверить `docker compose ps`, health endpoints, вход в UI и обе вкладки на `http://127.0.0.1:8080`.
- [ ] Финальный отчёт: branch, commits, merge commit, тесты, контейнеры, smoke results и честные not-run.

## 7. Обязательные критерии приёмки

- [ ] В WORK при наличии завершённой сверки нет ложных прочерков в стоимости и авторе.
- [ ] Стоимость равна frozen snapshot, не текущему тарифу; ноль не считается отсутствием.
- [ ] Автор показывается ФИО, не UUID/login.
- [ ] Дата обеих очередей берётся из `Reconciliation.completed_at`, не из гашения.
- [ ] WORK сортируется по дате сверки с точными подписями пользователя.
- [ ] ACCEPTED имеет date/range filter и сортировку с точными подписями пользователя.
- [ ] Фильтрация/сортировка серверные, выполняются до пагинации, `total` корректен.
- [ ] Null-date всегда в конце, порядок стабилен между страницами.
- [ ] URL восстанавливает состояние после F5/Back/Forward; изменение фильтра сбрасывает page.
- [ ] Date params не применяются вне ACCEPTED и не влияют на счётчики вкладок.
- [ ] EXPECTED не регрессировал: issueDate sorting и его русские labels сохранены.
- [ ] Optional «Автор сверки данных» в ACCEPTED показывает те же реальные данные.
- [ ] Нет N+1 запросов по сверкам/пользователям и нет внешних VetIS вызовов на list-read.
- [ ] На 390px нет горизонтальной прокрутки страницы; popover доступен клавиатурой.
- [ ] Storybook, frontend unit/typecheck/lint/build, backend tests и targeted e2e зелёные.
- [ ] ТЗ и код в `main`, контейнеры пересобраны и healthy.

## 8. Review Focus

- Не заменить прочерк запросом `GET /users/:id` из каждой строки.
- Не пересчитать историческую стоимость по текущему справочнику тарифов.
- Не назвать дату `ReceiptConfirmation.confirmed_at` датой сверки только потому, что значения часто близки.
- Не сортировать только текущую страницу в JavaScript.
- Не применить один набор подписей сортировки ко всем трём вкладкам.
- Не потерять q/result/date при изменении одного фильтра и не протащить accepted-only date в другую очередь.
- Не включить active date filter в stage totals, если счётчик означает общее количество очереди.
- Не считать пустую строку, null и денежный ноль одним состоянием.
- Не использовать timezone браузера вместо `Europe/Moscow`.
- Не копировать фильтры или стили из HTML-макета как независимую runtime-реализацию.
- Не закрыть задачу только unit-тестами: нужен реальный API/browser walkthrough после обновления контейнеров.
