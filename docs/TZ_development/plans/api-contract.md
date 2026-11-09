# REST API v1 — контракт разработки

Схемы здесь нормативны для создания Pydantic/OpenAPI и generated TS в ТЗ-01–11. Исполняемый `/openapi.json` появляется при реализации; этот документ не утверждает наличие работающего API. Каждый маршрут ниже начинается `/api/v1`. Paths OpenAPI полные; servers `/`; openapi-fetch baseUrl пустой. Суффикс `:uuid` означает UUID path parameter.

## API-01. Общие схемы и ответы

`DecimalString` — конечная десятичная строка с точкой без exponent; `Code/Number` — текст с нулями. Все изменяемые GET отдают `ETag: "<revision>"`; mutations требуют If-Match целевого агрегата. POST create использует ревизию родителя (party/lab/user collection где применимо), не выдуманную ревизию новой записи. Login/logout/смена собственного пароля не требуют entity ETag, но требуют CSRF/Origin по сессионному протоколу; login получает предварительный CSRF через GET /auth/csrf. Все предметные mutations следуют SPEC-04. Для отсутствующего If-Match — 422 REVISION_REQUIRED; отсутствующего Idempotency-Key — 422 IDEMPOTENCY_KEY_REQUIRED.

`Problem = {type,title,status,detail,instance,code,trace_id,errors:[{path:string,field_id?:string,message:string}]}` с Content-Type application/problem+json. Путь JSON в errors соответствует DTO; field_id указывает CHK/VSE для формы. 401 SESSION_REQUIRED/SESSION_EXPIRED; 403 ACCESS_DENIED/ACCOUNT_BLOCKED; 404 NOT_FOUND; 409 REVISION_CONFLICT/DUPLICATE_NUMBER/ALREADY_EXISTS/IDEMPOTENCY_MISMATCH/OPERATION_UNRESOLVED/STATE_CONFLICT; 422 VALIDATION_ERROR/CONFIGURATION_MISSING/INTEGRATION_EVIDENCE_INCOMPLETE; 503 DEPENDENCY_UNAVAILABLE/INTEGRATION_NOT_CONFIGURED/BACKUP_DURABILITY_UNAVAILABLE. Сообщение русское, code стабилен. Чужой UUID → 404 без реквизитов. Если integration evidence недостаточно, сама операция остаётся UNKNOWN, а запрос ручной проверки может вернуть 422 с её ID.

Успешный create 201 + Location + DTO/ETag; update 200 DTO/ETag; обычный delete 204; удаление ВСЭ после проверки долговечности 204, неопределённость 202 CommandState. Async 202 `{operation_id,state,status_url}` не равен подтверждению. `GET /operations/:id` возвращает `CommandState{id,kind,state,result_id?,problem?,updated_at}`; область каждого чтения проверяется. Idempotency replay возвращает прежний outcome без нового побочного эффекта. Удалённый result не воскрешается; mutation старой сущности → 409 EXAMINATION_DELETED, чтение →404.

Списки: `?laboratory_id&product_species_id&q&from&to&page=1&page_size=20&sort=created_desc&status`. Область обязательна для рабочих списков; чужая область — отказ. from/to включают дни через полуоткрытый timestamp `[from 00:00, to+1day 00:00)` Europe/Moscow. `Page<T>{items,total,page,page_size}`; фиксированно 20 строк, устойчиво created_at DESC/id DESC; для отчётов доступна сортировка year/half/generated_at с id tie-break, whitelist полей. Недопустимый sort/period —422. Новый фильтр page=1. Поиск case-insensitive trimmed, SQL параметры, escaping LIKE wildcard как буквального ввода. ID в ссылках всегда реальные.

## API-02. Доступ и пользователи

