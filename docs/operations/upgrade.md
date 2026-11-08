# Upgrade: смена версии на действующей установке (ADR-003/014, OPS-01)

## Правила

1. **Build once, deploy same digest.** Апгрейд выполняется только на digest
   из release manifest нового релиза; пересборка на установке запрещена.
   Один и тот же образ фронтенда используется во всех средах.
2. **Миграции — one-shot с release lock.** Перед сменой версии API:
   ```sh
   docker compose --profile migrate run --rm migrate
   ```
   Скрипт `deploy/migrate_lock.py` держит advisory lock PostgreSQL всё время
   `alembic upgrade head`. Две одновременных миграции (или два релиза на
   одну установку) сериализуются; failed/зависший holder **блокирует**
   смену версии — повтор допустим только после разбора причины.
3. **Runtime DDL-free.** Работающий backend не выполняет DDL; изменения
   схемы только в one-shot job. Дисциплина expand/contract/roll-forward:
   новые колонки добавляются expand-шагом, старые удаляются contract-шагом
   позже, откат — roll-forward на предыдущий digest, а не `downgrade`
   на проде.
4. **Секреты.** Всё через закрытый env-file установки; новые ключи
   (key-ring сессий/снапшотов) добавляются в env-file, а не в образы.
5. **Порядок.**
   ```sh
   docker compose pull            # по digest из release manifest
   docker compose --profile migrate run --rm migrate
   docker compose up -d           # backend на новом digest
   ```
6. **Проверка после апгрейда.** Smoke без ВетИС: `/api/v1/health/live`,
   `/api/v1/health/ready` (БД/версия схемы), SPA отвечает. `migration_head`
   совпадает с манифестом релиза.
7. **Retention реестра.** После успешного апгрейда запускается
   `retention`: остаются активный релиз + 5 предыдущих
   (`deploy/registry-retention.sh`).

## Ограничения

- Параллельный релиз на ту же установку невозможен: CI-группа
  `deploy-<installation>` сериализует деплой, release lock сериализует
  миграции.
- `VETIS_READ_ENABLED` / `VETIS_WRITE_ENABLED` не меняются апгрейдом;
  write остаётся `false` (O-11).
- Обновление lock-файлов (`uv.lock`, `package-lock.json`) — отдельный
  upgrade-коммит с диагностикой и полным CI, без самовольной смены
  версий стека (SPEC).
