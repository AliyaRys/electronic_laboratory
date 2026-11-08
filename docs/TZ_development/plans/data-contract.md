# DATA: данные и внутренние контракты

Это проект физической модели для миграций, не готовый DDL. Все PK — UUID, кроме составных ключей; обязательны NOT NULL, если не указано `?`. `rev` — bigint ≥1, увеличивается при изменении агрегата. Даты — date, моменты — timestamptz UTC с интерпретацией Europe/Moscow. Денежные/массовые типы — SPEC-05. JSONB проходит строгую Pydantic-валидацию, `extra=forbid`; JSON не заменяет FK/UNIQUE.

## DATA-01. Доступ

| Таблица | Поля и ограничения |
| --- | --- |
| territories | id, name, parent_id? → territories RESTRICT; дерево без циклов; республика/город/МО |
| laboratories | id, territory_id RESTRICT, name, address, organization, rev; внешние площадки не выводятся из названия |
| users | id, login, full_name, email, position?, password_hash, role enum VET/HEAD/ADMIN/ANALYST, active, rev, created_at; UNIQUE(login); крайние пробелы login убираются, регистр логина сохраняется и сравнивается буквально, поиск списка без регистра |
| user_scopes | user_id, laboratory_id, product_scope_id; UNIQUE всех трёх; врач — назначения, заведующий — своя лаборатория; аналитик — область Татарстана по политике |
| delegation_grants | grantor/target admin, role, territory_id, may_delegate; изменение только уполномоченным управлением, не редактированием собственного профиля |
| user_events | id, target_user_id RESTRICT, actor_id RESTRICT, at, action, changed_fields JSONB без паролей; реальные изменения |
| casbin_rule | схема официального sqlalchemy-adapter; единственный решающий механизм авторизации |

Связанные пользователи RESTRICT; ни один FK автора не ON DELETE CASCADE/SET NULL. Сеансы — Redis, не новая таблица SQL sessions. Блокировка пользователя/пароль отзывают нужные сеансы. Удаление защищает текущего и последнего уполномоченного администратора области под общей блокировкой области.

## DATA-02. Партия и сверка

| Таблица | Поля и ограничения |
| --- | --- |
| incoming_documents | id, contour, evsd_uuid, laboratory_id RESTRICT, external_status, source_snapshot JSONB, content_hash, fetched_at, replaced_document_uuid?, rev; UNIQUE(contour, evsd_uuid) на установку |
| parties | id, incoming_document_id UNIQUE RESTRICT, laboratory_id RESTRICT, classification_snapshot JSONB с четырьмя ID/именами и unit ID, created_at, rev |
| reconciliations | id, party_id UNIQUE RESTRICT, checks JSONB по CHK, delivered/accepted/returned quantities и weights, decision?, transaction_planned?, transaction_type?, fair bool default false, services JSONB, repeated_required?, repeat_reason?, repeat_act_number?, actor_id, saved_at, completed_at?, state OPEN/CONFIRMED/RETURNED, rev |
| receipt_confirmations | id, party_id UNIQUE RESTRICT, operation_id UNIQUE, source_evsd_uuid, fingerprint, evidence JSONB, accepted/returned quantities/weights, classification_snapshot, confirmed_at; запись только командой подтверждения, неизменяема |
| hidden_incoming | contour, evsd_uuid, content_hash, actor_id, hidden_at; UNIQUE(contour, evsd_uuid); fetched_at исключён из hash |

Documental quantities живут в source_snapshot; delivered/accepted/returned отдельно. Поля принятого состава до подтверждения — намерение, не факт. После подтверждения frozen snapshot определяет всю downstream работу. CHECK неотрицательных величин; полное принятие accepted=delivered, returned=0; частичное accepted+returned=delivered, обе части >0; полный возврат accepted=0, returned=delivered. Сравнивать только одинаковые unit ID. Положительная подтверждённая приёмка нужна для ВСЭ; full return никогда не создаёт ВСЭ.

Индексы `(laboratory_id, created_at DESC, id DESC)`, external UUID, status; queue read model учитывает наличие ВСЭ и confirmation отдельно. После удаления ВСЭ партия попадает «В работе», но confirmation остаётся. Скрывать можно только expected без начатой сверки/ВСЭ/внешнего намерения.

