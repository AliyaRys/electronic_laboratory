# ВетИС: гашение и подтверждение Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полностью реализовать гашение/возврат, XML preview, submit/poll и обработку UNKNOWN по шести предоставленным сценариям, проверив их только офлайн и исключив любой живой write-вызов в test/production.

**Architecture:** Неизменяемое intent, XML mapping, preview, реальный external submit, polling и reconcile реализуются за одним портом. Production-код transport обязателен, но проверяется через внедрённый spy/симулятор и обезличенные fixtures без вызова Меркурия. XML строится из закреплённой версии входящего raw XML и фактов сверки по [контракту тестового Меркурия](mercury-test-integration-contract.md). `VETIS_WRITE_ENABLED=false` является безопасным значением установки, а не постоянной заглушкой: после решения владельца оператор включает capability, затем уполномоченный пользователь явно подтверждает гашение.

**Tech Stack:** SOAP ВУ pinned manifest, Zeep/arq, PostgreSQL journal/outbox.

**Spec:** O-12/O-13, [контракт тестового Меркурия](mercury-test-integration-contract.md), ADR-019, API-04/10, DATA-06, INPUT-01, ФТ-ARR-06–15/ACC-11. Только после V01/V02; живое выполнение операции агентом исключено, production-код и операторское включение обязательны.

## Global Constraints

- «Один unresolved intent на входящий документ».
- «Повтор необратимого submit автоматически запрещён».
- «Одного UTILIZED, введённого номера и кнопки “выполнено” недостаточно».
- Отдельные исходящие после ВСЭ/для проб отсутствуют; возвратный ВСД внутри приёмки входит.
- Poll2/5/10/30/60 сек+jitter, затем 60 сек до 15 мин; connect10/read60/job120 сек.
- Никакой smoke/e2e/приёмочный/нагрузочный/ручной тест не вызывает test или production `ProcessIncomingConsignment`/возврат.
- Успешные fixture-тесты и доступные test credentials не дают агенту права включить `VETIS_WRITE_ENABLED` или выполнить живой submit.
- Реализация не заканчивается feature flag: при enabled capability transport обязан отправить запрос, а UI — дать уполномоченному пользователю явное подтверждение конкретного решения. Поштучный внешний `VetisWriteAuthorization` не требуется.

## Review Focus

- Ответ submit потерян до applicationId: W02 UNKNOWN, без повторной заявки.
- Worker lease потерян в SUBMITTING: W02 следующий worker только reconcile.
- Позднейший складской остаток изменился: W02 не использует его как доказательство первоначального принятого состава.
- Ручное гашение partial без связанного возврата: W02 UNKNOWN/EVIDENCE_INCOMPLETE.
- Удаление местной ВСЭ: W03 не отправляет новое гашение при пересоздании.

### Task W01: Intent и три решения приёмки

**Files:** создать `backend/src/modules/integrations/vetis/{receipt,receipt_mapping}.py`, `backend/tests/vetis/test_receipt_mapping.py`; изменить manifest/adapter/contracts/arrivals receipt router и `docs/integration/chk-xml-mapping.md`.

**Interfaces:** `build_receipt_preview(source_revision,reconciliation_rev)->ReceiptPreview`; `submit_receipt(intent:ReceiptIntent, confirmation:UserConfirmation)->Submission`. ReceiptIntent содержит immutable source UUID/raw XML checksum/external revision/receiver/decision/quantities/act/return reason/initiator/fingerprint/localTransactionId/reconciliation rev. Confirmation связывает актуального уполномоченного пользователя, fingerprint preview и момент явного подтверждения; не заменяет server capability. Submission{application_id?,transport_state}; точные XML пути по выданному manifest, не по предположению.

- [x] Написать **офлайн** XML assertions для всех шести сценариев 1.1.1–1.2.3 и каждого `vetInspection.result`: doc120/delivered100/full100 не return20; partial120=100+20 с причиной/linked return; RETURN_ALL accepted0 без accepted consignment/акта этой ветки; mismatch ACCEPT/PARTIAL требует discrepancyReport; Other reason text; blocking discrepancy запрещает ACCEPT/PARTIAL; no personal initiator/scope refuses до submit. Transport spy всегда `external write calls=0`.
- [ ] Запустить `uv run --frozen pytest backend/tests/vetis/test_receipt_mapping.py -v`, получить FAIL.
- [x] Реализовать manifest/fixtures и **реальный external transport** `ProcessIncomingConsignment` + submit/receive result. Зафиксировать: `vetCertificatePresence=ELECTRONIC`; docInspection из сверки; vetInspection независимо из действия пользователя; ACCEPT/PARTIAL mismatch с актом; RETURN_ALL без акта/accepted consignment; returnedDelivery только PARTIAL/RETURN_ALL. Preview валидирует source checksum/receiver/status/quantity/unit/reason/codes; команда под locks создаёт frozen intent+outbox. Tests внедряют spy вместо сетевого transport; один unresolved partial UNIQUE.
- [x] Проверить localTransactionId/applicationId как разные поля, rollback outbox и enabled/disabled capability. При disabled →503 до outbox; при enabled в тесте вызывается только spy и проверяется точный envelope/action. Сырые credentials тест не читает, агент не меняет реальную установку и не выполняет живой вызов.
- [ ] Зафиксировать: `feat: prepare immutable verified receipt submissions`.

