# ТЗ на исправление ручного обновления поступлений с первого нажатия

Дата: 13.11.2026  
Тип задачи: VetIS sync worker + operation state + frontend refresh + tests

## 1. Проблема и подтверждённая причина

На странице поступлений кнопка:

```html
<button type="button" class="app-button secondary">
  <span>Обновить</span>
</button>
```

при первом нажатии запускает ручной sync. В наблюдаемом случае:

- первая операция завершилась `FAILED / VETIS_SYNC_FAILED`;
- первый проход не импортировал новую партию;
- следующее нажатие создало новую операцию;
- вторая операция завершилась `SUCCESS` и импортировала новую запись.

Причина: worker считает временную ошибку внешнего read-запроса окончательным
FAILED и закрывает outbox. Автоматического retry внутри той же операции нет.
Пользователь вынужден нажимать «Обновить» второй раз.

## 2. Требуемый результат

Одно нажатие «Обновить» должно:

1. создать или переиспользовать одну durable sync operation;
2. дождаться успешного полного read-прохода либо честного окончательного
   отказа;
3. автоматически повторить временный сбой без второго нажатия пользователя;
4. после commit успешного sync заново загрузить таблицу и все счётчики;
5. показать новую подходящую партию в «Ожидаемых» после первого завершённого
   действия пользователя.

Повторное нажатие во время операции не должно создавать вторую параллельную
операцию или дубликаты партий.

## 3. Обязательное чтение

- `AGENTS.md`;
- `docs/TZ_development/plans/2026-11-06-10-vetis-read.md`;
- `docs/TZ_development/plans/mercury-test-integration-contract.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `docs/TZ_development/plans/data-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/07-common-behavior.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- `dorabotka/2026-11-12-vetis-gassed-vsd-disappears-from-arrivals.md`;
- `backend/src/modules/integrations/vetis/{sync,worker,adapter,transport}.py`;
- `backend/src/modules/arrivals/router.py`;
- `frontend/src/pages/ArrivalsPage.tsx`;
- `frontend/src/features/arrivals/api.ts`;
- существующие backend/frontend/e2e tests sync и поступлений.

## 4. Ограничения сохранности

1. Не удалять и не пересоздавать пользователей, лаборатории, ВСД, партии,
   сверки, ВСЭ, пробы, отчёты или PostgreSQL volume.
2. Не выполнять `docker compose down -v`, destructive seed/reset или очистку
   БД.
3. Не выполнять внешние write-вызовы ВетИС. Read retry относится только к
   `GetVetDocumentList`.
4. Retry должен быть идемпотентным: повторный UUID обновляет существующую
   запись, новый UUID создаёт одну новую партию.
5. Не маскировать окончательную ошибку сообщением «Поступлений нет».

## 5. Retry policy worker

### 5.1. Разделение ошибок

Разделить ошибки на:

**Повторяемые:**

- timeout/connect error;
- временная недоступность endpoint;
- HTTP 502/503/504;
- временный SOAP gateway fault;
- временный malformed/incomplete application result, если его можно безопасно
  повторить.

**Неповторяемые без изменения конфигурации:**

- `INTEGRATION_NOT_CONFIGURED`;
- `INTEGRATION_SCOPE_MISSING`;
- `INTEGRATION_SCOPE_REVOKED`;
- ошибка schema pin/checksum;
- некорректный manifest или credentials;
- постоянная ошибка авторизации/прав.

Сохранять исходный problem code и техническую диагностику безопасно, без
credentials/raw SOAP. Нельзя превращать все ошибки в одинаковый
`VETIS_SYNC_FAILED` без причины.

### 5.2. Повтор внутри одной операции

Для повторяемых ошибок:

1. не переводить operation сразу в окончательный `FAILED`;
2. сохранить состояние retryable/pending с номером попытки;
3. освободить lease/outbox так, чтобы worker мог повторить операцию;
4. использовать ограниченный backoff, например 2, 5, 10, 30, 60 секунд;
5. установить максимальное число попыток/время операции по текущему контракту;
6. после успешного полного прохода перевести ту же operation в `SUCCESS`;
7. после исчерпания попыток перевести её в `FAILED` с исходным кодом причины.

Нельзя создавать новую операцию на каждую попытку. `operation_id` и
idempotency intent должны оставаться теми же.

Если worker перезапустился, pending/retryable operation должна восстанавливаться
dispatcher-ом без потери retry state.

