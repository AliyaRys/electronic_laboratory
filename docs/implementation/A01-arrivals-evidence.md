# A01 — Идентичность и очереди (Поступления), свидетельства выполнения

Задача: идентичность входящего эВСД, скрытие документов, очереди-модели чтения, разрешение продукции Меркурия 2-го уровня, фронтовый список поступлений. План: `docs/TZ_development/plans/2026-11-06-04-arrivals.md`, задача A01; ветка `feature/A01-queues`.

## Что сделано

### Backend (`backend/src/modules/arrivals/`, миграция `0006_arrivals`)

- `0006_arrivals.py` (после `0005_mercury_product_lvl2`, существующие миграции не тронуты): `incoming_documents` UNIQUE(contour, evsd_uuid), `parties` (classification_snapshot с четырьмя уровнями и unit), `reconciliations`, `receipt_confirmations`, `hidden_incoming` (UNIQUE(contour, evsd_uuid), hash без fetched_at). Индексы `(laboratory_id, created_at DESC, id DESC)` на incoming_documents и parties, внешние UUID и статус.
- `commands.py`:
  - `upsert_incoming(uow, document: IncomingDocument) -> Party` — стабильная идентичность по (contour, evsd_uuid); повторный импорт того же UUID обновляет снимок/fetched_at; новый UUID с тем же номером — второй документ и вторая партия; commit остаётся координатору.
  - hash = SHA-256 канонического снимка (fetched_at не входит); существенное изменение удаляет решение о скрытии (документ снова виден, AT-23), неизменный повтор не возвращает строку.
  - Неоднозначная привязка площадки: `laboratory_id is None` → 422 `INTEGRATION_SCOPE_MISSING`, партия НЕ создаётся (таблица `vetis_bindings` появится в ТЗ-10 — там тот же код пути).
  - Классификация: `product` (2-й уровень) разрешается по contour+GUID к `mercury_product_guid_lvl_2` локально, без сети; промах → 422 `MERCURY_PRODUCT_DICTIONARY_MISS` с русским текстом БЕЗ сырого GUID; `subProduct` (3-й) и `productItem` (4-й) хранятся отдельными полями, `productItem.name` не подменяет название 2-го уровня.
- `ports.py` (DATA-06): `ReceiptEvidenceReader.read(party_id) -> ReceiptEvidence | None`; типизированный `ReceiptEvidence`; реализации нет — реальные доказательства придут из ТЗ-11/фикстур тестового composition root.
- `queries.py`: очереди как read model на query-time: EXPECTED (нет начатой сверки/confirmation), WORK (есть сверка или confirmation без завершённой ВСЭ — после удаления ВСЭ партия остаётся «В работе», confirmation сохраняется), ACCEPTED (положительный confirmation + завершённая ВСЭ, наличие таблицы `examinations` опрашивается `to_regclass` — до ТЗ-06 корректно даёт WORK). Scope-фильтр лаборатории применяется до count/поиска; 20 строк, создано DESC/id DESC; result-фильтры WAITING/RETURNED/COMPLETED; поиск (номер документа, productItem, название продукции) — case-insensitive, trimmed, escaping LIKE.
- `router.py` (`/api/v1/arrivals`): GET список (queue/result/q/page, laboratory_id обязателен, `arrivals:list`), GET `/{party_id}` (ETag партии, `arrivals:read`, чужой UUID → 404), DELETE `/{party_id}` → 204 hide (только expected без начатой работы; иначе 409 STATE_CONFLICT; Idempotency-Key + If-Match), POST `/sync` → авторизация `vetis:sync` и честный **503 INTEGRATION_NOT_CONFIGURED** от DisabledVetisAdapter (никакого фиктивного импорта).
- `integrations/vetis/{ports,contracts}.py` (DATA-06): контракты VetisScope/IncomingPage/ReceiptIntent/Submission/ExternalResult/ReconciliationEvidence (DTO API-04/10, не SOAP-типы) и `DisabledVetisAdapter`, все порты которого бросают стабильный 503 `INTEGRATION_NOT_CONFIGURED`; SOAP/сети нет.
- `CURRENT_SCHEMA_REVISION` обновлён на `0006_arrivals`; conftest расширен сбросом arrivals-таблиц.

