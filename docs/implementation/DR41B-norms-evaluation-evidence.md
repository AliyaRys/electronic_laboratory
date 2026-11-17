# DR41-B §6/§7 — справочник норм (FIXED/CONFIGURABLE/NONE) и подсветка оценки в форме ВСЭ

Дата: 17.11.2026 · Ветка `codex/norms-evaluation-registry` (worktree `C:\electronic_lab_dev-dr41b`, база main 424581e)

## Реализовано

### Backend (§6.4)
- `mandatory.py`: `CatalogIndicatorDef.evaluation_mode` (FIXED / CONFIGURABLE / NONE) +
  `fixed_values` (wire-коды MATCH/MISMATCH/NEGATIVE/POSITIVE, legacy русские варианты и
  legacy BOOLEAN true/false → IN_NORM/DEVIATION) и `fixed_criterion` (текст применённого
  правила). `INDICATOR_BY_ID` для оценки по id показателя.
- `service.py`: `fixed_evaluation()` — FIXED-показатели (F18/F19/F22/F27/F28) оцениваются
  по каноническому реестру БЕЗ active MethodRule; F23 (NONE) → `NOT_APPLICABLE`;
  tariff по-прежнему обязателен (это платная строка). Пиннед строки старых snapshot
  сохраняют свою evaluation (не переоцениваются). Legacy INTEGER-норма: строковое
  десятичное значение — целое оценивается, дробное → честный `UNKNOWN` + `hint`
  «пересохраните норму показателя в справочнике» (находка ревью DR42).
- `commands.py`: `_refuse_fixed_or_none()` — POST/PUT нормы для FIXED/NONE → 422
  `VALIDATION_ERROR` с русским сообщением («фиксирована методикой ФТ…» / «не имеет нормы…»).
- `context.py`: `CatalogIndicator.evaluation_mode` в `/catalogs/methods/context`;
  `missing` содержит только CONFIGURABLE (F20/F21/F24/F25/F26/F29).
- `queries.py`: readiness — FIXED/NONE обязательные (F18/F19) не требуют MethodRule;
  F20 (CONFIGURABLE) по-прежнему требует.
- OpenAPI regen: `npm run gen:api` (schema.d.ts +evaluation_mode, штатный скрипт).

### Frontend
- `MethodsEditorPage`: `buildMethodRows` показывает только CONFIGURABLE-показатели;
  legacy-норма FIXED/NONE-показателя — честная диагностика `method-legacy-*`
  («фиксирована методикой ФТ…» / «не имеет нормы…»), не редактируется, не считается dirty.
- `PricingPreview`: `evaluationLabel` — IN_NORM «Норма», DEVIATION «Отклонение»,
  NOT_APPLICABLE «Оценка по норме не применяется», UNKNOWN «Оценка не определена»;
  в бейдже выводится честный `hint` legacy-нормы.
- `ResearchFields`: карточки исследований получают `evaluations` (typed snapshot из
  серверного preview, keyed по indicator id) — подложка/граница + текст; цвет не
  единственный носитель. Бейдж отсутствует, пока preview не ответил (никакой
  выдуманной оценки). Итог врача FIT/UNFIT не тронут.
- `ExaminationForm`: карта оценок из preview (success/recalculating), пересчитывается
  после изменения результата и при загрузке формы с данными.
- `examinations.css`: спокойные зелёная/красная тона `data-evaluation`.

### Storybook (§9.4 п.10)
- `E04/examination.stories.tsx`: `ОценкаНормВКарточках` (IN_NORM/DEVIATION/UNKNOWN+hint/
  NOT_APPLICABLE — fixed+configurable), `ОценкаНормУзкийЭкран` (mobile1),
  `ОценкаНормЗагрузкаИОшибка` (loading + CONFIGURATION_MISSING). Тот же код
  ResearchFields/PricingSection, без копий.

## TDD evidence (RED → GREEN)
- RED: `backend/tests/catalog_pricing/test_dr41b_registry.py` — первый запуск
  `AttributeError: 'CatalogIndicatorDef' object has no attribute 'evaluation_mode'`
  (test_registry_modes_match_the_ft_rules), далее 8 failed (fixed evaluation без
  MethodRule, отказ записи, legacy INTEGER honest UNKNOWN, context/missing, readiness).
- GREEN: `uv run --frozen pytest backend/tests/catalog_pricing backend/tests/examinations -q`
  → 168 passed (после реализации). `ruff check backend` → All checks passed.
- Frontend RED/GREEN: `ResearchFields.test.tsx` (4 теста подсветки),
  `PricingPreview.test.tsx` (+NOT_APPLICABLE, +legacy hint), `MethodsEditorPage.test.tsx`
  (fixed/none не в справочнике, legacy-диагностика, 19 passed). Полный прогон:
  `npm run test` → 68 файлов, 563 passed; `lint`, `typecheck` → 0 ошибок;
  `build`, `build-storybook` → успешно.

## Ограничения / notes
- `format:check` на репозитории падает на 14 файлах, НЕ относящихся к §6/§7
  (AppShell/app-header/reports/arrivals/e2e — артефакт других веток); мои файлы
  проходят prettier чисто. Реформат чужих файлов после случайного `npm run format`
  откачен (`git checkout`).
- Тесты DR42 (`test_dr42_scope`, `test_meat_scope`, `test_methods_context`) обновлены
  под mandated behavior: F23 UNKNOWN → NOT_APPLICABLE, missing только configurable.
- Существующие ACTIVE MethodRule для FIXED/NONE в БД не удаляются и не мигрируют —
  они игнорируются оценкой и показываются как honest-диагностика в редакторе.
