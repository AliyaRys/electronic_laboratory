# INPUT: схемы данных, загрузка и безопасное отсутствие

Нормативная основа — [контракт ADR](../../adr/deployment-and-input-contracts.md). Здесь конкретизированы форматы реализации, не придуманы фактические нормы, цены, секреты и XML-профиль. Каждая загрузка валидирует весь набор, показывает ошибки до подтверждения и фиксирует version/source/checksum/loaded_at/actor; partial configuration не считается ready. Fixtures живут только tests и не загружаются production seed.

## INPUT-01. Профиль ВУ — V01/W01

Владелец фактических данных: оператор подключения/интегратор и лаборатория. По O-12 используется выданный тестовый профиль ВУ и выделенная read-идентичность для полного опроса каждые 15 минут. Локальный файл `API Mercury data for connection test.txt` содержит секреты и не входит в Git. `API REQUESTS.txt` содержит успешный read и шесть write-сценариев; он используется как закрытый источник обезличенных fixtures. ИИ-агентам и автоматическим проверкам запрещён живой write-вызов; production-код такого вызова обязателен по O-13.

`VetisManifest{profile_id,version,contour,family:'mercury-vu.service',endpoint:https-url,service_id,business_schema_version,soap_version,namespaces:map,soap_actions:map,wsdl:{resource,sha256},xsd:[{resource,sha256,imports}],operations:[{name,input_type,output_type}],enum_constraints,decimal_constraints,text_constraints,capabilities,evidence_links}`. Для текущего профиля подтверждены endpoint `https://api2.vetrf.ru:8002/platform/services/2.0/ApplicationManagementService`, `service_id=mercury-vu.service:2.0`, namespace `http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2` и SOAPAction submit. V01 обязан закрепить WSDL/XSD checksum. Секреты gateway login/password/apiKey/issuerId хранятся отдельно server config. Personal initiator связан с user UUID; binding лаборатории содержит contour/business_member_id/enterprise_id. `VETIS_READ_ENABLED` включается после проверки read-profile. `VETIS_WRITE_ENABLED` по умолчанию false и не включается агентом; реализация обязана поддерживать true после операторского решения. Fixtures не содержат внешние credentials/идентификаторы.

Проверка checksum/capabilities входит в V01; production-код write transport и обезличенные fixtures шести сценариев — в W01. Матрица XML требует точные namespace/XPath, единицы/precision/length, provenance и моделируемое доказательство результата. Read-хранилище сохраняет raw XML, revision/checksum и GUID/UUID вместе с source `name`; `productType=1` проверяется локально. Missing initiator/scope→422, missing profile/credentials→503. При write capability=false вызов отклоняется до outbox/сети; при true используется реальный transport после роли, актуальности данных и явного подтверждения пользователя. Автотест true-state подменяет transport spy. Нет доказанного partial состава→UNKNOWN/EVIDENCE_INCOMPLETE. XSD ограничения не допускают silent rounding/truncation.

## INPUT-02. Методики и нормы — C01/E01

Владелец значений: ответственный ветметодист. JSON collection `MethodRule{version,laboratory_id,product_species_id,product_state_id,indicator_id,result_schema,unit_id,rule,source:{name,edition,reference},effective_from}`. result_schema — union BOOLEAN_MATCH / INTEGER_NONNEGATIVE / DECIMAL / ENUM / TEXT / DOSIMETRY_PAIR; enum значения и clinical mapping из источника. Rule — `interval{lower?,upper?,lower_inclusive,upper_inclusive}` либо `qualitative{accepted_values}`; обе границы при наличии lower≤upper. Обязательность определяется ФТ, а не редактируемым флажком. Трихинеллоскопия определяется отдельным policy mapping по стабильному GUID: свинина (`57a674fd-ca2b-c523-6853-72d27b4ae32c`), конина (`64930556-cbb2-13db-bcdc-572eb188e45e`), свиные субпродукты/жиры (`40dd45d4-75aa-b984-4fdb-291f84afad03`) и конские субпродукты/жиры (`16d9f824-a5f3-6837-3073-e54c4ed5d74d`). Существующая таблица может временно хранить флаг для совместимости, но её имя не используется для отображения. Клиническая норма не выводится из названия.

Массы scale6, деньги scale2, внешний quantity Decimal с source precision. pH0..14 и microscopy int≥0 — ограничения ввода, не clinical normality. Organoleptic/identification/luminescent — enum MATCH/MISMATCH; cooking список ФТ 10; trichinella result type/rule по методике. Отсутствующая mandatory methodology/norm блокирует wait/complete, в том числе ярмарку; UI input остаётся, UNKNOWN не показывать «Норма». Каталог заболеваний и варианты cooking — дословно ФТ 10 с кодами, stable ID, «Другое» text.

## INPUT-03. Прейскурант — C01/C02/A02

Владелец: ответственный за прейскурант. `Tariff{laboratory_id,product_species_id,service_code,unit_id,price:DecimalString,version,source}` price≥0, ≤2 decimals. VSE множитель только подтверждённое accepted_quantity в source unit. Для двух CHECK услуг `CheckServiceRule{service_code:PRODUCT_IDENTIFICATION|TRANSPORT_INSPECTION,unit_id,multiplier_basis:ACCEPTED_QUANTITY|DELIVERED_QUANTITY|ONE_SERVICE,applicable_decisions:[ACCEPT_ALL|PARTIAL|RETURN_ALL],version,source}` — конкретное правило должно быть получено с прейскурантом, не выбрано агентом вместо владельца. Неприменимый unit/decision→блокирующая конфигурационная ошибка, а не догадка о коэффициенте.

