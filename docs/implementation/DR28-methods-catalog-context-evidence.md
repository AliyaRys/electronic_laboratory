# DR28 — методы каталога: честный контекст + создание нормы. Доказательства

Дата: 2026-11-13. Ветка: `feature/DR28-methods-catalog-context` (реализована в изолированном
worktree `C:\elab-dr28-solo`, ветка `feature/DR28-solo`, push в `feature/DR28-methods-catalog-context`).
BASE: main `603947c`.

## Что доказано и чем

### Backend (вариант B — ТЗ §7, R-DR28-7)
- `backend/src/modules/catalog_pricing/context.py` (новый) — scoped read model
  `GET /api/v1/catalogs/methods/context`:
  - область `meat` («Мясо и мясопродукты») резолвится ТОЛЬКО из разрешённого
    классификационного read model `MercuryProductGuidLvl2` (`product_type = 1`,
    active + is_last) — GUID и русское название из реального словаря; лаборатория,
    тестовый scope и первый ВСД никогда не используются как вид продукции (§5.4);
  - `product_state_id` — стабильный уровень `subProduct` классификации партий ЭТОЙ
    лаборатории и выбранного вида; несуществующее состояние не изобретается (§5.3);
  - ровно один вид/состояние выбирается автоматически, русское название показывается (§5.2);
  - отсутствие настроенной области → `409 CONFIGURATION_MISSING`, а не пустой каталог (§5.1);
  - ответ содержит полный реестр VSE-F18–F29 (`mandatory.CATALOG_INDICATORS` — ЕДИНЫЙ
    источник, F30/F31 отсутствуют) + `active_rules` + `missing` (§6.1/§6.3/§7).
- `backend/src/modules/catalog_pricing/mandatory.py` — `CatalogIndicatorDef`/`CATALOG_INDICATORS`:
  канонические 12 показателей с русскими названиями, result_schema и единицами.
- `router.py` — endpooint `/methods/context` (объявлен ДО `/methods/{rule_id}`),
  авторизация `catalog:read` (HEAD своей лаборатории, ADMIN/ANALYST по территории, VET read-only).
- `commands.py` — `product_state_id` не может равняться `laboratory_id` или
  `product_species_id` (`VALIDATION_ERROR`); запрет `species == laboratory` сохранён (§7).

### Frontend (R-DR28-1..6)
- `frontend/src/features/catalogs/api.ts` — `fetchMethodsContext()`; страница больше
  НИКОГДА не вызывает старый `GET /catalogs/methods` с недействительным scope (тест
  фиксирует 0 обращений к списку при invalid scope).
- `MethodsEditorPage.tsx` — реестр-ориентированный экран:
  - блок «Вид продукции» (селектор по коду области; UUID не показываются; species/state
    в URL только как восстанавливаемые параметры ссылки, никогда в подписях);
  - состояния: loading / no-scope («Вид продукции и состояние продукции не настроены…»
    + повтор + возврат) / empty-but-configured (все F18–F29 с «Не настроено» и
    «Настроить») / access denied / validation / success / conflict / delete warning;
  - «Добавить норму» в заголовке «Диапазоны нормы» открывает СУЩЕСТВУЮЩИЙ
    `MethodEditor` в create-режиме; POST с Idempotency-Key; успех → закрытие формы +
    перечитывание контекста (строка появляется без перезагрузки).
- `MethodEditor.tsx` — create-режим с реестром: выбор показателя по русскому названию и
  коду, вид/состояние берутся из контекста, тип результата и единица следуют каноническому
  определению показателя; источник методики обязателен; поля не показывают UUID.
- `schema.d.ts` перегенерирован из backend OpenAPI (тот же контракт).
- Storybook: `C02/MethodEditor` + `CreateFromContext`/`NarrowFromContext` (§10).

## Гейты
- backend: `ruff check backend` — чисто; `pytest backend/tests/catalog_pricing/...` — см. отчёт.
- frontend: `tsc --noEmit` — чисто; `eslint` — 1 известное pre-existing предупреждение
  (`use-catalog-context.ts` useMemo deps); `prettier --check` — чисто; vitest
  **56 files / 390 tests passed** (включая 8 новых/обновлённых тестов страницы);
  `npm run build` и `build-storybook` — см. отчёт.
- Живых write-запросов в тестах нет (MSW/spy); данные и снапшоты не удалялись; контейнеры
  не пересобирались (за контроллером).

## Честно не выполнено / раскрыто
- Числовые нормы не выдуманы и не скопированы: до ввода методистом строки показываются
  как «Не настроено» (§3 INPUT-02).
- Provisioning реальной пары для лаборатории 2812 остаётся административной задачей
  (словарь Меркурия должен содержать meat-записи); UI честно блокируется, пока
  сопоставление отсутствует.
- Docker rebuild/push/merge — контроллер.
