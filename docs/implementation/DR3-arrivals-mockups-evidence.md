# DR3 — очереди поступлений по утверждённым макетам: подтверждение реализации

Ветка: `feature/DR3-arrivals-mockups`
Спецификация: `dorabotka/2026-11-10-arrivals-pages-match-mockups.md` (не коммитится)
Дата: 2026-11-10

## Что сделано

Экраны очередей EXPECTED / WORK / ACCEPTED (`/labs/:labId/arrivals`) приведены
к утверждённым HTML-макетам. Реакция сервера, контракты запросов и предметные
данные не изменены; недостающие возможности сервера перечислены ниже как
API-gaps, бэкенд не тронут.

## Переиспользование и расширение (без копий)

- `components/icons/VseIcon.js` — канонический реестр иконок пополнен
  `arrival-plus`, `arrival-reconcile`, `columns-grid` (+ README,
  `ArrivalsIcons.stories.js`, список `listArrivalIcons`); адаптер
  `frontend/src/shared/ui/legacy-icons.ts` дополнен теми же именами. Локальные
  SVG в экранах, JS и stories не рисуются.
- `frontend/src/shared/ui/DataTable.tsx` — аддитивное расширение: рендер ячейки
  `node`, `className`/`actions` строки, `icon`/`tone` у rowAction, вариант
  `variant="arrivals"`, `visuallyHiddenCaption`. Обычные таблицы не изменены
  (`title`-подсказки ставятся только в варианте `arrivals`).
- Шапка — `components/shell/AppHeader.js`, без локальных копий.
- Новая композиция `ArrivalsScreen.tsx` используется и маршрутом
  (`pages/ArrivalsPage.tsx`), и Storybook — один и тот же React-код и стили.

## Изменённые файлы

- `frontend/src/features/arrivals/`: `ArrivalsScreen.tsx`, `ArrivalTables.tsx`
  (три таблицы этапов), `ArrivalsFilters.tsx` (+ `ColumnsChooser`),
  `ArrivalsPagination.tsx`, `StageTabs.tsx`, `arrivals.css`, `api.ts`
  (STAGE_LABELS/DESCRIPTIONS/EMPTY_TEXTS), `arrivals.stories.tsx`;
  удалены `ArrivalList.tsx`, его тест и story.
- `frontend/src/pages/ArrivalsPage.tsx` — запросы/URL/мутации/синхронизация.
- `frontend/src/shared/ui/DataTable.tsx`, `legacy-icons.ts`, `icon.stories.tsx`.
- `components/icons/VseIcon.js`, `README.md`, `ArrivalsIcons.stories.js` (новый).
- `frontend/tests/e2e/arrivals.spec.ts`, `frontend/tests/e2e/vetis-read.spec.ts`
  (ANALYST: кнопки синхронизации нет — ожидание изменено со «disabled» на
  «отсутствует»).
- `docs/implementation/evidence/DR-arrivals-action-*.png` — перезаписаны при
  прогоне `test:e2e`: спецификация сохраняет их безусловно, вид строк изменился.

## Исправления по макетам

- Рабочая область 1180px (`.arrivals-shell`), не общий `app-main`.
- Пилюли-вкладки 40px / radius 999; подписи «Ожидаемые / В работе /
  Завершенные» со счётчиками из отдельных запросов (реальные total).
- Панель фильтров: radius 16, тень `0 8px 24px rgba(31,90,91,.03)`; поле
  поиска 41px / radius 9 / граница `#cbdadb`, явная кнопка очистки, Enter и
  debounce 300ms; select результата — только на ACCEPTED с честными подписями
  «Ожидание / Возврат / Завершено»; кнопки «Найти», фильтр дат и select
  сортировки не рисуются (нет в API — см. gaps).
- Таблица: заголовок 54px на `#f7faf9`, строки 68px; иконные действия
  40×40 (radius 11), компактные 36×36 (radius 10) на ACCEPTED.
- EXPECTED: корзина «Скрыть поступление из очереди» (`admin-delete`) и ссылка
  «Перейти к сверке данных» (`arrival-reconcile`).
- WORK: бирюзовый плюс «Создать ВСЭ» на маршрут
  `/labs/:labId/arrivals/:partyId/examination/new`; черновики — только в
  stories через `draftPartyIds` (серая строка `app-row-draft` + карандаш
  «Продолжить создание ВСЭ»).
- ACCEPTED: «глаз» 36×36 — только при наличии `examination_id`; выбор колонок
  (сессионный, опциональные checkAuthor / vseAuthor / vseNumber).
- Пагинация с номерами страниц и стрелками `chevron-left/right`.
- Компактная вторичная кнопка «Обновить» в строке заголовка — только VET/HEAD;
  у ANALYST кнопки нет; честная строка статуса синхронизации.
- Честные данные: стоимость, автор сверки, статус ВСД, результат ВСЭ и срок
  — «—» (поля в read-модели отсутствуют); никаких GUID и клиентских вычислений.

## Численная проверка геометрии (§21)

Playwright-проверка по Storybook-страницам (та же композиция и стили), обе
ширины 1440 и 390, все три этапа:

| Параметр | Макет | Факт |
|---|---|---|
| shell max-width | 1180px | 1180px |
| вкладка | ≥40px, r999 | 40px, 999px |
| панель фильтров | r16, тень 0 8px 24px rgba(31,90,91,.03) | то же |
| поле поиска | 41px, r9, #cbdadb | 41px, 9px, rgb(203,218,219) |
| thead | 54px, #f7faf9 | 54px, rgb(247,250,249) |
| td | ~68px | 68px |
| иконное действие | 40×40 r11; компакт 36×36 r10 | совпадает |
| горизонтальный скролл документа | нет | docOverflowX = 0 |

Временный скрипт проверки удалён, в коммит не входит.

## Запуски проверок (все exit 0, на финальном дереве)

- `npm.cmd run format:check`
- `npm.cmd run lint`
- `npm.cmd run typecheck`
- `npm.cmd run test` (vitest, 217 passed)
- `npm.cmd run build-storybook`
- `npm.cmd run build`
- `npm.cmd run test:e2e` (все спецификации)

## Скриншоты

- `docs/implementation/evidence/DR3-arrivals-expected-1440.png` / `-390.png`
- `docs/implementation/evidence/DR3-arrivals-work-1440.png` / `-390.png`
- `docs/implementation/evidence/DR3-arrivals-accepted-1440.png` / `-390.png`

## Бэкенд

`git diff --stat` по коммиту не содержит путей backend/ — изменения только во
фронтенде, реестре иконок и документации.

## API-gaps (сервер не поддерживает — не имитируем)

1. Нет параметра сортировки списка — не рисуется select сортировки.
2. Нет date_from/date_to — не рисуется фильтр дат.
3. В IncomingView нет стоимости сверки, автора сверки, статуса ВСД
   (человекочитаемого) и результата ВСЭ — в этих колонках «—».
4. В read-модели WORK нет признака черновика ВСЭ — черновик только в stories.
5. Нет человекочитаемого статуса ВетИС в read-модели списка.
6. Нет API скачивания/печати заключения и «Max».
7. Название лаборатории не в read-модели — подзаголовок сформулирован без неё.

## Остающиеся отклонения от макетов

- Только вызванные отсутствием данных/API (колонки «—», без фильтров дат и
  сортировки); визуальная геометрия соответствует макетам (см. таблицу выше).
