# DR42 — «Исправление расчёта стоимости и формы карточки ВСЭ» — evidence

Дата: 17.11.2026 · Ветка: `codex/exam-pricing-outcome-form` · Worktree: `C:\electronic_lab_dev-dr42` · BASE main 46801cb

## Выбранный вариант scope (§2/§10)

**Вариант A** (рулинг контроллера R-DR42-1): DR14-контракт сохранён — тариф ВСЭ привязан к конкретному виду продукции Меркурия. Доказательства тестами: `backend/tests/catalog_pricing/test_dr42_scope.py::test_tariff_in_catalog_scope_is_found_by_preview` (корректный scope находится preview) и `::test_legacy_laboratory_scope_tariff_is_not_a_valid_scope` (product_species_id=лаборатория не считается действующим scope, даёт понятную конфигурационную ошибку с сохранением технического кода `CONFIGURATION_MISSING`).

Старые строки не удалены и не мигрированы молча: tariffs context помечает их устаревшими, `TariffsEditorPage` показывает счётчик «Обнаружено устаревших строк тарифов, требующих миграции» без подмены цен и без копирования между лабораториями (`test_tariffs_context_lists_species_names_and_legacy_rows`).

## Коммиты

- `4864aa9` fix(backend): DR42 tariff scope diagnostics, evaluation mode and decimal microscopy
- `94cfae3` feat(frontend): DR42 decimal research inputs (VSE-F24 microscopy)
- `e5a8015` feat(frontend): DR42 styled select, outcome block and tariff species scope
- `7d918fc` style(frontend): DR42 prettier pass on touched files and hooks-order fix
- `2e4d5a5` fix(frontend): DR42 exhaustive-deps warning in use-catalog-context

## Диагностика отсутствующего тарифа (§4.2)

`backend/src/modules/catalog_pricing/service.py::missing_tariff_message` — пользовательское сообщение называет исследование и код:
«Не настроена стоимость исследования «Микроскопия» (код VSE-F24) для выбранного вида продукции. Откройте справочник «Стоимость исследований» и настройте этот показатель.» + scope-хвост для владельца прейскуранта. `CONFIGURATION_MISSING` остаётся техническим кодом. Тест: `test_missing_tariff_message_names_indicator_and_action`.

## Дробные числовые поля (§5)

- `frontend/src/features/examinations/formValues.ts`: `normalizeDecimalInput`/`compareDecimals` — только строковая грамматика, без parseFloat/toFixed/binary float; запятая → точка на wire, «2,» держится в поле до blur/submit; отрицательные/NaN/Infinity/экспонента/пустое выполненное отклоняются.
- VSE-F24 (микроскопия) → DECIMAL: frontend `ResearchKind` и backend `result_schema`; старые integer snapshots читаются (compat), миграция не выполнялась — за ней к контроллеру.
- pH (0–14), температура, дозиметрия (2 величины) — единый decimal-путь с диапазонами.
- Тесты: `frontend/src/features/examinations/formValues.test.ts` (129 строк), `backend/tests/examinations/test_results.py` (дробные значения, старые snapshots).

## Evaluation/preview контракт (§4.3)

FIXED/CONFIGURABLE/NONE — часть read-only ответа сервера (`test_evaluation_mode_is_part_of_the_snapshot`, `test_fixed_enum_evaluation_mode`); preview возвращает method_snapshot, evaluation (IN_NORM/DEVIATION/UNKNOWN), tariff/quantity/amount; `test_catalog_change_does_not_reprice_saved_snapshot` — смена каталога не перекрашивает/не пересчитывает сохранённый snapshot. Ноль цены отличим от отсутствующей цены (`test_zero_price_differs_from_missing_price`). Frontend `PricingPreview` — debounce 300ms поверх DR35; ошибка preview не очищает введённые значения.

## SelectDropdown (§6.1)

`frontend/src/shared/ui/SelectDropdown.tsx` — один переиспользуемый controlled-компонент (trigger-кнопка + listbox panel, border/shadow/active item, приглушённый disabled placeholder, arrows/Home/End/Enter/Escape, `aria-expanded`/`role=listbox`/option, label, focus-visible, stacking выше секции). Тесты: `SelectDropdown.test.tsx` (92 строки), Storybook `select-dropdown.stories.tsx` (тот же код).

## Блок «Итог экспертизы» (§6)

`OutcomeFields.tsx`/`examinations.css` перестроены по `electronic-vse-journal.html`: дата+checkbox широкой строкой, result/direction/specialist в grid-колонках, section tokens + иконка `check-complete`. Бизнес-матрица FIT/UNFIT/направления/reason/обязательность не изменена (`OutcomeFields.test.tsx`); ничего не предвыбирается, кроме сохранённого.

## Gates (все foreground)

| Gate | Результат |
|---|---|
| `uv`/venv pytest backend/tests/catalog_pricing + backend/tests/examinations | **160 passed** (2:04) |
| ruff check backend | All checks passed |
| ruff format --check | 39 pre-existing файлов не в DR42-зоне (arrivals/reports/vetis и др., не тронуты DR42-коммитами); DR42-файлы отформатированы |
| `npm run format:check` | 15 warn — все arrivals/reports (DR41-A зона, не DR42); DR42-файлы чисты |
| `npm run lint` | 0 errors, 0 warnings (после `2e4d5a5`) |
| `npm run typecheck` | exit 0 |
| `npm run test` | **66 files / 530 tests passed** |
| `npm run build` | exit 0 |
| `npm run build-storybook` | exit 0 |
| `npm run test:e2e` (examinations.spec) | **not-run по существу**: 10 failed из-за `ECONNREFUSED 127.0.0.1:8000` — e2e-конфиг требует живой backend (docker-окружение контроллера, Live VetIS write запрещён); 2 passed на чисто-frontend шагах. Честно засчитано как not-run. |

## Ограничения / к контроллеру

- E2E Save/Complete и Save/Waiting (§8) требует поднятого docker-стека — прогнать контроллеру после сборки контейнеров.
- Миграция устаревших tariff-строк и legacy integer snapshots — не выполнялась (BLOCKED по рулингу).
- schema.d.ts изменён в коммите `4864aa9` штатным генератором.
