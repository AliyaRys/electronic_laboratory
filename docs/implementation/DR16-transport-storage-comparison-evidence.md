# DR16 — сверка «Способ хранения продукции при перевозке» (CHK-F12): evidence

Дата: 12.11.2026 · Ветка: `feature/DR16-transport-storage-comparison` · Спецификация:
`dorabotka/2026-11-12-transport-storage-comparison.md` §1–10, решения R-DR16-1..8.

## Что сделано

Backend:

- Новый единый словарь `backend/src/modules/integrations/vetis/storage_types.py`:
  `FROZEN=Замороженный, CHILLED=Охлажденный, COOLED=Охлаждаемый, VENTILATED=Вентилируемый`;
  неизвестный непустой код → «Неизвестный способ хранения» + диагностическая запись
  в лог, код не подменяется (R-DR16-1/3).
- `normalizer.py`: `NormalizedEntry.transport_storage_type` извлекается
  namespace-aware из `vd:certifiedConsignment/vd:transportStorageType`;
  `VdDocument.transportStorageType` добавлен в типизированный source snapshot
  (`backend/src/modules/arrivals/schemas.py`). Raw XML, checksum, revision не
  меняются (R-DR16-2).
- `reconciliation.py::source_projection()`: публикует раздельно `storageCode`
  (исходный код) и `storage` (русское); отсутствие узла = отсутствие значения —
  фиктивных отметок нет (R-DR16-3).
- `queries.py::_external_fields()`: `IncomingView.external.fields` получил
  `storageCode` и `storage`; старые ключи не тронуты (R-DR16-4).
- XML-гашение: `receipt_mapping.py` уже копирует исходный
  `transportStorageType` из закреплённого source XML (строка `_copy_named(...)`),
  русский текст никогда не подменяет внешний код (R-DR16-6) — покрыто
  существующими тестами `test_receipt_mapping.py`.
- Backfill: идемпотентная перенормализация через существующий
  `run_backfill()` (DR5 §11) — обновляются только производные поля snapshot
  (`transportStorageType`), raw XML/checksum/source identity/ETag и локальные
  факты не меняются; повторный запуск — 0 изменений. Миграция НЕ потребовалась.

Frontend:

- `comparedFields()` в `api.ts`: `CHK-F12` «Способ хранения продукции при
  перевозке», блок `transport`, сразу после F10/F11; источник — backend-овское
  русское `storage` (фронтенд код не переводит, R-DR16-5).
- `ComparisonField`: новый опциональный `actualPlaceholder`; для `CHK-F12`
  передаётся «Фактический способ хранения»; общий компонент, отметка только
  явная, mismatch → фактическое значение + причина; mismatch ограничивает
  решения по существующей серверной матрице (`CHK-F12` уже inadmissible в
  backend-валидаторе и в `INADMISSIBLE_FIELDS`).

## Тесты (§8)

Backend (всего по DR16: 17 тестов):

- `backend/tests/vetis/test_dr16_storage_type.py` — 9 passed: CHILLED →
  «Охлажденный»; все 4 кода; неизвестный код сохраняется с честным fallback и
  не считается совпадающим; отсутствие узла остаётся отсутствующим;
  namespace-aware извлечение; raw XML не переписывается.
- `backend/tests/arrivals/test_dr16_storage.py` — 9 passed: projection публикует
  `storageCode`+`storage` раздельно; отсутствующий узел; неизвестный код;
  `external.fields` несёт оба ключа; CHK-F12 mismatch ограничивает decisions до
  `RETURN_ALL`; mismatch требует факта и причины; отметка на отсутствующем поле
  блокируется; registry ground; backfill добавляет storage без изменения
  checksum и идемпотентен.

Frontend (7 тестов, `StorageComparison.test.tsx`): CHK-F12 в транспортном блоке
с русским значением и без кода `CHILLED`; порядок F09→F10→F11→F12; mismatch
открывает placeholder «Фактический способ хранения» + причину; отметка и факты
восстанавливаются после открытия; только RETURN_ALL доступен при mismatch;
неизвестный код — честный fallback без переполнения на 390 px; никакой
автоматической отметки.

Проверки gates (все на коммите):

- `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed.
- `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis -q` —
  см. отчёт контролёру; известные 2 pre-existing failures в
  `backend/tests/examinations/test_delete.py` не затрагивались (не запускались в этом gate — там отдельный suite).
- `npm.cmd run format:check` / `typecheck` / `lint` / `test -- --run` (302 passed) /
  `build` / `build-storybook` — passed. Pre-existing lint warning
  (`use-catalog-context.ts`, useMemo deps) не связан с DR16.
- TypeScript schema: `npm run gen:api` выполнен против OpenAPI, сгенерированного
  из кода без БД — `frontend/src/shared/api/schema.d.ts` без изменений: поля
  `ExternalFields.fields` — открытая карта `string | null`, форма DTO не
  менялась.

## Ограничения / не выполнено

- Живой `ProcessIncomingConsignment` не вызывался (запрещено); write-сценарии
  only-not-run. Транспортный spy — не требуется: в тестах используются
  обезличенные XML fixtures и чистые функции.
- Пересборка Docker-контейнеров и merge — зона контролёра (R-DR16-8).
- Данные не удалялись; миграций нет.
