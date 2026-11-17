# DR44 «Просмотр сохранённой ВСЭ и данные завершённых поступлений» — evidence Task 7

Ветка: `codex/examination-view-completed-arrivals`, worktree `C:\electronic_lab_dev-dr44`.
Коммиты Tasks 1–6: `81ea972` (RED-тесты) … `e0f7b25` (view page = vse-view).
Коммиты Task 7 см. в конце.

## 1. E2E (Playwright) — RUN

Стек доступен: Playwright 1.65.0 (`frontend/node_modules`), Chromium 1254 в
`%LOCALAPPDATA%\ms-playwright`; config `frontend/playwright.config.ts`
(webServer: vite dev 4173 + storybook 6006). Node: v26.13.0
(`C:\Users\Алия\AppData\Local\Temp\opencode\node26\node-v26.13.0-win-x64`).

### Новые DR44-тесты (Task 7, шаги 1–3) — PASS

Команда (из `frontend/`):

```
npx playwright test tests/e2e/arrivals.spec.ts tests/e2e/examinations.spec.ts -g DR44 --reporter=list
```

Результат: **4 passed** (после `prettier --write` повторно 4 passed):

- `arrivals › DR44: the FIT row carries all five values and opens the saved card, then returns to ACCEPTED` —
  ВСЭ «Пригодно», «480,00 ₽», «с 01.11.2026 по 10.11.2026», автор ВСЭ, «№ 154/2026»;
  переход по «Открыть карточку ВСЭ» → просмотр карточки → возврат в ACCEPTED, значения строки сохранены.
- `arrivals › DR44: UNFIT shows «Непригодно» in the row; direction and reason live only in the card` —
  в таблице только «Непригодно» (нет «На утилизацию»/причины), направление и причина — только в карточке.
- `arrivals › DR44: a WAITING card fabricates no outcome and stays out of ACCEPTED` —
  ACCEPTED честно пуст, карточка WAITING показывает «Итог не указан…», без «Пригодно · …».
- `examinations › DR44: the saved COMPLETED FIT view shows sections, researches, sample, outcome, specialist and frozen pricing` —
  eyebrow «Просмотр записи», h1 «ВСЭ № 12/2026», шесть секций по порядку, русские названия
  исследований (нет «Показатель <uuid>»), значение «4,5 °C», проба 06.11.2026 / 12,6,
  «Пригодно · В реализацию без ограничений», специалист, дата первого завершения (мск), frozen «255,00 ₽», pageerror[] = [].

### Полный прогон двух spec'ов — 19 passed / 13 failed, все 13 падения pre-existing

```
npx playwright test tests/e2e/arrivals.spec.ts tests/e2e/examinations.spec.ts --reporter=list
```

Проверено на чистом HEAD (`git stash` → прогон → `git stash pop`): те же тесты падают
идентично **без** моих изменений, включая:

- тесты создания/редактирования (`REUSE is the default…`, `a fresh NEW sample…`, `a COMPLETED create…`,
  `a submit without…`, `a 409 keeps…`, `a dirty form…`, `narrow width…`, `DR30 design parity…`) —
  страница создания запрашивает `GET /api/v1/examinations/parties/:id/form`, который в spec
  не замокан; запрос уходит в vite-прокси на реальный бэкенд (`ECONNREFUSED 127.0.0.1:8000`,
  бэкенд в среде не поднят) и форма не открывается;
- `control screenshots…` / `the accepted stage keeps the column chooser…` / `ACCEPTED: apply one день…` —
  fixture расхождение с реализацией страницы (строки mockStageRows не отображаются;
  strict-mode «06.11.2026» совпадает с кнопкой фильтра и ссылкой строки);
- `a WAITING card shows no conclusion…` / `deleting the card makes the party creatable again…` —
  заголовок «Карточка ВСЭ № …» заменён в Task 6 на «Просмотр записи» + «ВСЭ № …» (vse-view), spec не обновлён.

edit/delete/late completion **не регрессировали от DR44**: в этих же прогонах
`the delete dialog keeps the safe cancel focused and refreshes after a 409` — ok,
`the journal shows only real cards…` — ok, `deleting the card…` падает по той же
pre-existing причине (отсутствие мока `/form` + старый заголовок), а не из-за DR44.

Найденные для ревью баги/долги (не исправлял — вне Task 7):

1. `frontend/tests/e2e/examinations.spec.ts` fixtures создаются без мока
   `examinations/parties/:id/form` (DR35) и без `view.sample` (DR44 Task 3) —
   зафиксировано добавлением `sample` в fixture `card()` (test-only, API уже его отдаёт).
2. Устаревшие ожидания заголовка «Карточка ВСЭ № …» в e2e после Task 6 (см. выше).
3. Строгий селектор в `ACCEPTED: apply one день…` совпадает с двумя узлами.

