# ТЗ на отображение предприятия и хозяйствующего субъекта в сверке

Дата: 13.11.2026  
Тип задачи: API/read model + reconciliation UI, использование существующего GUID-cache

## 1. Цель

В блоке «Участники перевозки» сверки показывать два разных объекта для
отправителя и получателя:

```text
Сведения об отправителе
Предприятие: <enterprise.name>
Хозяйствующий субъект: <businessEntity.name>

Сведения о получателе
Предприятие: <enterprise.name>
Хозяйствующий субъект: <businessEntity.name>
```

Для отправителя сейчас отображается поле `CHK-F05` с подписью
«Отправитель — предприятие». Его нужно переименовать в **«Предприятие»**.
Новое поле хозяйствующего субъекта должно использовать `CHK-F06`.

Для получателя сохранить симметрию модели:

- `CHK-F07` — «Предприятие»;
- `CHK-F08` — «Хозяйствующий субъект».

## 2. Источник данных

Входящий XML содержит GUID/UUID, но может не содержать `dt:name` у
`businessEntity`:

```xml
<dt:businessEntity>
  <bs:uuid>3536384b-9481-4bfb-ab5c-a56dde7681f7</bs:uuid>
  <bs:guid>14c34503-d99c-4ce7-9742-6de77395f05d</bs:guid>
</dt:businessEntity>
<dt:enterprise>
  <bs:uuid>8e8a596c-8008-4576-969f-301caa52f114</bs:uuid>
  <bs:guid>aa367f30-9701-4c8e-b468-1fbf820d4184</bs:guid>
  <dt:name>ХАЛЬФИН ФАНИС ФАНАВИЛЕВИЧ</dt:name>
</dt:enterprise>
```

Использовать существующую архитектуру из:

`dorabotka/2026-11-12-vetis-entity-name-cache.md`

Приоритет названия:

1. `name` из source XML текущей версии;
2. локальный contour-scoped cache по `(contour, entity_kind, guid)`;
3. `Название не получено` при отсутствии результата.

Запросы к ВетИС выполняет только backend worker. Frontend не вызывает
`GetBusinessEntityByGUID` или `GetEnterpriseByGuid v2`.

## 3. Обязательное чтение

- `AGENTS.md`;
- `dorabotka/2026-11-12-vetis-entity-name-cache.md`;
- `https://help.vetrf.ru/wiki/GetBusinessEntityByGUID`;
- `https://help.vetrf.ru/wiki/GetEnterpriseByGuid_v2`;
- `docs/TZ_development/plans/field-mapping.md`;
- `docs/TZ_development/plans/api-contract.md`;
- `Функциональные требования/v2.0/02-arrivals-and-receipt.md`;
- `Функциональные требования/v2.0/10-field-catalog.md`;
- `Функциональные требования/v2.0/11-traceability-and-acceptance.md`;
- `backend/src/modules/arrivals/{queries,reconciliation,validation}.py`;
- `frontend/src/features/arrivals/{api,ReconciliationForm,ComparisonField}.tsx`.

## 4. Backend/read model

### 4.1. Resolving names

Использовать существующий cache и worker из предыдущего ТЗ. Не создавать
вторую таблицу, второй словарь или прямые HTTP/SOAP-вызовы из страницы.

Для каждого участника хранить отдельно:

```text
sender.businessEntity → CHK-F06
sender.enterprise     → CHK-F05
receiver.businessEntity → CHK-F08
receiver.enterprise     → CHK-F07
```

Кэш изолирован по `contour` и `entity_kind`; одинаковый GUID в разных типах
объектов не объединять.

### 4.2. API fields

Расширить единый `IncomingView.external.fields`/read model именами:

```text
senderOwner
senderEnterprise
receiverOwner
receiverEnterprise
```

Для поддержки диагностики допустимо отдавать структурированные объекты с
`guid`, `uuid`, `name`, `name_source`, `resolved_at`, но старые строковые
поля должны сохранить совместимость.

Если cache ещё не разрешил GUID:

- возвращать `Название не получено` или состояние `MISSING`;
- не показывать сырой GUID пользователю;
- не блокировать импорт ВСД, сохранение сверки или гашение, если сам GUID есть
  и остальные обязательные данные валидны;
- оставить job в фоне с retry/backoff.

## 5. Reconciliation UI

### 5.1. Отправитель

В карточке `vse-rec-sender-title`:

1. текущий `CHK-F05` переименовать:
   - было: «Отправитель — предприятие»;
   - стало: **«Предприятие»**;
   - source: `senderEnterprise`.