### 5.3. Overlap protection

Пока для лаборатории есть `PENDING`, `RUNNING` или retry-wait sync:

- повторное нажатие возвращает существующую operation;
- новая operation и новая outbox row не создаются;
- два worker не выполняют одну попытку одновременно;
- полный проход страниц остаётся duplicate-safe.

## 6. Полный проход и видимость результата

Успешным считать только полный проход всех внешних страниц. Checkpoint и
freshness из ТЗ DR9 меняются только после полного `SUCCESS`.

Последовательность завершения:

```text
external read pages
→ import/upsert
→ freshness/presence update
→ commit transaction
→ operation SUCCESS visible via GET /operations/:id
→ frontend refetch table + all stage counters
```

Frontend не должен перечитывать список до того, как `SUCCESS` стал виден из
operation endpoint. Если `refetch()` получил старый ответ, использовать
query invalidation/refetch с защитой от stale response и дождаться завершения
актуального запроса.

После успешного refresh перечитать:

- текущий `arrivals` query;
- `EXPECTED` counter;
- `WORK` counter;
- `ACCEPTED` counter.

Если новая партия не входит в текущий scope/`productType=1`/receiver/type/status,
она не должна появляться, но diagnostics должны объяснять причину.

## 7. Frontend operation state

Состояния кнопки:

- `PENDING/RUNNING/retry-wait`: disabled + busy «Обновление…»;
- retryable failure между попытками: «Повторяем обновление…», не показывать
  финальную ошибку;
- `SUCCESS`: перечитать список и показать итог sync;
- окончательный `FAILED`: показать понятную причину и возможность повторить;
- `INTEGRATION_NOT_CONFIGURED`/scope/auth error: не повторять автоматически,
  показать действие для администратора.

Один клик не должен завершаться визуальным «успехом» до успешного полного
прохода. Ошибка не должна визуально превращаться в пустой список.

Отображать безопасные counters operation:

- обработано страниц;
- получено документов;
- импортировано;
- исключено фильтрами;
- номер текущей попытки.

Не показывать секреты, raw SOAP и credentials.

## 8. Тесты

### Backend

1. Первая попытка получает transient 502, вторая успешна: одна operation,
   итог SUCCESS, новая партия импортирована.
2. Несколько transient ошибок используют backoff и не создают дубликаты
   operation/outbox.
3. После исчерпания попыток operation FAILED с исходной причиной.
4. `INTEGRATION_NOT_CONFIGURED` не повторяется автоматически бесконечно.
5. Scope/auth/schema ошибки не запускают бессмысленный retry.
6. Worker restart во время retry восстанавливает operation.
7. Две параллельные ручные команды используют одну operation.
8. Полный проход с несколькими страницами и retry не теряет документы.
9. После SUCCESS freshness update и operation state commit происходят до
   доступности результата через GET operation.
10. Retry не вызывает `ProcessIncomingConsignment`.

### Frontend/MSW/e2e

1. Одно нажатие создаёт один POST `/arrivals/sync`.
2. Polling остаётся на той же operation до SUCCESS.
3. Retry-wait не показывает финальный FAILED и не разблокирует кнопку раньше
   окончания операции.
4. После SUCCESS таблица и три счётчика refetch-ятся и показывают новую партию.
5. После окончательного FAILED отображается понятная ошибка и доступно
   повторное ручное действие.
6. Проверить loading/error/empty, клавиатуру и ширины 1440/1024/768/390 px.

## 9. Docker, данные и Git

После реализации пересобрать контейнеры без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять пользователей/ВСД/ВСЭ и не
включать VetIS write capability агентом.

Работать в отдельной feature-ветке. Проверить `git status` до начала и перед
коммитом. После тестов отправить ветку в GitHub, обновить `main` через
`git pull --ff-only`, объединить feature-ветку с `main` без force-push и
отправить обновлённый `main`. При защищённом main создать Pull Request.

## 10. Критерии готовности

- новая партия появляется после одного нажатия «Обновить», если read-проход
  доступен и документ подходит под фильтры;
- временный сбой автоматически повторяется в рамках одной операции;
- повторное нажатие не создаёт параллельных операций/дубликатов;
- список перечитывается только после committed SUCCESS;
- окончательные ошибки показываются честно;
- backend/frontend/e2e tests проходят;
- контейнеры пересобраны, ветка отправлена и объединена с main либо создан PR.
