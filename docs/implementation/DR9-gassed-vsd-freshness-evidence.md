# DR9 — Доказательства: исключение погашенных во внешнем ВетИС ВСД из «Поступлений»

Дата: 2026-11-12. Ветка: `feature/DR9-gassed-vsd-freshness` (от main 397efb3).
Задание: `dorabotka/2026-11-12-vetis-gassed-vsd-disappears-from-arrivals.md`, руллинги контроллера R-DR9-1..10.

## 1. Модель актуальности (§4)

- Миграция `backend/migrations/versions/0015_source_presence.py` (после `0014_mercury_purpose`, head цепочки):
  - `incoming_documents.source_presence` `VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN'` + CHECK `IN ('CURRENT_CONFIRMED','NOT_IN_CURRENT_CONFIRMED_LIST','UNKNOWN')` (`incoming_source_presence_valid`);
  - `source_presence_reason` `VARCHAR(64)` — причина (`not_in_confirmed_list`, `filtered_*`);
  - `last_seen_sync_at` `TIMESTAMPTZ` — последний успешный sync, на котором документ был замечен;
  - `presence_changed_at` `TIMESTAMPTZ` — sync, на котором он перестал быть замеченным;
  - индекс `ix_incoming_presence (laboratory_id, contour, source_presence)`;
  - честный backfill: существующие строки → `CURRENT_CONFIRMED`, `last_seen_sync_at = fetched_at` (они попали в read model из полного INCOMING+CONFIRMED прохода);
  - downgrade удаляет ТОЛЬКО новые столбцы/индекс — ничего не удаляется.
- ORM-зеркало: `backend/src/modules/arrivals/models.py` (IncomingDocument).
- `UTILIZED` нигде не утверждается: отсутствие во внешнем списке даёт только `NOT_IN_CURRENT_CONFIRMED_LIST`.

## 2. Алгоритм деактивации (§5)

`backend/src/modules/integrations/vetis/sync.py`:

- Полный проход собирает ПОЛНЫЙ наблюдённый набор UUID: kept (импортированные) + filtered по причинам (`IncomingPage.filtered_documents`, нормализатор `filter_entries` возвращает UUID-ы по причинам receiver/transport/status/product_type). Импорт-ошибка называет UUID в диагностике FAILED-операции.
- Финализация (одна транзакция с SUCCESS): повторная проверка binding (scope/contour); затем
  1) наблюдённые документы этой лаборатории/контура → `CURRENT_CONFIRMED`, `last_seen_sync_at=checkpoint`, причина/`presence_changed_at` сброшены;
  2) документы, ОТСУТСТВУЮЩИЕ в полном наборе → `NOT_IN_CURRENT_CONFIRMED_LIST`, причина `not_in_confirmed_list`, `presence_changed_at=checkpoint`. Ничего не удаляется.
- Ошибка/обрыв/неполный проход код финализации не достигают: актуальность и checkpoint не меняются.
- Корректный `total=0` полного прохода деактивирует активные записи только при валидном scope (binding перепроверен) и успешном checkpoint.
- Повторное появление CONFIRMED восстанавливает активность без дубля: `upsert_incoming` (commands.py) на вставке и на любом обновлении ставит `CURRENT_CONFIRMED` и сбрасывает stale-метку; партия не дублируется.
- Скрытие пользователем (`hidden_incoming`) и внешнее отсутствие не смешиваются: sync не трогает скрытия.

## 3. Очереди, API (§6)

- `queries._queue_condition("EXPECTED")` теперь требует `IncomingDocument.source_presence == 'CURRENT_CONFIRMED'` (+ прежние условия: нет начатой reconciliation, нет confirmation, не скрыт, доступная лаборатория). WORK/ACCEPTED не изменены.
- `IncomingView` + `source_presence`, `last_seen_sync_at`, `source_presence_reason` (`schemas.py`, обновлён `frontend/src/shared/api/schema.d.ts` через `npm run gen:api` против локально поднятого бэкенда на :8011).
- Direct read stale-документа: `receipt.build_receipt_preview` → 409 `SOURCE_PRESENCE_STALE` «ВСД больше не входит в текущую очередь оформленных документов; повторное гашение недоступно.» (до этого — проверка статуса/checksum не затронута).
- ReceiptConfirmation/ВСЭ/raw XML/checksum/reconciliation не удаляются и не изменяются sync'ом (тест: сохраняются и при деактивации).

