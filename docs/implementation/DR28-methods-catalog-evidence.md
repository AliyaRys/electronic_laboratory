# DR28 — Справочник норм: честный контекст области + создание нормы (evidence)

Дата: 13.11.2026. Ветка: `feature/DR28-methods-catalog-context` (worktree
`../electronic_lab_dev-dr28`, base = main 603947c). ТЗ:
`dorabotka/2026-11-13-methods-catalog-empty-and-create.md` (§1–11) — в коммите.

## Вариант реализации

**Вариант B** (§7, предпочтительный): новый read model
`GET /api/v1/catalogs/methods/context?laboratory_id=&area=meat&product_species_id=&product_state_id=`
→ `laboratory, areas, species_options, states, product_species, product_state,
indicators[], active_rules[], missing[]`. Backend владеет scope и readiness,
поэтому выбран B; дублирования реестра нет.

## Подход к сопоставлению scope (§5.2/§5.3/§5.4/§11 — DATA SAFETY)

Никаких придуманных данных и никакого отдельного «mapping»-слоя с выдуманными
ID. Сопоставление берётся из существующих read models:

- **Область** — стабильный безопасный код `meat` («Мясо и мясопродукты»), не
  GUID. Код области живёт в URL (`?tab=methods&area=meat`).
- **Вид продукции (species)** — разрешённый классификационный read model
  `MercuryProductGuidLvl2` (`product_type = 1`, `active`, `is_last`): реальный
  GUID словаря Меркурия + его русское название (например «Свинина»); флаг
  `requires_trichinelloscopy` приходит оттуда же. UUID лаборатории, тестовый
  scope `11111111-…`, чужая лаборатория `e926e655-…` и первый входящий ВСД не
  используются нигде.
- **Состояние продукции (state)** — стабильный `subProduct`-уровень партии:
  различные `subProduct`-ссылки (`id`+`name`) реальных партий ЭТОЙ лаборатории
  для выбранного вида. Состояние, которое не наблюдалось, не изобретается:
  пустой список = честный блокирующий экран, а не подставленный UUID. Ровно
  одно состояние выбирается автоматически, имя показывается.

## Что сделано

### Backend
- `catalog_pricing/context.py`: сборка scoped-контекста; 409
  `CONFIGURATION_MISSING` для неизвестной области/вида/состояния; честный
  no-scope ответ (`configured=false`, пустые опции) без словаря.
- `catalog_pricing/mandatory.py`: единый реестр `CATALOG_INDICATORS`
  (VSE-F18–F29: код/имя/result_schema/unit/обязательность/условность/варианты)
  на стабильных UUID5 `elab-vse://field/VSE-Fxx`. F30/F31 отсутствуют.
- `catalog_pricing/queries.py`: `readiness` теперь перечисляет отсутствующие
  F18–F20 и **условный F21** по policy-маппингу
  (`MercuryProductGuidLvl2.requires_trichinelloscopy`).
- `catalog_pricing/commands.py`: дополнительно запрещён
  `product_state_id == laboratory_id` и `product_state_id == product_species_id`
  (species == laboratory запрещён и ранее); `source`, `version`,
  `effective_from`, `result_schema`, `unit_id`, одна active-версия на ключ —
  как было; PUT/If-Match/удаление не тронуты.
- `router.py`: endpoint контекста (authz `catalog:read` по лаборатории; чужая
  лаборатория → `ACCESS_DENIED`), объявлен до `/methods/{rule_id}`.
- Миграция БД **не требуется** (только чтение существующих таблиц);
  `CURRENT_SCHEMA_REVISION` не менялся.

### Frontend
- `api.ts`: типизированный `fetchMethodsContext` (schema.d.ts перегенерирован
  через `npm run gen:api` из OpenAPI backend).
- `MethodsEditorPage.tsx`: переписан на read model контекста:
  - невалидный/ненастроенный scope → НЕТ вызова GET /catalogs/methods (страница
    вообще им не пользуется), НЕТ «Нормы для этой области не заданы», есть
    экран «Вид продукции и состояние продукции не настроены для этой
    лаборатории.» + подсказка про администратора + «Вернуться»/«Проверить
    снова»; создание в невалидном scope невозможно;
  - человекочитаемые селекторы «Вид продукции» (код области), «Вид»
    (несколько видов), «Состояние продукции» (несколько состояний); UUID не
    отображаются; смена перечитывает только свою область;
  - полный список VSE-F18–F29 даже без строк: без нормы — «Не настроено» +
    «Настроить»; активная норма — редактирование как раньше (границы,
    включённость, enum-варианты, удаление с предупреждением, §12.6 409);
    неизвестный показатель — честная диагностика без придуманного имени;
  - «Добавить норму» в заголовке «Диапазоны нормы» открывает СУЩЕСТВУЮЩИЙ
    `MethodEditor` в create-режиме; успех → закрытие + перечитывание scoped
    списка (строка появляется без перезагрузки).
- `MethodEditor.tsx`: create-режим без полей UUID — показатель выбирается по
  русскому названию и коду из контекста; `product_state_id` передаётся
  пропсом (сервер-разрешённая пара); тип результата/единица/варианты
  предзаполняются каноническим определением показателя; источник методики
  обязателен; POST с Idempotency-Key; ALREADY_EXISTS/VALIDATION_ERROR →
  ошибка к полю, ввод сохранён. Edit-режим (PUT/If-Match/удаление) без
  изменений.

## Тесты

- Backend: `backend/tests/catalog_pricing/test_methods_context.py` — 6
  интеграционных тестов: no-scope без словаря; честное разрешение пары
  (species/state) + полный F18–F29 + missing; отказ чужим species/state;
  блокировка laboratory-UUID как species/state и species как state;
  идемпотентный POST без дубля; условная F21 в readiness.
  `pytest backend/tests/catalog_pricing backend/tests/arrivals
  backend/tests/vetis backend/tests/examinations -q` → **464 passed, 2
  failed** — известные существующие падения
  `backend/tests/examinations/test_delete.py` (test_concurrent_delete_…,
  test_delete_http_204_and_unknown_202; воспроизводятся и на main, disclosed).
  `ruff check backend frontend/tests/e2e` — чисто.
- Frontend: `MethodsEditorPage.test.tsx` — 11 тестов (интервал/null/409-валид/
  enum/неизвестный показатель; честные экраны no-scope; полный список F18–F29
  с «Не настроено»/«Настроить»/«Добавить норму», отсутствие F30/F31; UUID не
  показываются; read-only без кнопок; «Настроить» → существующий MethodEditor
  → createMethod с реальными ID → строка появляется без перезагрузки);
  `MethodEditor.test.tsx` обновлён (create без UUID-полей, idempotency-key,
  If-Match). `vitest run` → **56 файлов, 393 passed**.
- Гейты: `format:check` ✓, `lint` ✓ (1 известное предупреждение
  react-hooks/exhaustive-deps в use-catalog-context), `typecheck` ✓,
  `build` ✓, `build-storybook` ✓. Stories: `method-editor.stories.tsx`
  (Create / PresetIndicator / Narrow 390px) на контекстных индикаторах.
- Docker rebuild/merge — по инструкции контроллера, не выполнялось.
- Не выполнялось: живой VetIS write, записи в реальную БД, удаления данных,
  seed реальных норм (запрещено §3/§5.4/§11).
