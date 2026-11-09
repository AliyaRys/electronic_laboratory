# ADR — Электронная лаборатория ВСЭ

Версия пакета **1.1**, дата **06.11.2026**. **Назначение: полная архитектурная основа для передачи агенту на написание ТЗ.** Все архитектурные выборы ADR-001–024 приняты автором по прямому поручению владельца продукта. Отдельного согласования руководителем, tech lead и эксплуатацией нет. Проверки реализации и фактические параметры установки не подменяются заявлением о готовом приложении.

ФТ v2.0 и R-01–R-09 подтверждены владельцем 06.11.2026. Продуктовая основа — foundation v1.9 с приоритетом O-01–09 из ФТ. Прямое уточнение владельца после версии 1.0 разрешает самостоятельно закрыть технические варианты; требование adr_request о передаче новых решений на внешнее ревью для этого пакета отменено этим уточнением.

## Точка входа для следующего агента

Передать [agent-handoff.md](agent-handoff.md) и всю эту папку. В handoff определены состав ТЗ, приоритет требований, порядок реализации и критерии полноты. Начать чтение с [карты архитектуры](architecture-overview.md), затем предметных ADR-015–024 и платформенных ADR-001–014. [Трассировка](traceability.md) покрывает 81 FT; [контракт входов](deployment-and-input-contracts.md) задаёт типы/источники/отказы для параметров установки, каталогов и ВетИС. [Источники](sources.md) и [проверка](verification.md) отделяют подтверждённые факты от будущих проверок.

## Статусы и полномочия

Все текущие ADR имеют **Accepted** в рамках делегированного автору выбора архитектуры. Это не заявление о согласовании третьими лицами, установленных зависимостях, полученных credentials и работающем production. Новых архитектурных решений в статусе Proposed нет. Принятые ФТ не изменяются архитектурным допущением. Жизненный цикл будущих записей: Proposed → Accepted → Superseded/Deprecated; принятые записи не удаляются, замещаются новыми со ссылкой.

Предыдущий пакет 1.0 сохранён как [архив проекта решений](../adr-v1.0-review.zip); он не нормативен для следующего ТЗ. Текущая редакция завершает ранее не принятые варианты, а не выдаёт их за когда-то согласованные третьими лицами. Шаблон будущих записей — [template.md](template.md).

