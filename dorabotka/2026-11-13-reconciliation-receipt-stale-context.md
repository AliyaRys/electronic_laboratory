# ТЗ на исправление ошибки гашения из страницы сверки

Дата: 13.11.2026  
Тип задачи: frontend receipt-context synchronization + preview/submit revision safety

## 1. Цель

Исправить маршрут гашения входящего транспортного ВСД со страницы сверки так,
чтобы после заполнения и сохранения сверки пользователь мог:

1. открыть блок «Гашение эВСД»;
2. выбрать результат ветеринарного осмотра и даты;
3. успешно сформировать preview;
4. проверить preview;
5. один раз подтвердить отправку;
6. получить queued operation и увидеть её фактический результат через polling.

Исходная ошибка:

```text
Гашение не подготовлено
Источник или сверка изменились; сформируйте preview заново.
```

Backend должен продолжать отклонять действительно устаревший preview. Нужно
исправить передачу актуальных revision во frontend, а не отключать защиту
revision/checksum.

## 2. Подтверждённая причина

### 2.1. Backend guard работает корректно

`build_receipt_preview()` загружает под блокировкой текущие:

- `VetisSourceDocument.revision`;
- `Reconciliation.rev`.

Затем сравнивает их с пришедшими из frontend значениями:

```python
if source.revision != source_revision or reconciliation.rev != reconciliation_revision:
    raise REVISION_CONFLICT(
        "Источник или сверка изменились; сформируйте preview заново."
    )
```

Эта проверка обязательна: нельзя разрешать гашение по старой сверке или старому
исходному XML.

### 2.2. Frontend сохраняет устаревший receipt context

Текущий поток имеет раздельные query:

```text
GET /arrivals/{party_id}/reconciliation
GET /arrivals/{party_id}/receipt-context
```

`ReceiptOperation` получает context один раз через query key:

```text
[laboratory_id, party_id, "receipt-context"]
```

После успешного сохранения формы `ReconciliationPage` делает только:

```text
setQueryData([labId, partyId, "reconciliation"], savedView)
```

Query `receipt-context` не инвалидируется и не перечитывается. Поэтому после
сохранения backend уже увеличивает `Reconciliation.rev`, но `ReceiptOperation`
продолжает использовать старое значение.

В `prepare()` отправляются значения из устаревшего closure:

```text
context.source_revision
context.reconciliation_revision
```

Та же проблема есть в `confirm()`: при повторной сборке submit payload берёт
revision из `context`, а не из успешно сформированного frozen preview.

### 2.3. Данные указанной партии

Для партии:

`a560d943-38e3-467f-956c-e2a885514cad`

в БД на момент расследования:

```text
source_revision       = 1
reconciliation.state  = OPEN
reconciliation.decision = ACCEPT_ALL
reconciliation.rev    = 4
```

Это подтверждает, что revision сверки меняется независимо от source revision.
Receipt context обязан быть повторно загружен после каждого успешного save и
не может жить в UI дольше показанной revision сверки.

## 3. Обязательное чтение

До реализации прочитать:

- `AGENTS.md`;
- `docs/TZ_development/plans/2026-11-06-11-vetis-receipt.md`;
- `docs/TZ_development/plans/mercury-test-integration-contract.md`;
- `dorabotka/2026-11-12-vetis-receipt-unit-xml-scenarios.md`;
- `backend/src/modules/arrivals/router.py`;
- `backend/src/modules/integrations/vetis/receipt.py`;
- `backend/src/modules/integrations/vetis/receipt_mapping.py`;
- `backend/src/modules/integrations/vetis/worker.py`;
- `backend/src/modules/arrivals/reconciliation.py`;
- `frontend/src/pages/ReconciliationPage.tsx`;
- `frontend/src/features/arrivals/{ReceiptOperation,ReconciliationForm,api}.tsx`;
- `frontend/src/features/arrivals/ReceiptConfirmationDialog.tsx`;
- существующие backend tests receipt/reconciliation и
  `frontend/src/features/arrivals/ReceiptOperation.test.tsx`.

## 4. Требуемый frontend flow

### 4.1. После сохранения сверки

После успешного `PUT /arrivals/{party_id}/reconciliation`:

