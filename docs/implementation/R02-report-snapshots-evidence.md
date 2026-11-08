# R02 — Подписанный preview и неизменяемый snapshot (ТЗ-08)

## Результат

- Preview считается в отдельной короткой транзакции PostgreSQL `REPEATABLE READ` и не записывается в БД.
- Компактный payload содержит применённую версию классификации, матрицу, UUID/revision и ненулевые вклады источников; несжатый размер ограничен 32 МиБ.
- HMAC-SHA256 охватывает payload, `key_id`, серверный `session_id`, actor, лабораторию, тип и период. Секрет не короче 256 бит; один keyring задаётся через `REPORT_PREVIEW_KEYS` всем workers. Ротация — 90 дней, проверка выведенного ключа — ещё 9 часов.
- Production-приложение проверяет keyring при запуске, а Compose требует `REPORT_PREVIEW_KEYS`; неполная установка не начинает принимать трафик.
- Сохранение повторно проверяет подпись и текущую сессию, но не перечитывает ВСЭ и не пересчитывает матрицу. В `report_snapshots` записывается ровно проверенный payload, семь обрезанных непустых текстовых кодов и метаданные сохранения.
- Уникальность `(report_type, laboratory_id, year, half)` и advisory lock дают один успех при конкурентном сохранении. Строка снимка имеет только revision 1; update endpoint отсутствует.
- DELETE удаляет только снимок отчёта с проверкой области, `If-Match`, CSRF и идемпотентности. Источники и пробы не затрагиваются.
- Миграция получила номер `0010_report_snapshots`, потому что фактический `main` уже заканчивается на `0009_examinations`; ожидаемая ревизия readiness обновлена синхронно.

## Контрольные сценарии

`backend/tests/reporting/test_snapshots.py` подтверждает:

- источник удалён после preview — сохранены прежние payload, матрица и число источников;
- изменение payload и перенос подписи в другую сессию отвергаются `REPORT_PREVIEW_INVALID`;
- код `001` сохраняет ведущие нули, пробельный код не проходит валидацию;
- два конкурентных сохранения одного периода дают один created и один `REPORT_PERIOD_EXISTS`;
- нет данных и незавершённое полугодие отклоняются;
- старый ключ принимается ровно в девятичасовом окне;
- компактный список из 100 000 источников остаётся меньше 32 МиБ;
- повтор команды с тем же ключом возвращает тот же снимок; удалённый снимок больше не читается.

## Проверки 08.11.2026

- `uv run --frozen ruff check backend` — passed.
- `uv run --frozen mypy backend/src` — passed, 84 source files.
- `uv run --frozen pytest backend/tests/reporting/test_snapshots.py -v` — 7 passed.
- `uv run --frozen pytest backend/tests/reporting -q --cov=backend.src.modules.reporting --cov-report=term-missing --cov-fail-under=90` — 55 passed, 90.17%.
- `uv run --frozen pytest backend/tests -q` — 402 passed.
- `npm.cmd run typecheck` — passed.
- `npm.cmd test -- --run` — 37 files / 154 tests passed.
- OpenAPI contract regenerated into `frontend/src/shared/api/schema.d.ts` from the live application.

Предельное время полного расчёта 100 000 реальных источников остаётся нагрузочным доказательством OPS03; R02 закрепляет размер и структуру payload без заявления о производительности целевого стенда.
