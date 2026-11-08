# ВетИС: гашение и подтверждение Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полностью реализовать гашение/возврат, XML preview, submit/poll и обработку UNKNOWN, проверив их офлайн и исключив самовольную юридически значимую write-операцию в production.

**Architecture:** Неизменяемое intent, XML mapping, preview, submit, polling и reconcile реализуются за одним портом и проверяются детерминированным adapter/fixtures. XML строится из закреплённой версии входящего raw XML и сверки по утверждённой карте. Production transport текущего выпуска не получает write credentials и жёстко отклоняет submit; `VETIS_WRITE_ENABLED=false`. Для будущего первого включения предусмотрен отдельный внешний одноразовый owner authorization на конкретный UUID/решение/срок плюс подтверждение пользователя; код или зелёный тест не создаёт такое разрешение.

**Tech Stack:** SOAP ВУ pinned manifest, Zeep/arq, PostgreSQL journal/outbox.

**Spec:** O-11, ADR-019, API-04/10, DATA-06, INPUT-01, ФТ-ARR-06–15/ACC-11. Только после V01/V02; живое включение write исключено из текущего плана.

## Global Constraints

- «Один unresolved intent на входящий документ».
- «Повтор необратимого submit автоматически запрещён».
- «Одного UTILIZED, введённого номера и кнопки “выполнено” недостаточно».
- Отдельные исходящие после ВСЭ/для проб отсутствуют; возвратный ВСД внутри приёмки входит.
- Poll2/5/10/30/60 сек+jitter, затем 60 сек до 15 мин; connect10/read60/job120 сек.
- Никакой smoke/e2e/приёмочный/нагрузочный/ручной тест не вызывает production ProcessIncomingConsignment или возврат.
- Успешные fixture-тесты не меняют `VETIS_WRITE_ENABLED=false`. Будущее включение требует нового письменного решения владельца и отдельного юридически допустимого плана ввода.
- Одного feature flag недостаточно: будущий transport проверяет `VetisWriteAuthorization` до outbox и повторно до сети; authorization нельзя создать через UI/API/seed/миграцию/тест.

## Review Focus

- Ответ submit потерян до applicationId: W02 UNKNOWN, без повторной заявки.
- Worker lease потерян в SUBMITTING: W02 следующий worker только reconcile.
- Позднейший складской остаток изменился: W02 не использует его как доказательство первоначального принятого состава.
- Ручное гашение partial без связанного возврата: W02 UNKNOWN/EVIDENCE_INCOMPLETE.
- Удаление местной ВСЭ: W03 не отправляет новое гашение при пересоздании.

### Task W01: Intent и три решения приёмки

**Files:** создать `backend/src/modules/integrations/vetis/{receipt,receipt_mapping}.py`, `backend/tests/vetis/test_receipt_mapping.py`; изменить manifest/adapter/contracts/arrivals receipt router и `docs/integration/chk-xml-mapping.md`.

**Interfaces:** `build_receipt_preview(source_revision,reconciliation_rev)->ReceiptPreview`; `submit_receipt(intent:ReceiptIntent, authorization:VetisWriteAuthorization)->Submission`. ReceiptIntent содержит immutable source UUID/raw XML checksum/external revision/receiver/decision/quantities/act/return reason/initiator/fingerprint/localTransactionId/reconciliation rev. Authorization содержит document_uuid/decision/expires_at/responsible/authorization_id и не хранится как обычная настройка приложения. Submission{application_id?,transport_state}; точные XML пути по выданному manifest, не по предположению.

- [ ] Написать **офлайн** XML assertions для полного/частичного/возврата: doc120/delivered100/full100 не return20; partial120=100+20 с причиной и linked return; RETURN_ALL accepted0 без местнойВСЭ/акта этой ветки; Other reason текст; blocking discrepancy запрещает ACCEPT/PARTIAL; no personal initiator/scope refuses до submit. Transport spy всегда `production write calls=0`.
- [ ] Запустить `uv run --frozen pytest backend/tests/vetis/test_receipt_mapping.py -v`, получить FAIL.
- [ ] Расширить **offline manifest/fixtures**, не production capability, описанием ProcessIncomingConsignmentOperation + submitApplicationRequest/receiveApplicationResult + service read methods. Для CHK decision/actual/reason/act заполнить XPath request→response/evidence, длины/precision/codes по официальной схеме и ранее полученным обезличенным примерам; не добывать evidence пробным гашением. Preview собирается из закреплённого raw XML checksum/external revision и фактов сверки, затем повторно валидирует receiver/quantity/unit/reason/codes; изменение источника делает preview устаревшим. Команда под locks проверяет current access/rev/status/decision и создаёт frozen intent+outbox atomically,202 только в изолированном test adapter. Production transport отклоняет submit до сетевого вызова. Один unresolved partial UNIQUE.
- [ ] Проверить localTransactionId/applicationId разные поля, нет доверия к их дедупликации без контрактного доказательства. Full routes contract tests и rollback outbox выполняются без production network. `VETIS_WRITE_ENABLED=false` остаётся после W03 и после всех зелёных тестов.
- [ ] Зафиксировать: `feat: prepare immutable verified receipt submissions`.

