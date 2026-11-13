# DR20 — дата выработки и срок годности в сверке (CHK-F22/CHK-F23). Evidence

Ветка: `feature/DR20-production-expiry-dates` (из `main`, 7b6a1f8).
Спецификация: `dorabotka/2026-11-13-production-expiry-date-reconciliation.md` (§1–11), предписания R-DR20-1..8.

## Реализация

Backend:
- `backend/src/modules/arrivals/schemas.py` — типизированная структура `GoodsDate` (R-DR20-1): `firstDate`/`secondDate`/`informalDate` + `firstDateHour`/`secondDateHour` (час хранится отдельно, R-DR20-2); строгая календарная валидация `strict_calendar_date` (ГГГГ-ММ-ДД, «2026-02-30» отклоняется); `Batch.dateOfProduction`/`Batch.expiryDate`; единый проецирующий хелпер `goods_date_fields(batch, base)` (R-DR20-3) — единичная дата заполняет только `<base>`, интервал только `From/To`, informal только `…Informal`; отсутствующее поле — четыре `None`, без выдуманных дат.
- `backend/src/modules/integrations/vetis/normalizer.py` — namespace-aware разбор `vd:batch/vd:dateOfProduction|expiryDate/vd:firstDate|secondDate|informalDate`; календарная дата собирается только из `dt:year/month/day`, час — отдельно; никакого tz-сдвига; невалидная комбинация → контролируемая диагностическая ошибка (`entry.date_problems` + структурированный warning `goods_date_normalization_problem`), импорт остальных реквизитов не ломается (R-DR20-2).
- `backend/src/modules/arrivals/queries.py` / `reconciliation.py` — read model `producedOn/producedOnFrom/producedOnTo/producedOnInformal` + `expiresOn/…` в `ExternalFields.fields` и в CHK source projection (machine-readable ISO-даты; форматирование — на фронте из структуры, без повторного разбора raw XML).
- `backend/src/modules/arrivals/validation.py` — §8: отметка требуется только при наличии source-значения (существующее правило FT-ARR-03); фиктивная отметка по отсутствующему значению — blocking; для CHK-F22/F23 факт при расхождении обязан быть строгой календарной датой (blocking «Фактическая дата должна быть корректной календарной датой в формате ГГГГ-ММ-ДД»); `expiryDate` раньше `dateOfProduction` (в т.ч. по границам интервалов) → blocking CHK-F23 «…раньше даты выработки…»; CHK-F22 добавлен в derived act (source/actual/reason). Матрица ACCEPT_ALL/PARTIAL/RETURN_ALL не обходится: CHK-F22 — inadmissible ground (existing FieldSpec), actual не меняет snapshot.
- `backend/src/modules/integrations/vetis/backfill.py` — новый таргетированный `run_goods_date_backfill` (§5.3, R-DR20-4): переразбирает из `vetis_source_documents.raw_xml` ТОЛЬКО два поля; raw XML/checksum/UUID/scope не трогаются; revision документа и партии не изменяется; решение «скрыть» сохраняется перезаписью `content_hash` у HiddenIncoming (хеш — производное значение, согласованное со снапшотом); идемпотентен (второй прогон — `unchanged`).
- Миграции НЕ требуются: snapshot — JSONB (предпочтение §10 соблюдено), данных не удаляли.
- TS-схема: `npm run gen:api` выполнен по свежему OpenAPI-документу backend — diff `schema.d.ts` пуст (SourceSnapshot/Batch не входят в OpenAPI-контракт; поля read model — динамический `fields`).

Frontend:
- `frontend/src/features/arrivals/api.ts` — `formatGoodsDate` (R-DR20-5): единичная — `03.11.2026` (срок годности — `до 10.11.2026`, как в примере §7.1), интервал — `с 03.11.2026 по 05.11.2026`, informal — исходный текст без выдуманной даты; интервал никогда не сворачивается в одну дату; `comparedFields()`: в product-блоке после существующих полей — CHK-F22 «Дата выработка», затем CHK-F23 «Срок годности», оба с `actualType: "date"`.
- `frontend/src/features/arrivals/ComparisonField.tsx` + `shared/ui/Field.tsx` — общий `ComparisonField` поддерживает `actualType: "date"` → нативный `<input type="date">` (R-DR20-6: тип фактического значения CHK не менялся молча — факт остаётся одиночной календарной датой в существующем `Comparison.actual` строкой; расширение на интервал факта не выполнялось, т.к. требует сначала server-side payload-контракта по §7.2); причина по CHK-F43 обязательна; отметки только явные.
- `ReconciliationForm.tsx` — прокидывает `actualType`.

## Тесты

Backend (fixtures; живой VetIS write не выполнялся):
- `backend/tests/vetis/test_dr20_goods_dates.py` (§9-1…5 + диагностика): единичная дата выработки; единичный срок годности; интервал с сохранением второй даты; informal не становится календарной датой; час не сдвигает календарный день (23:00 → тот же день, час отдельно); невалидная комбинация — контролируемый диагностический error без поломки импорта; отсутствующие узлы остаются absent.
- `backend/tests/arrivals/test_dr20_goods_dates.py` (§9-6…10): CHK-F22/F23 в source projection (единичная/интервал/informal); отсутствующие поля не требуют фиктивной отметки (и отказывают фиктивной); mismatch требует actual+reason и попадает в акт с source/actual/reason; не-дата факт отклоняется с понятной ошибкой; expiry раньше production блокируется; таргетированный backfill идемпотентен, raw XML/checksum не меняются, revision не двигается; без raw XML — честная ошибка.
- Гейт: `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed; `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis -q` — **290 passed**.

Frontend:
- `frontend/src/features/arrivals/GoodsDateComparison.test.tsx` (§9-1…6): оба поля в product-блоке в порядке (после CHK-F21); форматы единичная/интервал/informal; для mismatch открывается нативный date input внутри карточки общего `ComparisonField` (радио-отметки того же компонента); сохранённые отметки и фактические значения восстанавливаются после reload; ошибка привязана к конкретной карточке (CHK-F23, без затекания в CHK-F22); ширины/клавиатура/длинные значения — **JSDOM-ограничение раскрыто**: движка раскладки нет, реальная проверка 1440/1024/768/390 px относится к Playwright e2e; проверены контракт отсутствия горизонтального переполнения, tab-фокус и длинный informal-текст.
- Гейт: `npm run format:check` — ок; `npm run typecheck` — ок; `npm run lint` — 0 errors (1 предсуществующее warning в unrelated файле); `npm run test -- --run` — **52 files / 329 passed**; `npm run build` — ок; `npm run build-storybook` — ок.

## Границы и честные не-выполнения

- Docker-пересборка и merge в main — по инструкции контроллера НЕ выполнялись субагентом.
- Живой write в ВетИС не выполнялся (запрещён); все тесты на fixtures.
- Playwright e2e для реальных вьюпортов не запускался (дисциплина гейта — только jsdom-тесты); ограничение раскрыто в тесте.
- Известные предсуществующие 2 падения `backend/tests/examinations/test_delete.py` — вне гейта DR20, не воспроизводились, раскрываются как известные.
- Миграция БД не требовалась и не создавалась.
