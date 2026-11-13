# DR19 — «Вид транспорта» (CHK-F09) в сверке ВСД: доказательства реализации

Дата: 13.11.2026 · Ветка: `feature/DR19-transport-type-reconciliation` (база main 7b6a1f8) · ТЗ: `dorabotka/2026-11-13-transport-type-reconciliation.md`

## Что сделано

- **Единый словарь** `backend/src/modules/integrations/vetis/transport_types.py`: 1=Автомобильный, 2=Железнодорожный, 3=Авиатранспортный, 4=Морской (контейнер), 5=Морской (трюм), 6=Речной (v2.1), 7=Перегон (скота) (v2.1); неизвестный код → «Неизвестный вид транспорта» + диагностика (`unknown_transport_type`); отсутствующий/пустой код остаётся отсутствующим (R-DR19-1/3).
- **Normalizer** (`vetis/normalizer.py`): namespace-aware разбор `vd:certifiedConsignment/vd:transportInfo/vd:transportType`, код хранится КАК СТРОКУ (`transportType` в snapshot `vdDocument`), не из `vehicleNumber`, не приводится к числу (R-DR19-2).
- **Read model**: `queries.py::_external_fields` публикует `transportTypeCode` (сырой код) и `transportType` (русская расшифровка) раздельно; `reconciliation.py::source_projection` заполняет ранее пустой `transportKind` из ТОГО ЖЕ словаря — второй словарь не создан (R-DR19-4). Валидатор `FieldSpec("CHK-F09","транспорт","transportKind","inadmissible")` существовал и теперь получает реальное значение.
- **Backfill**: использован существующий идемпотентный механизм `vetis/backfill.py` (перепарсивание сохранённого raw XML, только производные поля; raw XML/checksum/UUID/revision/локальные факты не трогаются). Миграция БД НЕ требуется (snapshot — JSONB, поле опционально).
- **Frontend** (`api.ts::comparedFields`): CHK-F09 — первая карточка transport-блока, `source: external.transportType`, placeholder «Фактический вид транспорта», общий `ComparisonField`; порядок: CHK-F09 → CHK-F10 → CHK-F11 → CHK-F12 (совпадает с §5 ТЗ). Отметка только явная; mismatch требует факт+причину; серверная матрица решений не обходится (CHK-F09 — недопустимое транспортное расхождение). Raw `vd:transportType` в XML гашения не изменяется (source берётся из закреплённого raw XML, `receipt_mapping.py` сохраняет `transportInfo` целиком).

## Тесты (§7)

Backend (файлы `backend/tests/vetis/test_dr19_transport_type.py`, `backend/tests/arrivals/test_dr19_transport_type.py`; fixtures + namespace-aware парсер, живой `ProcessIncomingConsignment` не вызывается):

1. Коды 1–7 дают точные русские названия (включая v2.1: 6, 7).
2. `transportTypeCode`/`transportType` публикуются раздельно; код хранится строкой, не берётся из vehicleNumber.
3. Неизвестный код «9» сохранён, honest fallback, никогда не auto-match.
4. Отсутствующий узел не создаёт фиктивной отметки (даже при наличии vehicleNumber).
5. CHK-F09 в source projection (`transportKind`) и в validation (inadmissible; mismatch требует факт+причину; absent не требует отметки).
6. Backfill существующего raw XML идемпотентен и не меняет checksum/raw XML.

Frontend (`TransportComparison.test.tsx`): первый в transport-блоке; код 1 → «Автомобильный»; все коды 1–7; mismatch placeholder + причина; отметка восстанавливается после повторного открытия; честные состояния (неизвестный код без переполнения на 390 px, явная отметка/фокус, отсутствие карточки без значения).

## Результаты проверок (на закоммиченном дереве)

- `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis -q` — 285 passed.
- `npm.cmd run format:check` — ok; `typecheck` — ok; `lint` — 0 errors (1 pre-existing warning в `use-catalog-context.ts:340`, файл не изменялся); `test -- --run` — 52 files, 330 passed; `build` — ok; `build-storybook` — ok.

## Честно не выполнено / ограничения

- Проверка ширин 1440/1024/768/390 px в браузере не выполнялась агентом — jsdom проверяет только отсутствие горизонтального переполнения на 390 px; визуальная проверка остаётся за контроллером (пересборка контейнеров и браузерная проверка — задача контроллера, R-DR19-7).
- Известные 2 падения `backend/tests/examinations/test_delete.py` — pre-existing, вне затронутых каталогов (в гейтах §7 их нет).
- Живой `ProcessIncomingConsignment` не вызывался (запрещён §7).
- Миграции БД нет и она не требовалась; данные не удалялись; `DESIGN.md`, `seed_identity.py`, `*.local.json`, `.env*`, vetis-schema не изменялись.
