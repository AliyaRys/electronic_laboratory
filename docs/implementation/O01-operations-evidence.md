# O01: Образы, CI и установка — evidence

Дата: 2026-11-08. Ветка `feature/O01-ops`, коммит `7f4ddf3`
`ops: add reproducible private delivery and installation` (pushed).
Требования: ФТ 08 (OPS-01, inputs.md), ADR-013/014/023/024, API-09,
plans/{inputs,api-contract,data-contract}.md, controller decisions ТЗ-09.

## Что сделано

- `backend/tests/operations/test_configuration.py` — 26 конфигурационных
  assertions (TDD: RED 26 failed → GREEN 26 passed).
- `deploy/migrate_lock.py` — обёртка one-shot миграции с advisory lock
  PostgreSQL; `docker-compose.yml` (migrate) и `deploy/backend.Dockerfile`
  подключают её.
- `deploy/frontend-nginx.conf` — внешний edge nginx: TLS 1.2/1.3 только,
  завершение TLS на границе, сертификаты путями закрытых файлов, без
  секретов в репозитории.
- `deploy/registry-compose.yml`, `deploy/registry-nginx.conf`,
  `deploy/registry-retention.sh`, `deploy/registry-backup.sh` — приватный
  реестр: Distribution 3.1.2 по digest, TLS + htpasswd + internal network,
  non-root UID 10001, 200 GiB том, retention «активный + 5 предыдущих»,
  ежедневный backup one-shot сервис.
- `deploy/release-manifest.schema.json` — ReleaseManifest
  {git_sha, image_digests, base_digests, migration_head, locks, licenses,
  runner_digest, contract_versions, forms}, `additionalProperties: false`.
- `.gitverse/workflows/verify.yml` — действия закреплены по SHA
  (checkout v5.0.0, setup-python v6.0.0); push/PR без секретов (уже было).
- `.gitverse/workflows/release.yml` — trusted pipeline: только
  `workflow_dispatch`; frozen install → quality gates (cov ≥85) →
  migration-check на ephemeral PG (с нуля, повтор, downgrade+roll forward)
  → build once → push в приватный реестр по SHA+digest (тег `active`) →
  release manifest (валидация по схеме) → own-stand smoke без ВетИС →
  production только при явном одобрении environment, деплой
  сериализован concurrency-группой `deploy-<installation>`.
- `docs/operations/install.md`, `release.md`, `upgrade.md`.

## Доказательства (команды и результат)

> Fix round 1 (2026-11-08): six review findings fixed; см. раздел
> «Fix round 1» ниже — все цифры актуальны для коммита fix-round.

| Проверка | Команда | Результат |
| --- | --- | --- |
| RED | `uv run --frozen pytest backend/tests/operations/test_configuration.py -v` (до реализации) | **26 failed** (28.39s) |
| GREEN | то же после реализации | **26 passed** (36.51s) |
| Ruff | `uv run --frozen ruff check backend` / `ruff format --check backend` | All checks passed / 140 files already formatted |
| Mypy | `uv run --frozen mypy backend/src` | Success: no issues found in 87 source files |
| Compose base | `docker compose -f docker-compose.yml config --quiet` | exit 0 |
| Compose dev | `docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet` | exit 0 |
| Compose registry | `docker compose -f deploy/registry-compose.yml config --quiet` | exit 0 |
| nginx edge | `nginx -t` в `nginx:1.30.6` с dummy-сертификатом, dummy host | syntax is ok, test successful |
| nginx registry | то же c `REGISTRY_UPSTREAM=registry:5000` (template envsubst) | syntax is ok, test successful |
| Полный бэкенд-набор с покрытием | `pytest backend/tests --cov=backend/src --cov-fail-under=85` | **445 passed**, coverage **93.4%** (≥85) |
| compileall / import | `python -m compileall backend`; импорт `backend.src.interfaces.main`, `deploy.migrate_lock` | 0 / ok |
| YAML release.yml | `yaml.safe_load` | jobs: quality, migration-check, build, manifest, smoke, production; trigger — только workflow_dispatch |
| Digest реестра 3.1.2 | `docker pull registry:3.1.2` + `docker image inspect` | `sha256:38907510915c3f1604c7e83d6ab602ab3020d092f73bdaed8696773693ff768c` |

## Runtime-проверки блокировки миграций (реальные, не только config)

- `test_two_concurrent_migrations_serialize` — два параллельных
  `migrate_lock.py` процесса против реального PostgreSQL (testcontainers,
  `postgres:18.6`): суммарное время > 2.5s при 1.5s в каждом прогоне —
  выполнение сериализовано.
- `test_migration_lock_blocks_when_holder_lives` — удерживающий holder
  (6s) блокирует второй процесс: exit ≠ 0 с сообщением о release lock
  (LOCK_WAIT_TIMEOUT_SECONDS=2).

## Ключевые названные конфигурации (утверждены тестами)

- Base compose: backend/DB/redis не публикуют портов; фронтенд только
  `127.0.0.1:8080:8080`; без bind mounts и без `--reload`;
  `REPORT_PREVIEW_KEYS`/`SECRET_KEY` обязательны без умолчаний
  (сервер не стартует без общего секрета превью — R02).
- Dev compose: БД публикуется только на `127.0.0.1`.
- nginx: `/api/v1` проходит без rewrite; `/openapi.json` не отдаёт SPA;
  envsubst ограничен `BACKEND_HOST`/`BACKEND_PORT`.
