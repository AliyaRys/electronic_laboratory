# Install: установка на новый стенд (OPS-01, API-09, ADR-013/024)

## Предпосылки

- Хост 8 vCPU / 32 GiB / 500 GiB SSD; отдельный backup-хост ≥ 2 TiB;
  200 GiB под реестр/сборку.
- Docker Engine 29.9.3 / Compose 5.7.0.
- Сертификат/ключ TLS установки (файлы на закрытых ресурсах хоста).
- Закрытый env-file установки (`/srv/vse/secrets/install.env`, chmod 600):
  `APP_FQDN`, `DB_HOST/PORT/USER/NAME/PASSWORD`, `SECRET_KEY`,
  `REPORT_PREVIEW_KEYS`, Redis URL/secret/key-prefix, credentials реестра
  (push/pull раздельно), backup-адрес и SSH host key. Файл **не попадает** в
  образы, Git и логи.

## Шаги

1. **Реестр** — `docker compose -f deploy/registry-compose.yml up -d`
   (см. `docs/operations/release.md`): TLS + auth + internal network,
   non-root UID 10001, 200 GiB.
2. **Pull по digest** — из release manifest берутся `image_digests`:
   `docker pull <registry>/vse-backend@<digest>`,
   `docker pull <registry>/vse-frontend@<digest>`. Для compose-стека
   значения задаются в закрытом env-file установки как
   `BACKEND_IMAGE=<registry>/<ns>/vse-backend@<digest>` и
   `FRONTEND_IMAGE=<registry>/<ns>/vse-frontend@<digest>` — сервисы
   `backend`, `migrate` и `frontend` используют их как `image:`.
   **Пересборки нет и быть
   не должно**: тот же digest работает в любой среде (переносимость образов
   между стендами без rebuild).
3. **Env-file** — скопировать шаблон в закрытый env-file, заполнить. Пустые
   обязательные переменные дают startup error без утечки DSN/секретов:
   `SECRET_KEY` и `REPORT_PREVIEW_KEYS` обязательны без умолчаний
   (R02: сервер не стартует без общего секрета превью).
4. **Миграции** — one-shot, до смены версии API:
   `docker compose --profile migrate run --rm migrate`.
   Команда держит release advisory lock (`deploy/migrate_lock.py`):
   две одновременных миграции/релиза сериализуются; зависший/неудавшийся
   holder блокирует смену версии (LOCK_WAIT_TIMEOUT_SECONDS управляет
   ожиданием). Runtime работает DDL-free — только one-shot job.
5. **Стек** — `docker compose up -d`. Публикуется только фронтенд на
   `127.0.0.1:8080`; backend/DB/redis не публикуются; DNS внутри Compose
   (`DB_HOST=postgres`).
6. **Edge TLS** — внешний nginx (`deploy/frontend-nginx.conf`) завершает
   TLS **1.2/1.3 только** и проксирует на SPA-ориджин; сертификат/ключ — по
   путям закрытых файлов хоста.
7. **Bootstrap** — закрытая одноразовая CLI (API-09): обязательная
   идентичность UserWrite, grants, без паролей по умолчанию, повтор
   запрещён.

## Install smoke (без ВетИС)

```sh
curl -sf http://127.0.0.1:8080/api/v1/health/live   # 200
curl -sf http://127.0.0.1:8080/api/v1/health/ready  # БД/версия схемы; ВетИС отдельно
curl -sf https://<APP_FQDN>/                        # SPA через TLS
```

`ready` проверяет БД и версию схемы; состояние ВетИС в smoke не
используется (`VETIS_READ_ENABLED` включается отдельно владельцем).

## Проверки переноса

- Тот же `image_digests` на другом стенде поднимается без пересборки.
- Реестр, восстановленный из копии (`deploy/registry-backup.sh`), отдаёт
  те же digest.
- Envsubst фронтенда ограничен `BACKEND_HOST`/`BACKEND_PORT`
  (`deploy/nginx.conf`); `/api/v1` проходит без rewrite, `/openapi.json`
  отдаёт backend.
