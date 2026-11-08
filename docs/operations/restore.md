# Аварийное восстановление установки (O02)

## Важное ограничение

Это восстановление всей установки, не отмена удаления отдельной ВСЭ. Нельзя
открывать старую PITR-копию как текущую систему. Восстановление применяет всю
непрерывную доступную WAL-цепочку как минимум до максимального LSN всех
подтверждённых удалений. При неизвестной границе, разрыве WAL, отсутствии
keyring или журнала tombstone публичный доступ остаётся закрытым.

## Изолированная ежемесячная проверка

1. Создать disposable хост/volume, не использовать пользовательскую среду.
2. Выбрать последнюю `pg_verifybackup`-прошедшую base-copy и проверить
   `MANIFEST.sha256`/`SHA256SUMS`.
3. Восстановить PostgreSQL 18.6, настроить `restore_command` на отдельную копию
   WAL-каталога и проиграть всю непрерывную цепочку. Зафиксировать replay LSN и
   timeline. Partial-WAL обязан восстановить транзакцию до подтверждённого LSN.
4. После promotion проверить миграционную head, keyring и инварианты: партии,
   пробы, утилизации, сохранённые отчёты и tombstone. Удалённый UUID даёт 404;
   payload удалённой ВСЭ не восстанавливается из отчёта/аудита.
5. Все внешние операции `SUBMITTING/UNKNOWN` перевести только в очередь
   reconcile. Никакого автоматического submit после restore.
6. Создать evidence schema 1: `wal_continuous`, `checksum_verified`,
   `deletion_journal_continuity`, `keyring_available`,
   `all_durable_lsn_replayed`, `pending_external_policy: reconcile-only`,
   `completed_at`, start/end/duration и обезличенные LSN.
7. Запустить `restore-gate.py evidence.json --output safe.env`. Только exit 0
   допускает служебный запуск, причём он принудительно оставляет
   `VETIS_READ_ENABLED=false`, `VETIS_WRITE_ENABLED=false`,
   `DELETE_DURABILITY_ENABLED=false`.

После ручной сверки незавершённых операций, health/readiness, полномочий и
нового живого backup receiver владелец установки отдельно включает чтение и
durable DELETE. Write ВетИС этим процессом никогда не включается.

## Измерения

Фиксируются размер base/WAL, start/end, RPO обычных записей, достигнутый RTO,
последний replay LSN, max durable-delete LSN и результаты выборочных сверок.
Цели RPO≤15 минут/RTO≤4 часа объявляются выполненными только по реальному
изолированному прогону на целевых app/backup-хостах. Без такого прогона статус
— `not-run`, production release-gate закрыт.
