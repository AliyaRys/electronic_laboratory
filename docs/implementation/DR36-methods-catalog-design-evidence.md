# DR36 — дизайн справочника «Нормы исследований» по макету `directory-norms-edit`

Дата: 16.11.2026
ТЗ: `dorabotka/2026-11-16-methods-catalog-design-parity-directory-norms.md`
Ветка: `codex/methods-catalog-design` (worktree `C:\electronic_lab_dev-dr36`)

## Реализация

`MethodsEditorPage` (`frontend/src/features/catalogs/MethodsEditorPage.tsx`) переписан на
композицию макета §7–14 без изменения бизнес-логики DR28/DR31/DR35:

- одна белая секция `vse-catalog-section` (border 1px, radius 18px, padding 25px / 18px ≤800px)
  с канонической иконкой `directory-norms` и заголовком `h2` «Диапазоны нормы»;
- заголовок страницы: eyebrow «Редактирование справочника», `h1` «Нормы исследований» (30px/1.15),
  пояснение «Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ.»;
- категория «Мясо и мясопродукты» — одна спокойная строка (`vse-catalog-context-note`,
  `data-testid="methods-area-name"`), без технического контейнера;
- отдельного списка «Не настроено» и кнопки «Настроить» больше нет: ненастроенная числовая строка
  сразу содержит пустые «Норма от»/«Норма до» (§10.2); пустая строка не отправляется
  (`empty unset rows are never sent`) и не превращается в нулевой диапазон;
- качественные блоки (`QualitativeBlock`) по образцу «Проба варки»: квадратная кнопка `＋` 43×43
  (`.vse-catalog-sq`, secondary), строки вариантов `minmax(260px,1fr) 170px 43px` со select «Оценка»
  и квадратной `−` только для пользовательских вариантов; registry-варианты readonly, удаления
  лишены (§11.2);
- технические метаданные (включённость границ) и удаление нормы (FT-CAL-08, Dialog-подтверждение)
  сложены в раскрытие «Дополнительные настройки» / «Дополнительные действия» внутри строки/блока;
  «Источник: …», «Методика и версия», UUID и крупные кнопки «Удалить норму» с основной
  поверхности убраны (`NormRow`/`QualitativeBlock` больше не выводят `source`);
- текстовые исследования — спокойная строка `vse-catalog-text-row` в общей геометрии с пояснением
  «Результат вводится текстом; диапазон нормы не задаётся.» вместо жёлтой диагностики;
- loading-состояние: skeleton строк реального размера внутри секции (§15.1);
- sticky-панель `Отменить` / `Сохранить справочник` (§13): disabled без изменений, busy
  «Сохранение…», повторный submit недоступен;
- `Button` (`shared/ui/Button.tsx`) получил необязательный `ariaLabel` (доступное имя `＋`/`−`
  отличается от видимого символа); остальные варианты не изменились;
- MSW-фикстуры (`mocks/catalog-editor-handlers.ts`) получили read model `/methods/context`
  (полный реестр VSE-F18–F29, scope meat, активные правила) — только для Storybook/тестов,
  демо-числа макета не перенесены;
- Storybook: `editor-pages.stories.tsx` — истории `NormsWide`, `NormsParityDirectoryNormsEdit`
  (§18 сравнение с макетом), `NormsTablet` (768), `NormsNarrow` (390); `editor-parts.stories.tsx`
  обновлён (выражения раскрытий без «Методика и версия»).

## Измеренная геометрическая сверка с макетом (§20)

Playwright, одинаковые viewport; измерены `getComputedStyle` у рабочей страницы (Storybook)
и `directory-norms-edit.html`:

| Метрика | Макет 1440 | Приложение 1440 | Макет 390 | Приложение 390 |
| --- | --- | --- | --- | --- |
| h1 | 30px/1.15 | 30px/1.15 | ~27px | 27px (≤800px) |
| padding секции | 25px | 25px | 18px | 18px |
| radius секции | 18px | 18px | 18px | 18px |
| grid числовой строки | `…180px 180px` | `…180px 180px` (identical px) | 1fr | 1fr |
| высота поля | 43px | 43px | 43px | 43px |
| grid качественной строки | `…170px 43px` | `…170px 43px` (identical px) | 1fr | 1fr |
| кнопка `＋` | 43×43 | 43×43 | 43×43 | 43×43 |
| sticky-actions | bottom 18px, blur | bottom 18px, blur(12px) | 8px | 8px |
| горизонтальный overflow | нет | нет | нет | нет |

Полностраничные снимки: `docs/implementation/DR36-screenshots/`
(`norms-1440/1024/768/390.png` — рабочая страница, `mockup-*.png` — эталон, одинаковые viewport).

## Проверки

| Проверка | Результат |
| --- | --- |
| `npm.cmd --prefix frontend test --run src/features/catalogs` | 7 files / 51 tests passed |
| Полный frontend vitest | **62 files / 471 tests passed** |
| `npm.cmd --prefix frontend run typecheck` | exit 0 |
| `npm.cmd --prefix frontend run lint` | 0 errors (1 pre-existing warning `use-catalog-context.ts`, вне изменений DR36) |
| `npm.cmd --prefix frontend run build` | exit 0 |
| `npm.cmd run build-storybook` | exit 0 |
| e2e `catalogs.spec.ts` (реальный backend: pg 55441 / redis 56391 / uvicorn 8001 / vite 4173) | **3 passed**, включая новый `test_head_saves_first_norm_then_updates_it`: первая норма pH создаётся POST прямо из строки, затем редактируется и сохраняется PUT; значения подтверждаются read model |

## Not-run / ограничения

- Тесты §19 (HEAD без переключателя лаборатории, ADMIN/ANALYST разрешённые лаборатории, 390px
  overflow) покрыты существующими unit/e2e наборами (`use-catalog-context.test.tsx`,
  `catalogs.spec.ts`, browser measurements); отдельные новые тесты не добавлялись, так как эти
  сценарии уже защищены.
- Backend не изменён (read model DR31 отдаёт все нужные данные) — backend regression не запускался.
- `test:ui` общего каталога макетов не запускался: общие компоненты `components/` не затронуты
  (изменения только в React SPA).

## Состояния и честность

- 409: черновик сохраняется, свежая ревизия загружается, выбор «Сохранить моё значение» /
  «Взять значение сервера»; частичное сохранение — честная сводка над секцией (unit-тесты).
- Пустые границы не превращаются в нули; null остаётся null (тест `a null upper boundary stays
  empty and is sent as a string, never as 0`).
- Read-only роль: без mutation-контролов, страница не выглядит сломанной.
- Дозиметрическое исследование: одна карточка VSE-F29 (вариант 1 §10.4), без двух независимых норм.
