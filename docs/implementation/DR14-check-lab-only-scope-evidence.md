# DR14 — Справочник «Платные услуги» привязан только к лаборатории

Дата: 2026-11-12. Ветка: `feature/DR14-check-lab-only-scope` (BASE: main 98d9652).

## 1. Решение владельца (отменяет ТЗ DR11 §4 в этой части)

«Справочник "Платные услуги" привязан только к лаборатории. Убери связку с
продукцией вообще: пользователь в справочнике назначает стоимость платных услуг
и она применяется к сверкам ВСЕХ видов продукции». В интерфейсе пользователь
редактирует справочник в рамках своих лабораторий. Rulings R-DR14-1…7 —
`.superpowers/sdd/2026-11-12-check-pricing/dr14-progress.md`.

## 2. Миграция 0017_check_tariff_lab_scope

- `tariffs.product_species_id` → nullable (`ALTER COLUMN … NULLABLE`).
- Data-fix: `UPDATE tariffs SET product_species_id = NULL WHERE service_code IN
  ('PRODUCT_IDENTIFICATION','TRANSPORT_INSPECTION')` — чинит живые
  mis-scoped строки 110.00/140.00 (species ошибочно = UUID лаборатории);
  ничего не удаляется.
- Вместо `uq_tariff_scope_code_unit` — два частичных уникальных индекса:
  - `uq_tariff_lab_code_unit_check` (laboratory_id, service_code, unit_id)
    WHERE product_species_id IS NULL — область CHECK;
  - `uq_tariff_lab_species_code_unit` (laboratory_id, product_species_id,
    service_code, unit_id) WHERE product_species_id IS NOT NULL — область ВСЭ.
- Downgrade: честная ошибка (RuntimeError) при наличии строк с NULL species,
  иначе индексы удаляются, NOT NULL и прежняя уникальность восстанавливаются.
- `CURRENT_SCHEMA_REVISION` → `0017_check_tariff_lab_scope`
  (`backend/src/modules/identity/router.py`); `test_platform.py` (readiness
  guard + миграционный тест) проходит.

## 3. Pricing (сервер)

- `service._tariff_for_check(uow, laboratory_id, code)`: поиск тарифа CHECK
  только по `laboratory_id` партии + `service_code`, строки строго с
  `product_species_id IS NULL`; чужая лаборатория недостижима; отсутствующий
  тариф — прежний `CONFIGURATION_MISSING` с указанием услуги.
- `_price_check`: ветка «вид продукции не задан» удалена — species не
  требуется и не читается.
- `arrivals.reconciliation._price_check_services`: species партии больше не
  передаётся и не требуется (вспомогательная `_party_species_id` удалена).
- `GET /pricing/preview`: species обязателен только для `context="VSE"`.
- Пути ВСЭ (`_price_vse`, readiness) не тронуты — species обязателен.

## 4. Guard create/update тарифа

DR13-guard «species == laboratory_id → 422» для тарифов заменён честной
валидацией по коду (`commands._tariff_species`, константа
`CHECK_SERVICE_CODES` из `service.py`, сравнение по кодам, не по uuid):

- CHECK-коды: species принимается отсутствующим; любой переданный —
  нормализуется в NULL (species никогда не сохраняется для CHECK);
- остальные коды (ВСЭ): species обязателен — 422
  `«Тариф услуги ВСЭ требует вид продукции…»` при отсутствии;
- DR13-guard остаётся для method rules (`MethodRuleWrite`).

## 5. Редактор «Платные услуги» (frontend)

- `CheckServicesEditorPage`: никакой продукции — ни выбора, ни блокировки.
  Заголовок/контекст показывает только «Лаборатория: <название>»
  (`data-testid="check-services-laboratory"`); переключатель лабораторий для
  разрешённых ролей сохранён; правила доступа не изменились (пользователь
  редактирует свои лаборатории, VET — чтение).
- Блокировка «Вид продукции для этой лаборатории не настроен.» удалена;
  описание: «…применяется к сверкам продукции всех видов». Состояния
  loading/error/empty/delete-конфликт и узкий экран сохранены (сторис
  `PaidServicesWide/Narrow`).
- `api.fetchTariffs(labId, null)`: без species → серверный список CHECK-
  тарифов лаборатории (`GET /catalogs/tariffs` без `product_species_id`).
- `use-catalog-context.ts` не менялся: сообщение «Вид продукции не настроен»
  сохранено для ВСЭ-справочников (тарифы/методики), из CHECK-редактора убрано.
- `schema.d.ts` перегенерирован offline (`openapi()` приложения → локальный
  JSON → `openapi-typescript`), не редактировался вручную.

## 6. Тесты

Backend (обновлены/добавлены):
- `catalog_pricing/test_pricing.py`: CHECK-тесты используют NULL-species
  тарифы; новый `test_check_prices_without_species` (species отсутствует и
  отличается — цена одна); API-тест создания CHECK-тарифа без species
  (`product_species_id: null` в ответе, список без species), ВСЭ-код без
  species → 422.
- `catalog_pricing/test_rules.py`: `test_check_tariff_accepts_and_normalizes_
  missing_species` (absent + provided→NULL), `test_vse_tariff_requires_species`,
  `test_check_tariff_lab_scope_unique` (частичный уникальный индекс),
  уникальность/неположительная цена переведены на ВСЭ-код.
- `arrivals/test_dr11_pricing.py` + `check_pricing_seed.py`: сид CHECK-тарифов
  без species; «чужая область» = species-строка той же лаборатории + NULL-строка
  чужой лаборатории; `test_party_species_differences_never_change_the_price`.

Frontend: `CheckServicesEditorPage.test.tsx` — сохранение create/update без
`product_species_id`, наличие только «Лаборатория: …», редактор остаётся
рабочим при species=lab (DR13-блокировка переработана), пустой каталог →
создание; моки MSW — NULL-species CHECK-тарифы.

## 7. Гейты (на закоммиченном дереве)

- `uv run --frozen ruff check backend frontend/tests/e2e` — passed.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/catalog_pricing
  backend/tests/test_platform.py backend/tests/operations -q` — 226 passed,
  1 failed: `operations/test_configuration.py::
  test_base_compose_runtime_requires_shared_secret_without_default` —
  окруженезависимый тест `docker compose config` (возвращает 0 без секретов на
  этой машине), к изменениям DR14 не относится, docker не пересобирался.
- Frontend (Node 26.13.0): `format:check`, `typecheck`, `lint` (0 errors;
  1 pre-existing warning `use-catalog-context.ts` exhaustive-deps),
  `test -- --run` (50 файлов / 296 passed), `build`, `build-storybook` — all ok.
- Известные 2 падения `backend/tests/examinations/test_delete.py` на plain main
  — не запускались (не затронуты задачей), признаны ранее.

## 8. Честно не выполнено / ограничения

- Миграция НЕ применялась к живой dev-БД вручную — по инструкции контроллер
  применит её при деплое (`alembic upgrade head`); никакой SQL руками.
- `test:ui` (Playwright auth) не запускался: задача не переносит компоненты
  входа и не меняет auth.
- Живой write ВетИС не выполнялся; Docker не пересобирался; данные не
  удалялись.
- Проверка на использующем экране (журнал сверок) покрыта автотестами
  `backend/tests/arrivals` (расчёт при сохранении сверки), живой прогон —
  контроллер после применения миграции.