## 4. Диагностика (§7)

- Диагностика SUCCESS-операции (обезличенная): `external_total, pages, observed_uuids, kept, filtered_receiver, filtered_transport, filtered_status, filtered_product_type, new_documents, updated_documents, marked_not_current` (+ прежние `received/kept/filtered` для совместимости).
- `new_documents/updated_documents` считаются в `_import_item` (pre-check существования, upsert без изменения сигнатуры).
- Фронт (ArrivalsPage): после успешного прохода честный итог «Получено документов / Наблюдено во внешнем списке / Импортировано / Исключено из активной очереди / Обработано страниц»; ошибка sync не формулируется как «эВСД не найдены».
- ReceiptOperation: stale-партия показывает точный текст руллинга R-DR9-6 и не предлагает гашение (до запроса контекста, по read model).

## 5. Тесты (§8)

Backend: `backend/tests/vetis/test_presence_sync.py` (7 тестов, покрывают все 9 пунктов backend-списка: полный набор/стейл, ошибка последней страницы, фильтры-диагностика, дубли/reappearance, total=0 и восстановление, скрытие ≠ внешнее отсутствие, юридические факты, счётчики только после полного прохода; `test_repeat_job_no_duplicates` в test_sync.py остаётся дублёж-доказательством) и `backend/tests/arrivals/test_dr9_presence.py` (API 1–6: EXPECTED gate, total после актуальности и scope, direct read stale + блок гашения, сохранность confirmation, поля view).

Frontend: `ArrivalsPage.test.tsx` +2 (итог-счётчики успешного прохода; ошибка ≠ «не найдены»), `ReceiptOperation.test.tsx` +1 (stale-текст и отсутствие гашения).

## 6. Гейты

- Backend: `uv run --frozen ruff check backend frontend/tests/e2e` — чисто; `pytest tests/vetis tests/arrivals` — 191 passed; `tests/reporting tests/samples` — 101 passed; полный `pytest` — 617 passed, 6 failed.
  Все 6 failed повторяются на чистом base 397efb3 (проверено git stash + прогон: те же 6), т.е. предсуществующие/связанные с окружением (compose secret, migration lock, health/ready на dev-инсталле) и к DR9 не относятся.
- Frontend: `format:check`, `lint` (0 ошибок, 1 предсуществующий warning catalogs), `typecheck`, `test --run` (275 passed), `build`, `build-storybook` — все зелёные.
- No-write: read-stage sync не имеет write-порта вызовов (test_no_write_on_read_stage — флаг-агностичен); никаких внешних write-запросов ВетИС не выполнялось; `VETIS_WRITE_ENABLED`, `.env*`, compose, `vetis-schema/`, Docker-контейнеры не трогались.
- Viewport/keyboard (§8 API/frontend п.7 — 1440/1024/768/390, клавиатура, overflow): ЧЕСТНО НЕ ВЫПОЛНЕНЫ (E2E-прогон с браузером в этом окружении не запускался). Unit-проверки клавиатуры существующих компонентов продолжают проходить в vitest.

## 7. Данные и миграция

- Миграция 0015 ПРИМЕНЕНА локально к dev-БД (`alembic upgrade head`, путь только вверх; проверено: head=`0015_source_presence`, 4/4 документов в `CURRENT_CONFIRMED`). Ничего не удалялось, `down -v`/destructive не выполнялись.
- ВНИМАНИЕ контроллеру: запущенные контейнеры бэкенда всё ещё со старым кодом (head=0014) — `/api/v1/health/ready` может отвечать 503 «версия схемы БД не соответствует» до пересборки контейнеров (шаг контроллера по R-DR9-10).
- Чужие незакоммиченные файлы (`DESIGN.md`, `dorabotka/*`, `vetis-schema/`, `.env*`) не тронуты и не коммиты.

## 8. Не сделано / пробелы

- Live VetIS leg: not-run (по правилам; только fixtures/spy).
- E2E viewport/keyboard прогон: not-run (см. §6).
- Пересборка контейнеров и merge в main — контроллер (R-DR9-10).
