# DR5 — разбор входящих XML эВСД и справочник назначений: подтверждение реализации

Ветка: `feature/DR5-vetis-xml-purpose`
Спецификация: `dorabotka/2026-11-11-vetis-incoming-xml-fields-and-purpose-dictionary.md` (не коммитится)
Дата: 2026-11-11

## Что сделано

Разбор входящего транспортного эВСД приведён к данным документа: количество
транспортных мест из `vd:packageList` (максимальный уровень упаковки, без
fallback на `vd:volume`), UUID ВСД из верхнеуровневого `bs:uuid`, дата
оформления из `vd:issueDate` (plain date без сдвига пояса), русская подпись
статуса из backend-карты, название назначения груза по локальному
contour-scoped справочнику `mercury_purpose_guid` (151 запись, read-only
`GetPurposeList` раз в 14 суток от scheduler). Идемпотентный backfill
перенормализовал сохранённый raw XML. Живых записей в ВетИС нет и не было:
гашение не включено, `VETIS_WRITE_ENABLED=false` во всех прогонах.

## Backfill на локальной установке (реальный документ)

- результат: `viewed: 1, fixed: 0, unchanged: 1, error: 0` (документ уже
  корректен; raw/checksum/confirmed facts не изменялись);
- повторный прогон даёт тот же результат (идемпотентность);
- скрытые поступления, счётчики и подтверждённые факты не тронуты.

## Миграция и справочник

- `backend/migrations/versions/0014_mercury_purpose.py` — следующие за
  актуальным head; создаёт `mercury_purpose_guid` и
  `mercury_purpose_sync_state`; downgrade удаляет только эти две таблицы;
- `backend/resources/vetis/purpose_dictionary.json` — 151 запись без секретов;
  целевой GUID `0778b8cb-f49d-4ed9-88b9-5f70af00a211` → «реализация в пищу
  людям» разрешается;
- на локальной установке применено `alembic upgrade head`: 151 строка в
  `mercury_purpose_guid` (контур PILOT), sync-state не создан (worker ещё не
  запускался — первый/последний sync = только seed).

## Проверки

- ruff: `backend`, `frontend/tests/e2e` — чисто;
- `pytest backend/tests/vetis backend/tests/arrivals` — 151 passed;
- `pytest backend/tests/examinations backend/tests/documents` — 67 passed +
  2 pre-existing failure в `backend/tests/examinations/test_delete.py`
  (409 против 204, конкурирующая утилизация) — воспроизводятся на baseline
  `main` через git stash, к DR5 не относятся;
- frontend: vitest 235 passed, `format:check`, `lint`, `typecheck`,
  `build-storybook`, `build` — чисто.

## Браузерная проверка на реальном документе

Спецификация `frontend/tests/e2e/dr5-real-browser.spec.ts` (read-only: без
приёмки, без sync, без скрытия) против локальной установки (vite :4173 →
backend :8111), пользователь-диагностика `dr5-browser-check`:

- очередь «Ожидаемые», 1440px: строка партии показывает «Дата оформления ВСД»
  03.11.2026, «UUID ВСД» e13bda81-7cf6-4b2b-b1aa-3c99e25adaac, массу 500.0 кг
  и количество 8; поиск находит партию по фрагменту UUID; 390px — нет
  горизонтального переполнения;
- сверка `/arrivals/:partyId/reconciliation`: блок «Документ» показывает UUID
  ВСД, дату 03.11.2026, статус «Оформлен», назначение «реализация в пищу
  людям»; количество 8 и вес 500.0 остаются раздельными source-значениями
  (CHK-F20/CHK-F21); 390px — без переполнения;
- снимки: `docs/implementation/evidence/DR5-expected-1440.png`,
  `DR5-expected-390.png`, `DR5-reconciliation-1440.png`,
  `DR5-reconciliation-390.png`.

## Честно не выполнено

- живой read-only `GetPurposeList` по реальной сети ВетИС не запускался:
  sync покрыт mock-транспортом (пагинация, partial failure, overlap,
  checkpoint), на реальной установке sync-state не создавался;
- две существующие ошибки `backend/tests/examinations/test_delete.py`
  остаются (не из DR5, есть на baseline);
- диагностическая запись `dr5-browser-check` создана в локальной dev-БД для
  проверки входа, в коммит и seed не входит.
