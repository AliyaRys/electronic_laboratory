# E03 — Долговечное удаление ВСЭ без потери самостоятельных фактов

## Результат

- DELETE физически удаляет карточку ВСЭ, её медицинские результаты и расчёт, но атомарно сохраняет минимальный tombstone, команду и техническое событие. Tombstone не содержит медицинского payload.
- До изменения данных проверяются день создания, `If-Match` и готовность синхронного WAL-получателя. Транзакция использует `SET LOCAL synchronous_commit=on`.
- `204` возвращается только после подтверждённого `flush_lsn`. Потеря ответа во время commit или отсутствие подтверждения даёт `202 UNKNOWN`; повтор с тем же ключом читает tombstone и ждёт текущую верхнюю LSN, не выполняя второй DELETE.
- При неготовом backup операция отвечает `503 BACKUP_DURABILITY_UNAVAILABLE` до удаления. Без явного `DELETE_DURABILITY_ENABLED=true` guard остаётся закрытым; O02 должен развернуть и доказать настоящий receiver/restore.
- Старый GET даёт 404, старая mutation — `EXAMINATION_DELETED`. Партия возвращается в WORK, confirmation, проба, утилизация и сохранённый отчёт остаются. Тот же номер можно использовать для новой карточки с новым UUID, а REUSE не начисляет второй отбор.
- OpenAPI и клиент обновлены. Интерфейс не принимает `202` за завершённое удаление и показывает код операции.

## Контрольные сценарии

`backend/tests/examinations/test_delete.py` проверяет:

- сохранность confirmation, коллекции, утилизации, report snapshot и очереди партии;
- повторное создание с тем же номером и прежней пробой;
- отказ до записи при неготовом receiver и после границы дня Europe/Moscow;
- потерю ответа после успешного commit, UNKNOWN и последующее подтверждение по WAL;
- два одновременных повтора одной команды без второго события удаления;
- сериализацию гонки удаления со старой правкой;
- безопасные гонки удаления с повторным созданием и с утилизацией пробы;
- HTTP-контракт 204/202 и чтение `/api/v1/operations/{id}`.

Реальный base backup, разрыв WAL, восстановление и доказательство того, что удалённая карточка не вернулась после аварии, намеренно остаются критериями O02.

## Проверки 08.11.2026

- `uv run --frozen ruff check backend/src backend/tests/examinations/test_delete.py backend/migrations/versions/0011_examination_tombstones.py` — passed.
- `uv run --frozen mypy backend/src` — passed, 86 source files.
- `uv run --frozen pytest backend/tests/examinations/test_delete.py -q` — 10 passed.
- E01–E03 с coverage examinations — 36 passed, 91.77%.
- `uv run --frozen pytest backend/tests -q` — 412 passed.
- `npm.cmd run typecheck` — passed.
- `npm.cmd run test -- DeleteDialog.test.tsx` — 4 passed.
- `npm.cmd run test:e2e -- examinations.spec.ts` — 11 passed.
- OpenAPI перегенерирован из запущенного приложения.