## DATA-03. ВСЭ и пробы

| Таблица | Поля и ограничения |
| --- | --- |
| examinations | id, party_id UNIQUE RESTRICT, laboratory_id, number text CHECK(trim(number)<>''), created_at, created_by RESTRICT, first_completed_at?, status WAITING/COMPLETED, stamp, sent_to_lab bool, outcome?, direction?, reason?, rev; UNIQUE(laboratory_id, btrim(number)) с детерминированной регистрозависимой collation |
| research_results | id, examination_id CASCADE, indicator_id, typed_value JSONB, method_snapshot JSONB, evaluation_snapshot JSONB; UNIQUE(examination_id, indicator_id) |
| examination_findings | id, examination_id CASCADE, family INVASIVE/NONCONTAGIOUS, disease_code, other_text?, location?; для invasive location обязателен; noncontagious максимум 10 проверяется командой под lock ВСЭ |
| charges | id, owner_kind CHECK/VSE, owner_id, service_code, snapshot JSONB (name/unit/quantity/price/amount/method version), performed bool, completed_at; UNIQUE(owner_kind, owner_id, service_code); FK реализовать двумя owner-таблицами check_charges/vse_charges для референтной целостности, не бесконтрольным polymorphic FK |
| sample_baskets | laboratory_id, product_species_id, rev; составной PK; сериализует отбор/изменение/списание одного вида |
| sample_collections | id, party_id RESTRICT, laboratory_id RESTRICT, product_species_id, classification_snapshot, collected_on, mass_kg >0, collected_by RESTRICT, created_at, disposal_id? RESTRICT, rev |
| examination_samples | examination_id CASCADE, collection_id RESTRICT; UNIQUE пары; один отбор не должен повторно начисляться при новой связи |
| sample_disposals | id, laboratory_id, product_species_id, disposed_on, mass_kg >0, external_vsd_number nonblank, actor_id RESTRICT, recorded_at; immutable |
| examination_tombstones | examination_id PK (значение без FK), deleted_at, actor_id, command_id; без медицинского payload |

Остаток = SUM коллекций с disposal_id IS NULL; materialized balance не второй источник истины. Каждая коллекция входит максимум в одну утилизацию. При удалении ВСЭ каскадируются только результаты/находки/её charges/связи examination_samples. Не каскадируются партия/сверка/confirmation/коллекции/утилизации/отчёты. У старого URL 404, у старой mutation EXAMINATION_DELETED, никогда upsert по UUID клиента. Статус не содержит DRAFT. Ограничения матрицы итога и сохранённые обязательные результаты проверяются внутри одной команды, не публичным status PATCH.

## DATA-04. Конфигурация

`method_rules(id,laboratory_id,product_species_id,product_state_id,indicator_id,version,result_schema,unit_id,rule,source,rev)`; одна активная версия применимости. `tariffs(id,laboratory_id,product_species_id,service_code,unit_id,price>=0,rev)` UNIQUE области/кода/единицы. `check_service_rules` содержит только два кода PRODUCT_IDENTIFICATION / TRANSPORT_INSPECTION с multiplier_rule и решениями применимости. `report_classifications(id,version,mercury_species_id,animal_column,material_kind MEAT/OFFAL,supported)` UNIQUE(version,species_id). `bulk_price_jobs` + `bulk_price_targets` UNIQUE(job_id,laboratory_id) хранят исходное намерение/результаты; неизменяемый список целей. Удаление active каталога не каскадирует снимки рабочих записей.

## DATA-05. Отчёты и технические операции

`report_snapshots(id,type='5-VET-III',laboratory_id,year,half CHECK IN(1,2),generated_at,generated_by,saved_at,saved_by,header,codes,matrix,source_contributions,rules_version,mapping_version,form_version,ton_precision,rev)` UNIQUE(type,laboratory_id,year,half). После insert не UPDATE. source_contributions содержит UUID/ревизии как значения **без FK CASCADE** и только численные вклады, не медицинский протокол. Индекс lab/year/half и saved_at/id. Preview в БД не хранится.

`command_records(id,actor_id,action,context_id,key,request_hash,status,result_id?,problem_code?,created_at,finished_at?)` UNIQUE scope; `technical_events(id,actor_id,object_uuid,action,at,result,trace_id,revision?,operation_id?)`; `outbox(id,operation_id,event_type,payload,next_attempt_at,lease_owner?,lease_until?,delivered_at?)`; индексы due и operation_id. Неразрешённые external операции не чистятся TTL.

