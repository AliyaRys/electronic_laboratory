# DR27 — Гашение из страницы сверки: актуальный receipt context и frozen preview (evidence)

Дата: 13.11.2026 · Ветка: `feature/DR27-receipt-stale-context` (base main `6bdee09`) · ТЗ: `dorabotka/2026-11-13-reconciliation-receipt-stale-context.md` (закоммичен с кодом)

## Подтверждённая причина и объём правок

Backend guard `build_receipt_preview()` (revision/checksum/state) НЕ изменён — он корректен. Исправлен frontend:

1. **R-DR27-1 (§4.1)** — `ReconciliationPage.onSaved` теперь выполняет `setQueryData` сверки и **await** `invalidateQueries([lab, party, "receipt-context"])`; `ReconciliationForm.onSaved` стал асинхронным (`await onSaved(...)` внутри цепочки сохранения). `setQueryData` сверки больше не считается достаточным обновлением receipt context.
2. **R-DR27-2 (§4.2)** — `ReceiptOperation.prepare()` всегда выполняет свежий GET `receipt-context` непосредственно перед POST preview (closure-захваченный `context` запрещён); свежее значение одновременно обновляет кэш. Проверки перед POST: `reconciliation_revision === reconciliation.revision`, обе ревизии не null, сверка `OPEN`+`complete`, `write_enabled`, выбран `vetInspection`, дата возврата для `PARTIAL/RETURN_ALL`. Расхождение → перечитываются party/reconciliation/context, показывается «Сверка обновилась. Проверьте данные и сохраните сверку заново», ввод не теряется, авто-PUT отсутствует. Stale-context-после-save → ровно один автоматический повтор GET, затем продолжение.
3. **R-DR27-3 (§4.3)** — `confirm()` берёт `source_revision`/`reconciliation_revision`/`delivery_date`/`return_date`/`issue_date` из `preview.intent` и `fingerprint` из `preview.fingerprint` — контекст не используется. Двойное «Погасить» заблокировано (`busy` + `submitted` ref); один preview → ≤1 submit/outbox intent.
4. **R-DR27-4** — `REVISION_CONFLICT` между preview и confirm: без авто-retry submit; preview сбрасывается, диалог закрывается; перечитываются party/reconciliation/context; показываются причина, безопасные диагностики и кнопка «Сформировать preview заново» (новый preview — только явное действие пользователя); пользовательский ввод сохранён.
5. **R-DR27-5 (§5.2)** — backend contract сохранён полностью; при `REVISION_CONFLICT` Problem дополнительно несёт только `current_source_revision`/`current_reconciliation_revision` (механизм `ProblemError.extra`, мержится в тело Problem; схема Problem не изменена, raw XML/секреты не раскрываются).
6. **R-DR27-6** — таксономия ошибок на frontend: `REVISION_CONFLICT` (источник/сверка изменились), `SOURCE_CHECKSUM_MISMATCH` (критическая ошибка данных, без слепого повтора), `RECONCILIATION_INCOMPLETE`, `INTEGRATION_WRITE_DISABLED` (настройка оператора), `VALIDATION_ERROR` (проверить форму).

## Изменённые файлы

- `backend/src/core/problems.py` — `ProblemError.extra` + мерж безопасных диагностик в ответ обработчиком.
- `backend/src/modules/integrations/vetis/receipt.py` — только обогащение `REVISION_CONFLICT` диагностиками (guards не ослаблены).
- `backend/src/modules/arrivals/router.py` — чистое извлечение `collect_receipt_context(db, party)` (тот же read-model, вызывает endpoint; тестируемость §7.1).
- `frontend/src/pages/ReconciliationPage.tsx` — awaited инвалидация receipt-context после save.
- `frontend/src/features/arrivals/ReconciliationForm.tsx` — `onSaved` может быть Promise; `await onSaved(...)`.
- `frontend/src/features/arrivals/ReceiptOperation.tsx` — prepare/confirm/taxonomy/REVISION_CONFLICT-обработка.
- `frontend/src/shared/api/problem.ts` — Problem сохраняет две безопасные диагностики при нормализации.
- Тесты: `backend/tests/vetis/test_receipt_failures.py` (+7), `frontend/src/features/arrivals/ReceiptOperation.test.tsx` (+7), `ReconciliationPage.test.tsx` (+1).

## Gates (фактические результаты)

- Backend: `uv run --frozen ruff check backend frontend/tests/e2e` → All checks passed!
- Backend: `uv run --frozen pytest backend/tests/vetis backend/tests/arrivals -q` → **347 passed** (после финальных правок router).
- Известные ранее существовавшие: `backend/tests/examinations/test_delete.py` → 2 failed / 8 passed (`test_delete_http_204_and_unknown_202`, `test_delete_concurrent…`) — не связаны с DR27, раскрыто честно.
- Frontend: `npm.cmd run format:check` → All matched files use Prettier code style!
- Frontend: `npm.cmd run lint` → 0 errors, 1 pre-existing warning (catalogs `use-catalog-context.ts`, exhaustive-deps).
- Frontend: `npm.cmd run typecheck` (tsc --noEmit) → 0 ошибок.
- Frontend: `npm.cmd run test -- --run` → **56 files / 388 tests passed** (включая 7 новых DR27 в `ReceiptOperation.test.tsx`, 1 новый в `ReconciliationPage.test.tsx`).
- Frontend: `npm.cmd run build` → built; `npm.cmd run build-storybook` → completed successfully (Node 26.13.0 из PATH контроллера).

## Покрытие тестов ТЗ §7

Backend (1–11): context возвращает текущие ревизии (`collect_receipt_context`); preview принимает ровно текущую пару (3,2); любая устаревшая пара (3,1)/(2,2)/(4,5) → 409 `REVISION_CONFLICT` с двумя безопасными диагностиками и без raw XML/checksum/credentials; изменение source после preview блокирует submit-путь без outbox; повреждённый XML → `SOURCE_CHECKSUM_MISMATCH` (не маскируется); idempotent один intent+outbox, write-disabled без вызова/записи, полнота decision/unit/receiver-проверок — существующие тесты (`test_receipt_failures.py`, `test_receipt_mapping.py`, `test_dr10_unit_guid.py`) остаются зелёными.

Frontend (1–9): (1) после save обе query на одной ревизии (страничный тест с реальным PUT); (2) Save→Prepare партии `a560d943-38e3-467f-956c-e2a885514cad` отправляет новую ревизию 5 (component-тест с этим party_id; page-level Save→Prepare покрыт тестом (1)); (3) prepare делает свежий GET перед POST + один автоматический повтор при stale-context; (4) confirm берёт ревизии/issue_date/fingerprint из frozen preview (контекст намеренно неверный в тесте); (5) ровно один preview/submit на действие + двойной клик → 1 submit; (6) REVISION_CONFLICT сбрасывает preview, без авто-submit, кнопка «Сформировать preview заново», диагностики; (7) ввод сохраняется после ошибок; (8) см. (2); (9) все тесты через MSW — реальный VetIS write недостижим (spy-уровень: handlers только HTTP-моки, transport spy в backend тестах).

## Честно не выполнено / вне области

- Живая проверка сценария A–D в тестовом контуре и пересборка Docker — контроллер (§8 диспетча).
- `npm.cmd run test:ui` не запускался: компоненты входа не затронуты.
- E2E Playwright (`frontend/tests/e2e`) не запускался (только ruff); MSW-покрытие приведено выше.
