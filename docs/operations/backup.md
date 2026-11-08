# Резервное копирование PostgreSQL (O02)

## Граница и роли

Рабочая БД остаётся внутри Compose и не публикует порт на хост. Контейнер
`backup-tunnel` сам устанавливает ограниченный reverse SSH-туннель на отдельный
backup-хост: его `127.0.0.1:6543` ведёт только к `postgres:5432`. На backup-
хосте работают PostgreSQL 18.6 tools той же major-версии. Пользователь
`vsebackup` не имеет shell/DML/DDL-доступа к приложению, а роль
`vse_replication` имеет только LOGIN+REPLICATION.

В `authorized_keys` backup-хоста ключ туннеля ограничивается, например:

```text
restrict,port-forwarding,permitlisten="127.0.0.1:6543" ssh-ed25519 <PUBLIC_KEY>
```

В `sshd_config` для пользователя обязательно `GatewayPorts no`; host key
backup-хоста закрепляется в отдельном known_hosts. Реальные адреса и ключи не
хранятся в Git. Запуск app-стека: `docker compose --profile backup up -d` с
`BACKUP_TUNNEL_KEY_FILE` и `BACKUP_KNOWN_HOSTS_FILE` из закрытого env-file.

## Первичное включение

1. На app-БД выполнить `deploy/backup/provision-replication.sql`, передав
   сгенерированный `replication_password` и имя ограниченной runtime DB-роли
   как `app_role`. Ей выдаётся только `pg_monitor`, необходимый guard для чтения
   system identifier/timeline и состояния receiver/slot; backup-роли предметные
   права не выдаются. В `pg_hba.conf` разрешить только
   replication-соединение роли `vse_replication` из подсети Compose-туннеля по
   `host replication vse_replication <tunnel-subnet> scram-sha-256`; предметный
   login этой строкой не разрешать. Межхостовой участок уже защищён SSH, а
   незашифрованный PostgreSQL-участок остаётся внутри закрытой Compose-сети.
2. Проверить параметры: `synchronous_commit=local`,
   `synchronous_standby_names=vse_backup`, physical slot `vse_backup`,
   `max_slot_wal_keep_size=20GB`. `remote_apply` не используется.
3. На backup-хост установить `receiver.service`, `basebackup.service`,
   `basebackup.timer` и скрипты из `deploy/backup/`. В `receiver.env` хранить
   только ссылку на pg_service/passfile; файл имеет режим 0600.
4. Включить receiver и timer. `pg_receivewal --synchronous` делает fsync
   partial-WAL до подтверждения flush LSN. `application_name` строго
   `vse_backup`.

## Копии и retention

`basebackup.timer` запускается ежедневно в 02:00 Europe/Moscow. Новая копия
сначала создаётся в staging, проходит `pg_verifybackup` и SHA-256, затем
атомарно публикуется. Хранятся 7 daily и 4 weekly. WAL не удаляется скриптом
копии: граница цепочки вычисляется только после успешного полного restore новой
копии. Требуемая ёмкость — не меньше 2 TiB и одновременно
`11 × measured_base_size + WAL + 30%`.

`max_slot_wal_keep_size=20GB` ограничивает рост на app-хосте. Потерянный slot,
`wal_status=lost`, разрыв цепочки, заполнение диска или отсутствие свежей
проверенной копии переводят readiness в false и требуют новой base-copy.

## Readiness для DELETE

После ежемесячного восстановления `publish-readiness.py` формирует JSON только
при наличии свежей проверенной base-copy, WAL, ключей и непрерывного журнала
удалений. Файл передаётся на app-хост отдельным операторским каналом и атомарно
размещается как `BACKUP_READINESS_FILE` (0440, backend только читает). В backend
он монтируется Docker secret `/run/secrets/backup_readiness`.

`DELETE_DURABILITY_ENABLED=true` разрешается только после проверки этого файла
и живого receiver/slot/system_identifier/timeline. При любом сомнении остаётся
false. Обычные сохранения используют local commit; только DELETE ВСЭ выполняет
`SET LOCAL synchronous_commit=on`.

## Наблюдение

- receiver streaming/sync, slot active и не lost;
- WAL lag ≤10 минут, base backup ≤26 часов;
- backup-хост свободен ≥30%, app-диск ≥20%;
- timer/receiver exit status;
- ежемесячный restore ≤4 часов и зафиксированные LSN/durations.

Реальные пароли, DSN, hostnames, XML и медицинские данные в evidence не входят.
