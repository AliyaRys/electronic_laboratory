# ТЗ на отображение всех сопроводительных документов в сверке ВСД

Дата: 16.11.2026  
Тип задачи: VetIS XML normalization + read model/API + reconciliation UI

## 1. Цель

Исправить блок «Сопроводительные документы» на странице сверки данных.

Сейчас приложение выбирает только один транспортный документ и показывает его
как ТТН. В XML входящего ВСД может быть несколько верхнеуровневых элементов:

```xml
<vd:referencedDocument>
  <vd:issueSeries>0006</vd:issueSeries>
  <vd:issueNumber>5555</vd:issueNumber>
  <vd:issueDate>2026-11-16</vd:issueDate>
  <vd:type>1</vd:type>
  <vd:relationshipType>1</vd:relationshipType>
</vd:referencedDocument>
<vd:referencedDocument>
  <vd:issueSeries>33333</vd:issueSeries>
  <vd:issueNumber>66666</vd:issueNumber>
  <vd:issueDate>2026-11-16</vd:issueDate>
  <vd:type>6</vd:type>
  <vd:relationshipType>6</vd:relationshipType>
</vd:referencedDocument>
```

Нужно показывать каждый документ отдельно. Для каждого документа пользователь
должен видеть:

1. «Тип сопроводительного документа»;
2. «Серия и номер» — серия и номер одной строкой через пробел;
3. «Дата создания»;
4. одну пару кнопок «Соответствует»/«Не соответствует» на весь документ, а не
   отдельную пару на каждое поле.

## 2. Обязательное чтение

- `AGENTS.md`;
- `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`;
- официальный метод
  `https://help.vetrf.ru/wiki/GetVetDocumentListOperation_v2`;
- официальный справочник
  `https://help.vetrf.ru/wiki/DocumentType_v2.0`;
- `docs/TZ_development/plans/field-mapping.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `docs/TZ_development/plans/data-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `dorabotka/2026-11-15-vetis-receipt-async-result.md`;
- `backend/src/modules/integrations/vetis/{normalizer,document_types}.py`;
- `backend/src/modules/arrivals/{schemas,queries,reconciliation,validation}.py`;
- `frontend/src/features/arrivals/{api,ReconciliationForm,ComparisonField}.tsx`;
- существующие normalizer, arrivals и reconciliation tests/stories.

Для выполнения использовать **subagent-driven-development**: разбить работу на
независимые backend/read-model, frontend/component и test/verification задачи,
после каждой задачи проверять изменения и интегрировать только согласованный
результат.

## 3. Подтверждённый текущий дефект

Текущий normalizer `_transport_document()`:

- читает только прямые `vd:referencedDocument`;
- отбрасывает все типы кроме 1–5;
- отбрасывает неподходящие `relationshipType`;
- выбирает только один документ, предпочитая `relationshipType=1`.

Затем snapshot хранит его в единственном поле `transportDocument`, а read model
публикует только:

```text
transportDocumentType
transportDocumentNumber
transportDocumentIssuedOn
```

Frontend отображает `CHK-F25`, `CHK-F26`, `CHK-F27` как три отдельные карточки.
Поэтому документы типа 6–24 теряются ещё до UI, а отметка относится к отдельным
полям, а не ко всему документу.

## 4. Справочник `vd:type`

Создать/расширить единый backend registry `DocumentType` и использовать его
для API/UI. Не дублировать разные карты кодов в normalizer, queries и frontend.

| Код | Отображаемое название |
|---:|---|
| 1 | Товарно-транспортная накладная |
| 2 | Коносамент |
| 3 | CMR |
| 4 | Авианакладная |
| 5 | Транспортная накладная |
| 6 | ТОРГ-12 |
| 7 | Разрешение Россельхознадзора на ввоз/вывоз/транзит подконтрольной продукции |
| 8 | Разрешение ветеринарного управления субъекта страны ТС на ввоз продукции |
| 9 | Акт отбора пробы на исследование |
| 10 | ТОРГ-13 |
| 11 | Ветеринарный сертификат на перемещение внутри РФ |
| 12 | Ветеринарный сертификат третьих стран на ввоз продукции на территорию РФ |
| 13 | Ветеринарный сертификат страны ТС на ввоз продукции на территорию РФ |
| 14 | Ветеринарный сертификат РФ на вывоз продукции на территорию стран ТС |
| 15 | Ветеринарный сертификат РФ на вывоз продукции на территорию третьих стран |
| 16 | Заказ |
| 17 | Паспорт гражданина РФ |
| 18 | Паспорт иностранного гражданина |
| 19 | Паспорт гражданина Республики Казахстан |
| 20 | Паспорт гражданина Республики Беларусь |
| 21 | Паспорт гражданина Республики Армения |
| 22 | Паспорт гражданина Республики Киргизия |
| 23 | УПД |
| 24 | Электронный ветеринарный производственный сертификат |