### Тесты (именованные из брифа — все пять реализованы и зелёные)

`uv run --frozen pytest backend/tests/arrivals -v` → **9 passed**:

- `test_upsert_stable_identity` — два импорта одного UUID → 1 партия; новый UUID с тем же номером → 2.
- `test_hidden_hash` — неизменённый повтор невидим; fetched_at не меняет hash; существенное изменение снова видно (решение о скрытии снято).
- `test_external_update_preserves_checks` — refresh снимка не затирает actual/marks сохранённой сверки.
- `test_queue_after_examination_delete` — confirmation есть, ВСЭ удалена → очередь WORK, confirmation остаётся; с завершённой ВСЭ → ACCEPTED.
- `test_product_lvl2_name` — известный GUID → русское имя «говядина» из словаря; неизвестный → `MERCURY_PRODUCT_DICTIONARY_MISS` без сырого GUID в строке.
- `test_at_23_hide_expected_does_not_annul_evsd` — документ остаётся в БД, скрытый неизменный повтор не возвращает строку.

API-тесты (`test_api.py`): scope до count/поиска (403 чужая лаборатория), 20 строк/страница 2/устойчивый порядок, scoped поиск, hide 204 + честный sync 503, DisabledVetisAdapter 503. Фикстуры — типизированные (`IncomingDocument` через pydantic), вставляются только через `upsert_incoming`; прямой SQL используется только для stub-таблицы `examinations` в тесте очереди (имитация схемы ТЗ-06) и для сверочной строки (команда сохранения — задача A02). Runtime demo-переключателей нет.

### Полные backend-гейты (на финальном дереве)

