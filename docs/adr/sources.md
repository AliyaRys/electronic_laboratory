# Источники и пределы проверки

Версия 1.1, дата 06.11.2026. ФТ v2.0 и R-01–09 подтверждены владельцем в текущем чате. Новое указание пользователя уточняет границы ВетИС: отдельный модуль для ВУ, разработка последней, сначала получение, затем гашение; отсутствие продуктивных credentials не заменяется фиктивным успехом. Обсуждение отдельной среды интеграции в пакет не включалось.

## Локальные источники

Изучены нормативные разделы ФТ 00–13, реестр, решения владельца, handoff, история расхождений макетов, verification/review-findings; предметная основа foundation v1.9 использована для контекста. Исторические ФТ v1 и PDR v1.0–1.8 не объединяются с актуальными правилами. DESIGN/UX/STORYBOOK и общие библиотеки служат ограничением переноса, не разрешением добавлять исключённые функции. Браузерная проверка макетов в этой задаче не проводилась: ранее записанные наблюдения FT 12 прочитаны как источник, не объявлены новым прогоном.

Контрольные суммы фиксируют прочитанный baseline для будущего ТЗ, а не утверждают соответствие любого последующего изменения этим ADR.

| Источник | SHA-256 |
| --- | --- |
| [adr_request.md](../../adr_request.md) | b5300a7389fb79d9429a12a9e9c501be287c2d3ff6bcbe87d6136641557f8e1a |
| [AGENTS.md](../../AGENTS.md) | dc65379bbed90a943a4c62a68b6795dfce4e36cc27b183c6f689306b33492d37 |
| [DESIGN.md](../../DESIGN.md) | e4da284ed40a2b8b021870c64358140bb603dd35b4752ca12ae825bfb047a39a |
| [UX-CONTRACT.md](../../UX-CONTRACT.md) | f1cc77b9168645a54d93fb2d5c9e52f7b5b2e7a4865ddc4bf1f35c8d59ee5c21 |
| [STORYBOOK.md](../../STORYBOOK.md) | cb7e1ea14070365fc29b1460864cec6a5b3ba984d9d3170ff2efa04bbf149119 |
| [Функциональные требования/v2.0/00-specification.md](../../Функциональные%20требования/v2.0/00-specification.md) | 6201a91ade5b7ebfa919f15ae268166e88b855ecc65ec64eeb345e0a1b68603b |
| [Функциональные требования/v2.0/01-access-and-users.md](../../Функциональные%20требования/v2.0/01-access-and-users.md) | d8039a3581a01dab169f2cd9da29e99e6be95aae673af098372f16f5f4350ecc |
| [Функциональные требования/v2.0/02-arrivals-and-receipt.md](../../Функциональные%20требования/v2.0/02-arrivals-and-receipt.md) | db12f826bb753938b753fdc9256934b62c9f2a9183635b0b88c08c4525ff80c3 |
| [Функциональные требования/v2.0/03-examination.md](../../Функциональные%20требования/v2.0/03-examination.md) | 4674f03bbd12bc5c0828fde995182ef9830286d088135e79d64b0130a87ebb28 |
| [Функциональные требования/v2.0/04-outcomes-and-documents.md](../../Функциональные%20требования/v2.0/04-outcomes-and-documents.md) | 94589821c533b284d40c93c4a0cb45b8d79756b588658fcaf60c97d61ce401b5 |
| [Функциональные требования/v2.0/05-samples.md](../../Функциональные%20требования/v2.0/05-samples.md) | 633f2df80a457d6c18cec782d9e57c05dc81a42d5ae0e7d7491aa05fd43333ed |
| [Функциональные требования/v2.0/06-pricing-and-directories.md](../../Функциональные%20требования/v2.0/06-pricing-and-directories.md) | 37d3445de6562af74f10433eefdba254bf1edb1495a8981c0352eecface806ee |
| [Функциональные требования/v2.0/07-common-behavior.md](../../Функциональные%20требования/v2.0/07-common-behavior.md) | 6ea88a8cb6c910be4141d76f92178b21a61c8667c380f6a149e997ef95c4a55d |
| [Функциональные требования/v2.0/08-inputs-and-adr-handoff.md](../../Функциональные%20требования/v2.0/08-inputs-and-adr-handoff.md) | 52d39cc1f866056760a5110993f219e94fd28621aa3fe1fad709892947afb691 |
| [Функциональные требования/v2.0/09-reports.md](../../Функциональные%20требования/v2.0/09-reports.md) | 158bc04cf5712fe88c8f883cc2b7515c2afb7989309ed83213ec87c174dcd583 |
| [Функциональные требования/v2.0/10-field-catalog.md](../../Функциональные%20требования/v2.0/10-field-catalog.md) | 211c9434aa4a7e400fa093aecd3341a5ee73de8ad009dbe1f926abc6f90058b2 |
| [Функциональные требования/v2.0/11-traceability-and-acceptance.md](../../Функциональные%20требования/v2.0/11-traceability-and-acceptance.md) | f3ca9526b562a2ef6c03d29ac269c51109a9d4db376853eb0643d5afe19c58b6 |
| [Функциональные требования/v2.0/12-changes-and-mockups.md](../../Функциональные%20требования/v2.0/12-changes-and-mockups.md) | 6f6de8dcf1a24524515075948407848cd554f4cf1e89de7841f0e5e48989f90b |
| [Функциональные требования/v2.0/13-administrative-deletions.md](../../Функциональные%20требования/v2.0/13-administrative-deletions.md) | b6a50198848a228d0f85a08b17499d10d4024369e7646b002c1082c4a4773531 |
| [Функциональные требования/v2.0/owner-decisions.md](../../Функциональные%20требования/v2.0/owner-decisions.md) | c6896fcadb9785014d7df35adba19c35815ccbb6dfbe61c0e8aed320251c8f6d |
| [Функциональные требования/v2.0/README.md](../../Функциональные%20требования/v2.0/README.md) | d03d4dc507a429e17942abec7ed74d139469ad649f7275e2803dc961599b412f |
| [Функциональные требования/v2.0/requirements-index.md](../../Функциональные%20требования/v2.0/requirements-index.md) | 200b0793e51c61cca3c5e269b4efb2c5defc9b5ccb31d4da221aa383c58fe923 |
| [Функциональные требования/v2.0/review-findings.md](../../Функциональные%20требования/v2.0/review-findings.md) | 0432fd0bb1cdd64d17c8e0b6bdc483b37b762ca82923ff09e0651e42c7137ec8 |
| [Функциональные требования/v2.0/verification.md](../../Функциональные%20требования/v2.0/verification.md) | d94185a2b48403d1984c28f4908622111f8455f9ac7143df79fc5fc1a5eb73e2 |
| [product-design-records/v1.9/00-start-here.md](../../product-design-records/v1.9/00-start-here.md) | fd49daee26d35e0a860af22d7c929746fc695c0e06acefbd8d18779ad87512bb |
| [product-design-records/v1.9/02-product-design-records.md](../../product-design-records/v1.9/02-product-design-records.md) | ac59f13ce7b787b2f6d6e47b88d291a3c3cd06a124f699f325377720b6e69bd0 |
| [product-design-records/v1.9/08-field-catalog.md](../../product-design-records/v1.9/08-field-catalog.md) | 3a5a6f0baa8c38f06df449440e3b9350e7fed30a95200573d9150314dfbd9238 |
| [product-design-records/v1.9/16-veterinary-expert-meeting-2026-11-04.md](../../product-design-records/v1.9/16-veterinary-expert-meeting-2026-11-04.md) | 4d4bce674e645c7ccac9650431c5a748c821f96a637c43a45255c321a47eadd0 |