1. записать возвращённый `ReconciliationView` в query cache;
2. инвалидировать и дождаться нового
   `[laboratory_id, party_id, "receipt-context"]`;
3. передать в `ReceiptOperation` context с той же
   `reconciliation_revision`, что и у сохранённого view;
4. не разрешать подготовку гашения на устаревшем context.

Нельзя считать `setQueryData` сверки достаточным обновлением receipt context.
Инвалидация должна быть awaited либо `ReceiptOperation` должен гарантированно
перечитать context перед prepare.

### 4.2. Непосредственно перед preview

`prepare()` должен всегда выполнить актуализацию context перед POST preview:

```text
freshContext = await receiptContextQuery.refetch()
→ проверить freshContext без Problem
→ проверить source_revision/reconciliation_revision
→ POST /receipt-preview с freshContext
```

Запрещено использовать только значение `context`, захваченное предыдущим
рендером.

Перед POST проверить:

- `freshContext.reconciliation_revision === reconciliation.revision`;
- `freshContext.source_revision !== null`;
- `freshContext.reconciliation_revision !== null`;
- сверка остаётся `OPEN` и `complete=true`;
- `write_enabled=true`;
- выбран `vetInspection`;
- для `PARTIAL/RETURN_ALL` введена дата возврата.

Если context и отображённая сверка расходятся:

- не отправлять stale preview;
- перечитать party/reconciliation/context;
- показать понятное сообщение «Сверка обновилась. Проверьте данные и
  сохраните сверку заново»;
- не терять пользовательские значения, которые ещё не были отправлены;
- не выполнять автоматический PUT и не выбирать решение за пользователя.

Если причина только в устаревшем cached context после уже подтверждённого
save, разрешается автоматически повторить GET context и один раз продолжить
prepare с актуальными revision.

### 4.3. Frozen preview и confirm

После успешного preview сохранить весь `ReceiptPreview` как единственный
источник для подтверждения:

- `preview.intent.source_revision`;
- `preview.intent.reconciliation_revision`;
- `preview.intent.issue_date`;
- `preview.intent.delivery_date`;
- `preview.intent.return_date`;
- `preview.fingerprint`.

`confirm()` должен отправлять source/reconciliation revision и `issue_date` из
`preview.intent`, а fingerprint — из `preview.fingerprint`. Не брать эти поля
из старого `context`.

Повторное нажатие «Погасить эВСД» должно быть заблокировано во время запроса.
Один подтверждённый preview порождает не более одного submit/outbox intent.

Если backend вернул `REVISION_CONFLICT` между preview и confirm:

1. не повторять submit автоматически;
2. закрыть/сбросить устаревший preview;
3. перечитать party, reconciliation и receipt context;
4. показать причину и кнопку «Сформировать preview заново»;
5. сохранить введённые пользователем значения формы;
6. не создавать новую внешнюю write-операцию без нового явного подтверждения.

## 5. Backend contract и безопасность

### 5.1. Сохранить строгую проверку

`build_receipt_preview()` и `submit_receipt()` должны по-прежнему проверять под
актуальной транзакционной блокировкой:

- `source.revision == request.source_revision`;
- `reconciliation.rev == request.reconciliation_revision`;
- checksum raw XML;
- `reconciliation.state == OPEN`;
- confirmed incoming status;
- receiver scope;
- source unit GUID;
- полную матрицу decision/масса/количество/причина;
- отсутствие уже подтверждённой или конфликтующей операции.

Нельзя принимать stale revision, подменять revision значением из frontend
party cache или удалять проверку ради прохождения сценария.

### 5.2. Улучшить диагностируемость

При `REVISION_CONFLICT` backend может безопасно возвращать технические поля
`current_source_revision` и `current_reconciliation_revision` либо помещать их
в диагностический объект Problem. Не возвращать raw XML, credentials или
секреты.

Frontend должен различать:

- stale context после локального сохранения — обновить context;
- source changed — перечитать source/reconciliation и потребовать нового
  осознанного preview;
- checksum mismatch — показать критическую ошибку данных, не повторять вслепую;
- incomplete reconciliation — показать конкретные ошибки сверки;
- write disabled — показать настройку оператора, а не revision error.

## 6. Acceptance flow для пользователя

### Сценарий A: обычное полное гашение

