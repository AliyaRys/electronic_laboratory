# Evidence: DR39 — метаданные сверки и фильтры очередей поступлений

Ветка: `codex/arrivals-reconciliation-metadata-filters` (база `main` @ 93c1d53).
ТЗ: `dorabotka/2026-11-16-arrivals-work-accepted-reconciliation-metadata-filters.md`.

Задачи 1–7 выполнены в этой же ветке ранее в этой сессии работы (коммиты ниже;
RED-коммит тестов предшествует каждому feat-коммиту, порядок виден в истории git).

## Коммиты

| Коммит | Сообщение | Задача |
|---|---|---|
| 070023e | test: cover reconciliation metadata in arrivals list | 1 |
| 90deca3 | feat: expose frozen reconciliation summary in arrivals | 2 |
| 285fac3 | feat: sort and filter arrivals by reconciliation date | 3 |
| d43f48a | chore: regenerate arrivals reconciliation contract | 4 |
| 7080e4e | fix: show reconciliation cost author and completion date | 5 |
| 77aa9d2 | feat: add queue-aware arrivals sorting | 6 |
| c3c58aa | feat: filter completed arrivals by reconciliation date | 7 |
| 50ca7d2 | test: verify reconciliation metadata and arrival filters | 8 |

## Задача 8 — targeted e2e и исправления

`frontend/tests/e2e/arrivals.spec.ts` — добавлены 5 тестов ТЗ DR39. В ходе
первого прогона исправлены дефекты самого спека (компиляция typecheck нашла
нес объявленную `errors`; strict-mode конфликты локаторов «Дата» radio/textbox;
в ACCEPTED нет колонки стоимости — assertion заменён на дату/автора; таблицы не
показывают номер документа — assertions переведены на «говядина»).

Финальный прогон (playwright 1.65, Chrome, dev-server 4173):

```
npm.cmd --prefix frontend run test:e2e -- arrivals.spec.ts
14 passed, 2 failed (pre-existing)
```

5 тестов DR39 — все passed:

- `WORK shows the real frozen cost, author and completed date; sorting is server order with URL and F5`
- `ACCEPTED: apply one день, a range and сбросить; URL and rows survive F5`
- `the date never leaves ACCEPTED: other queues and tab counters stay clean`
- `ACCEPTED date filter works on 390 px with the keyboard`
- `an empty result and a network error keep the honest states`

Pre-existing failures (воспроизведены на `main` тем же набором, к DR39 не
относятся, не чинились):

- `control screenshots of the three stages, wide and narrow, no document overflow`
- `the accepted stage keeps the column chooser keyboard-accessible`

Обе падают на `getByText('RU016:260812-005102')` — таблицы очередей показывают
«UUID ВСД», а не номер документа; это расхождение спека с реализацией возникло
до DR39 (проверено на main: cf7bd86 — те же 2 failed).

## Финальные проверки (Task 9, чистое состояние ветки)

| Команда | Результат |
|---|---|
| `uv run --frozen pytest backend/tests/arrivals/ -q` | 160 passed |
| `uv run --frozen ruff check .` | All checks passed |
| `npm.cmd --prefix frontend test` (vitest, все файлы) | 61 files / 457 tests passed |
| `npm.cmd --prefix frontend run typecheck` | ok (0 errors) |
| `npm.cmd --prefix frontend run lint` | 0 errors, 1 pre-existing warning (useMemo deps в существующем коде) |
| `npm.cmd --prefix frontend run build` | ok (предупреждение о размере чанков — существующее) |
| `npm.cmd --prefix frontend run build-storybook` | ok |
| `npm.cmd --prefix frontend run test:e2e -- arrivals.spec.ts` | 14 passed / 2 pre-existing failed |

## Честные not-run

- Полный e2e-набор за пределами `arrivals.spec.ts` не запускался (нужен локальный
  `identity-seed.local.json`, отсутствует в worktree); targeted arrivals-набор
  выполнен полностью.
- Merge в `main`, push и пересборка Docker-контейнеров — по плану выполняет
  контроллер, в этой ветке не выполнялись.
- Миграции БД не потребовались (новых таблиц/колонок нет).