Конвенция: MADR-lite из adr_request и [documentation-and-adrs](https://github.com/addyosmani/agent-skills/blob/main/skills/documentation-and-adrs/SKILL.md). Использован Superpowers 7.0.1: using-superpowers, brainstorming (контекст/архитектура/независимая проверка), verification-before-completion. Указание владельца на самостоятельный выбор решений имеет приоритет над промежуточными этапами внешнего согласования навыков. Код, DDL, Dockerfile/Compose и CI-конфиги в этой задаче не создаются.

## Индекс решений и состав файлов

14 обязательных имён adr_request сохранены. ADR-015–023 фиксируют предметные решения, ADR-024 закрывает незаданную платформу поставки. Помимо 24 ADR здесь 8 сопровождающих Markdown-файлов: README, template, architecture-overview, traceability, sources, verification, deployment-and-input-contracts, agent-handoff; всего **32**.

| № | Решение | Статус | Дата |
| --- | --- | --- | --- |
| 001 | [PostgreSQL хранит согласованные рабочие данные](ADR-001-postgresql.md) | Accepted | 2026-11-06 |
| 002 | [Backend развивается от закреплённого форка FastAPI](ADR-002-backend-platform.md) | Accepted | 2026-11-06 |
| 003 | [Async SQLAlchemy и Alembic управляют данными](ADR-003-orm-and-migrations.md) | Accepted | 2026-11-06 |
| 004 | [Casbin принимает единое решение о доступе](ADR-004-authn-authz.md) | Accepted | 2026-11-06 |
| 005 | [Redis и arq обслуживают фоновые задачи без хранения бизнес-истины](ADR-005-infra-dependencies.md) | Accepted | 2026-11-06 |
| 006 | [OpenAPI задаёт REST-контракт и единый формат ошибок](ADR-006-api-contract.md) | Accepted | 2026-11-06 |
| 007 | [Новый клиент реализуется как TypeScript React Vite SPA](ADR-007-frontend-platform.md) | Accepted | 2026-11-06 |
| 008 | [TanStack Query хранит серверное состояние, Zustand — контекст клиента](ADR-008-state-management.md) | Accepted | 2026-11-06 |
| 009 | [Radix Primitives дополняются существующими CSS-токенами](ADR-009-ui-layer.md) | Accepted | 2026-11-06 |
| 010 | [openapi-fetch выполняет запросы единого API](ADR-010-http-client.md) | Accepted | 2026-11-06 |
| 011 | [Backend проходит исполняемые проверки данных и прав](ADR-011-backend-quality.md) | Accepted | 2026-11-06 |
| 012 | [Frontend проверяется на уровне компонентов и рабочих сценариев](ADR-012-frontend-quality.md) | Accepted | 2026-11-06 |
| 013 | [Compose и frontend nginx дают единый origin](ADR-013-compose-and-environments.md) | Accepted | 2026-11-06 |
| 014 | [Версии закрепляются с отдельным контролем обновлений](ADR-014-versions-and-upgrades.md) | Accepted | 2026-11-06 |
| 015 | [Модульный монолит изолирует предметные процессы и ВетИС](ADR-015-module-boundaries.md) | Accepted | 2026-11-06 |
| 016 | [Устойчивые идентификаторы отделяют ВСЭ от проб и внешних документов](ADR-016-domain-data.md) | Accepted | 2026-11-06 |
| 017 | [Транзакции, ревизии и идемпотентность защищают рабочие факты](ADR-017-consistency-and-time.md) | Accepted | 2026-11-06 |
| 018 | [Модуль ВетИС использует SOAP-профиль ветеринарных управлений](ADR-018-vetis-module.md) | Accepted | 2026-11-06 |
| 019 | [Приёмка подтверждается внешним результатом без слепого повтора](ADR-019-receipt-orchestration.md) | Accepted | 2026-11-06 |
| 020 | [Нормы и цены закрепляются вместе с результатом](ADR-020-pricing-and-methods.md) | Accepted | 2026-11-06 |
| 021 | [Отчёт сохраняет показанный снимок и воспроизводимые вклады](ADR-021-report-snapshots.md) | Accepted | 2026-11-06 |
| 022 | [Единая модель вывода формирует PDF и Excel](ADR-022-document-rendering.md) | Accepted | 2026-11-06 |
| 023 | [Технический аудит и восстановление защищают данные без истории ВСЭ](ADR-023-operations-security.md) | Accepted | 2026-11-06 |
| 024 | [GitVerse CI/CD и частный OCI registry обеспечивают поставку](ADR-024-delivery-platform.md) | Accepted | 2026-11-06 |

## Версии и граница достоверности


Проверено **06.11.2026** прямым HTTP-чтением npm registry, PyPI, Docker Hub, сайтов Python/Node/PostgreSQL/nginx; форк — git ls-remote и чтением файлов закреплённого коммита. Значение из реестра означает существующий опубликованный выпуск, **не проверенную совместимость**. Контрольные номера adr_request не копировались как доказательство. Registry latest для npm не используется в production как плавающая версия.

**Backend:** исходные версии ниже из реального uv.lock сохраняются. Свежие версии справа — сведения реестра, не разрешение переписать lock. **Frontend и новые пакеты:** выбранные версии фиксируются при реализации; peer/compatibility-проверка входит в CI платформенного этапа, не требует дополнительного согласования. Отклонённый @radix-ui/themes приведён для прозрачности альтернативы.

| Пакет | Выбранная исходная версия / статус | Свежая проверенная версия | Дата | Источник |
| --- | --- | --- | --- | --- |
| react | 19.3.1 (выбрана) | 19.3.1 | 2026-11-06 | [реестр](https://registry.npmjs.org/react/latest) |
| react-dom | 19.3.1 (выбрана) | 19.3.1 | 2026-11-06 | [реестр](https://registry.npmjs.org/react-dom/latest) |
| typescript | 7.0.2 (выбрана) | 7.0.2 | 2026-11-06 | [реестр](https://registry.npmjs.org/typescript/latest) |
| vite | 8.3.6 (выбрана) | 8.3.6 | 2026-11-06 | [реестр](https://registry.npmjs.org/vite/latest) |
| vitest | 5.1.0 (выбрана) | 5.1.0 | 2026-11-06 | [реестр](https://registry.npmjs.org/vitest/latest) |
| @tanstack/react-query | 5.106.1 (выбрана) | 5.106.1 | 2026-11-06 | [реестр](https://registry.npmjs.org/@tanstack%2Freact-query/latest) |
| zustand | 5.0.16 (выбрана) | 5.0.16 | 2026-11-06 | [реестр](https://registry.npmjs.org/zustand/latest) |
| openapi-fetch | 0.17.0 (выбрана) | 0.17.0 | 2026-11-06 | [реестр](https://registry.npmjs.org/openapi-fetch/latest) |
| openapi-typescript | 7.13.0 (выбрана) | 7.13.0 | 2026-11-06 | [реестр](https://registry.npmjs.org/openapi-typescript/latest) |
| @radix-ui/react-dialog | 1.3.1 (выбрана) | 1.3.1 | 2026-11-06 | [реестр](https://registry.npmjs.org/@radix-ui%2Freact-dialog/latest) |
| @radix-ui/themes | Отклонён ADR-009 | 3.3.0 | 2026-11-06 | [реестр](https://registry.npmjs.org/@radix-ui%2Fthemes/latest) |
| react-router | 8.5.1 (выбрана) | 8.5.1 | 2026-11-06 | [реестр](https://registry.npmjs.org/react-router/latest) |
| react-hook-form | 7.91.0 (выбрана) | 7.91.0 | 2026-11-06 | [реестр](https://registry.npmjs.org/react-hook-form/latest) |
| zod | 4.6.7 (выбрана) | 4.6.7 | 2026-11-06 | [реестр](https://registry.npmjs.org/zod/latest) |
| msw | 3.0.4 (выбрана) | 3.0.4 | 2026-11-06 | [реестр](https://registry.npmjs.org/msw/latest) |
| @testing-library/react | 16.3.3 (выбрана) | 16.3.3 | 2026-11-06 | [реестр](https://registry.npmjs.org/@testing-library%2Freact/latest) |
| @playwright/test | 1.65.0 (выбрана) | 1.65.0 | 2026-11-06 | [реестр](https://registry.npmjs.org/@playwright%2Ftest/latest) |
| eslint | 10.14.0 (выбрана) | 10.14.0 | 2026-11-06 | [реестр](https://registry.npmjs.org/eslint/latest) |
| prettier | 3.9.10 (выбрана) | 3.9.10 | 2026-11-06 | [реестр](https://registry.npmjs.org/prettier/latest) |
| @storybook/react-vite | 10.6.6 (выбрана) | 10.6.6 | 2026-11-06 | [реестр](https://registry.npmjs.org/@storybook%2Freact-vite/latest) |
| fastapi | 0.136.1 | 0.162.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/fastapi/json) |
| uvicorn | 0.46.0 | 0.54.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/uvicorn/json) |
| sqlalchemy | 2.0.49 | 2.1.8 | 2026-11-06 | [реестр](https://pypi.org/pypi/sqlalchemy/json) |
| alembic | 1.18.4 | 1.20.1 | 2026-11-06 | [реестр](https://pypi.org/pypi/alembic/json) |
| pydantic | 2.13.4 | 2.14.3 | 2026-11-06 | [реестр](https://pypi.org/pypi/pydantic/json) |
| pytest | 9.0.3 | 9.2.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/pytest/json) |
| mypy | 2.0.0 | 2.4.1 | 2026-11-06 | [реестр](https://pypi.org/pypi/mypy/json) |
| ruff | 0.15.12 | 0.17.4 | 2026-11-06 | [реестр](https://pypi.org/pypi/ruff/json) |
| casbin | 1.43.0 (выбрана) | 1.43.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/casbin/json) |
| crudauth | 0.7.1 (authn; authz в Casbin) | 0.8.2 | 2026-11-06 | [реестр](https://pypi.org/pypi/crudauth/json) |
| redis | 7.4.0 | 8.1.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/redis/json) |
| arq | 0.28.0 (выбрана) | 0.28.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/arq/json) |
| httpx | 0.28.1 | 0.28.1 | 2026-11-06 | [реестр](https://pypi.org/pypi/httpx/json) |
| pytest-cov | 7.1.0 (выбрана) | 7.1.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/pytest-cov/json) |
| pytest-asyncio | 1.3.0 | 1.4.1.post1 | 2026-11-06 | [реестр](https://pypi.org/pypi/pytest-asyncio/json) |
| sqlalchemy-adapter | 1.9.0 (выбрана) | 1.9.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/sqlalchemy-adapter/json) |
| uv | 0.13.7 (выбрана) | 0.13.7 | 2026-11-06 | [реестр](https://pypi.org/pypi/uv/json) |
| asyncpg | 0.31.0 | 0.32.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/asyncpg/json) |
| zeep | 4.3.3 (выбрана) | 4.3.3 | 2026-11-06 | [реестр](https://pypi.org/pypi/zeep/json) |
| weasyprint | 70.0 (выбрана) | 70.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/weasyprint/json) |
| openpyxl | 3.1.5 (выбрана) | 3.1.5 | 2026-11-06 | [реестр](https://pypi.org/pypi/openpyxl/json) |
| psycopg | 3.3.8 (выбрана) | 3.3.8 | 2026-11-06 | [реестр](https://pypi.org/pypi/psycopg/json) |
| argon2-cffi | 25.1.0 (выбрана) | 25.1.0 | 2026-11-06 | [реестр](https://pypi.org/pypi/argon2-cffi/json) |
| npm | 12.2.2 (выбрана) | 12.2.2 | 2026-11-06 | [npm registry](https://registry.npmjs.org/npm/latest) |
| taskiq | 0.12.4 (исходный lock, к удалению по ADR-005) | unverified (обновление не выбрано) | 2026-11-06 | [форк](https://gitverse.ru/a9v/FastAPI-boilerplate), uv.lock закреплённого SHA |

Точный источник исходных backend-версий: репозиторий https://gitverse.ru/a9v/FastAPI-boilerplate.git, `git show 4deb9c45f4298d4a84f005126f6ee8ccd823acf8:uv.lock`. Это отдельное доказательство от свежих версий PyPI. Форк не содержит arq: Taskiq выявлен в backend/pyproject.toml и backend/src/infrastructure/taskiq. Наличие arq в adr_request отражено как принятое решение о замене, не факт исходника.

| Runtime / сервис | Выбор | Дата | Подтверждение |
| --- | --- | --- | --- |
| Python | 3.15.2 (выбран; runtime-проверка выполняется при реализации) | 2026-11-06 | [Python](https://www.python.org/downloads/), [цикл](https://endoflife.date/api/python.json) |
| Node.js | 26.13.0 LTS (выбран) | 2026-11-06 | [выпуски](https://nodejs.org/en/about/previous-releases), [цикл](https://endoflife.date/api/nodejs.json) |
| PostgreSQL | 18.6 (выбран) | 2026-11-06 | [поддержка](https://www.postgresql.org/support/versioning/), [цикл](https://endoflife.date/api/postgresql.json) |
| nginx | 1.30.6 stable (выбран; 1.31.8 — mainline) | 2026-11-06 | [выпуски](https://nginx.org/en/download.html) |
| Redis server | 8.10.3-alpine3.23 (выбран) | 2026-11-06 | [Docker Hub](https://hub.docker.com/v2/repositories/library/redis/tags/8.10.3-alpine3.23) |
| Docker Engine | 29.9.3 | 2026-11-06 | [официальный выпуск](https://docs.docker.com/engine/release-notes/29) |
| Docker Compose plugin | 5.7.0 | 2026-11-06 | [официальный выпуск](https://github.com/docker/compose/releases/tag/v5.7.0) |
| Distribution registry | 3.1.2 | 2026-11-06 | [официальный выпуск](https://github.com/distribution/distribution/releases/tag/v3.1.2) |
| GitVerse runner | инструмент выбран; точный официальный digest фиксируется при установке, сейчас unverified | 2026-11-06 | [self-hosted runner](https://gitverse.ru/docs/cicd/docs/runners/self-hosted/) |

Digest ниже получены для точных тегов Docker Hub. Это индекс multi-platform; архитектура хоста и non-root запуск проверяются перед релизом. Node — сборочный образ, не production runtime SPA. Отдельный образ uv не используется: uv 0.13.7 устанавливается в backend build stage из проверенного release-бинарника с checksum, не плавающий latest. Все фактические base images должны получить digest до выпуска.

| Образ | Проверенный digest | Дата | Источник |
| --- | --- | --- | --- |
| python:3.15.2-slim | sha256:e97b88e416c3c01eb427b21fd8cd3ebf006e6ee38afcfcc3cae1c54ee2ab0a75 | 2026-11-06 | [Docker Hub](https://hub.docker.com/v2/repositories/library/python/tags/3.15.2-slim) |
| node:26.13.0-bookworm-slim | sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 | 2026-11-06 | [Docker Hub](https://hub.docker.com/v2/repositories/library/node/tags/26.13.0-bookworm-slim) |
| postgres:18.6 | sha256:bd5dfa494a5a259704365813dbfa5fa6b3e69be7348d43b547f540c730478583 | 2026-11-06 | [Docker Hub](https://hub.docker.com/v2/repositories/library/postgres/tags/18.6) |
| nginx:1.30.6 | sha256:42c68eab6f7e22611786a9fe1d1c019e275c50185bd54b8f75dc2b9184322703 | 2026-11-06 | [Docker Hub](https://hub.docker.com/v2/repositories/library/nginx/tags/1.30.6) |
| redis:8.10.3-alpine3.23 | sha256:71885d8cc6e42f2bc0aa2eb853bfc4be200b5108a46ac50e117ae1df0531fb80 | 2026-11-06 | [Docker Hub](https://hub.docker.com/v2/repositories/library/redis/tags/8.10.3-alpine3.23) |

| registry:3.1.2 | sha256:38907510915c3f1604c7e83d6ab602ab3020d092f73bdaed8696773693ff768c | 2026-11-06 | [Docker Hub](https://hub.docker.com/v2/repositories/library/registry/tags/3.1.2) |

## Реестр закрытия вопросов версии 1.0

Это журнал принятых решений, не список для внешнего согласования. В колонке указана конкретная точка, где вопрос закрыт. Совместимость и параметры подключения остаются честно непроверенными фактами до реализации/выдачи значений; архитектурное поведение для них уже определено.

| ID прежнего вопроса | Итог | Где зафиксировано |
| --- | --- | --- |
| Q-OWNER | Закрыт: отдельных согласующих нет; агент реализует/проверяет, аналитик меняет продуктовые правила | README, agent-handoff |
| Q-RBAC | Закрыт: одна установка Татарстана, лаборатория/территория/продукция как область, 4 роли, Casbin | ADR-004 |
| Q-AUTH | Закрыт: Redis SessionTransport crudauth, пароль 12–128, сеанс 8ч/простой 30мин, bootstrap одноразовой командой | ADR-004/005 |
| Q-PYTHON / Q-NODE | Закрыты: Python 3.15.2, Node 26.13.0, npm 12.2.2; проверка совместимости — критерий реализации | ADR-002/007/014 |
| Q-COMPAT | Переведён в release-gate: frozen install, peer/типизация/тесты; фактическое прохождение не заявлено | ADR-011/012/014 |
| Q-FORK | Закрыт: закреплённый SHA, ежемесячная задача сопровождения, cherry-pick без молчаливого upgrade lock | ADR-002/014 |
| Q-QUEUE | Закрыт: arq 0.28.0, Redis, PostgreSQL outbox; Taskiq удаляется контролируемым изменением | ADR-005 |
| Q-LICENSE | Закрыт выбор Redis AGPLv3 без модификации/внешнего managed-сервиса; notices всех зависимостей — release-gate | ADR-005/014 |
| Q-UI / Q-UI-MIGRATION | Закрыты: Primitives + CSS-токены; React Router/RHF/zod/Storybook; React frontend отдельно от эталонных HTML/JS | ADR-007/009 |
| Q-TEST | Закрыт: backend 85%/критические модули 90%, frontend 80%, RTL/MSW/Playwright + SC/AT | ADR-011/012 |
| Q-CI | Закрыт: GitVerse self-hosted runner + частный Distribution registry, миграции и проверки до релиза | ADR-024 |
| Q-TLS / Q-HOST | Закрыты: собственный Compose-хост и PostgreSQL; внешний nginx TLS на хосте, frontend localhost:8080 | ADR-001/013 |
| Q-API | Закрыт: Problem Details, /api/v1 в OpenAPI paths, пустой baseUrl; breaking change через v2 | ADR-006/010 |
| Q-UPDATES | Закрыт: ежемесячная задача агента по первоисточникам, без Renovate/Dependabot и auto-merge | ADR-014 |
| Q-OPS | Закрыт: нагрузочные цели/первичные ресурсы, RPO15мин/RTO4ч, backup/WAL/restore и сроки хранения | ADR-023 |
| Q-VETIS-PROFILE | Переведён в контракт настройки: manifest зарегистрированного ВУ-профиля и проверки; выданные строки сейчас unverified | ADR-018, контракт входов |
| Q-INITIATOR | Закрыт O-12/O-13: test read запускается выделенной read-идентичностью; write использует личного инициатора, server capability и явное подтверждение пользователя. Поштучная внешняя owner authorization не требуется; агент не выполняет живой тест | ADR-018/019 |
| Q-RECONCILE | Закрыт: служебное чтение ВСД/stockEntry по UUID, связанного возврата; недостаток доказательств → UNKNOWN | ADR-019 |

## Открытые вопросы

**Незакрытых архитектурных решений для написания ТЗ нет.** Существующие FT и подтверждение R достаточны для текущего архитектурного выбора; новых продуктовых решений вместо аналитика не принято.

Остаются физически внешние значения: домен/сертификат/секреты/контакты установки, credentials и выданный ВУ-профиль, реальные нормы/тарифы/классификация, официальные ресурсы форм. Их схема, источник, этап и отсутствие описаны в deployment-and-input-contracts. Агент пишет ТЗ на их настройку и проверку, не останавливает документ до появления настоящего пароля и не называет макет официальным эталоном.

## Ограничения и проверяемые риски

1. SOAP-профиль ВУ должен реально предоставлять выбранные операции. До получения registered manifest это не доказано; заранее определены проверка capabilities и безопасное выключенное состояние. Выдуманный WSDL запрещён.
2. Первый интеграционный этап импортирует ВСД, но полный рабочий цикл требует доказанной приёмки; служебное чтение и гашение идут следующим отдельным этапом.
3. Совместная работа выбранных версий/пулов/renderer проверяется при реализации. Это исполняемый gate, не основание ждать архитектурного согласующего.
4. Официальные формы и предметные каталоги требуют реальных значений: предусмотрены ресурсы/редакторы, валидация и отказ без подстановок.
5. Один Compose-хост не обеспечивает HA; приняты резервирование вне хоста и проверяемые цели RPO/RTO. Рост нагрузки не даёт права обещать эти цели без прогона.