- Build once / deploy same digest: манифест несёт image digests + base
  digests + migration_head + locks + licenses + runner_digest +
  contract_versions + forms.
- Workflow policy: недоверенные события без секретов; actions по SHA;
  деплой по установке сериализован.

## Честно не выполнено (not-run) и почему

- **GitVerse CI execution** (verify.yml/release.yml): запуск GitVerse
  runner из этой среды недоступен; проверка workflow — только
  конфигурационные assertions и `docker compose config`/`nginx -t`.
  Легки quality/migration-check/build/manifest/smoke не исполнялись в CI.
- **Build образов** (`docker build` backend/frontend): не выполнялся
  локально в рамках этой задачи (сборка каталога и образов не требовалась
  контролёром; docker buildx на Windows-стенде не проверялся). Push в
  приватный реестр не выполнялся — нет реального реестра/учётных данных.
- **Реальный production deploy, retention/backup на работающем реестре,
  восстановление digest из копии** — требуют реальной установки; пути и
  скрипты определены, исполнение не проверялось.
- **Registry restore возвращает прежний digest** — обеспечивается
  контентно-адресуемым хранилищем OCI; переносимость подтверждается
  digest-ссылками манифеста, живой прогон не выполнялся.
- Dummy TLS-сертификаты и `example.invalid` использованы только для
  `nginx -t`; реальные hostname/секреты в evidence отсутствуют.
- Отказные пути retention/backup проверены живьём в образе
  `vse-registry-tools:local`: без release log → «RETENTION REFUSED»,
  exit 3, ничего не удалено; без примонтированного storage → отказ,
  exit 3.

## Отклонения/решения

- Поле `runner_digest` схемы допускает `not-verified`: до регистрации
  self-hosted runner в GitVerse точный digest неизвестен; значение
  подтверждается перед релизом (ADR-024). Job `runner-verify`
  (self-hosted `vse-runner`) сверяет `RUNNER_IMAGE_DIGEST` с ожидаемым и
  блокирует `production` (needs: [smoke, runner-verify]); production
  исполняется только на выделенном runner `vse-production`.
- Retention берёт порядок удаления ТОЛЬКО из закрытого `releases.log`
  (Distribution не отдаёт время пуша манифеста); без файла — громкий
  отказ exit 3, ничего не удаляется.
- Postgres volume mount (`postgres_data:/var/lib/postgresql`, родительский
  каталог кластера PG18) не менялся — дефект I01 уже исправлен в
  docker-compose.yml; `docker compose config` подтверждает валидность.

## Fix round 1 (2026-11-08) — по итогам ревью контролёра

| Finding | Исправление | Проверка |
| --- | --- | --- |
| 1. Нет `image:` — smoke и digest-deploy не работали | `backend`/`migrate`/`frontend` получили `image: ${BACKEND_IMAGE:-vse-backend:local}` / `${FRONTEND_IMAGE:-vse-frontend:local}`; smoke в release.yml задаёт digest-ссылки через env, убран маскирующий `\|\| true`; upgrade.md/install.md описывают реальный механизм | `docker compose config` c `BACKEND_IMAGE=<...>@sha256:aaa…` → rendered `image` = digest-ссылка (тест `test_compose_services_carry_digest_deployable_image_fields`); тест `test_release_smoke_runs_loud_without_build_masking` |
| 2. Registry недостижим через TLS front (`internal: true` блокирует published-трафик) | выделена сеть `registry_front` (не internal) — nginx подключён к `registry_front` + `registry_internal`; daemon реестра только во внутренней | `docker compose -f deploy/registry-compose.yml config` exit 0; тест `test_registry_front_network_is_publishable` |
| 3. One-shots ссылались на несмонтированные скрипты | собран образ `deploy/registry-tools.Dockerfile` (alpine по digest + curl, скрипты запечены `COPY`); entrypoints указывают на `/usr/local/bin/*` | `docker build -f deploy/registry-tools.Dockerfile deploy/` → OK; тест `test_registry_one_shots_carry_baked_scripts` |
| 4. Lock id в манифесте ≠ реальному | единый источник `deploy/migrate_lock.py::RELEASE_LOCK_ID` = 94914482292051; release.yml и release.md используют то же число | тест `test_release_lock_id_single_source_of_truth` сверяет все три места и запрещает устаревшие значения |
| 5. Fallback retention мог молча удалить свежие релизы | удаление только по закрытому `releases.log` (newest first); без файла — «RETENTION REFUSED», exit 3; dead-код удалён; backup отказывается без storage | живой прогон в tools-образе: exit 3 с сообщением, ничего не удалено; тест `test_retention_refuses_destructive_run_without_release_log` |
| 6. Production не на отдельном runner | job `runner-verify` (self-hosted `vse-runner`) сверяет `RUNNER_IMAGE_DIGEST` vs `RUNNER_IMAGE_EXPECTED_DIGEST` и стоит в `needs` перед production; production — `[self-hosted, vse-production]`, никогда `ubuntu-latest` | YAML-парсинг: prod runs-on `['self-hosted','vse-production']`, needs `[smoke, runner-verify]`; тест `test_production_runs_on_dedicated_selfhosted_runner` |

Гейты после фиксов: `pytest backend/tests/operations -v` → **33 passed**;
полный набор `pytest backend/tests --cov=backend/src --cov-fail-under=85`
→ **452 passed**, coverage **93.48%**; ruff/format/mypy чисто; `docker
compose config` exit 0 для base/dev/registry.
