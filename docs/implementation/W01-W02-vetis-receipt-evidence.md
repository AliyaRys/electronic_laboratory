# W01/W02 — доказательства реализации гашения без живого write-вызова

Дата: 10.11.2026.

## Что реализовано

- Миграция `0013_vetis_receipts`: неизменяемый intent, раздельные
  `localTransactionId`/`applicationId`, evidence/diagnostics, polling и один
  незавершённый intent на партию.
- Strict API: локальный XML preview и явное подтверждение fingerprint; при
  `VETIS_WRITE_ENABLED=false` ответ 503 возникает до intent/outbox.
- XML строится из закреплённого raw XML/checksum и сверки по структуре
  `delivery`, `deliveryFacts`, `discrepancyReport`, `returnedDelivery`.
  Покрыты шесть сценариев 1.1.1–1.2.3 и три результата ветосмотра. Причина
  возврата записывается в `authentication/specialMarks` в формате документации
  ВетИС, для `OTHER_REASON` добавляется текст.
- Перед сетью фиксируется `SUBMITTING`. Утрата ответа submit без
  `applicationId` переводит операцию в `UNKNOWN`; автоматический повтор
  запрещён. Poll безопасно повторяется по расписанию 2/5/10/30/60 секунд,
  после 15 минут результат остаётся `UNKNOWN`.
- Подтверждение создаётся только при `COMPLETED`, исходном `UTILIZED` эВСД,
  совпавшем получателе/единице и доказанных объёмах `stockEntry` и возвратного
  `RETURNABLE` ВСД. `REJECTED` и неполные связи локальную ВСЭ не открывают.

## Выполненные проверки

- `pytest backend/tests/vetis/test_read_contract.py ... test_reconcile.py -q`:
  55 passed (после проверки HTTP-защиты — 57 passed).
- В PostgreSQL доказаны disabled-before-outbox, один intent/outbox, потерянный
  submit без повтора и одно подтверждение при повторном результате.
- `ruff check ...`: passed.
- `mypy backend/src/modules/integrations/vetis backend/src/modules/arrivals/router.py`:
  passed.
- Полный backend без двух заранее известных сбоев `test_delete.py`: 534 passed,
  2 deselected. Устаревший тест HTTP-маршрута обновлён и проходит.

## O-13

Живой `ProcessIncomingConsignment` не выполнялся. Внешние credentials не
читались тестами, `VETIS_WRITE_ENABLED` установки не менялся. Production
transport реализован и в тесте перехватывается до сети с проверкой
`SOAPAction=submitApplicationRequest` и точного XML. Живая write-приёмка имеет
статус: **не выполнялась — запрещено O-13**.
