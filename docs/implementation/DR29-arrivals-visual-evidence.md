# DR29 — arrivals toolbar, row-action focus and dialog stacking (visual fixes)

Дата: 2026-11-13 · Ветка: `feature/DR29-arrivals-visual-fixes` (worktree
`C:\electronic_lab_dev-dr29`, base main 603947c). ТЗ:
`dorabotka/2026-11-13-arrivals-toolbar-delete-dialog-visual-fixes.md`
(§1–9, §9 = gate). Бэкенд, docker, seed и живые вызовы VetIS не затронуты.

## Изменения

- `frontend/src/features/arrivals/ArrivalsScreen.tsx` — статус
  «Автообновление из ВетИС каждые 15 минут» перенесён ВНУТРЬ группы
  `.arrivals-sync`, непосредственно НАД кнопкой «Обновить» (единая композиция,
  один источник текста `syncStatus`); вне группы остаётся fallback-абзац только
  когда кнопки нет (не бывает на реальном маршруте).
- `frontend/src/pages/ArrivalsPage.tsx` — страница передаёт только `Button`
  (label/busy/busyLabel/`runSync()`/disabled без изменений); обёртку группы
  рендерит общий `ArrivalsScreen`. Бизнес-логика sync/polling/hide не изменена.
- `frontend/src/features/arrivals/arrivals.css`:
  - `.arrivals-sync` — колонка, `align-items: stretch`; статус
    (`.arrivals-sync .arrivals-sync-status`) участвует в intrinsic-размере с
    `max-width: 0` и заполняет контейнер через `min-width: 100%` → ширина
    группы равна ширине кнопки, правый край текста = правому краю кнопки,
    длинный статус переносится внутри этой ширины (≤2 строк), страница не
    расширяется. ≤800px — `text-align: left`, группа под заголовком
    (существующая сетка).
  - DR29 §5.1: hover/focus-подсветка только на `.arrivals-icon-action.danger`;
    явные правила гарантируют, что `.app-table-row-actions`, соседняя ссылка
    «Сверить» и sticky action cell не получают background/border/outline при
    фокусе/наведении на дочернюю кнопку; глобальный `:focus-visible` ring
    сохранён. Иконка и 40×40 touch target, aria-label/title/`onHide` — без
    изменений.
  - Заголовочный блок: отдельный статус-абзац удалён из-под `title-row`;
    подзаголовок EXPECTED «Транспортные эВСД…» остаётся на прежнем малом
    интервале (`margin: 7px 0 0`); описания WORK/ACCEPTED не менялись.
- `frontend/src/shared/ui/ui.css` (общий слой для ВСЕХ диалогов):
  - `.app-dialog-overlay` → `z-index: 1000` (выше страницы и AppHeader 100/120,
    поповеров 30/40, sticky action cells 5; ниже карточки);
  - `.app-dialog` → `z-index: 1001` (над overlay, карточка не затемняется).
  Значения централизованы и задокументированы рядом с селектором; `!important`
  не добавлялся; отдельного arrivals-исключения нет (в `arrivals.css`
  `app-dialog` отсутствует — проверено unit-тестом). Radix focus trap / Escape
  / возврат фокуса сохранены.

## Гейты (все выполнены в worktree)

| Гейт | Результат |
|---|---|
| `npm run format:check` | passed |
| `npm run lint` | 0 errors; 1 pre-existing warning `use-catalog-context.ts:340` (каталоги — вне зоны DR29, файл не менялся) |
| `npm run typecheck` | passed |
| `npm run test -- --run` | 396 passed / 0 failed (57 файлов) |
| `npm run build-storybook` | passed |
| `npm run build` | passed |
| `npm run test:e2e` | route-mocked спеки: 60 passed / 5 failed — все 5 отказов воспроизводятся на чистом main теми же тестами (pre-existing, см. ниже) |

Pre-existing e2e failures (проверено на main `C:\electronic_lab_dev`, тот же
код тестов): `arrivals.spec` «control screenshots…» и «column chooser
keyboard-accessible» (фикстура `mockStageRows` не даёт документ в таблице),
`examinations.spec` ×2 (`RU016:260807-002914` не найден), `vetis-read.spec`
«a failed run shows…». Спеки, требующие `identity-seed.local.json` и живого
бэкенда (`catalogs*`, `identity`, `dr5-real-browser`), в worktree не запускались
— локальные seed-файлы (`*.local.json`) по ограничениям задачи не переносились;
Docker-окружение — зона контроллера.

## Новые тесты

- Unit/component (`ArrivalsScreen.test.tsx`, DR29 §7.1–4, 6/8 частично):
  статус внутри группы над кнопкой и единственный; retry/busy длинный текст с
  `role="status"`; без кнопки группы/подсказки нет; EXPECTED-подзаголовок
  под заголовком; focus не добавляет классов группе; контракт stacking
  ui.css (overlay 1000 / content 1001, без `!important`, без arrivals-локальных
  исключений).
- `ArrivalsPage.test.tsx` (DR29 §7.5, 7): delete открывает только Dialog —
  без навигации, без DELETE до подтверждения; Escape и «Отмена» возвращают
  фокус на кнопку скрытия.
- Storybook (`arrivals.stories.tsx`): страница обновления (busy + длинный
  retry-статус), «Действия строки / focus на скрытии», «Диалог скрытия /
  открыт над таблицей»; 390px-история существовала и сохранена.
- e2e (`tests/e2e/arrivals.spec.ts`, DR29): геометрия sync-группы
  (правый край текста = правый край кнопки, ширина ≤ ширины кнопки,
  без overflow страницы) на 1440/1024/800/390 и при 200% zoom (viewport 720);
  busy-состояние меняет только текст; focus/hover-подсветка только на
  danger-кнопке (computed styles контейнера/соседа); Dialog поверх overlay
  (overlay 1000 < card 1001), фокус на «Отмена», Escape возвращает фокус.

Скриншоты: `docs/implementation/evidence/a01-dr29-sync-{1440,800,390}.png`,
`docs/implementation/evidence/a01-dr29-dialog-1440.png` (копии из
`frontend/test-results`, Chrome, реальный маршрут `/labs/:id/arrivals`).

## Проверка других диалогов (регрессия общего слоя)

Единый z-index-фикс применён ко всем `Dialog`/Radix-диалогам без локальных
исключений. Регрессия пройдена: Dialog.test (3), DisposalDialog,
BulkPriceDialog, DeleteDialog в unit-прогоне; e2e shell
(`test_dialog_focus_and_escape`), examinations (диалоги удаления), samples
(disposal dialog), documents/reports — все passed. Stories каталогов не
пересобирались локально (другой агент ведёт каталоги); сборка Storybook
(весь каталог) прошла успешно.
