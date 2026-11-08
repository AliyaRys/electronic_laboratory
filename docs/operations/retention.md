# Retention: сроки хранения и запрещённая очистка (O03)

## Логи и диагностика

| Хранилище | Срок | Константа |
| --- | --- | --- |
| Технические события (`technical_events`) | 90 дней | `audit.TECHNICAL_EVENT_RETENTION` |
| События безопасности (действия `SECURITY.*`, `user_events`) | 365 дней | `audit.SECURITY_EVENT_RETENTION` |
| Диагностика SOAP (`SoapDiagnostics`) | 30 дней | `audit.SOAP_DIAGNOSTIC_RETENTION` |

План очистки строится `audit.retention_plan(now)` и **исполняется**
`audit.apply_retention(session, now=..., soap=...)`: строки старше `before`
удаляются только из перечисленных хранилищ (security-события — те же
`technical_events` с префиксом действия `SECURITY.`), результат — счётчики
по хранилищам; одноразовая команда обслуживания —
`uv run --frozen python -m backend.src.core.audit`. Сами
лог-записи не содержат секретов и медицинских payload — см. `monitoring.md`.

## Бизнес-факты без автоматического TTL

Следующие данные **никогда** не удаляются лог-TTL из этого раздела
(`audit.NEVER_PURGED_TABLES`, DATA-05):

- нормализованные подтверждения приёмки (`receipt_confirmations`) — неизменяемы;
- сверка (`reconciliations`) и партии (`parties`, `incoming_documents`);
- внешние операции, включая неразрешённые UNKNOWN (`vetis_operations`) —
  неразрешённые external операции не чистятся TTL;
- ВСЭ и её результаты (`examinations`, `research_results`,
  `examination_findings`, `charges`), tombstone-записи;
- физические пробы: отборы (`sample_collections`) и утилизации
  (`sample_disposals`);
- сохранённые отчёты (`report_snapshots`).

`audit.assert_purgable` отклоняет любую попытку включить бизнес-таблицу в TTL-
очистку (ошибка «бизнес-факт без автоматического TTL»), т.е. 90/365/30-дневные
сроки логов физически не могут почистить бизнес-факты.

## Runbook ежемесячной очистки

1. Убедиться, что полная проверенная копия и непрерывный WAL на месте
   (`backup.md`), иначе очистку не проводить.
2. Выполнить план `retention_plan(now)` **исполнителем** `apply_retention`
   (`core/audit.py`): строки старше отсечки удаляются только из
   `PURGABLE_STORES` (`technical_events` без префикса `SECURITY.`,
   `security_events` = `SECURITY.*` в той же таблице, `soap_diagnostics` —
   в маскированном хранилище SOAP), результат — счётчики по хранилищам.
3. Одноразовая команда обслуживания (коммитит сама, пишет JSON со счётчиками):

   ```sh
   uv run --frozen python -m backend.src.core.audit
   ```

   Для disposable-прогона добавить `--database-url <DSN>`. Отказ выполнить
   (например, недоступная БД) — код возврата 1 и сообщение в stderr; ничего
   не удаляется частично (executor не коммитит сам, commit один в конце).
4. Проверить, что счётчики бизнес-таблиц до/после совпадают (никакой разницы);
   `apply_retention` физически отклоняет любую бизнес-таблицу
   (`assert_purgable` → «бизнес-факт без автоматического TTL»).
5. Записать результат (дата, до/после, счётчики) в журнал эксплуатации.

Автоматического фонового задания план не требует: механизм исполнения
существует и покрыт тестом на настоящем PostgreSQL
(`test_purge_executor_applies_cutoffs_and_leaves_business_facts`).

## Локальные записи идемпотентности

Локальные записи команд хранятся 30 дней (`SPEC-04`); внешние UNKNOWN не
очищаются. Это правило не входит в TTL логов выше и выполняется отдельной
логикой idempotency-журнала.
