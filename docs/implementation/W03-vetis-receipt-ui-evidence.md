# W03 — управляемое гашение ВетИС: evidence

## Результат

- Серверный `receipt-context` сообщает только capability, закреплённые ревизии
  и последнюю операцию; endpoint не создаёт intent/outbox и не выдаёт XML или
  credentials.
- При `VETIS_WRITE_ENABLED=false` экран показывает «Гашение не включено
  оператором» и не предлагает отправку.
- При enabled пользователь отдельно указывает результат ветеринарного осмотра
  и дату поступления, получает server-built preview с fingerprint и
  подтверждает необратимое действие в общем доступном диалоге.
- После HTTP 202 повторный submit исчезает. `PROCESSING` опрашивается,
  `UNKNOWN` разрешает только проверку результата, `REJECTED` не открывает
  downstream, `CONFIRMED` открывает ВСЭ только при route `EXAMINATION`.
  Для `RETURN_ALL` route `NONE`, поэтому ВСЭ не предлагается.

## Проверки

- RED до реализации: адресный Vitest не находил `ReceiptOperation`.
- `ReceiptOperation.test.tsx`: 3 passed — disabled, ровно один submit после
  preview/явного подтверждения и отсутствие ВСЭ после полного возврата.
- `vetis-receipt.spec.ts`: 3 passed в Chromium — disabled=0 writes;
  enabled=1 spy submit и UNKNOWN без повторной отправки; CONFIRMED/REJECTED
  управляют доступом к созданию ВСЭ.
- `build-storybook`: passed; состояния диалога preview/busy/error добавлены.
- `typecheck`: passed.
- `ruff check` и `mypy` изменённого backend-маршрута: passed.
- W01/W02 regression: 26 passed; arrivals confirmation/context: 8 passed.
- Полный backend: 534 passed, 3 deselected. Исключены два ранее известные
  `test_delete.py` и Windows-проверка межпроцессной migration-lock; адресные
  проверки W03 и документации проходят.

Скриншот диалога получен браузерным e2e и просмотрен на действующем экране.
Секреты и реальные ВетИС identifiers в тестах отсутствуют.

## Внешняя граница

Живой `ProcessIncomingConsignment` не вызывался. Флаг фактической установки не
менялся. Живой write остаётся `not-run by O-13`; процедура контролируемого
включения описана в `docs/operations/vetis-enable.md`.

Живой read-маршрут до сверки также не повторялся в W03: V01 оставил
`schema_pins=PENDING` из-за недоступного профиля ВУ. Это не заменено фиктивным
внешним успехом; offline e2e полностью перехватывает сеть и использует spy.
