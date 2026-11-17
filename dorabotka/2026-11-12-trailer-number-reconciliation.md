# ТЗ на добавление номера прицепа/полуприцепа в сверку ВСД

Дата: 12.11.2026  
Тип задачи: VetIS XML normalization + API/read model + reconciliation UI

## 1. Цель

В блоке сверки:

«Ветеринарно-санитарная оценка и идентификация транспорта»

добавить сравниваемое поле:

```text
Номер прицепа/полуприцепа
```

Значение брать из XML входящего ВСД:

```xml
vd:certifiedConsignment/vd:transportInfo/vd:transportNumber/vd:trailerNumber
```

Если узел отсутствует или пустой, в интерфейсе показывать:

```text
Прицеп отсутствует
```

## 2. Обязательное поведение

Поле должно выглядеть и работать как остальные comparison cards:

- название «Номер прицепа/полуприцепа»;
- исходное значение из ВСД;
- кнопка «Совпадает»;
- кнопка «Не совпадает»;
- при несоответствии — поле «Фактическое значение»;
- поле причины несоответствия;
- кнопки «Отмена» и «Ок» существующего общего компонента;
- доступные имена, `aria-pressed`, visible focus и keyboard navigation.

Для отсутствующего прицепа:

- исходный текст строго «Прицеп отсутствует»;
- это информационное значение, а не пустой source field;
- пользователь может явно отметить «Совпадает»;
- отсутствие прицепа само по себе не является ошибкой и не требует ввода
  фактического номера;
- при выборе «Не совпадает» фактический номер и причина обязательны;
- нельзя подставлять `—`, `null`, `Не указано` или фиктивный номер вместо
  согласованного текста.

## 3. Текущая причина отсутствия поля

Проверить и исправить весь путь данных:

1. normalizer должен читать `vd:trailerNumber`, а не только первый найденный
   транспортный номер;
2. source snapshot должен хранить `vehicleNumber` и `trailerNumber` раздельно;
3. `source_projection()` должен публиковать отдельные `vehicleNumber` и
   `trailerNumber`;
4. `IncomingView.external.fields` должен отдавать номер прицепа;
5. `frontend/src/features/arrivals/api.ts::comparedFields()` должен добавлять
   `CHK-F11` в блок `transport`;
6. текущий backend validator уже содержит `CHK-F11` как расхождение,
   требующее фактического значения и причины — не обходить это правило;
7. если source trailer отсутствует, projection обязан отдавать согласованный
   текст «Прицеп отсутствует», чтобы UI мог выполнить явную сверку.

Не переиспользовать `vehicleNumber` для прицепа и не объединять номера в одну
строку: пользователь должен видеть отдельные поля ТС и прицепа.

## 4. Обязательное чтение

До реализации прочитать:

- `AGENTS.md`;
- `docs/TZ_development/plans/API REQUESTS.txt`;
- `docs/TZ_development/plans/field-mapping.md`;
- `docs/TZ_development/plans/2026-11-06-04-arrivals.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/08-field-catalog.md`;
- `Функциональные требования/v2.0/sources/foundation-v1.9/09-checklist-reconciliation.md`;
- `backend/src/modules/integrations/vetis/normalizer.py`;
- `backend/src/modules/arrivals/{schemas,queries,reconciliation,validation}.py`;
- `frontend/src/features/arrivals/{api,ReconciliationForm,ComparisonField}.tsx`;
- существующие XML normalizer/reconciliation/frontend tests.

## 5. Backend и source snapshot

### 5.1. Разбор XML

Разбирать namespace-aware путём:

```text
vd:certifiedConsignment/vd:transportInfo/vd:transportNumber/vd:vehicleNumber
vd:certifiedConsignment/vd:transportInfo/vd:transportNumber/vd:trailerNumber
```

Сохранять отдельно:

```json
{
  "vehicleNumber": "А123АА116",
  "trailerNumber": "Т456РР116"
}
```

Если `trailerNumber` отсутствует, сохранять отсутствие source-факта и
публиковать в UI projection согласованный текст «Прицеп отсутствует».
Не записывать этот текст в raw XML и не выдавать его за внешний номер.

### 5.2. Read model