Для неизвестного непустого кода использовать безопасный fallback «Тип документа
<код>» и сохранить исходный код для диагностики. Не удалять неизвестный документ
из списка.

## 5. XML normalization и snapshot

### 5.1. Список документов

В `vdDocument` добавить source-faithful список:

```json
"referencedDocuments": [
  {
    "issueSeries": "0006",
    "issueNumber": "5555",
    "issueDate": "2026-11-16",
    "type": "1",
    "relationshipType": "1"
  }
]
```

Требования:

- читать все прямые дочерние `vd:referencedDocument` у текущего
  `vd:vetDocument`;
- сохранять порядок из XML;
- не использовать descendant-wide поиск, чтобы документы внутри
  `vd:laboratoryResearch` не смешивались с сопроводительными документами ВСД;
- не фильтровать типы 1–5: сохранять все типы 1–24 и неизвестные коды;
- `relationshipType` сохранять без потери, даже если UI его пока не показывает;
- отсутствие серии не является ошибкой;
- если номер или дата отсутствуют, сохранить документ с `null` и показать в UI
  «—», а не удалить весь документ;
- пустой `referencedDocument` без единого полезного поля можно исключить с
  диагностикой normalizer, не ломая импорт остальных данных.

Расширить `ReferencedDocument` так, чтобы optional-поля XML не приводили к
отказу импорта всего ВСД:

```text
issue_series: string | null
issue_number: string | null
issue_date: string | null
document_type: string | null
relationship_type: string | null
```

### 5.2. Обратная совместимость primary transport document

Поле `transportDocument` сохранить как compatibility projection для текущих
потребителей и гашения:

- выбирать только среди документов типа 1–5;
- учитывать `relationshipType` 1/6;
- предпочитать `relationshipType=1`;
- при отсутствии relationship 1 использовать первый корректный документ 1–5;
- если подходящего транспортного документа нет, `transportDocument=null`.

Расширение списка для сверки не должно ломать предыдущую задачу по гашению:
`receipt_mapping.py` продолжает копировать в `delivery/accompanyingForms/waybill`
только выбранный primary transport document.

### 5.3. Backfill

Для уже импортированных документов выполнить идемпотентный backfill из
сохранённого raw XML:

- переразобрать список прямых `vd:referencedDocument`;
- обновить только производный source snapshot/read model;
- не менять raw XML, checksum, UUID, source revision, партии, сверки, ВСЭ,
  пробы и отчёты;
- повторный backfill не создаёт дубликатов и сохраняет исходный порядок.

## 6. API/read model

Добавить typed-массив в `IncomingView.external` либо в согласованный отдельный
read model:

```typescript
type AccompanyingDocument = {
  key: string;
  sourceOrder: number;
  typeCode: string | null;
  typeLabel: string;
  series: string | null;
  number: string | null;
  seriesAndNumber: string | null;
  createdOn: string | null;
  relationshipType: string | null;
};

accompanyingDocuments: AccompanyingDocument[];
```

### 6.1. Стабильный ключ

`key` должен быть детерминированным для одного документа и не зависеть только
от позиции в массиве. Сформировать его из нормализованной комбинации:

```text
typeCode + relationshipType + issueSeries + issueNumber + issueDate
```

Одинаковые документы с полностью одинаковыми source-полями должны иметь
различимый `sourceOrder` либо отдельный occurrence suffix. Перестановка
документов не должна переносить сохранённую отметку на другой документ.

### 6.2. Совместимость старых полей

На переходный период сохранить в API старые flat-поля:

```text
transportDocumentType
transportDocumentNumber
transportDocumentIssuedOn
```