## 2. Backend

```
uv run --frozen pytest backend/tests/arrivals backend/tests/examinations -q
→ 251 passed, 215 warnings (3:03)
uv run --frozen ruff check backend/src backend/tests → All checks passed!
uv run --frozen ruff format --check backend/src backend/tests
→ 43 files would be reformatted (identity/, vetis/, arrivals/, tests…)
```

`ruff check` — PASS. `ruff format --check` репозиторий-wide не проходит, в том числе
на файлах, которые ветка DR44 не меняла (identity/, vetis/ — `git diff e2766f6..HEAD -- backend`
не содержит их). Это pre-existing несоответствие форматтера (версия/профиль) — не исправлял,
т.к. Task 7 запрещает изменения вне scope; для ревью.

## 3. Frontend gates (Node v26.13.0)

| Команда | Результат |
|---|---|
| `npm run format:check` | PASS (после `prettier --write` двух изменённых spec'ов) |
| `npm run lint` (eslint) | PASS |
| `npm run typecheck` (tsc --noEmit) | PASS |
| `npm run test` (vitest) | PASS: 71 files, 587 tests |
| `npm run build` (tsc + vite) | PASS (chunk >500 kB warning — pre-existing) |
| `npm run build-storybook` | PASS (storybook-static собран) |

## 4. RED-фазы Tasks 1–6 (по diff/коммитам)

- **Task 1 (`81ea972 test:`)** — только тесты: `backend/tests/arrivals/test_examination_summary.py`
  (223 строки: FIT-сводка, номер, frozen specialist_name, pricing, combined_total; 0.00+0.00=0.00;
  отсутствующий/corrupt snapshot → null; разные валюты → null; legacy fallback имени) +
  `ArrivalTables.test.tsx` (+122 строки: «Пригодно», сумма, срок, специалист вместо жёстких прочерков;
  единая/интервал/informal/отсутствие expiry). Красные до `dc99f24`.
- **Task 2 (`dc99f24`)** — RED → GREEN в `test_examination_summary.py` (+87/-…) при добавлении
  `ExaminationSummary`, bulk read, Decimal-суммы, fallback.
- **Task 3 (`8cfaa7c`)** — RED: `backend/tests/examinations/test_create.py` +38 (linked sample
  в `GET /examinations/:id`); GREEN реализацией `ExaminationSampleView` (join).
- **Task 4 (`b648b2c`)** — RED-компонентные тесты `HelpTooltip.test.tsx` (53 строки: hover, focus,
  Escape, aria-describedby, accessible name, закрытое состояние) + обновлённые ожидания
  `ArrivalTables.test.tsx`/`DataTable`/stories; GREEN реализацией `headerNode`, `HelpTooltip`,
  иконки вопроса (VseIcon + legacy-icons) и заполнения колонок.
- **Task 5 (`fd867f2`)** — RED: `SavedResearchResults.test.tsx` (189 строк: BOOLEAN/DECIMAL/ENUM/TEXT/
  DOSIMETRY, otherText, findings, required tone, unknown indicator «Исследование»+код, без «Показатель <uuid>»)
  и `SavedPricingTable.test.tsx` (52 строки: строки/норма/оценки/итог/0,00 ₽/повреждённый snapshot).
- **Task 6 (`e0f7b25`)** — RED: `ExaminationViewPage.test.tsx` +93 (шесть секций, sample, итог,
  специалист, frozen total, WAITING без фабрикации итога и с отдельным late-completion).

## 5. Not-run / ограничения

- **Docker Compose пересборка контейнеров, merge в `main`, push, финальный browser smoke на
  http://127.0.0.1:8080** — NOT RUN: Task 7 в рамках SDD-инструкции ограничен шагами e2e+gates+evidence
  (merge/push/контейнеры запрещены инструкцией «НЕ мержите, НЕ пушите»); остаётся на finishing-этап.
- **Real-API e2e leg** — NOT RUN: реальный бэкенд/VetIS в среде недоступен (см. ECONNREFUSED выше);
  e2e используют MSW-style route mocks, как и весь существующий спектр.
- **Storybook-скриншоты новых состояний** — компонентные stories добавлены в Tasks 4–5, целевой
  визуальный скриншот-run не выполнялся; cat. build-storybook PASS.
- **`ruff format`** — не приведён к репозиторий-wide консистентности (см. §2, pre-existing).

## 6. Коммиты Task 7

- `test: cover DR44 saved-view and completed-arrivals e2e` — e2e additions (arrivals/examinations spec).
- `docs: DR44 spec and evidence` — ТЗ `dorabotka/2026-11-17-examination-view-and-completed-arrivals-data.md`
  (в ветке отсутствовало) + этот файл.
