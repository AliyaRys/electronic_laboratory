# DR31 — единый мясной scope справочника норм: evidence

Дата: 16.11.2026. Ветка: `feature/DR31-meat-scope-methods` (base main 372ead4).
ТЗ: `dorabotka/2026-11-16-methods-catalog-single-meat-scope.md` (§1–15), rulings R-DR31-1..16.

## Решение (внедрено)

Активная норма = `laboratory_id + product_area_code('meat') + indicator_id`
(«Мясо и мясопродукты»). `product_species_id`/`product_state_id` исключены из
ключа применимости и write-контракта; старые колонки остаются nullable
(audit-only, новый код их не читает и не пишет как scope). GUID четырёх групп
(свинина, конина, свиные/конские субпродукты и жиры) остались ТОЛЬКО для
условной обязательности трихинеллоскопии в карточке ВСЭ — одна общая строка
VSE-F21 (`examinations/validation.py`, без изменений по смыслу).

## Миграция 0019_meat_scope_methods (недеструктивная, повторяемая)

- `product_area_code` NOT NULL default `'meat'`; species/state → nullable;
- по группам старых активных строк (lab, indicator):
  - эквивалентные по схеме/единице/значению → одна активная норма `meat`
    (новейшая по version/rev/id), остальные деактивированы (история сохранена),
    у выжившей строки scope-колонки очищены;
  - различающиеся → НЕ выбраны произвольно: все строки группы деактивированы
    для аудита, норма остаётся «Не настроено» (требует явного ввода);
- заменены индексы: `uq_method_rule_active` → (lab, area, indicator) partial
  unique (active=true); `ix_method_rules_scope` → (lab, area, indicator);
- партии, карточки ВСЭ, тарифы, справочники Меркурия не затронуты; снимки не
  пересчитываются.

**Счётчики миграции (live-прогон, контрольный прогон теста `test_migration_merges_equivalent_and_keeps_conflicts_unresolved`):**
- объединено эквивалентных норм: **2 строки** (1 группа; в контрольном прогоне миграция сообщила `merged equivalent norms: 1`);
- конфликтующих групп: **1** (обе строки деактивированы, значение не выбрано);
- норм к заполнению пользователем: **1**.

В локальной живой БД конфликта не возникло; механика конфликтов проверена
миграционным тестом (downgrade → seed → upgrade → assertions).

## Backend/API/оценка

- Write-контракт `MethodRuleWrite = {laboratory_id, code: VSE-F18..F29, rule}`
  — без species/state/indicator UUID/schema/unit/version/source
  (`extra=forbid` отвергает старые поля); неизвестный код → 422; тип нормы
  сверяется с каноническим реестром; источник — «Ручная настройка
  справочника норм» (серверное значение); версия — серверная (prev+1);
  create деактивирует прежнюю активную норму того же ключа.
- Context `GET /catalogs/methods/context`: без чтения
  `MercuryProductGuidLvl2`, без наблюдаемых subProduct партий, без параметров
  species/state, без 409 при пустых словарях Меркурия; возвращает лабораторию,
  область «Мясо и мясопродукты», реестр F18–F29, активные нормы, missing.
- Оценка ВСЭ (`service._active_rule`): lab + meat + indicator; species/state
  в запросе нормы отсутствуют; одна норма для всех мясных позиций; species
  остаётся только для тарифа (DR14, вне задачи). Добавлена честная проверка
  `productType == 1` в `examinations.commands.pricing_request_for`.
- Readiness: обязательные F18–F20 по meat-scope; F21 — партийное правило
  (в readiness не требуется); тарифные проверки при переданном species
  сохранены.
- If-Match, idempotency, CSRF, ролевая матрица и запрет чужой лаборатории
  сохранены (тесты `test_methods_context.py`, `test_pricing.py`).

## Frontend

- `MethodsEditorPage`: при открытии сразу заголовок «Нормы исследований»,
  readonly-контекст «Мясо и мясопродукты» (`data-testid=methods-area-name`),
  полный список F18–F29, нормы или «Не настроено», кнопка «Сохранить
  справочник». Удалены: селектор вида/состояния, тексты «Выберите вид/состояние
  продукции…», URL-параметры species/state, все GUID/UUID, кнопка «Добавить
  норму» и технический `MethodEditor` (файл удалён, DELETE_WARNING перенесён
  в `editor-parts.tsx`). Первая настройка — прямо из строки («Настроить» →
  инлайн-черновик → сохранение без перезагрузки). Пустая граница ≠ 0;
  от ≤ до блокируется у поля; частичный успех сохраняет ввод и показывает
  неуспешные строки; 409 → «Сохранить моё значение»/«Взять значение сервера».
- `api.ts`: `fetchMethodsContext(laboratoryId, area)`, `fetchMethods(lab, page)`,
  `fetchReadiness(lab, species?)`. Тарифы/массовые цены не тронуты (DR14).
- `schema.d.ts` перегенерирован из OpenAPI (`gen:api`).

## Документация (обновлена)

- `Функциональные требования/v2.0/06-pricing-and-directories.md` (FT-CAL-06,
  приёмка FT-CAL-06);
- `Функциональные требования/v2.0/10-field-catalog.md` (строка «Нормы»);
- `product-design-records/v1.9/08-field-catalog.md` (примечание DR31);
- `docs/TZ_development/plans/2026-11-06-03-catalog-pricing.md` (Interfaces);
- `docs/TZ_development/plans/traceability.md` (FT-CAL-06);
- `docs/adr/ADR-020-pricing-and-methods.md` (изменение решения DR31);
- `frontend/src/features/catalogs/README.md`;
- OpenAPI/schema: схема отдаётся из backend-модулей (docstrings обновлены),
  `frontend/src/shared/api/schema.d.ts` перегенерирован.
  `CURRENT_SCHEMA_REVISION = 0019_meat_scope_methods`.

## Проверки

Backend: `uv run --frozen ruff check backend frontend/tests/e2e` — All checks
passed. `uv run --frozen pytest backend/tests/catalog_pricing backend/tests/vetis
backend/tests/arrivals backend/tests/examinations -q` — 483 passed, 2 failed:
`examinations/test_delete.py::test_concurrent_delete_and_disposal_preserve_the_disposal_fact`,
`examinations/test_delete.py::test_delete_http_204_and_unknown_202` — оба
воспроизводятся на чистом `main` (stash-прогон) и являются известными
pre-existing failures, к DR31 не относятся.

Frontend (Node 26): format:check — единственное замечание
`src/features/arrivals/ReceiptOperation.tsx`, воспроизводится на чистой ветке
(pre-existing, файл вне зоны DR31); lint — 1 warning (use-catalog-context
exhaustive-deps, pre-existing), 0 errors; typecheck — 0 errors; vitest —
56 files / 400 tests passed; vite build — ok; storybook build — ok.

Не выполнялось (по распределению с контроллером): merge в main, пересборка
Docker-контейнеров, живая проверка под заведующим, e2e Playwright и
`npm run test:ui` — контроллер; `frontend/tests/e2e/catalogs.spec.ts`
семантически совместим (ссылка `product_species_id` в URL игнорируется
страницей, assertions «Добавить норму»/UUID остаются валидными).