| Method / path | Вход → выход; право |
| --- | --- |
| GET /auth/csrf | → CSRF token, no-store; анонимный bootstrap для login |
| POST /auth/login | `{login,password}` → `{user:UserView,contexts:ScopeView[],csrf_token}` + cookie; неверные данные 401 одинаково без перечисления логинов; rate-limit 429 |
| POST /auth/logout | `{}` →204 + отзыв текущего сеанса |
| GET /me | → `UserView{id,full_name,login,email,position,role,active,scopes,capabilities,revision}`; без password hash/секретов |
| POST /me/change-password | `{current_password,new_password,confirmation}` →204, отзыв всех сеансов; неверный текущий 422 |
| GET /contexts | → доступные лаборатории/продукция и контакты помощи, без рабочих данных |
| GET /users; GET /users/:id | Page<UserView> / UserView; только ADMIN с целевой областью; фильтры role/status/lab/product и q ФИО/логин/email |
| POST /users | `UserWrite{full_name,login,email,position?,role,scopes, password,confirmation}` →UserView; ADMIN + delegation |
| PUT /users/:id | UserWrite без пароля →UserView; ETag пользователя; смена назначения отзывает доступ со следующего запроса |
| POST /users/:id/block; POST /users/:id/unblock | `{}` →UserView |
| POST /users/:id/reset-password | `{new_password,confirmation}` →204, все сеансы отозваны; active/scopes не меняются |
| GET /users/:id/history | Page<UserEvent>; только ADMIN, без секретов |
| DELETE /users/:id | нет тела →204; 409 USER_HAS_REFERENCES/SELF_DELETE_FORBIDDEN/LAST_ADMIN |

Пароль 12..128 Unicode символов, подтверждение буквально, Argon2id 64 MiB/3/1. Login уникален после trim; email обязательный валидный контакт; четыре роли enum. UserWrite отвергает старые permission flags. Начальные маршруты: VET/HEAD текущая лаборатория; ADMIN users; ANALYST выбор одной лаборатории.

## API-03. Конфигурация и расчёт

`MethodRule`/`Tariff`/`CheckServiceRule`/`ClassificationMap` — DATA-04 и inputs.md. `PricingRequest{party_id,context:CHECK|VSE,performed:[service_code],results:ResearchValue[],fair}`; accepted values/unit берутся сервером из партии, fair сверяется с frozen приёмкой. `PricingSnapshot{lines:[{service_code,name,unit_id,quantity,unit_price,amount,method_snapshot?,evaluation?}],total,currency:'RUB',fair}`. Для ярмарки unit_price=amount=total='0.00', чужой обычный тариф в snapshot не включён. Клиентская цена игнорируется/отклоняется extra=forbid.

GET /catalogs/{methods|tariffs|check-services|classifications} →Page соответствующей схемы; POST коллекции/PUT `/:id`/DELETE `/:id` — редакторы по матрице прав, ETag записи/коллекции лаборатории. GET /catalogs/readiness?laboratory_id&product_species_id → `{ready,missing:[{input_id,field,message}]}`. POST /pricing/preview →PricingSnapshot, право читать соответствующую рабочую область; расчёт ничего не сохраняет. POST /catalogs/bulk-prices `{laboratory_ids,product_species_id,service_code,unit_id,price}` →202 BulkPriceJob; право ADMIN/ANALYST, ETag не нужен для whole-set intent, актуальная область проверяется под lock, key обязателен. GET /catalogs/bulk-prices/:id → `{targets:[{lab_id,state,problem?}],state}`; POST `/:id/retry` — только failed targets с прежним intent и новым командным ключом, без обновления succeeded.

## API-04. Поступления

`IncomingView{id,party_id,laboratory_id,external:{contour,evsd_uuid,status,fields},classification,documentary,confirmation?,queue,examination_id?,revision}`. `external.fields` хранит для вложенных объектов раздельные `{guid?,uuid?,name?}` из одной source revision; `name` является UI-значением, ID — диагностикой. `QuantitySet{mass_kg:DecimalString,quantity:DecimalString,unit_id:string}`. `ReconciliationWrite{checks:map<CHK-field-id,Comparison>,inspection:{compartment,joint_carriage,vet_result:CORRESPONDS|MISMATCH|UNSUPERVISED},delivered:QuantitySet,accepted:QuantitySet,returned:QuantitySet,decision:ACCEPT_ALL|PARTIAL|RETURN_ALL,return_reason?:{code,text?},repeat?:{required,reason?,act_number?},transaction:{planned,type?:INTERNAL|EXTERNAL},fair:boolean,services:[{code,performed}]}`. `Comparison{matches:boolean,actual?:typed scalar,reason?:string}`; actual имеет тип исходного поля. Для начатой сверки незаполненные поля допускаются, для завершения — полная проверка. ServerView содержит creator, calculated act/items/allowed_decisions/costs, их клиент не задаёт.

