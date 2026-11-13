# DR24 — evidence: reconciliation controls, logo, draft state and quantity display

Задача: `dorabotka/2026-11-13-reconciliation-controls-logo-drafts-quantities.md` (§1–11),
вердикты R-DR24-1…7 в `.superpowers/sdd/2026-11-13-rec-controls-quantities/progress.md`.
Ветка: `feature/DR24-rec-controls-quantities` (worktree `C:\electronic_lab_dev-dr24`,
BASE main = 104a200, включает DR23).

## Изменения

1. **Раскладка карточек сравнения (§3.1/§4, R-DR24-1).** Геометрия уже была
   макетной (`reconciliation.css`: grid `minmax(0,1fr) 40px 40px`, кнопки 40×40,
   focus-visible через `:has(input:focus-visible)`, состояние = фон + иконка +
   aria-label + live-текст). Проверено и закреплено тестами: значение и кнопки в
   одной строке (соседние grid-элементы), кнопки не переносятся под значение и не
   выталкиваются за карточку на 390 px (без горизонтального скролла документа),
   клавиатура и radio-семантика сохранены.
2. **Логотип (§3.2, R-DR24-2).** `mercury-logo.webp` скопирован в
   `frontend/public/mercury-logo.webp` (попадает в Vite/Docker build — проверено
   наличием в `dist/`); разметка бейджа `<img src="/mercury-logo.webp" alt=""><span>Меркурий</span>`;
   CSS мокапа (22×22, скругление 50%, object-fit cover) вместо прежнего
   декоративного кружка.
3. **Черновик-семантика (§3.3/§7, R-DR24-3).** Подтверждено существующей
   реализацией (`initialValues` → нейтральные `matches=null/actual=""/reason=""`;
   запись только через PUT «Сохранить сверку»; `useCommand` не пишет в query cache;
   `onSaved` публикует только успешный ответ сервера; `useDirtyGuard` только
   предупреждает). Никакого autosave: grep по `localStorage|sessionStorage|beforeunload`
   пуст. Существующие сохранённые строки сверок не тронуты (изменений бэкенда нет).
4. **Поля участников (§3.4, R-DR24-4).** `comparedFields` теперь ВСЕГДА выдаёт
   CHK-F05/F06/F07/F08 как карточки сравнения: resolved имя (SOURCE_XML/VETIS_LOOKUP)
   → активные controls; PENDING → «Уточняем названия организаций…», ERROR →
   «Название временно недоступно», MISSING → «Название не получено» — controls
   на месте, но disabled, ничего не отмечено, GUID не показывается. Легаси-ключи
   `consignor/consignee` остались толерантностью проекции только когда NameSource
   отсутствует целиком (старые фикстуры; для владельца — никогда). «Все
   соответствует» не отмечает disabled-поля. DR23-поллинг не сбрасывает форму:
   `defaultValues` фиксированы на маунте, переход disabled→enabled сохраняет
   остальные несохранённые значения.
5. **Decimal (§5, R-DR24-5).** `formatDecimalDisplay` / `normalizeDecimalInput` —
   только строки (без `Number/parseFloat/toFixed/арифметики`): таблица §5.2
   (60/60.0/60.000000→«60»; 60.45/60.450000→«60,45»; 0.000000→«0»); запятая только
   на presentation; ввод принимает точку и запятую, канонизация на blur и в
   submit (`canonicalQuantitySet`), промежуточный ввод «60,»/пустое поле не
   ломается. Подписи: «Вес, кг» и «Количество мест, шт.» (никогда «Количество (кг)»);
   применено к «Доставлено/Принято/Возвращается» и к сводке диалога подтверждения.
6. **GUID единицы (§6, R-DR24-6, вариант 1).** Блок «Единица измерения (из эВСД)»
   удалён из формы и из сводки подтверждения; подписи «Вес, кг»/«Количество мест,
   шт.»; `unit_id` остаётся в трёх QuantitySets и payload (тест), серверная проверка
   не тронута; честное предупреждение остаётся только при отсутствии самого GUID.

## Тесты (§8)

- `Dr24RecControls.test.tsx` (20 тестов): decimal-таблица и «никаких float»
  (большие строки проходят посимвольно), геометрия карточки (DOM-порядок +
  raw CSS мокапа, 390 px без выталкивания), F07/F08 активны при resolved,
  PENDING/ERROR/MISSING — controls видимы/disabled/не отмечены, фокус/radio/aria/
  live, бейдж `img[src="/mercury-logo.webp"] alt=""` + текст «Меркурий»
  (страница через MSW), черновик: новая сверка нейтральна; отметка → unmount без
  PUT → повторное открытие нейтрально; «Все соответствует» без save не создаёт
  сетевых запросов; query cache не получает draft до успешного PUT; ранее
  сохранённая OPEN-сверка восстанавливает только реально сохранённые checks
  (диагностика источника предвыбора = `initial.checks` сервера); массы/места
  раздельно, без «GUID:» в блоках количеств, unit_id в payload.
- Обновлены затронутые тесты DR8/DR10/DR13/DR21 (`ReconciliationForm.test.tsx`),
  DR23 (`ParticipantNameStates.test.tsx` — без правок, прошёл), W03
  (`ReceiptOperation.test.tsx`: сводка без GUID, гашение не блокируется
  отсутствием имени единицы).

## Гейты (на закоммиченном дереве)

- backend: `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed;
  `uv run --frozen pytest backend/tests/arrivals -q` — 138 passed.
- frontend (Node 26 из `…\opencode\node26\…`): `format:check` ✓, `lint` ✓
  (0 ошибок; 1 известный pre-existing warning catalogs), `typecheck` ✓,
  `test -- --run` 378 passed (56 файлов), `build-storybook` ✓, `build` ✓
  (`dist/mercury-logo.webp` присутствует).

## Storybook

- states обычное/расхождение/узкий экран уже были; добавлены `СравнениеНедоступно`
  (disabled) и `СравнениеОжиданиеИмени` (PENDING, loading) на общем `ComparisonField`.

## Честно не выполнено

- `npm run test:e2e`: Playwright-конфиг поднимает dev-server/Storybook и требует
  работающего backend (Docker), который поднимать/пересобирать запрещено
  контрактом этой подзадачи (решение за контроллером).
- Браузерные проверки §10 (1440/1024/800/390, 200% zoom) — в компетенции
  контроллера после пересборки контейнеров; jsdom-тесты покрывают 390 px,
  overflow, фокус и длинные значения.
- Живые VetIS write-вызовы не выполнялись (запрещены); всё на MSW/фикстурах.
- Backend-контракты не менялись (CHK IDs, validation, If-Match, idempotency —
  нетронуты; изменений бэкенда нет).
