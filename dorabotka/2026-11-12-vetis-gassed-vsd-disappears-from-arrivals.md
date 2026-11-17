# ТЗ на исключение погашенных ВСД из раздела «Поступления»

Дата: 12.11.2026  
Тип задачи: VetIS read-sync + локальный read model + очереди поступлений

## 1. Проблема и установленная причина

ВСД был погашен во внешнем интерфейсе тестового контура Меркурия, но остался
в очереди:

`/labs/2812e437-facc-432f-9242-5162c9d9f49f/arrivals?queue=expected`

Проверка текущего окружения показала:

- последняя синхронизация лаборатории завершилась `SUCCESS`;
- полный проход: `pages_done=1`, `imported=3`;
- UUID погашенного ВСД отсутствует в последнем внешнем ответе;
- его локальный `fetched_at` старше последнего sync;
- локальный `external_status` остался `CONFIRMED`;
- локального `ReceiptConfirmation` нет, потому что гашение выполнялось вне
  этой системы;
- `arrival_page()` определяет `EXPECTED` только по отсутствию локальной
  reconciliation/confirmation.

Корень проблемы: текущий V02 sync делает только upsert документов из текущего
ответа и намеренно не меняет локальную запись, отсутствующую во внешнем
списке. Это правильно для неполного/ошибочного прохода, но сейчас не
различаются:

1. ошибочный или неполный sync, при котором данные менять нельзя;
2. полный успешный `INCOMING + CONFIRMED` проход, в котором ВСД больше не
   является подходящим для активной очереди.

Внешний фильтр:

```xml
<vd:vetDocumentType>INCOMING</vd:vetDocumentType>
<vd:vetDocumentStatus>CONFIRMED</vd:vetDocumentStatus>
```

после гашения исключает ВСД из текущего списка, но локальная очередь этого
изменения не фиксирует.

## 2. Источники

До работы прочитать:

- `AGENTS.md`;
- `docs/TZ_development/plans/2026-11-06-04-arrivals.md`;
- `docs/TZ_development/plans/2026-11-06-10-vetis-read.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `docs/TZ_development/plans/data-contract.md`;
- `docs/TZ_development/plans/mercury-test-integration-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/07-common-behavior.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- `Функциональные требования/v2.0/12-changes-and-mockups.md`;
- материалы foundation v1.9 о поступлениях и статусах;
- `backend/src/modules/integrations/vetis/{adapter,normalizer,sync,worker}.py`;
- `backend/src/modules/arrivals/{models,commands,queries,router}.py`;
- `frontend/src/pages/ArrivalsPage.tsx` и тесты поступлений.

## 3. Ограничения сохранности

1. Не удалять `IncomingDocument`, `Party`, raw XML, checksum, reconciliation,
   ReceiptConfirmation, ВСЭ, пользователей, лаборатории или отчёты.
2. Не выполнять `docker compose down -v`, очистку БД или destructive seed.
3. Не считать отсутствие результата доказательством изменения статуса при
   ошибке, обрыве, неполном проходе или неизвестном scope.
4. Не называть документ `UTILIZED` только по отсутствию в списке CONFIRMED.
   Без отдельного подтверждения использовать состояние вроде
   `NOT_IN_CURRENT_CONFIRMED_LIST`.
5. Не выполнять внешний write-запрос ВетИС.

## 4. Модель актуальности

Добавить в read model состояние актуальности, например:

- `CURRENT_CONFIRMED`;
- `NOT_IN_CURRENT_CONFIRMED_LIST`;
- `UNKNOWN`.

Также хранить:

- последний успешный sync, на котором документ был замечен;
- sync, на котором он перестал быть замеченным;
- причину (`not_in_confirmed_list`, `filtered_receiver`, `filtered_type`,
  `filtered_product_type` и т. п.).

Все существующие source snapshot/raw XML и локальные факты сохраняются.
Если тот же UUID снова появится как CONFIRMED, он снова становится
`CURRENT_CONFIRMED` без создания дубля партии.

Не утверждать `UTILIZED`, если внешний read-контракт не передал этот статус.
Пользовательский текст для stale-состояния:

> ВСД больше не входит в текущую очередь оформленных документов.

## 5. Когда разрешено менять актуальность

Деактивация отсутствующих документов допускается только после полного
успешного sync:

1. все страницы прочитаны до `total`;
2. cursor/offset завершён корректно;
3. scope и contour проверены;
4. нет HTTP/SOAP/XML/DB ошибки;
5. operation получила `SUCCESS` и передвинула checkpoint.