2. добавить comparison card `CHK-F06`:
   - название: **«Хозяйствующий субъект»**;
   - source: `senderOwner`;
   - те же кнопки совпадения/несоответствия;
   - при mismatch — фактическое значение и причина.

Порядок:

```text
Предприятие
Хозяйствующий субъект
```

### 5.2. Получатель

В карточке `vse-rec-receiver-title`:

1. `CHK-F07` показывать как **«Предприятие»** из `receiverEnterprise`;
2. добавить `CHK-F08` как **«Хозяйствующий субъект»** из `receiverOwner`;
3. использовать тот же общий `ComparisonField`;
4. порядок такой же: предприятие, затем хозяйствующий субъект.

Пустая карточка получателя недопустима, если read model содержит хотя бы
одно имя или разрешённое состояние `Название не получено`.

Не вставлять отдельную локальную HTML-копию comparison card. Расширить
`comparedFields()` и переиспользовать общий компонент.

## 6. Сохранение и validation

- `CHK-F05` и `CHK-F07` сохраняют прежнюю семантику предприятия;
- `CHK-F06` и `CHK-F08` сохраняют семантику хозяйствующего субъекта;
- не переименовывать ID в payload, БД или checks JSONB;
- изменить только пользовательские русские подписи;
- при наличии source name/GUID сравнение должно быть явным;
- mismatch участника остаётся недопустимым для полного/частичного принятия по
  существующему правилу validation;
- не выбирать автоматически возврат;
- если имя временно не разрешено и отображается `Название не получено`, не
  создавать фиктивную отметку совпадения и не подменять его GUID.

Старые сохранённые сверки с `CHK-F05`/`CHK-F07` должны продолжить читаться.
Переименование label не должно мигрировать или удалять старые keys.

## 7. Тесты

### Backend/read model

1. XML с enterprise name и businessEntity без name создаёт cache job только
   для businessEntity.
2. После успешного `GetBusinessEntityByGUID` read model получает
   `senderOwner`/`receiverOwner`.
3. Enterprise и businessEntity сохраняются раздельно.
4. Cache miss показывает fallback и не блокирует сохранение/гашение.
5. Контуры `PILOT`/`PRODUCTION` не смешиваются.
6. Повторный sync/backfill не создаёт дубли jobs/cache.
7. Ошибка lookup сохраняет прежнее имя и назначает retry.
8. Raw XML, checksum, revision и локальные юридические факты не изменяются.

### Frontend

1. У отправителя отображаются две карточки: «Предприятие» и «Хозяйствующий
   субъект».
2. У получателя отображаются те же две карточки.
3. `CHK-F05` и `CHK-F07` имеют подпись «Предприятие».
4. `CHK-F06` и `CHK-F08` имеют подпись «Хозяйствующий субъект».
5. Все четыре поля используют одинаковые match/mismatch controls и доступны
   с клавиатуры.
6. Fallback `Название не получено` не показывает GUID и не блокирует форму.
7. Проверить loading/error/long name/missing name и 1440/1024/768/390 px.

Все тесты используют fixtures и transport spy. Внешние write-вызовы ВетИС
не выполняются.

## 8. Docker, данные и Git

После реализации пересобрать контейнеры без удаления volume:

```powershell
cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, не удалять пользователей/ВСД/ВСЭ и не
включать VetIS write capability агентом.

Работать в отдельной feature-ветке. Перед началом и перед коммитом проверить
`git status`; не затирать существующие изменения.

Вместе с кодом добавить это ТЗ в ту же feature-ветку и закоммитить его. Затем:

1. отправить feature-ветку в GitHub;
2. обновить `main` через `git pull --ff-only`;
3. объединить feature-ветку с `main` без force-push;
4. отправить обновлённый `main` в GitHub.

При защищённом `main` создать Pull Request и указать связь с файлом:

`dorabotka/2026-11-13-participant-enterprise-owner-fields.md`

## 9. Критерии готовности

- у отправителя и получателя видны «Предприятие» и «Хозяйствующий субъект»;
- названия берутся из существующего GUID-cache, а не из запросов браузера;
- `CHK-F05/06/07/08` сохраняют прежнюю бизнес-семантику;
- mismatch продолжает проходить серверную проверку доступности решений;
- raw XML и существующие данные не удаляются;
- backend/frontend tests проходят;
- контейнеры пересобраны;
- ТЗ закоммичено вместе с кодом, feature-ветка объединена с `main`, main
  отправлен в GitHub либо создан Pull Request.