Они заполняются из compatibility `transportDocument` и используются только
старыми потребителями/receipt mapping. Новая страница сверки работает с
`accompanyingDocuments` и не выводит эти поля отдельными карточками.

## 7. Frontend reconciliation UI

### 7.1. Блок

В блоке «Сопроводительные документы» использовать существующую секцию
`CheckSectionCard` с canonical key `documents` и иконкой `check-documents`.

Если документы есть, отображать их вертикальным списком самостоятельных
карточек, визуально отделённых друг от друга:

```text
┌────────────────────────────────────────────────────────┐
│ Товарно-транспортная накладная              [✓] [×]   │
│ Тип сопроводительного документа: Товарно-транспортная │
│ Серия и номер: 0006 5555                              │
│ Дата создания: 16.11.2026                            │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ ТОРГ-12                                    [✓] [×]    │
│ Тип сопроводительного документа: ТОРГ-12              │
│ Серия и номер: 33333 66666                            │
│ Дата создания: 16.11.2026                            │
└────────────────────────────────────────────────────────┘
```

Требования:

- тип документа отображается русским названием из единой карты;
- серия и номер объединяются через один пробел;
- если серии нет — показывать только номер;
- если номера нет — показывать только серию;
- если оба отсутствуют — `—`;
- дату `YYYY-MM-DD` показывать в принятом русском формате `DD.MM.YYYY` без
  timezone-сдвига;
- неизвестный type code не скрывать;
- длинные названия и номера переносятся, карточка не ломает grid;
- документы не смешиваются с «Ранее проведённой ВСЭ» и транспортными полями.

### 7.2. Одна отметка на документ

Для каждого документа использовать одну общую группу:

```text
document card → [Соответствует] [Не соответствует]
```

Кнопки не должны дублироваться у трёх полей внутри карточки. Использовать
существующую визуальную геометрию `ComparisonField`/общего controls либо новый
составной `DocumentComparisonField`, но не копировать разметку локально в
`ReconciliationForm` и stories.

Доступность:

- `role=radiogroup` с названием документа;
- полные русские `aria-label` для обеих кнопок;
- `aria-pressed`/radio semantics;
- состояние выражается не только цветом;
- visible focus и keyboard order соответствуют порядку карточек.

При `Не соответствует` показывать внутри этой карточки структурированное
фактическое значение документа:

- тип;
- серия и номер;
- дата создания;
- причина расхождения.

Фактическое значение передавать как объект документа, а не как одну строку,
чтобы не терять границы полей.

### 7.3. Пустое состояние

Если `accompanyingDocuments` пуст:

```text
В эВСД нет сопроводительных документов.
```

Не создавать фиктивную кнопку или отметку. Отсутствие документов должно
соответствовать текущему правилу обязательности только после согласования
серверной validation-матрицы; UI не должен самовольно блокировать/разрешать
завершение.

## 8. Reconciliation payload и validation

Текущий `checks` допускает только `CHK-Fxx`, поэтому для одной отметки на
несколько документов добавить отдельный typed-контракт:

```text
documentChecks: {
  [documentKey]: {
    matches: boolean;
    actual?: {
      typeCode?: string | null;
      series?: string | null;
      number?: string | null;
      createdOn?: string | null;
    };
    reason?: string | null;
  }
}
```

Требования:

- `documentChecks` хранится в сохранённой сверке без изменения raw XML;
- один документ имеет ровно одну отметку;
- mismatch требует actual и reason по существующему правилу;
- ключ документа проверяется сервером against current source snapshot;
- неизвестный/удалённый ключ не принимается молча;
- источник и фактическое значение не смешиваются;
- изменение порядка документов не меняет адресацию сохранённых отметок;
- existing `CHK-F25/26/27` старых сверок продолжают читаться.

### 8.1. Legacy compatibility

Для старых сохранённых сверок без `documentChecks`:

- считать старые `CHK-F25/26/27` отметкой primary transport document только при
  однозначном соответствии;
- не переносить эти marks на все новые документы;
- при отсутствии primary document показывать старую проверку как legacy
  diagnostic, не выдумывая документ;
- новые сохранения используют `documentChecks` как authoritative source;
- old flat fields остаются доступными для старых receipt/validation consumers
  до завершения миграции.

Обновить server validation/ActPreview так, чтобы расхождение по конкретному
сопроводительному документу содержало стабильный document key, source, actual и
reason. Не считать три новых поля тремя отдельными обязательными отметками.

