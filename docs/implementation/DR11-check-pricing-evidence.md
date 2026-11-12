# DR11 — расчёт стоимости двух услуг сверки (evidence)

Дата: 2026-11-12. Ветка: `feature/DR11-check-pricing` (от main 0c29957).
ТЗ: `dorabotka/2026-11-12-reconciliation-check-services-pricing.md`; rulings R-DR11-1..8.

## Root cause (§1) — подтверждено

- `ReconciliationForm.toPayload` отправлял `services: []` (оставлено как факт
  выполненной услуги; invoice строится не из него).
- `save_reconciliation` не вызывал `catalog_pricing.evaluate_and_price`.
- `ReconciliationView` не содержал snapshot; frontend показывал только
  `initial.services` с прочерками.

## Серверный путь расчёта (§5)

`save_reconciliation` (backend/src/modules/arrivals/reconciliation.py):

1. валидация сверки → если `validation.complete`, собирается
   `PricingRequest(context="CHECK")`:
   - `performed = ["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"]`
     (точные коды, R-DR11-1);
   - `laboratory_id` — лаборатория партии; `product_species_id` —
     `classification_snapshot["product"]["id"]` (тот же species-scope, что и
     в examinations/documents `_product_scope`; для целевой живой партии это
     `362aa885-9b9f-ae95-05d0-f9570f4fbdc6`);
   - accepted/delivered quantity + unit_id — из сохранённых QuantitySet;
   - `decision`, `fair` — из сверки; клиентские цены не существуют.
2. вызов существующего `evaluate_and_price()` (read-only, до commit);
3. `row.pricing_snapshot = snapshot.model_dump()` — атомарно с фактами
   (миграция `0016_reconciliation_pricing`, колонка JSONB nullable);
4. `ReconciliationView.pricing` возвращается в PUT/GET.

Неполная (незавершённая) сверка сохраняется без snapshot (O-09); ранее
замороженный snapshot не трогается. Полная валидная сверка обязана
рассчитаться; отсутствие правила/тарифа/единицы → 422
`CONFIGURATION_MISSING`, commit не выполняется (никакого пустого/нулевого
snapshot).

Механика расчёта — существующий `_price_check`: тариф по точному scope
(laboratory + species + service_code, чужой scope невозможен); база по
`CheckServiceRule.multiplier_basis` (ONE_SERVICE / ACCEPTED_QUANTITY /
DELIVERED_QUANTITY c unit партии); решение проверяется по
`applicable_decisions`; при пустых правилах — разрешённый дефолт
ONE_SERVICE с явной lineage-отметкой (`method_snapshot.multiplier_basis =
null`, `source.name = "Правило услуги не задано"`); `fair=true` → обе строки
как выполненные, `unit_price/amount/total = "0.00"`, обычная цена не
сохраняется. Русские названия услуг унифицированы
(`CHECK_SERVICE_NAMES` = формулировки макета/каталога).

## Контракт (§6)

`ReconciliationView.pricing: PricingSnapshot | null` — `{lines:[{service_code,
name, unit_id, quantity, unit_price, amount}], total, currency:"RUB",
fair}`. Старое `services` осталось фактом выполненных услуг и больше не
используется как источник invoice. Snapshot не пересчитывается при изменении
тарифа (тест §9-9).

## Frontend (§7)

- `ReconciliationForm`: при наличии `initial.pricing` — таблица «Услуга /
  Единица расчёта / Количество / Тариф / Сумма» + «Итого» (сохранённые
  серверные значения; формат только отображения `100,00 ₽`, итог не
  вычисляется на клиенте); иначе прежний empty-state. Демонстрационных цен
  50/94/100/130 нет.
- `ReconciliationFeedback`: ветка `CONFIGURATION_MISSING` — StatusView
  «Стоимость услуг не рассчитана» с названием конкретной услуги (из
  `errors[].path = performed.<CODE>`), ввод не очищается.
- Сохранение публикует возвращённый view (query обновляется без
  перезагрузки); узкий экран — media query ≤768px, без overflow страницы.
- Stories: `РасчетСтоимости`, `ЯрмаркаБезОплаты`, `КонфигурацияОтсутствует`.
- `schema.d.ts` перегенерирован (`gen:api` из локального openapi.json, без
  Docker).

## Тесты

Backend — `backend/tests/arrivals/test_dr11_pricing.py` (12 шт., §9-1..10):
полный save с snapshot; точные коды/имена/total; CONFIGURATION_MISSING без
строки в БД; чужие species/lab → CONFIGURATION_MISSING; applicable_decisions
(ACCEPT_ALL ok / PARTIAL → 422); ONE_SERVICE / ACCEPTED_QUANTITY /
DELIVERED_QUANTITY; fair → нули без скрытой цены; повторный save
идемпотентен; изменение тарифа не меняет snapshot; stale If-Match → 409 и
commit пустой.

Frontend — 6 новых тестов в `ReconciliationForm.test.tsx` (§7-1..6): save с
pricing заменяет empty-state; точные русские названия и колонки;
CONFIGURATION_MISSING называет услугу и сохраняет ввод; ярмарка 0,00 ₽;
snapshot виден после новой загрузки; 390px без overflow.

## Результаты гейтов

- `uv run --frozen ruff check backend frontend/tests/e2e` — passed.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/catalog_pricing backend/tests/test_platform.py -q` — passed (см. финальный прогон в отчёте задачи; миграционный guard test_platform обновлён: `CURRENT_SCHEMA_REVISION = "0016_reconciliation_pricing"`).
- Frontend: `format:check`, `typecheck`, `lint` (1 pre-existing warning в
  use-catalog-context.ts, не из этой задачи), `test -- --run` (50 файлов /
  287 тестов), `build`, `build-storybook` — passed.

## Живые проверки (API/e2e) — ЧЕСТНО НЕ ВЫПОЛНЕНО

- `GET`/`PUT` против живого backend не выполнялись: backend не запущен в этой
  сессии, пересборка/запуск контейнеров — шаг контроллера. Read-only проверка
  scope целевой партии (laboratory `2812e437-facc-432f-9242-5162c9d9f49f`,
  species `362aa885-…`) и Storybook e2e остались контроллеру/полному
  прогону.
- Живой VetIS write не выполнялся; `VETIS_WRITE_ENABLED`, `.env*`, compose и
  `vetis-schema/` не тронуты. `tmp/openapi.json` — временный артефакт
  генерации схемы.

## Миграции

`0016_reconciliation_pricing` (downgrade удаляет только колонку). Данные не
удаляются и не перезаписываются.