```text
Открыть партию
→ заполнить сверку
→ Сохранить сверку
→ context обновился до новой reconciliation revision
→ выбрать результат ветосмотра
→ Подготовить гашение
→ preview успешно создан
→ проверить summary
→ Погасить эВСД
→ один POST submit
→ operation QUEUED/PROCESSING
→ polling
→ CONFIRMED или честная причина REJECTED/UNKNOWN
```

### Сценарий B: сохранение и подготовка без перезагрузки страницы

1. Открыть сверку.
2. Изменить mark/decision/quantities.
3. Нажать «Сохранить сверку».
4. Не обновляя страницу, нажать «Подготовить гашение».
5. Preview должен использовать новую `reconciliation_revision`, а не старую.

### Сценарий C: source обновился между открытием и preview

1. Открыть страницу и получить context revision N.
2. Имитировать обновление source до revision N+1.
3. Нажать подготовку.
4. Система перечитывает context/reconciliation и не отправляет stale preview.
5. Пользователь видит, что нужно проверить/сохранить актуальную сверку.

### Сценарий D: source изменился после preview

1. Создать preview.
2. Имитировать изменение source.
3. Нажать подтверждение.
4. Submit не создаёт внешнюю операцию по старому preview.
5. Показывается предложение сформировать preview заново.

## 7. Tests

### Backend

1. `receipt-context` возвращает текущие source/reconciliation revisions.
2. `receipt-preview` принимает ровно текущую пару revisions.
3. Устаревшая reconciliation revision возвращает 409 `REVISION_CONFLICT`.
4. Устаревшая source revision возвращает 409 `REVISION_CONFLICT`.
5. Изменение source после preview блокирует submit и не создаёт outbox.
6. Checksum mismatch не маскируется как revision success.
7. Успешный preview строит корректный intent/XML для `ACCEPT_ALL`, `PARTIAL` и
   `RETURN_ALL`.
8. Успешный submit с тем же fingerprint создаёт одну операцию и одну outbox
   запись.
9. Повторный submit не создаёт дубль.
10. `write_enabled=false` не выполняет внешний вызов и возвращает понятную
    ошибку.
11. Все существующие unit/mass/quantity/receiver/decision проверки остаются
    активными.

### Frontend

1. После успешного save reconciliation query и receipt-context query обновляются
   до одной revision.
2. Save → Prepare без перезагрузки страницы отправляет новую revision.
3. `prepare()` делает актуальный GET context перед POST preview.
4. `confirm()` использует revision и issue date из frozen preview, а не stale
   context.
5. Preview/submit выполняются ровно один раз на соответствующее действие.
6. `REVISION_CONFLICT` очищает stale preview и предлагает новый preview без
   автоматического submit.
7. Пользовательский ввод не очищается после revision/network error.
8. Отдельно проверить указанную партию
   `a560d943-38e3-467f-956c-e2a885514cad` в сценарии Save → Prepare.
9. MSW/spy подтверждает отсутствие реального VetIS write-вызова в unit/e2e
   тестах.

## 8. Docker и сохранность данных

После реализации пересобрать контейнеры без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять:

- `docker compose down -v`;
- destructive seed/reset или очистку PostgreSQL;
- удаление пользователей, лабораторий, ВСД, партий, сверок, ВСЭ, проб,
  отчётов;
- обход revision/checksum guards;
- реальные VetIS write-вызовы из тестов или диагностики.

Работать в feature-ветке, сохранить ТЗ вместе с кодом, проверить `git status` и
зафиксировать фактические результаты тестов. Для живой проверки в тестовом
контуре write capability включается только контролируемо оператором; агент не
подменяет успешное гашение фиктивным статусом.

## 9. Критерии готовности

- после Save → Prepare без перезагрузки страницы preview формируется успешно;
- revision в preview совпадает с текущей сохранённой сверкой;
- confirm использует frozen preview и создаёт одну durable receipt operation;
- пользователь получает polling до `CONFIRMED`, `REJECTED` или `UNKNOWN`;
- stale source/reconciliation по-прежнему блокируются безопасно и объяснимо;
- указанная партия проходит сценарий без ошибки «Источник или сверка изменились»
  при отсутствии нового изменения данных;
- backend/frontend tests проходят, Docker-контейнеры пересобраны;
- данные и PostgreSQL volume сохранены.