## 9. Receipt/gashing compatibility

Новая UI-группа всех документов не должна менять внешний XML гашения.

Для `ProcessIncomingConsignment`/`waybill`:

- primary transport document выбирается старым безопасным правилом type 1–5 +
  relationship 1/6;
- type 6 (ТОРГ-12), type 11/24 и прочие документы не подменяют ТТН в
  `accompanyingForms/waybill`;
- если primary transport document отсутствует, сохраняется текущая честная
  ошибка подготовки XML;
- тесты receipt mapping с одним ТТН и несколькими документами должны пройти.

## 10. Tests

### Normalizer/backend

1. Один `referencedDocument` type 1 сохраняется в массиве и compatibility
   `transportDocument`.
2. Два документа type 1 и 6 сохраняются оба в исходном порядке.
3. Документы типов 1–24 получают правильные русские labels.
4. Неизвестный type code сохраняется с fallback label.
5. Прямая верхнеуровневая ссылка не смешивается с вложенным
   `laboratoryResearch/referencedDocument` type 9.
6. Отсутствующая серия/номер/дата не удаляет весь документ.
7. Backfill старого raw XML идемпотентен и не меняет raw/checksum/revisions.
8. Старый `transportDocument` выбирается для receipt mapping по прежнему
   правилу.
9. `DocumentType` registry полностью покрывает коды 1–24.

### API/reconciliation

1. IncomingView отдаёт typed `accompanyingDocuments` с key/order/labels.
2. Новый `documentChecks` валидируется и сохраняется атомарно со сверкой.
3. Mismatch документа требует структурированный actual и reason.
4. Документы с одинаковыми полями получают разные occurrence keys.
5. Перестановка source list не переносит marks на другой документ.
6. Старые `CHK-F25/26/27` читаются без миграции данных и не копируются на все
   документы.
7. ActPreview показывает конкретный документ, а не только общий CHK-F25.

### Frontend

1. В блоке видны две отдельные карточки для примера type 1 и type 6.
2. У каждой карточки ровно одна пара controls.
3. Отображаются «Тип сопроводительного документа», «Серия и номер», «Дата
   создания».
4. Длинные labels/series не ломают карточку; проверить 1440/1024/768/390 px.
5. Loading/error/empty/unknown type и отсутствие серии покрыты tests/stories.
6. Mismatch открывает actual document fields и reason внутри нужной карточки.
7. Keyboard focus, screen-reader names и no-GUID leakage проверены.
8. Нет браузерных вызовов ВетИС; используются API fixtures/MSW.

## 11. Docker, subagents и Git

ИИ-агент должен выполнить задачу через **subagent-driven-development**: отдельные
subtasks для normalizer/read model, backend validation, frontend component и
tests/review; перед интеграцией проверить diff каждого subtask.

После реализации:

```powershell
cd C:\electronic_lab_dev\frontend
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build-storybook
npm.cmd run build
npm.cmd run test:e2e

cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, destructive reset/seed и не удалять
пользователей, ВСД, партии, сверки, ВСЭ, пробы, отчёты или PostgreSQL volume.

ТЗ добавить в ту же feature-ветку и commit, что и код. Затем:

1. проверить `git status`/`git diff`;
2. отправить feature-ветку в GitHub;
3. выполнить `git pull --ff-only` для `main`;
4. объединить feature-ветку с `main` без force-push;
5. отправить обновлённый `main` в GitHub.

При защищённом `main` создать Pull Request. Живые VetIS write-вызовы в
автотестах и разработке не выполнять.

## 12. Критерии готовности

- все верхнеуровневые `vd:referencedDocument` отображаются в блоке
  «Сопроводительные документы»;
- типы 1–24 расшифровываются официальными русскими названиями;
- каждый документ отделён визуальной карточкой и имеет одну общую отметку;
- серия и номер объединяются через пробел, дата отображается в русском формате;
- старое отображение только ТТН заменено массивом документов;
- receipt mapping и гашение сохраняют отдельный primary transport document;
- old checks не теряются, новые document-level checks валидируются сервером;
- tests/storybook/e2e проходят, контейнеры обновлены;
- feature-ветка вместе с ТЗ объединена с `main` и отправлена в GitHub либо
  создан Pull Request.