### Task W02: Poll, доказательства и UNKNOWN

**Files:** создать `backend/src/modules/integrations/vetis/{polling,evidence,reconcile}.py`, `backend/tests/vetis/test_receipt_failures.py`, `backend/tests/vetis/test_reconcile.py`; изменить worker/dispatcher и arrivals.confirmation.

**Interfaces:** `get_operation(application_id,initiator)->ExternalResult`; `reconcile_receipt(intent)->ReconciliationEvidence`; `ReconciliationEvidence` либо complete ReceiptEvidence, либо incomplete diagnostics, не bool success.

- [x] Написать fault tests: обрыв до submit/после принятия шлюзом/после внешнего success до local commit; lease lost SUBMITTING→reconcile only; duplicate confirmed result→одна confirmation; unproved absence→не resubmit; rejected→нет accepted gate; manual partial без доказанного состава→UNKNOWN. Проверить внешнюю связь исходный UUID/receiver/accepted/returned/акты, не текущее stock balance. 15 мин без результата→UNKNOWN.
- [ ] Запустить `uv run --frozen pytest backend/tests/vetis/test_receipt_failures.py backend/tests/vetis/test_reconcile.py -v`, получить FAIL.
- [x] Реализовать NOT_SENT→QUEUED→SUBMITTING→PROCESSING→CONFIRMED/REJECTED/UNKNOWN в production adapter и локальном журнале. Перед submit durable SUBMITTING, applicationId записать немедленно после ответа шлюза. Receive result schedules backoff, SQL/HTTP locks не удерживать, job≤120 сек. При capability=true worker вызывает реальный transport; тест подменяет его spy. Reconcile проверяет business success+composition evidence, затем confirm_receipt atomically. Недостаточно связей→UNKNOWN+INTEGRATION_EVIDENCE_INCOMPLETE+обезличенный diagnostics bundle. Durable evidence/неразрешённые операции без TTL; masked fixture/rawSOAP30 дней.
- [x] Проверить AT-05 и SC-098–101 на fixtures/симуляторе, включая full returns, смоделированное ручное гашение с evidence и restore после локальной потери подтверждения. Случай утраченного applicationId без доказательств остаётся безопасно заблокирован. Все живые write-сценарии отметить `not-run by O-13`, не заменять пробной операцией в тестовом контуре; production-код polling при этом обязателен.
- [ ] Зафиксировать: `feat: reconcile receipt uncertainty without blind resubmission`.

### Task W03: Подключение UI и итоговая приёмка

**Files:** создать `frontend/src/features/arrivals/{ReceiptOperation,ReceiptConfirmationDialog}.tsx`, stories/tests, `frontend/tests/e2e/vetis-receipt.spec.ts`, `docs/operations/vetis-enable.md`; изменить receipt buttons/context invalidation и release checklist.

**Interfaces:** W03 реализует оба состояния одной рабочей функции. При server capability=false кнопка показывает, что отправка не включена, а прямой API даёт 503 до outbox. При capability=true уполномоченный пользователь получает preview, явно подтверждает fingerprint и запускает реальный submit через тот же порт. Тест enabled-state использует только spy. Только CONFIRMED evidence открывает локальную ВСЭ; RETURN_ALL не создаёт ВСЭ.

- [ ] Написать offline e2e для двух конфигураций: disabled не разрешает submit и даёт ноль вызовов; enabled показывает рабочую кнопку/подтверждение и вызывает ровно один spy-submit. Fixture 202 не даёт зелёное «Принято»; timeout сохраняет сверку и UNKNOWN; отказ не открывает create/print; fixture confirmation открывает нужный маршрут; deleted local recreated без нового submit.
- [ ] Запустить адресный e2e с детерминированным adapter и получить FAIL до UI.
- [ ] Подключить русские состояния: capability=false — «Гашение не включено оператором»; capability=true — preview, предупреждение о необратимом действии, кнопка подтверждения, PROCESSING/CONFIRMED/REJECTED/UNKNOWN и повторная проверка результата. Прямой API повторяет server checks роли/revision/status/fingerprint. Enabled-state является рабочим production-кодом, но e2e подменяет transport и не использует external credentials.
- [ ] Выполнить живой маршрут только до `real incoming→reconciliation` и доказать `external write calls=0`. Цепочку submit→ВСЭ→conclusion, partial/return/UNKNOWN проверить исключительно spy/fixtures, включая рабочий enabled-state. В acceptance.md живой write отметить `not-run by O-13`; это не препятствует завершить реализацию функции. Зафиксировать операторскую процедуру включения capability без выполнения операции.
- [ ] Зафиксировать: `feat: complete verified VetIS receipt workflow`.
