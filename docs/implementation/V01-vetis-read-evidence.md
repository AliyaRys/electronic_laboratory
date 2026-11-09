# Evidence: ТЗ-10 V01 — Manifest ВУ и read adapter (ветеринарные управления)

Дата: 09.11.2026. Ветка `feature/V01-vetis`. Исполнитель: субагент V01.

## 1. Что сделано

- `backend/resources/vetis/manifest.schema.json` + `backend/resources/vetis/manifest.json` —
  versioned контракт профиля ВУ (endpoint `https://api2.vetrf.ru:8002/platform/services/2.0/ApplicationManagementService`,
  `serviceId=mercury-vu.service:2.0`, namespace `http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2`,
  SOAP-действия submit/receive, ограничения, read-инициатор без write-полномочий). Секретов нет.
- `backend/src/modules/integrations/vetis/manifest.py` — загрузка/валидация manifest,
  проверка SHA-256 WSDL/XSD pins, загрузка server-side secret-файла (`VETIS_SECRET_PROFILE`).
- `backend/src/modules/integrations/vetis/transport.py` — граница Zeep (lazy import;
  TLS verified, `forbid_dtd/forbid_entities/forbid_external`, connect 10 с / read 60 с),
  spy-транспорт и запрещающий список write-операций (`ProcessIncomingConsignment`).
- `backend/src/modules/integrations/vetis/normalizer.py` — source-верный разбор страниц
  GetVetDocumentList (без обращения к общему справочнику), локальные фильтры предиката
  (получатель + TRANSPORT + CONFIRMED + `productType=1`), сохранение уровней
  `product/subProduct/productItem` с их `guid/uuid/name`, Decimal-точность.
- `backend/src/modules/integrations/vetis/adapter.py` — `list_incoming(scope, cursor, initiator) ->
  IncomingPage`; 422 `INTEGRATION_INITIATOR_MISSING` / `INTEGRATION_SCOPE_MISSING`;
  дедупликация курсором (offset + уже возвращённые UUID), `complete`/`next_cursor`,
  обезличенные счётчики `filtered`; 503 до закрепления схем.
- `contracts.py`: `IncomingPage{items: IncomingDocument[], next_cursor?, complete, filtered}` —
  элементы соответствуют DATA-02/API-04 и напрямую идут в `upsert_incoming` (A01).
- `ports.py`: сигнатура read-порта — `list_incoming(scope, cursor, initiator)`;
  disabled-адаптер сохранён (503). Zeep добавлен отдельным проверяемым изменением
  (`zeep==4.3.3`, `uv.lock`, mypy-override `zeep.*`).
- Документы: [vetis-contract-manifest](../integration/vetis-contract-manifest.md),
  [chk-xml-mapping](../integration/chk-xml-mapping.md).

## 2. TDD: RED → GREEN

- RED: `uv run --frozen pytest backend/tests/vetis/test_read_contract.py` до реализации —
  14 errors (ModuleNotFoundError `vetis.manifest/transport/normalizer/adapter`).
- GREEN: 14 passed после реализации.

## 3. Контрактные проверки (все на обезличенных fixtures)

- endpoint/namespace/serviceId/SOAPAction берутся только из manifest; manifest валидируется
  структурно и не содержит apiKey/issuerId/password/login; соответствует schema-артефакту.
- SHA-256 WSDL/XSD проверяются при загрузке pins; расхождение → `ManifestPinError`;
  PENDING-pins → адаптер отвечает 503 до любого сетевого контакта.
- Пропуск инициатора → 422; отсутствие привязки лаборатория→ХС/площадка → 422.
- Неподходящий получатель / не-транспорт / не-CONFIRMED / `productType≠1` и отсутствующий
  `productType` отфильтрованы ДО записи; счётчики по причинам обезличены.
- Пагинация дедуплицирована: повтор курсора не дублирует и не перезаписывает эВСД;
  курсор переносит offset и уже возвращённые UUID.
- Точность Decimal сохранена (`120.500`), складские GUID ≠ UUID эВСД, уровни
  `product/subProduct/productItem` хранятся раздельно с их source `name`; неизвестный
  общий GUID не блокирует документ при наличии source `name`.
- Transport spy: внешние WRITE-вызовы = 0, ProductService-вызовы = 0, только
  `GetVetDocumentListOperation`; transport-граница отклоняет write-операции.
- Предметные модули не импортируют Zeep (проверка sys.modules + исходника router).

## 4. Живая read-only проверка — not-run по причине

Выданный тестовый комплект ВУ в этом окружении отсутствует; секретный файл
(`VETIS_SECRET_PROFILE`) не существует. Попытка загрузки закрепляемого WSDL
(`GET .../ApplicationManagementService?wsdl`) дважды вернула **401 Unauthorized**
(нужна базовая аутентификация шлюза). Следствие:

- живая read-only нога — `not-run` (причина: нет выданного тестового комплекта/credentials);
- фактические SHA-256 WSDL/XSD не вычислены и не выдуманы → `schema_pins.status = PENDING`,
  адаптер честно 503 до закрепления;
- write-credentials/capability не существуют ни в коде, ни в окружении
  (`ProcessIncomingConsignment` запрещён на границе транспорта; spy подтверждает 0 write-вызовов).

## 5. Quality gates (exit 0)

| Проверка | Результат |
| --- | --- |
| `uv sync --frozen` | exit 0 (Zeep 4.3.3 в lock) |
| `ruff check` (изменённые файлы) | All checks passed |
| `ruff format --check` (изменённые файлы) | 11 files already formatted |
| `mypy backend/src` | Success: no issues found in 93 files |
| `pytest backend/tests --cov=backend/src --cov-fail-under=85` | 487 passed, 2 failed (pre-existing), **92.73%**; vetis-пакет: manifest 88%, normalizer 88%, transport 91%, adapter/contracts/models/queries 83–100% |

2 падения (`backend/tests/examinations/test_delete.py::test_concurrent_delete_and_disposal_preserve_the_disposal_fact`,
`::test_delete_http_204_and_unknown_202`) воспроизводятся на чистом базовом дереве
(проверено `git stash` — те же 2 failed) и не относятся к V01.

## 6. Итог

Адаптер чтения ВУ готов и закреплён контрактами; включение живого чтения требует
только выданного тестового комплекта (secret-файл) и вычисления фактических
WSDL/XSD checksums — после этого `schema_pins` переводится в PINNED отдельным
проверяемым изменением. Ничего не сфабриковано: живая нога и checksums — honestly not-run.