GET /arrivals →Page<IncomingView> по queue EXPECTED/WORK/ACCEPTED и result RETURNED/WAITING/COMPLETED. GET /arrivals/:party_id →IncomingView с ETag партии. GET /arrivals/:party_id/reconciliation →ReconciliationView + ETag сверки, если ещё не создана — представление с parent ETag. PUT того же маршрута →сохранённая начатая ReconciliationView; If-Match партии при первом создании, далее сверки. POST /arrivals/:party_id/receipt →202 operation (ТЗ-11); тело `{reconciliation_revision}`; сервер снимает неизменяемый intent, использует ETag сверки. POST `/:party_id/reconcile-receipt` →202 read-reconcile, не ручной success. DELETE /arrivals/:party_id →204 hide expected. Планировщик каждые 15 минут создаёт SyncRun для закреплённых площадок; POST /arrivals/sync `{laboratory_id}` →202 ставит тот же job вручную для VET/HEAD, не меняя read-only идентичность. Нет публичного endpoint записи receipt_confirmation.

## API-05. ВСЭ

`ExaminationWrite{number,stamp,research:ResearchValue[],invasive_findings:[{disease_code,other_text?,location}],noncontagious_findings:[{disease_code,other_text?}],sample:SampleSelection,sent_to_lab:boolean,outcome?:FIT|UNFIT,direction?:SALE|DISPOSAL|DESTRUCTION,reason?:string}`. `ResearchValue{indicator_id,performed:true,value}`; отсутствие optional элемента означает не выполнено, mandatory пропуск →422. Типы VSE-F18–29 из field-mapping, болезни не ResearchValue. `SampleSelection` — API-06. Все readonly поля из party/user/clock не разрешены во write.

| Method / path | Контракт |
| --- | --- |
| GET /examinations | Page<ExaminationView>, контекст и фильтр WAITING/COMPLETED |
| GET /examinations/:id | View с полным снимком/пробами/итогом/author/created_at/first_completed_at/стоимостью/ETag |
| GET /arrivals/:party_id/examination-context | `{party,existing_id?,available_samples,required_indicators,configuration,revision}`; нет создания/резерва |
| POST /arrivals/:party_id/examination/wait | ExaminationWrite →201 WAITING; If-Match партии; sent_to_lab=true |
| POST /arrivals/:party_id/examination/complete | ExaminationWrite →201 COMPLETED; If-Match партии; при sent_to_lab=true до ответа использовать wait, не первый complete |
| PUT /examinations/:id | ExaminationWrite →200; полная разрешённая правка в день создания, сохраняет текущий status; для WAITING полный итог сам не завершает |
| POST /examinations/:id/complete-waiting | `{outcome,direction,reason?}` →200 COMPLETED; только WAITING, явное подтверждение получения ответа действием; после дня создания никакие другие поля |
| DELETE /examinations/:id | →204 только после remote WAL flush; 202 при UNKNOWN с operation_id; в день создания VET/HEAD |

`save_examination` различает command action из маршрута, не принимает произвольный status. Повторная ВСЭ после удаления получает новый UUID, номер можно использовать снова. Клиент не отправляет old UUID как upsert. Ошибки: EXAMINATION_ALREADY_EXISTS с existing_id в доступной области, DAY_CLOSED, RECEIPT_NOT_CONFIRMED, SAMPLE_DISPOSED, REQUIRED_RESULT_MISSING. Чтение контекста не создаёт пробу/цену/резерв.

## API-06. Пробы

`SampleSelection = {mode:'NEW',collected_on:date,mass_kg:DecimalString} | {mode:'REUSE',collection_id:UUID} | {mode:'EDIT',collection_id:UUID,expected_revision:int,collected_on:date,mass_kg:DecimalString}`. EDIT допустим только при обычной разрешённой правке связанной ВСЭ и активной пробе; REUSE только та же партия/лаборатория/вид, без начисления. Все ранее связанные отборы сохраняются при явном NEW, не перезаписываются.

GET /samples/balances?laboratory_id → `[{product_species_id,mass_kg,revision}]`; GET /samples/collections →Page<CollectionView> доступных фактов; GET /samples/disposals →Page<DisposalView> с period, фильтр не влияет на balance. POST /samples/disposals `{laboratory_id,product_species_id,disposed_on,external_vsd_number,expected_mass_kg}` + If-Match корзины →201 DisposalView; expected_mass лишь защита показанного подтверждения, фактическую массу вычисляет сервер по всем активным отборам. Нет PUT/DELETE disposal и нет SOAP submit для проб. Значение внешнего номера — вручную введённый факт, не автоматическая API-проверка.

## API-07. Документы