### Task W02: Poll, доказательства и UNKNOWN

**Files:** создать `backend/src/modules/integrations/vetis/{polling,evidence,reconcile}.py`, `backend/tests/vetis/test_receipt_failures.py`, `backend/tests/vetis/test_reconcile.py`; изменить worker/dispatcher и arrivals.confirmation.

**Interfaces:** `get_operation(application_id,initiator)->ExternalResult`; `reconcile_receipt(intent)->ReconciliationEvidence`; `ReconciliationEvidence` либо complete ReceiptEvidence, либо incomplete diagnostics, не bool success.

- [ ] Написать fault tests: обрыв до submit/после принятия шлюзом/после внешнего success до local commit; lease lost SUBMITTING→reconcile only; duplicate confirmed result→одна confirmation; unproved absence→не resubmit; rejected→нет accepted gate; manual partial без доказанного состава→UNKNOWN. Проверить внешнюю связь исходный UUID/receiver/accepted/returned/акты, не текущее stock balance. 15 мин без результата→UNKNOWN.
- [ ] Запустить `uv run --frozen pytest backend/tests/vetis/test_receipt_failures.py backend/tests/vetis/test_reconcile.py -v`, получить FAIL.
- [ ] Реализовать NOT_SENT→QUEUED→SUBMITTING→PROCESSING→CONFIRMED/REJECTED/UNKNOWN в изолированном adapter и локальном журнале. Перед смоделированным submit durable SUBMITTING, applicationId записать немедленно после fixture-ответа. Receive result schedules backoff, SQL/HTTP locks не удерживать, job≤120 сек. Reconcile проверяет business success+composition evidence, затем confirm_receipt atomically. Production может выполнять только разрешённое read/reconcile внешнего факта; оно не запускает submit. Недостаточно связей→UNKNOWN+INTEGRATION_EVIDENCE_INCOMPLETE+обезличенный diagnostics bundle. Durable evidence/неразрешённые операции без TTL; masked fixture/rawSOAP30 дней.
- [ ] Проверить AT-05 и SC-098–101 на fixtures/симуляторе, включая full returns, смоделированное ручное гашение с evidence и restore после локальной потери подтверждения. Случай утраченного applicationId без доказательств остаётся безопасно заблокирован. Живые production write-сценарии отметить `not-run by O-11`, не заменять пробной операцией.
- [ ] Зафиксировать: `feat: reconcile receipt uncertainty without blind resubmission`.

### Task W03: Подключение UI и итоговая приёмка

**Files:** создать `frontend/src/features/arrivals/{ReceiptOperation,ReceiptConfirmationDialog}.tsx`, stories/tests, `frontend/tests/e2e/vetis-receipt.spec.ts`, `docs/operations/vetis-enable.md`; изменить receipt buttons/context invalidation и release checklist.

**Interfaces:** В текущем production доступны read/status/reconcile и XML preview без submit; UI write-действия недоступны. В offline adapter POST receipt/reconcile и GET operations проверяют будущий контракт. После отдельного разрешения кнопка submit становится доступна только при server capability, действующем owner authorization для открытого UUID/решения и отдельном подтверждении пользователя; only CONFIRMED evidence открывает локальную ВСЭ, RETURN_ALL no ВСЭ.

- [ ] Написать offline e2e: production-конфигурация не показывает/не разрешает submit и даёт ноль write-вызовов; fixture 202 не даёт зелёное «Принято»; timeout сохраняет сверку и UNKNOWN; отказ не открывает create/print; fixture confirmation открывает нужный маршрут; deleted local recreated без нового submit.
- [ ] Запустить адресный e2e с детерминированным adapter и получить FAIL до UI.
- [ ] Подключить русские honest состояния production read-only: preview «XML подготовлен, отправка не разрешена», сохранение сверки и безопасное read/reconcile уже выполненного внешнего факта. Submit-кнопка отсутствует либо заблокирована server capability; прямой API submit отвечает контролируемым отказом до outbox/transport. Реализованный будущий enabled-state требует совпадающие UUID/decision/expiry owner authorization и отдельное подтверждение пользователя. Contract fixtures не исполняют реальные необратимые операции и физически не имеют production write credentials/route.
- [ ] Выполнить production маршрут только до `real incoming→reconciliation` и доказать `write calls=0`. Остальную цепочку receipt→ВСЭ→conclusion, partial/return/UNKNOWN проверить исключительно offline fixtures. В acceptance.md все живые write-кейсы отметить `not-run by O-11`; не объявлять готовность автоматизированного гашения или полного production MVP. Отдельное будущее разрешение должно создать новый release-gate и план ввода.
- [ ] Зафиксировать: `feat: complete verified VetIS receipt workflow`.