Нет цены для выполненного платного показателя→CONFIGURATION_MISSING; цена 0 допускается явно; ярмарке нет требования платного тарифа, сохраняются только 0.00. Две услуги имеют performed факт, не начисляются за одно открытие формы; возврат не обнуляет действительно оказанное. Реальные числа 94/100/50 измакетов не seed.

## INPUT-04. Формы — D01/D02/R02/R03

Владелец фактического эталона: владелец официальной формы. `FormManifest{form_id,version,date,template_sha256,official,required_fields,paper:'A4',margins_mm,repeat_headers,noncalculated_cells,ton_precision,fonts:[{resource,sha256,license}]}`. Conclusion-local/previous и 5-вет имеют отдельные manifests; общий renderer. До официального эталона official=false, «Предварительная форма», noncalculated «Не рассчитывается», ton_precision6. Для official=true приложить сам эталон/происхождение и визуальное сравнение геометрии/реквизитов; не только сменить флаг. Печатная подпись/печать — пустые места, не fabricated image.

Отсутствие обязательных реквизитов основания блокирует вывод с перечнем, даже если шаблон preliminary. При замене form version сохранённый отчёт сохраняет прежнюю form version/precision и доступный версионированный ресурс; не рендерить старый snapshot новой геометрией молча. Формы старых saved reports не удаляются cleanup. Нет эталона — разработка renderer возможна, официальная эквивалентность не принимается.

## INPUT-05. Классификация — C01/R01/V01

Владелец: интегратор+методист. `ClassificationMap{version,items:[{mercury_species_id,product_type_id,product_state_id,supported_mvp,animal_column,material_kind:MEAT|OFFAL}]}`. Ровно одна животная колонка и material kind для каждого поддержанного вида; колонки CATTLE/PIG/SHEEP_GOAT/RABBIT_NUTRIA/CHICKEN/OTHER_BIRDS/FISH/OTHER_ANIMALS по официальной форме. Наличие fish/poultry колонок не расширяет поддержанные процессы MVP. Неизвестный/двойной mapping блокирует **весь** report calculation; не превращается в OTHER_ANIMALS. Проверить контроль 240=241+242. Source classification партии не перезаписывается новым mapping; snapshot отчёта фиксирует версию применённого mapping.

Входящий эВСД является источником отображаемых названий: для `product`, `subProduct`, `productItem`, единицы и участников сохраняются собственные `guid/uuid/name`. Общий снимок 28 записей `GetProductByTypeList` от 07.11.2026 больше не является обязательной зависимостью read/UI. Существующая `mercury_product_guid_lvl_2` остаётся compatibility-хранилищем до V01 и может хранить четыре policy-флага трихинеллоскопии; промах этой таблицы не даёт `MERCURY_PRODUCT_DICTIONARY_MISS`, если source `name` присутствует. Для 5-вет по-прежнему нужен отдельный `ClassificationMap`; он не выводится из русской строки.

## OPS-01. Параметры установки — I01/O01–03

| Параметр / тип | Источник / хранение | Валидация / безопасный отказ |
| --- | --- | --- |
| APP_FQDN string, TLS certificate/key file | Установка, закрытые ресурсы хоста | Согласованное имя/цепочка/срок, неизвестный Host отвергнут, HTTPS не открывать при плохом сертификате |
| DB_HOST string, PORT int1..65535, USER/NAME string, PASSWORD secret | env-file закрыт; внутри Compose host=postgres | Пустые обязательные→startup error без DSN/секретов |
| BACKEND_HOST/PORT | Compose DNS/внутренний порт, runtime envsubst | Прокси сохраняет /api/v1; backend/DB не publish |
| Redis URL/secret/key-prefix | env-file; separate session/rate/queue prefixes | AOF everysec/noeviction; unavailable→503 защищённым запросам |
| Bootstrap identity/role scope/delegation | Закрытая одноразовая CLI, оператор установки | Обязательные UserWrite, grants valid, no default password, повтор запрещён |
| Session/snapshot keys, key_id | CSPRNG≥256bit, общий серверный key-ring вне образа | Snapshot rotation90d/old9h, no-key→ошибка startup зависимых функций; сеансы max8h idle30m |
| GitVerse repo/runner registration token/runner digest | trusted CI config/секреты | Закрытый repo, exact digest подтверждён до job; untrustedPR без секретов |
| Registry URL/namespace/push/pull credentials | Установка, разные секреты задач и runtime | TLS/auth/nonroot; нет доступа→release fail без публикации исходников |
| Backup host/address/SSH host key/replication credential | Отдельный backup host/закрытые файлы | Неизвестный host key→нет туннеля; нет verified base/WAL/receiver→DELETE503, release blocked |
| Контакты admin/support/incident | Организация, не секретный конфиг контактов | UI показывает реальный доступный контакт; нет контакта — честное объяснение, не fake email; incident status сохраняется |
| Host resources | Оператор:8vCPU/32GiB/500GiBSSD; backup≥2TiB+capacity formula; registry200GiB | Capacity check донагрузки/поставки, disk<20% alert |

Полная матрица прав: VET read/write working вназначенных lab/product; HEAD working read/write и все отчёты своей lab; ADMIN user management/delegation и catalogs в территории, **никаких** working/report/sample/conclusion reads; ANALYST read working/conclusion/samples и create/read/delete отчёты в любой одной выбранной lab Татарстана, catalogs edit в его области, без clinical/sample mutations. VET catalogs read, HEAD own edit, ADMIN/ANALYST scope edit; bulk только ADMIN/ANALYST. Hide expected VET/HEAD; user delete ADMIN сзащитойсвязей/self/last. Каждый read/search/count/export и delayed command повторяет policy; свои созданные записи не расширяют доступ.