Расширить `ExternalFields.fields` отдельным ключом `trailerNumber`.

Правила значения:

- непустой source number → этот номер;
- отсутствующий/пустой source number → «Прицеп отсутствует»;
- source code и UI label не смешивать;
- raw XML, checksum, revision и identity ВСД не менять.

Для уже сохранённых документов выполнить безопасный backfill из raw XML/source
snapshot. Backfill должен быть идемпотентным и не менять локальные факты
сверки, гашения, ВСЭ и отчётов.

## 6. Frontend-сверка

В `comparedFields()` добавить в транспортный блок:

```text
fieldId: CHK-F11
block: transport
label: Номер прицепа/полуприцепа
source: external.fields.trailerNumber
```

Порядок транспортного блока:

1. вид транспорта;
2. номер ТС;
3. номер прицепа/полуприцепа;
4. способ хранения;
5. наблюдения грузового отделения и совместной перевозки.

Использовать общий `ComparisonField`, не копировать HTML-разметку локально.
Для CHK-F11 задать placeholder фактического поля:

```text
Фактический номер прицепа/полуприцепа
```

Если текущий общий компонент не поддерживает placeholder, расширить его
явным параметром, не создавая отдельную копию компонента.

## 7. Сохранение и валидация

- `CHK-F11` сохраняется в checks JSONB обычным comparison;
- «Совпадает» для «Прицеп отсутствует» сохраняется как явная отметка;
- «Не совпадает» требует фактического значения и причины;
- недопустимое несоответствие при выборе полного/частичного принятия
  ограничивает решения по существующей серверной матрице;
- нельзя считать отсутствие прицепа несоответствием автоматически;
- нельзя автоматически выбирать решение о возврате.

При формировании XML гашения исходный `trailerNumber` должен оставаться
source-реквизитом. Пользовательский факт используется только в разрешённом
discrepancy/act payload по текущему контракту. Не подменять source XML без
закреплённого source checksum/revision.

## 8. Тесты

### Backend/normalizer

1. XML с `trailerNumber` возвращает отдельный номер прицепа.
2. XML без `trailerNumber` возвращает UI-текст «Прицеп отсутствует».
3. `vehicleNumber` и `trailerNumber` не смешиваются.
4. `CHK-F11` появляется в source projection и участвует в validation.
5. Отсутствие прицепа не создаёт ошибку и допускает явную отметку совпадения.
6. Mismatch требует actual + reason.
7. Backfill существующего raw XML идемпотентен и не меняет checksum/local facts.
8. Неизвестные/длинные номера не теряются и доступны полностью.

### Frontend

1. В транспортном блоке есть поле «Номер прицепа/полуприцепа».
2. Для fixture `trailerNumber` отображается его значение.
3. При отсутствии узла отображается «Прицеп отсутствует».
4. Для отсутствующего прицепа доступны кнопки сравнения, без обязательного
   фактического ввода.
5. Для mismatch открываются фактическое значение и причина с указанным
   placeholder.
6. После сохранения отметка восстанавливается при повторном открытии.
7. Проверить keyboard focus, `aria-pressed`, loading/error и ширины
   1440/1024/768/390 px.

Все автоматические проверки используют обезличенные XML fixtures. Живой
`ProcessIncomingConsignment` не вызывать.

## 9. Docker, данные и Git

После реализации пересобрать без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять пользователей/ВСД/ВСЭ и не
включать `VETIS_WRITE_ENABLED` агентом.

Работать в отдельной ветке, проверить `git status`, отправить ветку в GitHub,
обновить `main` через `git pull --ff-only`, объединить без force-push и
отправить `main`. При защищённом main создать Pull Request.

## 10. Критерии готовности

- поле «Номер прицепа/полуприцепа» отображается в транспортном блоке;
- source берётся из `vd:trailerNumber`;
- отсутствие source отображается ровно как «Прицеп отсутствует»;
- CHK-F11 сохраняется и валидируется сервером;
- номер ТС и прицепа остаются раздельными;
- существующие данные не удалены;
- backend/frontend tests проходят, контейнеры пересобраны;
- ветка отправлена в GitHub и объединена с main либо создан Pull Request.
