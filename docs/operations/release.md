# Release: воспроизводимая частная поставка (ADR-024, OPS-01, API-09)

Поставка частная: образы публикуются только в собственный реестр, исходный
код не публикуется. Релиз — это **release manifest** с digest-ссылками, а не
ветка и не тег: любой стенд разворачивает те же digest без пересборки.

## Pipeline (`.gitverse/workflows/release.yml`)

Только `workflow_dispatch` (явное поручение), никогда push/pull_request и
никогда авто-merge/deploy. Порядок:

1. **quality** — frozen install (`uv sync --frozen`, `npm ci`), ruff, mypy,
   pytest с `--cov-fail-under=85`. Секреты не используются.
2. **migration-check** — ephemeral PostgreSQL: `upgrade head` с нуля,
   повтор, `downgrade -1` + roll forward (дисциплина
   expand/contract/roll-forward, DATA-контракт). Фиксируется
   `migration_head` для манифеста.
3. **build** — образы собираются **один раз** (`backend.Dockerfile`,
   `frontend.Dockerfile`); пуш в приватный реестр по тегу `sha-<SHA>` и
   digest; ставится тег `active`.
4. **manifest** — генерация и валидация `release-manifest.json` против
   `deploy/release-manifest.schema.json`.
5. **smoke** — собственный стенд из вытянутых digest: one-shot `migrate`
   (с release lock), `/api/v1/health/live` и `/api/v1/health/ready`
   **без ВетИС**, SPA-ориджин отвечает. ВетИС-зависимостей в smoke нет.
6. **production** — только после явного одобрения environment
   `production-<installation>`; deploy сериализуется concurrency-группой
   `deploy-<installation>`.

Действия в workflow закреплены по SHA; недоверенные события (push/PR,
`verify.yml`) работают полностью без секретов. Runner production —
отдельный self-hosted runner с проверенным образом (digest в манифесте,
поле `runner_digest`); перед job-ом digest подтверждается.

## Приватный реестр (`deploy/registry-compose.yml`)

- CNCF Distribution 3.1.2 по проверенному digest; TLS nginx впереди,
  только TLS 1.2/1.3, basic auth (`htpasswd`), выделенная внутренняя сеть.
- Сервис реестра не публикует портов; наружу только nginx на
  `127.0.0.1:5443`.
- Реестр работает как non-root UID `10001`, том `registry_data`.
- Ёмкость под реестр/сборку — 200 GiB.
- Удержание версий: **активный релиз + 5 предыдущих**
  (`deploy/registry-retention.sh`, one-shot сервис `retention`; ежедневный
  график cron на хосте: `15 2 * * * docker compose -f /srv/vse/deploy/registry-compose.yml run --rm retention`).
- Ежедневное резервное копирование
  (`deploy/registry-backup.sh`, one-shot сервис `backup`, cron `15 3 * * *`).
- Восстановление реестра из копии возвращает прежние digest: storage
  копируется как есть, контентно-адресуемое хранилище не пересчитывается.

## ReleaseManifest

Схема — `deploy/release-manifest.schema.json`. Пример валидного манифеста
(значения digest иллюстративные; реальные — из шага build; hostname и
секреты сюда **не входят** и в evidence не попадают):

```json
{
  "git_sha": "38ac87fffffffffffffffffffffffffffffffffff",
  "image_digests": {
    "backend": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "frontend": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "backup_tunnel": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
  "base_digests": {
    "python": "sha256:e97b88e416c3c01eb427b21fd8cd3ebf006e6ee38afcfcc3cae1c54ee2ab0a75",
    "node": "sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68",
    "nginx": "sha256:42c68eab6f7e22611786a9fe1d1c019e275c50185bd54b8f75dc2b9184322703",
    "postgres": "sha256:bd5dfa494a5a259704365813dbfa5fa6b3e69be7348d43b547f540c730478583",
    "redis": "sha256:71885d8cc6e42f2bc0aa2eb853bfc4be200b5108a46ac50e117ae1df0531fb80",
    "registry": "sha256:38907510915c3f1604c7e83d6ab602ab3020d092f73bdaed8696773693ff768c"
  },
  "migration_head": "b7d3f5c9a1e2",
  "locks": {
    "release_lock_id": 94914482292051,
    "serialization": "one-shot migrate holds a pg advisory lock; concurrent releases serialize; a failed migration blocks the version switch"
  },
  "licenses": [
    { "resource": "russia-coat-of-arms.png", "license": "state symbol usage per owner instruction" }
  ],
  "runner_digest": "not-verified",
  "contract_versions": {
    "api": "09-operations (API-01..API-10)",
    "data": "09-operations (DATA-01..DATA-08)",
    "tz": "09-operations"
  },
  "forms": [
    {
      "form_id": "conclusion",
      "version": "preliminary",
      "template_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "official": false
    }
  ]
}
```

Манифест архивируется в закрытый каталог релизов на хосте реестра
(`releases.log` — порядок для retention). Evidence никогда не содержит
фактических hostname, учётных данных и секретов.
