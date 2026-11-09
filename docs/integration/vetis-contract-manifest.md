# ВетИС: контрактный manifest ВУ (ТЗ-10 V01)

Статус: закреплён методически; schema pinning ожидает выданный тестовый комплект.
Основание: ADR-018, [INPUT-01](../TZ_development/plans/inputs.md),
[контракт тестового Меркурия](../TZ_development/plans/mercury-test-integration-contract.md), дата 09.11.2026.

## 1. Файлы

| Файл | Роль |
| --- | --- |
| `backend/resources/vetis/manifest.schema.json` | версия-артефакт: структура manifest (INPUT-01). Изменяется только вместе с `manifest.py` |
| `backend/resources/vetis/manifest.json` | закреплённые значения профиля ВУ; секретов нет |
| `backend/src/modules/integrations/vetis/manifest.py` | загрузка/валидация manifest, проверка SHA-256, загрузка server-side secret-файла |

## 2. Закреплённые значения профиля

| Поле | Значение |
| --- | --- |
| Контур | PILOT (тестовый ВетИС) |
| Семейство | `mercury-vu.service` (только ВУ; fallback на сервис ХС запрещён) |
| `serviceId` | `mercury-vu.service:2.0` |
| Endpoint | `https://api2.vetrf.ru:8002/platform/services/2.0/ApplicationManagementService` |
| Бизнес-namespace | `http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2` |
| Application namespace | `http://api.vetrf.ru/schema/cdm/application/v2` |
| Base namespace | `http://api.vetrf.ru/schema/cdm/base` |
| SOAP | SOAP 1.1, `Content-Type: text/xml; charset=utf-8` |
| SOAPAction submit | `submitApplicationRequest` |
| SOAPAction receive | `receiveApplicationResultRequest` |
| Read-операция | `GetVetDocumentListOperation` (заявка `getVetDocumentListRequest`) |
| Write-операция (read-path запрещена) | `ProcessIncomingConsignment` |
| Инициатор | служебная read-идентичность (`SERVICE_READ_IDENTITY`), `write_capability=false` |
| Ограничения | страница ≤1000; интервал issueDate ≤31 день; XML ≤32 МиБ; глубина ≤128; connect 10 с; read 60 с |

## 3. Секреты — вне Git

`gateway login/password`, `apiKey`, `issuerId`, привязка площадки и служебная
read-идентичность загружаются только из server-side secret-файла, путь которого
задаёт переменная окружения `VETIS_SECRET_PROFILE` (`load_secret_profile`).
Файл не коммитится, не попадает в fixtures/логи/evidence; `SecretProfile` печатается
как `SecretProfile(***redacted***)`. Отсутствие профиля/секретов честно означает
503 `INTEGRATION_NOT_CONFIGURED` — фиктивные реквизиты не создаются никогда.

## 4. Schema pinning: статус PENDING

Состояние на 09.11.2026: `schema_pins.status = "PENDING"`, WSDL/XSD не закреплены.
Попытка загрузки `?wsdl` в окружении разработки вернула 401 (нужна базовая
аутентификация шлюза; выданный тестовый комплект в окружении отсутствует), поэтому
фактические SHA-256 вычислить нельзя и они не выдумываются.

Правила закрепления (реализованы и протестированы на fixture WSDL/XSD):

- `load_manifest_with_pins` сверяет SHA-256 WSDL и каждого XSD import; любое
  расхождение — жёсткая ошибка `ManifestPinError` (`INTEGRATION_SCHEMA_PIN_MISMATCH`).
- Пока `status != PINNED`, адаптер отвечает 503 `INTEGRATION_NOT_CONFIGURED`
  до любого сетевого контакта (`require_live_ready`).
- Успешный XML-пример никогда не заменяет закрепление схем (ADR-018).

## 5. Локальные фильтры (серверного productType-фильтра нет)

После scoped-запроса (площадка + `INCOMING` + `CONFIRMED`) и ДО записи применяется
предикат из контракта тестового Меркурия:

```text
получатель = закреплённая площадка
AND vetDocumentType = TRANSPORT
AND vetDocumentStatus = CONFIRMED
AND certifiedConsignment/batch/productType = 1
```

Отфильтрованные записи учитываются обезличенными счётчиками `IncomingPage.filtered`
(`receiver`/`transport`/`status`/`product_type`); отсутствующий/неразбираемый
`productType` не приравнивается к мясу. Идентичности уровней (`product`,
`subProduct`, `productItem`, единица, участники) сохраняются раздельно со своими
`guid`/`uuid`/`name` из source XML; складской GUID никогда не совпадает с UUID эВСД.
