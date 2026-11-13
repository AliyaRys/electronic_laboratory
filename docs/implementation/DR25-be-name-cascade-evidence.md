# DR25 — businessEntity name cascade + inline comparison row (evidence)

Дата: 2026-11-13. Ветка: `feature/DR25-be-name-cascade` (base: main efd7f5b).
Постановка: rulerings R-DR25-1..6 в `.superpowers/sdd/2026-11-13-be-name-cascade/progress.md`,
ТЗ DR18 §8 (каскад ent:name → ent:fullName → ent:fio).

## Fix 1 — каскад имени businessEntity/enterprise (R-DR25-1/2)

Живой факт: GetBusinessEntityByGUID для `0ed40ab2-cda6-4daa-9302-1e21187be0e1`
возвращает businessEntity БЕЗ верхнеуровневых dt:name/dt:fullName, с dt:fio =
«Хусаинова Гульнур Мансуровна» и вложенным juridicalAddress/country/name =
«Российская Федерация». Прежний `_child_text` в
`backend/src/modules/integrations/vetis/transport.py` искал значение через
`parent.iter()` — поиском по ВСЕМ потомкам, поэтому первое попавшееся
`dt:name` из вложенного адреса страны попадало в кэш как имя ХС.

Исправление (`transport.py`, `_child_text` + докстринги парсеров):

- значение читается ТОЛЬКО среди прямых детей элемента
  (`for child in parent` — без рекурсии);
- businessEntity: каскад строго `dt:name → dt:fullName → dt:fio` на его
  верхнем уровне; nested-элементы (juridicalAddress/country/region/district/
  locality и любые другие) никогда не являются источником имени;
- enterprise: только её собственный верхнеуровневый `dt:name`;
- если ни один из каскадных узлов отсутствует — имя НЕ устанавливается:
  запись получает `VETIS_REFERENCE_NAME_ABSENT` и существующий
  retry/backoff-путь; никакой подмены адресом/страной, имя не изобретается.

### Data-fix (R-DR25-3)

Новая функция `schedule_vetis_lookup_recheck(db)` в
`backend/src/modules/integrations/vetis/reference_names.py`:

- программный ORM-путь (никакого ручного SQL, никаких удалений): строки
  `vetis_reference_names` с `source = 'VETIS_LOOKUP'`, у которых
  `next_check_at IS NULL` или в будущем, получают `next_check_at = now`;
- идемпотентна: повторный запуск не изменяет уже поставленные на
  перепроверку строки (возвращает количество изменённых);
- строки `source = 'SOURCE_XML'` не затрагиваются;
- имя не трогается здесь — следующего тика worker'а достаточно:
  `_claim_due` забирает строку, фиксированный каскад заново разбирает ответ
  lookup, `_apply_lookup_result` перезаписывает имя (или честно оставляет
  старое и повторяет при отсутствии верхнеуровневого имени). Запрещённых
  write-методов нет — только два read-only lookup ( spy-тест это проверяет).

### Триггер для контроллера

`recheck_vetis_lookup_names_startup()` вызывается в `_startup` arq-воркера
(рядом с `backfill_reference_names_startup`, под тем же «никогда не блокирует
worker»-подавлением). После деплоя достаточно ОДИН раз перезапустить worker:
стартап разом помечает все VETIS_LOOKUP-строки, ближайший тик планировщика
(run_at_startup cron) пере-разрешает их с исправленным каскадом. Идемпотентно
при повторных рестартах.

## Fix 2 — карточка сравнения в одну горизонтальную линию (R-DR25-6)

Претензия владельца: в карточке сравнения кнопки «Совпадает»/«Не совпадает»
не стояли на одной линии с названием поля и значением — в DR24 имя поля
занимало всю ширину карточки над строкой (`.vse-rec-compare-name
{ grid-column: 1 / -1; }` в сетке `minmax(0,1fr) 40px 40px`).

Исправление (`frontend/src/features/arrivals/reconciliation.css`):

- сетка карточки: `minmax(0, 1fr) minmax(0, 1.4fr) 40px 40px` —
  `[Название поля] [Значение] [✓] [×]` в ОДНОЙ горизонтальной линии;
- имя поля — ведущая inline-ячейка той же строки (`grid-column: 1 / -1`
  снято, `min-width: 0` сохранён, текст переносится внутри ячейки);
- кнопки 40×40 идут сразу за значением, никогда на отдельной строке;
- mismatch-блок (`.vse-rec-facts`) и сообщение об ошибке
  (`.vse-rec-compare > .app-field-message`) раскрываются НИЖЕ inline-строки,
  на всю ширину карточки (`grid-column: 1 / -1` сохранён);
- сохранены: radio-семантика (radiogroup + aria-label), видимый focus,
  состояния PENDING/ERROR/MISSING (кнопки присутствуют, disabled, без
  отметок), состояние через фон+иконку+aria (не только цвет), сетка
  карточек 2 колонки >1020px / 1 колонка ≤1020px; разметка не
  дублируется — один ComparisonField используется страницей и stories.

## Тесты

Backend (`backend/tests/vetis/test_reference_names.py`, секция R-DR25):

- fio-only businessEntity → имя из fio (живой кейс DR25);
- `dt:name` выигрывает у fio/fullName; fullName — второй шаг каскада;
- РЕГРЕССИЯ: juridicalAddress/country/region/district/locality с именем, но
  без верхнеуровневых узлов → имя НЕ устанавливается («Российская
  Федерация» больше не появляется);
- enterprise не берёт имя из вложенного адреса;
- re-check путь идемпотентен, SOURCE_XML-строки не затронуты, каждая
  записанная операция — read-only lookup (spy), имя переписывается на
  исправленное.

Frontend (`frontend/src/features/arrivals/Dr24RecControls.test.tsx`):

- DOM-порядок карточки: name → value → check-buttons (ok, bad);
- inline-структура: имя — ведущая ячейка той же строки (сетка 4 колонок,
  без `grid-column: 1 / -1` у имени), кнопки 40×40;
- mismatch-блок раскрывается ниже inline-строки, до отметки закрыт;
- PENDING/ERROR/MISSING сохраняют DR24-поведение (кнопки присутствуют,
  disabled, unmarked) — тесты DR24 обновлены только там, где менялся
  ожидаемый порядок/сетка.

## Гейты на закоммиченном дереве

- backend: `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed;
- backend: `uv run --frozen pytest backend/tests/vetis backend/tests/arrivals -q` — 340 passed
  (известные ранее 2 упавших в `backend/tests/examinations/test_delete.py` не входят
  в эти каталоги и не запускались этой веткой);
- frontend: format:check, lint (0 errors; 1 pre-existing warning
  react-hooks/exhaustive-deps в catalogs), typecheck (0), test --run (56 файлов,
  380 passed), build (✓), build-storybook (✓).

Честно не выполнено: проверка реальной вёрстки в браузере (R-DR25-6 «проверить в
реальном браузере») — к сессии не подключён настольный браузер
(`browser.disconnected`); Storybook собран, story-примеры не дублируют разметку,
геометрия покрыта модульными тестами; live VetIS вызовы в тестах не выполнялись
(фикстуры + spy). Docker не пересобирался, merge — контроллер.