- `uv sync --frozen` — ok; `ruff check backend` — All checks passed; `ruff format --check` — 75 files formatted; после каждого `ruff format` файлы перекомпилированы (`compileall` 0) и импортированы (`import backend.src.interfaces.main` ok) — порча `except (A, B)` не воспроизводилась, байты проверены.
- `mypy backend/src` — **Success: no issues found in 50 source files**. (Полный `mypy backend` имеет 56 предсуществующих ошибки в тестах каталога/identity — воспроизводятся на базовом дереве 7fcfde9, к A01 не относятся.)
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` → **210 passed, coverage 94.03%** (arrivals: commands 92%, queries 88%, router 89%, schemas 98%, models 100%).

### Frontend

- `frontend/src/features/arrivals/api.ts` — fetch/hide поверх единственного транспорта; `ArrivalList.tsx` — таблица очереди (продукция 2-го уровня, документ, отправитель, количество/масса, очередь), строки ведут на настоящий party_id (`/labs/:labId/arrivals/:partyId/reconciliation` — там ясная заглушка A02); raw GUID никогда не показывается.
- `frontend/src/pages/ArrivalsPage.tsx` — очереди EXPECTED/WORK/ACCEPTED табами, result-фильтры WAITING/RETURNED/COMPLETED, поиск и страница — в URL; кнопка «Обновить» честно disabled с подписью «Обновление из ВетИС не настроено» (никакого пустого успешного импорта); диалог скрытия только для expected.
- Маршрут `/labs/:labId/arrivals` подключён в `app/router.tsx` вместо заглушки; `schema.d.ts` перегенерирован `npm run gen:api` из живого `/openapi.json` (+300 строк, без переписывания DTO руками).
- Фикстуры — только в тестах (MSW-обработчики и page.route), без runtime demo-режима.

### Гейты frontend

- `npm.cmd run lint` — ok; `format:check` — ok; `typecheck` — ok; `test` → **97 passed** (в т.ч. новые ArrivalList.test 3, ArrivalsPage.test 3); `build` — ok; `build-storybook` — ok (новые stories `arrival-list.stories.tsx`: ожидается/в работе/принято/пустая очередь).
- Playwright (`npx playwright test tests/e2e/arrivals.spec.ts`) → **2 passed**: переход по настоящему ID в заглушку сверки и назад сохраняет `?queue=expected` (URL-контекст), честный disabled-«Обновить», скриншоты 1440/390 (`test-results/a01-*.png`).
- Тесты SwitchContext скорректированы минимально: маршрут arrivals стал настоящей RequireSession-страницей, поэтому shell-тест использует заглушку Журнала ВСЭ и добавлен MSW-обработчик `/me`.

### Не выполнялось / вне задачи A01

- Реальный API e2e (identity/catalogs spec) — требует поднятого backend+PostgreSQL+Redis из отчётов F03/C02; в этой сессии не запущено, потому suites identity/catalogs не выполнялись (не зависят от A01).
- ReconciliationPage/формы сверки — A02 (осознанно не строились).
- POST /arrivals/sync реальный — ТЗ-10; POST receipt — ТЗ-11.
- `vetis_bindings`/`vetis_operations` ORM — приходят с ТЗ-10; в queries/commands уже есть безопасные `to_regclass`-проекции (незавершённое внешнее намерение блокирует скрытие, как только таблица появится).

## Коммит

- `feat: add incoming identity and scoped arrival queues` (backend + frontend, ветка `feature/A01-queues`).

## Fix round 1 (по ревью контроллера, 2 Important)

**Finding 1 — If-Match не сравнивался с ревизией партии в hide.**
- `commands.hide_incoming` теперь принимает `expected_revision: int | None` и после блокировки строки партии (`with_for_update`, зеркало паттерна `_scoped_target(lock=True)` из identity) вызывает `ensure_revision`: отсутствующий If-Match → 422 `REVISION_REQUIRED`, несовпадающий → 409 `REVISION_CONFLICT`. `router.hide_arrival` парсит If-Match и передаёт результат в команду (формат-проверка больше не единственная проверка заголовка).
- Новые тесты (`backend/tests/arrivals/test_api.py::test_hide_requires_current_if_match`): hide без If-Match → 422 REVISION_REQUIRED; stale `"9"` → 409 REVISION_CONFLICT, строка остаётся в очереди; корректный `"1"` → 204; повторный DELETE с тем же Idempotency-Key и корректным If-Match → 204 (API-01 idempotent replay), очередь пустая.
- Существующий `test_at_23_...` обновлён под новую сигнатуру (`party.rev`), существующие If-Match `"1"` в старых тестах остаются корректными.

**Finding 2 — внешнее существенное изменение не переразрешало классификацию.**
- В ветке `content_hash != hash` команды `upsert_incoming` классификация теперь переразрешается ДО любых обновлений: `_classification_snapshot` повторно проверяет lvl2 GUID по `mercury_product_guid_lvl_2` (неизвестный GUID → 422 `MERCURY_PRODUCT_DICTIONARY_MISS` и никакого мутационного следа — ни снимок документа, ни партия не меняются), затем обновляются `Party.classification_snapshot` (+`Party.rev+1`, ETag меняется) и снимок документа; факты сверок (actual/marks) по-прежнему не затрагиваются.
- Новый тест `test_import_and_queues.py::test_external_update_reresolves_classification`: импорт «говядина» + сохранённая сверка; внешнее обновление с GUID «свинины» → classification re-resolved в `{"id": pork, "name": "свинина"}`, checks прежние; обновление с неизвестным GUID → 422 `MERCURY_PRODUCT_DICTIONARY_MISS`, имя остаётся «свинина», hash документа не изменился.

**Гейты после фиксов (на закоммиченном дереве):**
- `uv run --frozen pytest backend/tests/arrivals -q` → **11 passed**;
- `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85` → **212 passed, coverage 94.10%** (arrivals: commands 93%, queries 89%, router 89%, schemas 98%, models 100%);
- `ruff check` → All checks passed; `ruff format` переложил 2 файла → после него `compileall` 0 + импорт-проверка OK; `ruff format --check` → 75 files formatted; `mypy backend/src` → Success, 50 files.

**Коммит фикса:** `869d94c` — `fix: enforce if-match on hide and re-resolve classification on external update` (pushed). Миноры из ревью не трогались.

---

# A01 — отчёт исходного раунда (до Fix round 1); остальная часть документа ниже описывает реализацию до адресных фиксов.

## Коммит

- `feat: add incoming identity and scoped arrival queues` (backend + frontend, ветка `feature/A01-queues`).