GET /arrivals/:party_id/conclusion/preview → `ConclusionView{basis_kind:LOCAL|PREVIOUS,basis_id,fields,form_id,form_version,official,warnings}`. GET `.../conclusion.pdf` →application/pdf, Content-Disposition безопасное имя. Доступ читателю записи (VET/HEAD/ANALYST в области), ADMIN запрещён. Основание local — актуальная пригодная завершённая ВСЭ; previous — подтверждённая приёмка без повторной и достаточно подтверждённых пригодных реквизитов. Непригодно/ожидание/удалённая местная при required local не fallback на previous. 422 DOCUMENT_BASIS_INCOMPLETE с перечнем отсутствующего. Print открывает этот PDF, нет команды «выдано/подписано».

## API-08. Отчётность

GET /reports/operational?laboratory_id&from&to → `{processed_parties,product_identifications,transport_inspections,current_sample_balances,period}`. GET /reports →Page<ReportSummary>; GET /reports/:id →ReportSnapshot; HEAD/ANALYST в области. POST /reports/preview `{type:'5-VET-III',laboratory_id,year,half}` → `{payload,key_id,signature}`; read-calculation не требует entity ETag/key, но CSRF/session обязателен. Payload = DATA-05 + session_id binding + compact sources; ограничение 32 MiB несжатого payload. Нет строк/источников →422 REPORT_NO_DATA, незавершённое полугодие →422 PERIOD_NOT_FINISHED; неверная классификация →422 REPORT_MAPPING_INVALID без частичной матрицы.

POST /reports `{preview:{payload,key_id,signature},codes:{okud,okpo,okved,oktmo,okogu,okopf,okfs}}` →201 ReportSnapshot с ETag; idempotency key обязателен; актуальная авторизация и подпись, без пересчёта источников. Коды trim nonblank, текст без маски. Подпись другого сеанса/actor/изменённого payload →422 SNAPSHOT_INVALID. UNIQUE period →409 REPORT_ALREADY_EXISTS. DELETE /reports/:id →204 + освобождённый период; не влияет на источники. GET /reports/:id/export.pdf и /export.xlsx →готовый файл исключительно из snapshot; print тот же PDF. Файл `5-вет_раздел-III_<лаборатория>_<год>_<полугодие>` с очисткой опасных символов.

## API-09. Служебный доступ

GET /health/live без секретов, GET /health/ready (БД/версия схемы; ВетИС отдельно). Метрики/backup readiness/интеграционная диагностика доступны служебной учётной записи установки, не добавляют пятую рабочую роль. Логи не раскрываются ADMIN как обход запрета рабочих данных. Bootstrap — закрытая CLI-команда, не HTTP public signup.

## API-10. Состояния ВетИС

OperationView: `{id,kind,state,party_id?,application_id?,result_id?,last_error?,last_checked_at,can_check_result}`. Технические receipt states NOT_SENT/QUEUED/SUBMITTING/PROCESSING/CONFIRMED/REJECTED/UNKNOWN. Ошибки инициатора/площадки —422 INTEGRATION_INITIATOR_MISSING/INTEGRATION_SCOPE_MISSING; выключенный модуль —503 INTEGRATION_NOT_CONFIGURED. Секреты/сырой SOAP не входят DTO. Переход CONFIRMED допустим только для `ReceiptEvidence` DATA-06, не по HTTP 200 шлюза/UTILIZED/остатку склада. Единственные пользовательские действия — отправить приёмку и проверить результат, без force-confirm.

По O-12 разрешено чтение тестового профиля ВУ. Receipt mutation routes и пользовательские write-действия во всех внешних контурах недоступны и возвращают 503 `INTEGRATION_WRITE_DISABLED` до создания outbox/сетевого вызова; UI не предлагает пробное гашение. Эти маршруты проверяются только офлайн детерминированным адаптером на шести обезличенных fixtures. Наличие `ReceiptEvidence`, credentials или тестового эВСД не разрешает write и не меняет `VETIS_WRITE_ENABLED=false`.

`POST /arrivals/:party_id/receipt/preview` формирует XML preview без сети из закреплённых `source_revision/raw_xml_checksum` и текущей ревизии сверки; ответ содержит fingerprint, человекочитаемое резюме и причины блокировки, но не секреты. Будущий `POST .../receipt` кроме Idempotency-Key и подтверждения пользователя требует server-side `VetisWriteAuthorization{document_uuid,decision,expires_at,responsible,authorization_id}`. Авторизация не принимается из тела клиента и не создаётся обычным API. Несовпадение/истечение срока →403 `VETIS_OWNER_AUTHORIZATION_REQUIRED` до outbox и сети; одного `VETIS_WRITE_ENABLED=true` недостаточно.
