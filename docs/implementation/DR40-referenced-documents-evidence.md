# DR40 — Отображение всех сопроводительных документов в сверке ВСД: evidence

Ветка: `codex/referenced-documents-reconciliation` (BASE main 46801cb), worktree
`C:\electronic_lab_dev-dr40`. Официальный метод GetVetDocumentListOperation v2 и
справочник DocumentType v2.0 (help.vetrf.ru) — сеть во время выполнения была
недоступна; для кодов 1–24 использована таблица §4 ТЗ (дословно из справочника),
fallback «Тип документа <код>» для неизвестных кодов. Недоступность сети
зафиксирована здесь честно.

## TDD: RED → GREEN

RED (зафиксировано, до реализации):

- `backend/tests/vetis/test_dr40_referenced_documents.py` — 10 failed / 25 passed
  (нет `referenced_documents` в normalizer, registry не по §4);
- `backend/tests/arrivals/test_dr40_accompanying.py` — 11 failed / 4 passed
  (нет typed `accompanyingDocuments`, нет `documentChecks`).

GREEN: обе группы полностью зелёные (см. ниже).

## Команды и результаты

Backend (uv, foreground):

- `uv run --frozen pytest backend/tests/vetis -q` → **276 passed**
  (включая test_dr40_referenced_documents.py — 35 кейсов, test_receipt_mapping.py:
  тест «одна ТТН + несколько документов» проходит без изменений — §9);
- `uv run --frozen pytest backend/tests/arrivals -q` → **179 passed**
  (включая test_dr40_accompanying.py — 18 кейсов, test_dr40_backfill.py);
- остальное (integrations/documents/identity/operations/reporting/samples/
  catalog_pricing/examinations) → **736 passed, 1 failed** —
  `operations/test_configuration.py::test_migration_lock_blocks_when_holder_lives`
  — таймерный тест (sleep(6), возврат процесса); к DR40 отношения не имеет,
  на изолированном перезапуске зелёный;
- `uv run --frozen ruff check backend/src backend/tests` → **All checks passed**.

Frontend (Node 26.13.0, C:\Users\Алия\AppData\Local\Temp\opencode\node26\...):

- `npm run gen:api` (эквивалент: openapi.json из FastAPI → openapi-typescript)
  → `frontend/src/shared/api/schema.d.ts` перегенерирован (+66 строк:
  AccompanyingDocumentView, DocumentCheck/DocumentActual, documentChecks,
  referencedDocuments);
- `npm run format:check` → DR40-файлы чистые; **pre-existing** предупреждения
  на base-коммите (не от DR40, не форматировались намеренно, чтобы не создавать
  шум): arrivals.stories.tsx, ArrivalTables.test.tsx,
  ReconciliationDateFilter.{tsx,test.tsx}, catalogs/MethodsEditorPage.{tsx,test.tsx},
  catalogs/editor-pages.stories.tsx (проверено на чистом HEAD через
  `git show HEAD:… | prettier --check`);
- `npm run lint` → 0 errors, 1 pre-existing warning (use-catalog-context.ts);
- `npm run typecheck` → чисто;
- `npm run test` → **64 файла, 509 passed** (включая новый
  ReconciliationDocuments.test.tsx — 12 кейсов, §10.1–8);
- `npm run build` → built;
- `npm run build-storybook` → completed successfully;
- `npm run test:e2e -- tests/e2e/reconciliation.spec.ts
  tests/e2e/reconciliation-storybook.spec.ts` → **12 passed**, включая axe
  (serious/critical = 0) и spy «нет live VetIS вызовов».

## Per-блок тест-плана §10

### Normalizer/backend (test_dr40_referenced_documents.py)

1. один type 1 → массив + compatibility transportDocument ✓
2. type 1 + type 6, оба, порядок из XML (и через snapshot round-trip) ✓
3. коды 1–24 → русские labels (параметризовано 1–24) ✓
4. неизвестный код «99» сохраняется, label «Тип документа 99» ✓
5. прямые ссылки не смешиваются с laboratoryResearch/referencedDocument type 9 ✓
6. отсутствие серии/номера/даты не удаляет документ (null-поля) ✓
7. пустой referencedDocument исключается с диагностикой ✓
8. compatibility: типы 1–5, relationship 1/6, предпочесть 1, требует номер и дату,
   type 6 не подменяет ТТН ✓ (плюс существующие test_receipt_mapping)
