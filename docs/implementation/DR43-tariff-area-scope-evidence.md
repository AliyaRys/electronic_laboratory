# DR43 — тарифы по области «Мясо и мясопродукты» + переверстка «Расчёт стоимости услуг» — evidence

Дата: 17.11.2026 · Ветка: `codex/tariff-area-scope` · Worktree: `C:\electronic_lab_dev-dr43` · BASE main e2766f6

## Владельческое решение (2026-11-17, заменяет R-DR42-1 Вариант A)

«Стоимость одна на всю категорию "Мясо и мясопродукты", не надо делать фильтр»:
тарифный scope = `laboratory_id + product_area_code('meat') + service_code` (как meat-нормы DR31);
вид продукции партии в поиск тарифа не входит; каталог без селектора вида продукции.

## Выбранная стратегия миграции 0021_tariff_area_scope

Недеструктивная, выполняется под lock (обёртка `deploy/migrate_lock.py`, паттерн DR31 0019; сама миграция
данных идёт в одной транзакции alembic):

- `tariffs.product_area_code` добавлен NULLABLE (NULL = CHECK/legacy scope, `'meat'` = новая область);
  `bulk_price_jobs.product_species_id` стал NULLABLE (эхо старого scope);
- в каждой группе `(laboratory_id, service_code, unit_id)` строк VSE (species NOT NULL) РОВНО ОДНА строка —
  новейшая по `(version, rev, id)` — переводится в area scope (`product_area_code='meat'`); её species
  ЗНАЧЕНИЕ СОХРАНЯЕТСЯ как аудиторское и больше не читается. Ничего не удаляется;
  исторические некорректные строки (`product_species_id = laboratory_id`) попадают в ту же групповую
  процедуру: если такая строка — новейшая в группе, именно она конвертируется (владельческая трактовка:
  старый контракт означал «один тариф на область»). Остальные строки группы остаются legacy (species scope,
  audit-only) и pricing их не читает;
- новый частичный уникальный индекс `uq_tariff_lab_area_code_unit` (laboratory, code, unit) WHERE
  `product_area_code IS NOT NULL` — один area-тариф на ключ; плюс `ix_tariffs_area`;
- сохранённые снапшоты ВСЭ не пересчитываются (ADR-020): чтение старых снапшотов не изменилось — строки
  снапшота несут закреплённые цены, каталог не влияет;
- downgrade честный: ошибка, пока существует area-строка с NULL species (созданные после миграции строки
  нельзя представить в species-контракте), иначе откат схемы.
- Тест миграции: `backend/tests/catalog_pricing/test_migration_0021.py` (реальный alembic downgrade→
  сидирование→upgrade, проверка «выжила новейшая цена», «ничего не удалено», CHECK не тронут, pricing
  считает по area-строке).

## Задача 1: backend + каталог

- `models.py`: `Tariff.product_area_code`, новые индексы; `TariffView.product_area_code`.
- `service.py`: `_tariff_for` ищет тариф по `lab + 'meat' + code` (species игнорируется); `_tariff_for_check`
  дополнительно требует `area IS NULL`; `missing_tariff_message` без species-хвоста, «для области
  „Мясо и мясопродукты"».
- `commands.py`: `_tariff_scope` — POST/PUT сохраняет ровно area scope (VSE: species→NULL, area='meat';
  CHECK: species→NULL, area=NULL); DR13-правило «species ≠ laboratory» больше не нужно — species не
  сохраняется вовсе.
- `queries.py`: `tariff_page` по `product_area_code` (None = CHECK); readiness-проверка тарифов по area scope.
- `context.py`: `TariffsContext` без `species_options`; `legacy_tariffs` = строки вне области (audit-only).
- `router.py`: `GET /catalogs/tariffs?product_area_code=` вместо species-параметра.
- `bulk.py`: массовая цена пишет area-строки; `product_species_id` — необязательное эхо.
- Тесты: `test_dr42_scope.py` адаптирован (species-тариф больше не действующий scope → заменён на
  «тариф в area scope находится preview; tariff c другим area / legacy-строка не находится»;
  message-тест на «Мясо и мясопродукты»; контекст без species_options); `test_rules.py`: вместо
  «VSE требует species» — «VSE сохраняет ровно area scope» + уникальность area-ключа; `test_pricing.py`,
  `test_create.py` — сидирование переведено на area scope.

