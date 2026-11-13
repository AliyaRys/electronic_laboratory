# ТЗ на добавление поля «Вид транспорта» в сверку ВСД

Дата: 13.11.2026  
Тип задачи: VetIS XML normalization + API/read model + reconciliation UI

## 1. Цель

В блоке сверки:

«Ветеринарно-санитарная оценка и идентификация транспорта»

добавить первым полем слева comparison-карточку:

```text
Вид транспорта
Автомобильный        [Совпадает] [Не совпадает]
```

Значение брать из XML входящего ВСД:

```xml
vd:certifiedConsignment/vd:transportInfo/vd:transportType
```

XML передаёт числовой код от 1 до 7. Пользователю показывать русскую
расшифровку, а исходный код сохранять отдельно для бизнес-логики, сверки,
диагностики и XML.

## 2. Справочник кодов

Использовать единый словарь backend/domain:

| Код XML | Название в интерфейсе |
| --- | --- |
| `1` | Автомобильный |
| `2` | Железнодорожный |
| `3` | Авиатранспортный |
| `4` | Морской (контейнер) |
| `5` | Морской (трюм) |
| `6` | Речной |
| `7` | Перегон (скота) |

`6` и `7` пометить в коде/документации как значения v2.1, но поддерживать их
наравне с остальными.

Не дублировать перевод в React-компонентах. Один mapping используется при
нормализации, в API и в интерфейсе.

Для неизвестного будущего кода:

- сохранить исходный код;
- показать «Неизвестный вид транспорта»;
- не считать поле автоматически совпадающим;
- не отклонять весь импорт ВСД только из-за неизвестного кода;
- записать диагностическое событие.

Если XML-узел отсутствует или пустой, оставить source value отсутствующим и
не создавать фиктивное значение/отметку.

## 3. Обязательное чтение

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
- ТЗ и реализацию поля `CHK-F12` «Способ хранения продукции».

## 4. Изменения backend/read model

### 4.1. Normalizer

Разбирать XML namespace-aware по точному пути:

```text
vd:certifiedConsignment/vd:transportInfo/vd:transportType
```

Сохранить в source snapshot исходный код, например:

```json
{
  "transportTypeCode": "1"
}
```

Не преобразовывать код в число, не терять исходное значение и не брать вид
транспорта из `vehicleNumber`.

### 4.2. Read model

Расширить `IncomingView.external.fields` отдельными полями:

```text
transportTypeCode: исходный код XML
transportType: русская расшифровка
```

Пример:

```json
{
  "transportTypeCode": "1",
  "transportType": "Автомобильный"
}
```

`source_projection()` должен публиковать `transportKind`/эквивалентный ключ
для validator из этого же mapping. Не создавать второй словарь для CHK.

Для уже сохранённых ВСД выполнить безопасный backfill из raw XML/source
snapshot:

- не менять raw XML, checksum, UUID, revision и локальные факты;
- backfill идемпотентен;
- отсутствие узла остаётся отсутствием, неизвестный код получает диагностику.

## 5. Изменения интерфейса сверки

В `frontend/src/features/arrivals/api.ts::comparedFields()` добавить первым
элементом `block: "transport"`:

```text
fieldId: CHK-F09
label: Вид транспорта
source: external.fields.transportType
```

Порядок транспортного блока должен быть:

1. Вид транспорта;
2. Номер ТС;
3. Номер прицепа/полуприцепа;
4. Способ хранения продукции при перевозке;
5. Состояние грузового отделения и совместная перевозка.

Использовать общий `ComparisonField`, не копировать HTML-разметку.

Для карточки задать placeholder фактического значения:

```text
Фактический вид транспорта
```

Сохранить существующие:

- кнопки `comparison-match`/`comparison-mismatch`;
- `aria-pressed`;
- фактическое значение и причину mismatch;
- `Отмена`/`Ок`;
- visible focus и клавиатурное управление.

Не выбирать «Совпадает» автоматически. Отметка остаётся явным действием
пользователя.

## 6. Валидация и downstream

`CHK-F09` уже относится к транспортным недопустимым расхождениям. Сохранить
существующее правило:

- совпадение разрешает дальнейшую валидацию;
- mismatch требует фактический вид транспорта и причину;
- mismatch не должен автоматически выбирать решение о возврате;
- при недопустимом расхождении доступность `ACCEPT_ALL/PARTIAL/RETURN_ALL`
  определяется существующей серверной матрицей;
- source code и русское имя не подменяются фактическим значением.

В XML гашения source `vd:transportType` сохраняется из закреплённого raw XML.
Фактический реквизит используется только в разрешённом discrepancy/act
payload по текущему контракту. Не изменять raw source без проверки checksum и
revision.

## 7. Тесты

### Backend/normalizer

1. Коды 1–7 дают точные русские названия.
2. `transportTypeCode` и `transportType` публикуются раздельно.
3. Неизвестный код сохраняется и не считается совпадающим автоматически.
4. Отсутствующий узел не создаёт фиктивную отметку.
5. `CHK-F09` появляется в source projection и validation.
6. Backfill существующего raw XML идемпотентен и не меняет checksum/local facts.

### Frontend

1. «Вид транспорта» отображается первым слева в transport block.
2. Для кода `1` отображается «Автомобильный».
3. Для всех кодов 1–7 используются правильные русские значения.
4. Mismatch открывает поле с placeholder «Фактический вид транспорта» и
   причину.
5. Отметка сохраняется и восстанавливается после повторного открытия.
6. Проверить loading/error/unknown code, keyboard focus и ширины
   1440/1024/768/390 px.

Все автоматические проверки используют обезличенные XML fixtures и transport
spy. Живой `ProcessIncomingConsignment` не вызывать.

## 8. Docker, данные и Git

После реализации пересобрать без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять пользователей/ВСД/ВСЭ и не
включать `VETIS_WRITE_ENABLED` агентом.

Работать в отдельной feature-ветке. Перед началом и перед коммитом проверить
`git status`; не затирать существующие изменения.

Вместе с кодом обязательно добавить этот файл ТЗ в Git и в ту же feature-ветку.
Создать коммит с понятным сообщением, отправить feature-ветку в GitHub,
обновить локальный `main` через `git pull --ff-only`, объединить feature-ветку
с `main` без force-push и отправить обновлённый `main` в GitHub.

Если `main` защищён, создать Pull Request, в котором указать путь к этому ТЗ:

`dorabotka/2026-11-13-transport-type-reconciliation.md`

## 9. Критерии готовности

- поле «Вид транспорта» отображается первым слева в транспортном блоке;
- source берётся из `vd:transportType`;
- коды 1–7 отображаются правильными русскими названиями;
- `CHK-F09` сохраняется и валидируется сервером;
- source code сохраняется для XML и диагностики;
- неизвестный/отсутствующий код обрабатывается честно;
- существующие данные не удалены;
- backend/frontend tests проходят, контейнеры пересобраны;
- этот файл ТЗ закоммичен вместе с кодом;
- feature-ветка объединена с `main` и `main` отправлен в GitHub либо создан PR.