`vetis_source_documents(id,evsd_uuid,external_revision?,external_updated_at?,raw_xml_encrypted,raw_xml_checksum,normalized_snapshot,received_at,is_current)` хранит версионированный защищённый источник; UNIQUE(evsd_uuid,raw_xml_checksum), одна current-версия. Сверка фиксирует `source_document_id/raw_xml_checksum`; новая внешняя версия делает её stale, но не затирает местные факты. `vetis_operations(id,party_id?,laboratory_id,actor_id,kind SYNC/RECEIPT/RECONCILE,state,intent JSONB,fingerprint,local_transaction_id,application_id?,write_authorization_id_hash?,evidence?,last_error?,lease_until?,rev,created_at,updated_at)`; partial UNIQUE(party_id) для unresolved RECEIPT. `sync_runs(id,operation_id,laboratory_id,status,checkpoint?,last_success_at?)`; `vetis_bindings(laboratory_id,contour,business_member_id,enterprise_id,classification_scope,read_identity_ref,rev)`. Owner authorization хранится вне обычной БД/настроек приложения; после проверки журналируется только безопасный ID/hash и scope, достаточные для аудита без возможности повторного использования. Stock GUID/version UUID — разные поля evidence, не evsd_uuid.

## DATA-06. Внутренние интерфейсы

Общие типы определяются в `backend/src/core/contracts.py`: UUID, CommandContext из SPEC-04; `UnitOfWork` предоставляет AsyncSession/commit только координатору; `Clock.now() -> datetime`; `ResourceScope(laboratory_id,product_species_id?)`; `Page[T](items,total,page,page_size)`.

| Владелец / файл | Сигнатура и смысл |
| --- | --- |
| identity/authz.py | `authorize(actor_id: UUID, action: str, scope: ResourceScope, attributes: dict) -> None`; exception при deny; внутри актуальная политика |
| catalog_pricing/service.py | `evaluate_and_price(uow: UnitOfWork, request: PricingRequest, previous: PricingSnapshot | None) -> PricingSnapshot`; типы API-03, без commit |
| arrivals/ports.py | `ReceiptEvidenceReader.read(party_id: UUID) -> ReceiptEvidence | None`; отсутствие/UNKNOWN не даёт права создавать ВСЭ |
| arrivals/confirmation.py | `confirm_receipt(uow: UnitOfWork, evidence: ReceiptEvidence) -> ReceiptConfirmation`; валидирует source/receiver/fingerprint/состав, idempotent; только служебная команда worker |
| samples/service.py | `apply_sample(uow: UnitOfWork, actor_id: UUID, party_id: UUID, examination_id: UUID, selection: SampleSelection) -> SampleCollection`; без commit, блокировка корзины; NEW/REUSE/EDIT |
| examinations/commands.py | `save_examination(ctx: CommandContext, party_id: UUID, payload: ExaminationWrite) -> ExaminationView`; coordinator всей транзакции |
| documents/service.py | `build_conclusion(actor_id: UUID, party_id: UUID) -> ConclusionView`; проверяет актуальное основание |
| reporting/calculator.py | `calculate_5vet(sources: list[ReportSource], mapping: ClassificationMap) -> ReportMatrix`; Decimal, без IO |
| integrations/vetis/ports.py | `list_incoming(scope: VetisScope, cursor: str | None, initiator: str) -> IncomingPage`; `submit_receipt(intent: ReceiptIntent) -> Submission`; `get_operation(application_id: str, initiator: str) -> ExternalResult`; `reconcile_receipt(intent: ReceiptIntent) -> ReconciliationEvidence` |

VetisScope/IncomingPage/ReceiptIntent/Submission/ExternalResult/ReconciliationEvidence определяет adapter contracts.py на основе DTO API-04/10, не SOAP-типы. ReceiptEvidence включает contour, evsd_uuid, receiver/enterprise IDs, decision, documentary/delivered/accepted/returned values+unit IDs, operation IDs, immutable подтверждения состава; `verified=True` от браузера не существует. До последнего этапа ports существуют, adapter выключен; test fake внедряется только тестовым composition root.
