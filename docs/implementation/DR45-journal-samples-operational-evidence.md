# DR45 — Журнал ВСЭ, учёт проб, мясной контекст и операционные услуги: evidence

Ветка `codex/journal-samples-operational-fixes`, worktree `C:\electronic_lab_dev-dr45` (BASE main e2766f6). ТЗ скопировано из управляющего репозитория и закоммичено первым коммитом `docs: specify journal samples and operational fixes` (в main на момент базирования ТЗ отсутствовал — дублирования нет).

## RED-фаза (Task 1)

Коммит `test: pin DR45 journal, samples and service-fact defects (RED)` — 4 дефекта зафиксированы падающими тестами до реализации:

- `backend/tests/examinations/test_journal.py` — scoped read model журнала отсутствовал: GET /api/v1/examinations → 404 (6 тестов RED).
- `backend/tests/samples/test_reads.py` — `BalanceView/CollectionView/DisposalView` не имели `product_name` / `evsd_uuid` / `collected_by_name` / `actor_name` (AttributeError, 3 теста RED).
- `backend/tests/reporting/test_operational.py::test_confirmed_receipt_persists_service_facts` — реальный поток «сохранение сверки без services → confirm ACCEPT_ALL» оставлял `services=[]`, operational давал 0/0 (RED).

Frontend-дефекты закрыты тестами в итоговых файлах: журнал по умолчанию COMPLETED (раньше WAITING, стр. 40 теста), шапка — статичное «Мясо и мясопродукты» без кнопки/listbox/milk и нормализация `milk→meat` в store (`AppShell.test.tsx`, `SwitchContext.test.tsx`).

## Реализация

### Task 2 — backend журнал (§2)

