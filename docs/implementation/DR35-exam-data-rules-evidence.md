# DR35 — доказательства реализации (ТЗ «Правила данных формы создания ВСЭ, договор специалиста, живой расчёт»)

Дата: 2026-11-16. Ветка: `codex/examination-create-fixes` (воркспейс `C:\electronic_lab_dev-dr35`, база main `05c1460`).

## Коммиты
- `db3fc1e` feat: examination create read model, specialist contract and NEW-only sample policy (backend)
- `dae9361` chore: restore upstream formatting (no functional change)
- `897b640` test: adjust delete-recreate expectations to the NEW-only sample policy
- `7a69028` chore: regenerate shared API schema (additive DR35 read model + preview)
- `20f0761` feat: DR35 create-form data rules on the client (frontend + ТЗ файл в репозитории)

## Миграция 0020 (`backend/migrations/versions/0020_exam_specialist_form_snapshot.py`)
- `examinations.specialist_id` — FK на users, ON DELETE RESTRICT;
- `examinations.specialist_name` — замороженное при сохранении имя;
- `parties.form_snapshot` — JSONB-снапшот шага сверки (read model формы).
Revision id: `0020_dr35_specialist` (≤32 символов, ограничение alembic_version). Применяется тестовым фикстуром (conftest) автоматически.

## Договор специалиста (ТЗ §12)
- `created_by` — неизменяемый актёр аудита (кто сохранил карточку);
- `specialist_id` — выбранный специалист Госветслужбы; `specialist_name` замораживается при сохранении;
- выбор — только server-authoritative scoped endpoint: `GET /api/v1/examinations/parties/{party_id}/form` (`eligible_specialists`: активные VET/HEAD текущей лаборатории и роли; модуль `backend/src/modules/examinations/specialists.py`);
- сохранение перепроверяет выбор тем же предикатом (недоступный/неактивный специалист → 422);
- легаси-строки (specialist_id IS NULL) показывают `created_by` как специалиста — задокументированный fallback (ExaminationViewPage, view-модель);
- один вариант в select: readonly-select с тем же визуальным форматом (ТЗ §12.3), UUID в интерфейсе не выводится.

## Read model формы и живой расчёт (§4, §13–14)
- `GET /api/v1/examinations/parties/{party_id}/form` → `ExaminationFormView` (`backend/src/modules/examinations/form_model.py`): участники (Предприятие/ХС), тип продукции с русской меткой, принятые масса/количество, `required_research_ids`, `eligible_specialists`, ревизии. Снапшот замораживается в `parties.form_snapshot`; повторный бэкфилл не перетирает непустые замороженные значения; на открытии страницы нет SOAP/справочных вызовов.
- `POST /api/v1/examinations/parties/{party_id}/pricing-preview` → `PricingPreviewRequest/Response`: только чтение, не мутирует состояние; вызывает **ту же функцию** `evaluate_and_price` (через `commands.preview_pricing`), что и финальное сохранение — идентичность расчёта гарантирована кодом, а не дублированием логики.
- Клиент (`frontend/src/features/examinations/PricingPreview.tsx`): debounce 300 мс, отмена устаревших запросов, состояния: пусто / расчёт / пересчёт / успех / нет тарифа (CONFIGURATION_MISSING) / ошибка с повтором; деньги в браузере не считаются.

## NEW-only проба (§11)
- REUSE отклонён сервером на создании (`_reuse_rejected`, 422) и убран из UI (`SampleSelection.tsx`: только «Новый отбор пробы этой партии»);
- правка той же карточки в тот же день конвертирует NEW-тело в EditSample связанной пробы;
- `tests/examinations/test_delete.py` обновлён: замена использует NEW, счётчики проб = 2 (все 10 проходят).

## Конфликт цены (§14–15)
- `expected_total` в ExaminationWrite (режим COMPLETED) сверяется с пересчитанным; расхождение → `PRICE_CONFLICT` 409 в `commands.py` и `lifecycle.py`; UI показывает честное сообщение «Стоимость изменилась с момента предварительного расчёта».

## Запуски и результаты
Backend (env: `ENVIRONMENT=pytest`, `SESSION_COOKIE_SECURE=false`):
- `uv run --frozen pytest backend/tests/examinations/test_dr35_data_rules.py -q` → **21 passed**;
- регрессия по домену (arrivals, examinations, samples, pricing, parties) → **417 passed**, включая исправленный `test_delete.py` (10 passed);
- `ruff check backend` — чисто.

Frontend (Node 26 из `C:\Users\Алия\AppData\Local\Temp\opencode\node26`):
- `typecheck` — 0 ошибок; `lint` — 0 ошибок (1 предупреждение — существовавшее ранее в `use-catalog-context.ts`);
- `format:check` — чисто; `test -- --run` → **424 passed (58 файлов)**;
- `build` и `build-storybook` — успешно (storybook-static собран).

## Не выполнено (честно)
- E2E из §20 (`npm run test:e2e`) — **не запускался**: требует запущенного стека (dev-сервер + Postgres/Docker) и локальный сид `tests/e2e/identity-seed.local.json`, которого нет в изолированном воркспейсе; Docker по регламенту диспетча не поднимается. Прикрытие сценариев §20 — интеграционные backend-тесты (21 DR35 + регрессия) и компонентные frontend-тесты (424).
- Ручной просмотр в браузере/Storybook — не проводился интерактивно; проверены только сборки Storybook и unit-тесты.

## Схема API
`frontend/src/shared/api/schema.d.ts` перегенерирован добавлением read model и preview (adдитивно): дамп `app.openapi()` воркспейса (env `ENVIRONMENT=pytest`), типы `ExaminationFormView`, `PricingPreviewRequest/Response`, поля `specialist_id/specialist_name` в `ExaminationView`.

## Storybook
`examination.stories.tsx`: истории формы (форма, узкий экран, длинные значения, правка WAITING), `ПробаНовыйОтбор` (решение §11), `ТрихинеллоскопияОбязательна` (закреплённый GUID, `required_research_ids`), `ПредварительныйРасчёт`/`ПредварительныйРасчётУзкийЭкран` (тот же `PricingSection`, что на странице), журнал и диалог удаления.