## Внешние первоисточники

- [documentation-and-adrs](https://github.com/addyosmani/agent-skills/blob/main/skills/documentation-and-adrs/SKILL.md): прочитан исходный SKILL.md; формат адаптирован к adr_request, жизненный цикл/альтернативы/последствия/verification сохранены.
- Локальный Superpowers 7.0.1: using-superpowers, brainstorming, verification-before-completion. Его builder check выполнен отдельным агентом; результаты и исправления — verification.md. Разработка продукта не выполнялась, записи не коммитились автоматически.
- [Форк](https://gitverse.ru/a9v/FastAPI-boilerplate): веб-страница первоначально дала 429, git-доступ сработал. HEAD/main = 4deb9c45f4298d4a84f005126f6ee8ccd823acf8. Проверены pyproject.toml, backend/pyproject.toml, uv.lock, LICENSE.md, backend/src/infrastructure/auth/setup.py и структура auth/taskiq. MIT подтверждена файлом лицензии; Taskiq и crudauth 0.7.1 подтверждены исходником/lock. Лицензия всего дерева зависимостей ещё не проверена.
- [PyCasbin SQLAlchemy adapter](https://github.com/pycasbin/sqlalchemy-adapter): существующий пакет sqlalchemy-adapter. В ADR выбрана консервативная sync-изоляция, а не недоказанная гарантия async-совместимости.
- [openapi-fetch](https://openapi-ts.dev/openapi-fetch/): пути клиента соответствуют OpenAPI буквально; поэтому ADR-006/010 исключают двойной префикс.
- [Получение ВСД v2](https://help.vetrf.ru/wiki/GetVetDocumentListOperation_v2) и [гашение v2](https://help.vetrf.ru/wiki/ProcessIncomingConsignment_v2): справка бизнес-операций; фактический XML-профиль ВУ ими не доказан. Параметры и enum заимствуются только после сверки WSDL ВУ.
- [Различия ВУ и ХС](https://help.vetrf.ru/wiki/Различия_в_запросах_от_хозяйствующих_субъектов_и_ветеринарных_управлений): подтверждает отдельное семейство сервиса/namespace; историческая страница не является доказательством точного актуального v2-контракта ВУ.
- [Компонент ВетИС.API](https://help.vetrf.ru/wiki/Ветис.API): контекст шлюза; примеры mercury-g2b не принимаются автоматически как подходящие для ВУ.
- Версии npm/PyPI и digest Docker Hub получены прямыми запросами. Все точные URL и дата помещены в таблицы README. Сайты [Python](https://www.python.org/downloads/), [Node](https://nodejs.org/en/about/previous-releases), [PostgreSQL](https://www.postgresql.org/support/versioning/), [nginx](https://nginx.org/en/download.html) проверены отдельно; endoflife.date — дополнительная сверка цикла, не замена первоисточнику.

Ни один продуктивный запрос ВетИС не выполнялся. Совместная установка зависимостей, лицензии новых пакетов, реальные credentials, XSD/WSDL ВУ, нормы, тарифы, официальные формы и нагрузка остаются непроверенными входами. Наличие версии в реестре не подтверждает совместимость.


## Дополнения редакции 1.1

Прямое уточнение владельца 06.11.2026: внешних архитектурных согласований нет, технические варианты автор выбирает самостоятельно, новые продуктовые вопросы обсуждает с аналитиком. Это основание принятия решений Accepted, не доказательство runtime-готовности.

Проверены первоисточники дополнительных решений: [GitVerse runner](https://gitverse.ru/docs/cicd/docs/runners/self-hosted/), [workflows](https://gitverse.ru/docs/cicd/introduction/), [пакетные лимиты](https://gitverse.ru/docs/limits-lfs-cicd/limits-packages), [Distribution 3.1.2](https://github.com/distribution/distribution/releases/tag/v3.1.2), [Docker Engine 29.9.3](https://docs.docker.com/engine/release-notes/29), [Compose 5.7.0](https://github.com/docker/compose/releases/tag/v5.7.0), [Redis licenses](https://redis.io/legal/licenses/), [pg_receivewal](https://www.postgresql.org/docs/18/app-pgreceivewal.html), [pg_basebackup](https://www.postgresql.org/docs/18/app-pgbasebackup.html), [ВСД по UUID](https://help.vetrf.ru/wiki/GetVetDocumentByUuidOperation_v2), [stockEntry по UUID](https://help.vetrf.ru/wiki/GetStockEntryByUuidOperation_v2). Версия и digest registry дополнительно прочитаны в Docker Hub; запись в README.

Значения выданного профиля ВУ и реальные секреты по-прежнему не получены. Разница с 1.0: их архитектурная обработка/получение/проверка заданы контрактом входов и больше не требуют выбора технического подхода третьим лицом. Точная доступность служебных методов в выданном ВУ-профиле не объявляется доказанной общими wiki-страницами.