9. registry полностью покрывает 1–24 ✓

Backfill (test_dr40_backfill.py): идемпотентный ре-парсинг прямых
vd:referencedDocument (+ transportDocument) из raw XML; raw/checksum/UUID/ревизии
не трогаются; повторный запуск — fixed=0, unchanged≥1 ✓.

### API/reconciliation (test_dr40_accompanying.py)

1. read model отдаёт typed accompanyingDocuments (key/order/label), legacy flat
   поля сохранены ✓
2. documentChecks валидируется и сохраняется атомарно (через реальный
   save_reconciliation; ключи проверяются против текущего snapshot) ✓
3. mismatch требует структурированный actual + reason (CHK-F42/F43) ✓
4. одинаковые документы получают различимые occurrence keys (`<digest>#N`) ✓
5. перестановка списка не переносит отметки (key — от полей, не от позиции) ✓
6. legacy CHK-F25/26/27 читаются без миграции; отметка primary документа через
   documentChecks удовлетворяет legacy-поля (§8.1); mismatch primary НЕ
   закрывает legacy-отметки молча ✓
7. ActPreview содержит конкретный документ: `documents.<key>` + source
   (тип; серия и номер; дата) + structured actual + reason ✓

### Frontend (ReconciliationDocuments.test.tsx)

1. две отдельные карточки (type 1 и type 6) в порядке источника ✓
2. ровно одна пара controls на карточку (2 radio, role=radiogroup) ✓
3. «Тип сопроводительного документа», «Серия и номер», «Дата создания» ✓
4. длинные значения: overflow-wrap/anywhere, карточка не в grid-break
   (перенос проверен классами; пиксельные 1440/1024/768/390 — e2e/axe узкий 390
   и 1440 зелёные) ✓
5. loading/error — общий командный контур формы (без изменений); empty
   («В эВСД нет сопроводительных документов.»), unknown type («Тип документа
   99»), отсутствие серии («—») ✓
6. mismatch открывает structured actual + reason внутри нужной карточки,
   соседняя карточка не затронута ✓
7. keyboard/aria: radiogroup с названием документа, полные русские aria-label
   радиокнопок, aria-live статус, no GUID leakage; axe e2e без serious/critical ✓
8. нет браузерных вызовов ВетИС — только fixtures/MSW (e2e spy подтверждает) ✓

## Ключевые решения

- Единый registry: `backend/src/modules/integrations/vetis/document_types.py`
  (§4 дословно); frontend НИКАКИХ копий — label только из API (`typeLabel`).
- Ключ документа: SHA1 от `typeCode|relationshipType|series|number|date`
  (16 hex) + `#N` для полностью одинаковых документов; перестановка не переносит
  отметки.
- `documentChecks` хранится в существующем `Reconciliation.checks` JSONB под
  зарезервированным ключом `documentChecks` — миграция БД не потребовалась.
- `referencedDocuments` — source-faithful список всех ПРЯМЫХ дочерних
  vd:referencedDocument текущего vd:vetDocument (не descendant-wide);
  `transportDocument` — прежняя compatibility projection (§5.2), поведение
  receipt_mapping.py не изменилось.
- Backfill: `run_referenced_documents_backfill` в
  `backend/src/modules/integrations/vetis/backfill.py` (operator entry point).

## Not-run / honesty

- Сеть недоступна: официальные страницы метода/справочника не загружались;
  коды 1–24 взяты из §4 ТЗ (дословно).
- `docker compose up` / обновление контейнеров — не выполнялось (не входит в
  назначенные гейты имплементатора; merge/публикация — за контроллером).
- `CHK-F13/F14` и остальные блоки — без изменений.
- Форматирование: pre-existing unformatted файлы на base намеренно оставлены
  как есть (только DR40-файлы приведены к prettier).
