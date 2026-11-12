# DR15 — login hover parity and server-side arrivals sorting (evidence)

Дата: 2026-11-12. Ветка: `feature/DR15-login-hover-arrivals-sort` (BASE main 98d9652).
Спецификация: `dorabotka/2026-11-12-login-hover-and-arrivals-sort.md` §1–9; решения R-DR15-1..5.

## 1. Hover кнопки «Войти» (§4, R-DR15-1)

- `frontend/src/features/identity/identity.css`: добавлен селектор
  `.vse-auth .app-button.primary:hover:not(:disabled)`, явно повторяющий базовые
  значения (тот же градиент `linear-gradient(135deg, var(--auth-teal), var(--auth-teal-dark))`,
  тот же `color: #fff`, та же тень `0 14px 28px #146c7328`; border-color = базовому).
  Общий hover рабочих кнопок (`.app-button.primary:hover` в `shared/ui/ui.css`)
  больше не меняет вид login-кнопки. Анимации/переходы не добавлены.
- Не тронуты: `:focus-visible` (кольцо фокуса), `:disabled`, `aria-busy`, ошибки форм,
  submit и переход после входа.
- Регрессия: `frontend/tests/e2e/login-hover.spec.ts` — два Playwright-теста
  против Storybook-истории `F03/LoginForm / Auth Screen` (`login-form.stories.tsx`,
  обёртка `.vse-auth vse-auth-page` + импорт `identity.css`/`ui.css`):
  1) computed styles (background/color/border/box-shadow/width/height) enabled-кнопки
     до и после реального `page.hover` идентичны; базовый фон — градиент, цвет — белый;
  2) Tab-фокус по-прежнему виден (outlineWidth ≠ 0) и submit выполняется
     (в истории показывается честный 401 «Неверный логин или пароль.»).
  Локальный прогон: **2 passed** (dev Storybook на 127.0.0.1:6006, без бэкенда).

## 2. Серверная сортировка EXPECTED (§5.2–5.3, R-DR15-2)

- `backend/src/modules/arrivals/router.py`: `GET /api/v1/arrivals` получил
  `sort: Literal["asc","desc"] | None = None`; недопустимое значение → честный 422 FastAPI.
- `backend/src/modules/arrivals/queries.py`: сортировка выполняется в SQL **до**
  `count/offset/limit` по выражению
  `incoming_documents.source_snapshot['vdDocument']['issueDate'] ->>` — это ровно
  значение колонки «Дата оформления ВСД»; НЕ `Party.created_at`, не `fetched_at`,
  не даты синхронизации/сверки/гашения.
- Порядок: `asc` — ранние даты первыми; `desc` (и отсутствие параметра — default
  сохранён) — поздние первыми. Tie-breaker при равных датах —
  `Party.created_at DESC, Party.id DESC`. Отсутствующая/некорректная дата → SQL
  `NULL`, явно `NULLS LAST` в обоих направлениях (детерминированное положение, без 500).
- Scope (`laboratory_id`), поиск (`q`), скрытые документы и queue-predicate не
  изменены; `total` — прежнее количество после scope/search/queue.
- OpenAPI/сгенерированный клиент: `frontend/src/shared/api/schema.d.ts`
  перегенерирован штатным `npm run gen:api` из `app.openapi()` бэкенда
  (`sort?: "asc" | "desc" | null`).

## 3. UI-фильтр «Сортировка» (§5.1/§6, R-DR15-3)

- `ArrivalsFilters.tsx`: только в EXPECTED (передаётся через `ArrivalsScreen`)
  поле `.arrivals-filter-field` с `label` «Сортировка» и `select#sort-order`,
  два точных варианта макета: `asc` «Сначала оформленные раньше»,
  `desc` «Сначала оформленные позже». В WORK/ACCEPTED контрол не выводится.
- `ArrivalsPage.tsx`: `Filters` расширен `sort` (по умолчанию `desc` = server
  default); URL-состояние персистентно (перезагрузка/возврат; недействительное
  значение из URL откатывается к `desc`; в URL пишется только не-default
  `sort=asc`, поэтому существующие маршруты/landing-URL не изменены);
  смена сортировки сбрасывает `page=1`; React Query key включает `filters`
  (с `sort`) — старый ответ не может заменить новый; `fetchArrivals` передаёт
  `sort` (недостающее значение = server default). Локальной пересортировки
  строк нет (`ExpectedArrivalsTable` рендерит `items.map` как есть).

## 4. Тесты (§7, R-DR15-4)

- Backend: `backend/tests/arrivals/test_dr15_sorting.py` — 9 тестов (§7.1–8):
  asc/desc по issueDate, default без параметра = desc, 422 на невалидное
  значение, сортировка до пагинации (21 запись, page 1/page 2), стабильный
  tie-breaker при равных датах, отсутствующая/некорректная дата не даёт 500,
  scope/search/total не меняются, sort key = JSONB-путь снимка.
- Frontend: `ArrivalsPage.test.tsx` +6 тестов (§7): select в EXPECTED с точными
  подписями; asc/desc меняют URL и уходят в API; смена сортировки сбрасывает
  page; порядок строк = порядок сервера (без локальной сортировки); в WORK
  select отсутствует; фокус/`sort=asc` из URL.
- Login UI: `login-hover.spec.ts` — computed-style hover-регрессия + фокус + submit.
- Storybook: `login-form.stories.tsx` — новая история `Auth Screen`
  (реальная оболочка /login); `arrivals.stories.tsx` — новые props `sort`
  у полных страниц. `npm run build-storybook` — успешно.

## 5. Прогон гейтов (на закоммиченном дереве)

- `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed!
- `uv run --frozen pytest backend/tests/arrivals backend/tests/identity -q` —
  **200 passed** (arrivals 97 + identity 103).
- Известные ранее (не относится к задаче, без изменений):
  `backend/tests/examinations/test_delete.py` — 2 упавших
  (`test_delete_http_204_and_unknown_202`, `test_concurrent_delete_and_disposal_preserve_the_disposal_fact`).
- Frontend (Node 26.13.0): `format:check` OK; `typecheck` OK;
  `lint` 0 errors (1 pre-existing warning в `use-catalog-context.ts`);
  `test -- --run` — **50 files / 301 passed**; `build` OK; `build-storybook` OK.
- Playwright: `login-hover` — **2 passed**.
- Не выполнялось (контроллер, см. R-DR15-5): пересборка docker-контейнеров,
  merge в main, полный e2e-набор против живого бэкенда (identity/arrivals
  e2e требуют seed + backend; выполнен только backend-free storybook-прогон).
  Живые VetIS write-вызовы не выполнялись; данные БД не менялись.

## 6. Ограничения сохранности

Пользователи/лаборатории/ВСД/партии/сверки/ВСЭ/пробы/отчёты/PostgreSQL volume —
не тронуты; миграций БД нет (сортировка read-time); `DESIGN.md`,
`dorabotka/`, `seed_identity.py`, `*.local.json` не изменялись; `git add -A`
не использовался.