При ошибке или неполном проходе старые документы не менять.

Во время полного прохода собрать все внешние UUID, а не только UUID успешно
импортированных партий. Для каждого UUID сохранить результат:

- `kept`;
- `filtered` с причиной;
- ошибка нормализации/импорта.

После `SUCCESS` сравнить полный набор наблюдённых UUID с локальными активными
документами этой лаборатории и contour. Локальный документ, которого нет в
полном наборе, пометить `NOT_IN_CURRENT_CONFIRMED_LIST`; не удалять его.

Корректный полный ответ `total=0` может деактивировать все активные записи
только при валидном scope и успешном полном checkpoint. Ошибка/timeout/
malformed XML не должны превращать очередь в пустую.

## 6. Очереди и API

`queue=EXPECTED` включает только документы, которые:

- принадлежат доступной лаборатории;
- не скрыты локально;
- имеют `CURRENT_CONFIRMED`;
- не имеют начатой reconciliation;
- не имеют локального confirmation.

`NOT_IN_CURRENT_CONFIRMED_LIST` не показывать в EXPECTED, даже если локальной
reconciliation нет.

Не ломать локальные WORK/ACCEPTED и юридические факты:

- локальное ReceiptConfirmation не удалять из-за внешнего sync;
- удаление ВСЭ не удаляет подтверждение приёмки;
- внешнюю актуальность и локальный статус показывать раздельно;
- direct read stale-документа не должен разрешать повторное гашение.

Расширить `IncomingView` диагностическими полями:

```text
source_presence
last_seen_sync_at
source_presence_reason
```

## 7. Диагностика

Для каждой успешной операции сохранять обезличенные counters:

```text
external_total, pages, observed_uuids, kept,
filtered_receiver, filtered_transport, filtered_status,
filtered_product_type, new_documents, updated_documents,
marked_not_current
```

После ручного обновления показывать честный итог: сколько получено, сколько
подходит, сколько импортировано и сколько исключено из активной очереди.
Ошибка sync не должна отображаться как «ВСД не найдены».
## 8. Тесты

### Backend/sync

Добавить fixtures и проверки:

1. Полный ответ содержит A и B; A уже локально есть — B импортируется, A
   остаётся CURRENT_CONFIRMED.
2. Следующий полный ответ содержит B, но не A — A получает
   NOT_IN_CURRENT_CONFIRMED_LIST и исчезает из EXPECTED.
3. Ошибка на последней странице не меняет актуальность A и не двигает
   checkpoint.
4. Повтор UUID не создаёт вторую Party.
5. UUID, снова появившийся как CONFIRMED, восстанавливает активность без дубля.
6. Фильтры receiver/type/productType дают диагностику, а не молчаливое
   удаление.
7. Пустой корректный полный ответ работает только по правилу раздела 5.
8. Скрытие пользователем и отсутствие во внешнем списке не смешиваются.
9. Counters фиксируются только после полного прохода.

### API/frontend

1. `GET /arrivals?queue=EXPECTED` исключает stale-состояние.
2. `total` и page items считаются после актуальности и scope-фильтра.
3. Direct read stale-документа показывает причину и блокирует повторное
   гашение.
4. ReceiptConfirmation/ВСЭ не удаляются внешним sync.
5. После успешного sync обновляются список и stage counters.
6. После failed/partial sync документ остаётся, UI показывает ошибку.
7. Проверить 1440/1024/768/390 px, клавиатуру и отсутствие overflow.

Все автоматические проверки используют fixtures/spy. Живой
`ProcessIncomingConsignment` не вызывается.

## 9. Docker, данные и Git

После реализации пересобрать без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять данные и не включать
`VETIS_WRITE_ENABLED` агентом.

Работать в отдельной ветке, проверить `git status`, отправить ветку в GitHub,
обновить `main` через `git pull --ff-only`, объединить без force-push и
отправить `main`. При защищённом main создать Pull Request.

## 10. Критерии готовности

- погашенный во внешнем ВетИС ВСД исчезает из EXPECTED после полного успешного
  sync;
- неполный/ошибочный sync не скрывает поступления;
- локальные source и юридические факты не удаляются;
- `CURRENT_CONFIRMED` не путается с подтверждённым `UTILIZED`;
- повторное появление CONFIRMED восстанавливает активность без дубля;
- counters объясняют разницу «получено/подходит/импортировано/исключено»;
- backend/frontend tests проходят, контейнеры пересобраны;
- ветка отправлена в GitHub и объединена с main либо создан Pull Request.