- Новый `backend/src/modules/examinations/journal.py`: `ExaminationJournalItem` + `journal_page` (scoped, статус WAITING/COMPLETED, q по номеру/клейму/UUID ВСД/хозяйству, outcome, specialist_id, полусегмент `occurred_[from,to)`, sort asc/desc по `first_completed_at`/`created_at` с tie-breaker `id`, пагинация 20, все display-поля join'ами — без N+1).
- `GET /api/v1/examinations` (router, `examination:read`, hide_foreign): plain URL → COMPLETED по умолчанию; `?status=WAITING` — явный выбор. Ответ `Page[...]`.
- Тесты: `test_journal.py` — 6 passed (статусы, 422, foreign 404, фильтры/сортировка, страница 2 без пересечений, ≤3 statement на страницу).

### Task 4 — человекочитаемые проекции проб (§4)

- `samples/schemas.py`: `BalanceView.product_name`, `CollectionView.{product_name,evsd_uuid,collected_by_name}`, `DisposalView.{product_name,actor_name}` (write payload и проверки ревизий не тронуты).
- `samples/queries.py`: balance — `func.min(имя из снапшота)` по группе; collections — join Party→IncomingDocument→User одним запросом; disposal_page — имя из коллекций утилизации + ФИО актёра одним запросом. Decimal остаётся Decimal (строки без float).
- История утилизаций больше не зависит от текущей страницы коллекций (имя приходит с сервера).

### Task 7 — сервер — владелец фактов услуг (§6)

- `arrivals/confirmation.py`: при заморозке CONFIRMED (ACCEPT_ALL/PARTIAL) `confirm_receipt` атомарно добавляет факты `{code, performed: true}` для PRODUCT_IDENTIFICATION и TRANSPORT_INSPECTION (идемпотентно, без дубликатов); RETURN_ALL/RETURNED фактов не получает.
- Миграция `0022_journal_service_facts` (down_revision `0020_dr35_specialist`): идемпотентный backfill CONFIRMED+completed_at строк, RETURNED не обогащается, downgrade без удаления фактов. Тест `test_backfill_0022_...` прогоняет backfill дважды.
- `operational_query` считает сохранённые boolean-факты (без изменений); FAIR при 0 ₽ считается.
- `frontend/src/features/arrivals/ReconciliationForm.tsx`: клиентский `services: []` удалён из payload (сервер — владелец фактов).

### Task 6 — мясной контекст шапки (§5)

- `components/shell/AppHeader.js`: опция `productStatic` — статичный блок «Мясо и мясопродукты» (не кнопка: нет aria-haspopup/aria-expanded/listbox/caret/milk); нормализация localStorage `milk→meat` при чтении и в `setProduct`. Интерактивный переключатель сохранён (`productStatic: false`) для Storybook и молочных макетов; README дополнен.
- React: `AppHeader.tsx` (`productStatic`, `StaticProductContext`), `AppShell.tsx` передаёт `productStatic` в work-режиме; `entities/session/context.ts::setProductType` нормализует `milk→meat`. Молочные stories не удалены; добавлены stories `WorkStaticMeat` (React) и `ProductStatic` (JS).
- SVG/геометрия AppHeader не менялись.

### Task 3 — журнал UI (§1/§3) и Task 5 — учёт проб (§3)

- `ExaminationJournalPage.tsx`: собственный scoped API (`fetchJournal`), default COMPLETED, URL-state (status/q/outcome/specialist/from/to/sort/page), страница/фильтры сбрасывают page, «Дата и время внесения»/«Хозяйство»/«UUID ВСД»/«Врач»/итог-бейдж/ссылка «Просмотр», Московское время `dd.mm.yyyy hh:mm`, период как `occurred_from` 00:00+03 и исключающий `occurred_to` следующего дня, loading/empty/error/retry. Никаких UUID партий/пользователей.
- `SampleAccountingPage` и компоненты `Balances/Collections/DisposalHistory`: человекочитаемые колонки (имя продукта, UUID ВСД, ФИО), роль-матрица сохранена (VET/HEAD утилизация, ANALYST read-only, VET без 5-ВЕТ), период истории не влияет на остатки.

## Gates

- Backend: `uv run --frozen pytest backend` — **973 passed** (полная расширенная сюита; 13:54). `uv run --frozen ruff check backend` — clean.
- Frontend: `format:check` clean (после `prettier --write` моих файлов), `lint` clean, `typecheck` clean, `vitest run` — **566 passed**, `build` ok, `build-storybook` ok (корневой `npm.cmd run build-storybook`).
- schema.d.ts перегенерирован штатным пайплайном gen:api (openapi.ts по экспортированному `app.openapi()` — локальный файл-хелпер удалён, в коммит не попал).
- Playwright e2e: **not-run** — стек требует `tests/e2e/identity-seed.local.json` и живого окружения (backend+DB), которых нет офлайн; honesty note.
- Применение миграции 0022 на живой БД, docker compose up и post-merge smoke — зона контроллера (Task 8), не выполнялись.

## Commits (порядок)

1. `docs: specify journal samples and operational fixes`
2. `test: pin DR45 journal, samples and service-fact defects (RED)`
3. `feat(examinations): add scoped journal read model`
4. `fix(samples): expose human-readable accounting views`
5. `fix(reporting): persist reconciliation service facts`
6. `style: ruff autofix backend`
7. `feat(ui): journal, sample accounting redesign and single-product header`
8. `chore: bump CURRENT_SCHEMA_REVISION to 0022`

## Concerns

- down_revision миграции 0022 = `0020_dr35_specialist` (голова на момент базирования). При merge с DR43 (0021) контроллеру нужно перелинковать цепочку.
- Фильтр «Врач» в журнале наполняется из загруженной страницы журнала (справочник специалистов scoped по лаборатории отдельным эндпоинтом не вводился, чтобы не дублировать identity API).
- Журнал-фильтры: итог «Условно-пригодно» из макета не предлагается (серверный контракт имеет только FIT/UNFIT) — фиктивная опция не создавалась.