## Задача 2: «Расчёт стоимости услуг»

- Общие стили вынесены в `frontend/src/shared/ui/check-section.css` (`.vse-check-section*`,
  `.vse-rec-invoice-*`, `.vse-visually-hidden`); reconciliation.css подключает их через `@import` — классы
  и правила в единственном экземпляре, вторая дизайн-система не создана.
- `ExaminationForm`: секция — `CheckSectionCard sectionKey="invoice"` (закреплённая карта `check-invoice`
  из общего реестра, без локального SVG), заголовок и пояснение по ТЗ.
- `PricingSection`: таблица `vse-rec-invoice-table` (wrap): Услуга | Единица расчёта | Количество | Тариф |
  Сумма; caption visually-hidden «Расчёт стоимости услуг по сверке»; строки — выполненные исследования из
  серверного preview (оценка/норма — бейджем внутри первой ячейки, честная информация DR41-B сохранена);
  итог `vse-rec-invoice-total` «Итого» + сумма сервера.
- Чекбокс «Ярмарка» (`vse-rec-invoice-waiver`, note «Сверка данных и ВСЭ по этой партии проводятся без
  оплаты.») отражает fair-флаг СЕРВЕРНОГО preview (fair вычисляется сервером из сверки партии,
  `examinations/commands.py pricing_request_for`); в карточке он readonly/disabled — браузер не подделывает
  и не переключает режим. Fair-контракт существовал (`PricingRequest.fair`, снапшот `fair`), нового
  серверного контракта не потребовалось.
- Просмотр (`ExaminationViewPage`): сохранённый снапшот в той же секции `CheckSectionCard` + `SavedInvoice`
  (те же классы, те же серверные строки, тот же waiver) — единый стиль во всех местах.
- Storybook: stories рядом (`examination.stories.tsx`), тот же код `PricingSection`/`CheckSectionCard`;
  состояния: с тарифами, fair (0,00 ₽), ошибка сети, loading, missing tariff (существующая), узкий экран.
- Адаптив/доступность наследуют сверку: wrap + перелом колонок ≤768px (уже в общих стилях), caption
  visually-hidden, чекбокс с aria-label.

## Gates

- backend: `uv run --frozen pytest backend/tests/catalog_pricing backend/tests/examinations -q` →
  **170 passed**; `ruff check backend` → clean; `ruff format --check` на моих файлах → clean
  (test_dr35_data_rules.py был неформатирован в базе — не мой файл, не трогал).
- frontend: `format:check` — мои файлы чисты (14 предупреждений — файлы, не входившие в задачу, были
  неформатированы в базе); `lint` → clean; `typecheck` → clean; `test` → **563 passed**; `build` → ok;
  `build-storybook` → ok.
- `schema.d.ts` — только штатным `npm run gen:api` (backend поднят локально, миграция к живой БД
  НЕ применялась; открытый OpenAPI без данных).
- Миграция к живой БД не применялась (контроллер применит после merge, через deploy/migrate_lock.py).

## Честные not-run / concerns

- Поведение в браузере (Playwright test:ui) не запускалось в этой сессии — стек e2e не поднимался;
  покрытие — unit/jsdom-тесты (563) и сборка Storybook. Рекомендуется прогнать `npm.cmd run test:ui`
  на экранах каталога и карточки ВСЭ после merge.
- Миграция не прогонялась на копии живых данных с реальными legacy-строками (покрыто миграционным тестом
  на синтетике); после применения контроллером стоит проверить счётчик «converted N VSE tariff row(s)»
  в логе 0021 и отсутствие неожиданных ALREADY_EXISTS при первых записях.
- В группах с несколькими species-ценами сохраняется цена новейшей строки; остальные цены остаются в
  legacy-строках (аудит), в расчёте не участвуют — расхождение цен не «разрешается» молча, а видно в
  каталоге через legacy-блок.
- `.superpowers/`, `tmp/` не коммитились; файл `tmp/split-css.py` остался в tmp (вне git).
