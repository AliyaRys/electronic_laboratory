# ВетИС: гашение и подтверждение Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завершить MVP доказанной приёмкой/возвратом и безопасной обработкой неизвестного внешнего исхода.

**Architecture:** Неизменяемое intent фиксируется с outbox до SOAP; gateway application acknowledgement не считается успехом. Worker polling/read-reconcile подтверждает состав и атомарно вызывает arrivals.confirm_receipt.

**Tech Stack:** SOAP ВУ pinned manifest, Zeep/arq, PostgreSQL journal/outbox.

**Spec:** ADR-019, API-04/10, DATA-06, INPUT-01, ФТ-ARR-06–15/ACC-11. Только после V01/V02.

## Global Constraints

- «Один unresolved intent на входящий документ».
- «Повтор необратимого submit автоматически запрещён».
- «Одного UTILIZED, введённого номера и кнопки “выполнено” недостаточно».
- Отдельные исходящие после ВСЭ/для проб отсутствуют; возвратный ВСД внутри приёмки входит.
- Poll2/5/10/30/60 сек+jitter, затем 60 сек до 15 мин; connect10/read60/job120 сек.

## Review Focus

- Ответ submit потерян до applicationId: W02 UNKNOWN, без повторной заявки.
- Worker lease потерян в SUBMITTING: W02 следующий worker только reconcile.
- Позднейший складской остаток изменился: W02 не использует его как доказательство первоначального принятого состава.
- Ручное гашение partial без связанного возврата: W02 UNKNOWN/EVIDENCE_INCOMPLETE.
- Удаление местной ВСЭ: W03 не отправляет новое гашение при пересоздании.

### Task W01: Intent и три решения приёмки

**Files:** создать `backend/src/modules/integrations/vetis/{receipt,receipt_mapping}.py`, `backend/tests/vetis/test_receipt_mapping.py`; изменить manifest/adapter/contracts/arrivals receipt router и `docs/integration/chk-xml-mapping.md`.

**Interfaces:** `submit_receipt(intent:ReceiptIntent)->Submission`, ReceiptIntent содержит immutable source UUID/receiver/decision/quantities/act/return reason/initiator/fingerprint/localTransactionId/reconciliation rev. Submission{application_id?,transport_state}; точные XML пути по выданному manifest, не по предположению.

- [ ] Написать XML assertions для полного/частичного/возврата: doc120/delivered100/full100 не return20; partial120=100+20 с причиной и linked return; RETURN_ALL accepted0 без местнойВСЭ/акта этой ветки; Other reason текст; blocking discrepancy запрещает ACCEPT/PARTIAL; no personal initiator/scope refuses до submit.
- [ ] Запустить `uv run --frozen pytest backend/tests/vetis/test_receipt_mapping.py -v`, получить FAIL.
- [ ] Расширить manifest зарегистрированным ProcessIncomingConsignmentOperation + submitApplicationRequest/receiveApplicationResult + service read methods. Для CHK decision/actual/reason/act заполнить XPath request→response/evidence, длины/precision/codes; перепроверить supported capabilities по выданному ВУ. Команда под locks проверяет current access/rev/status/decision и создаёт frozen intent+outbox atomically,202. Повтор перед SOAP вновь проверяет actor scope, rev/fingerprint и external applicability. Изменённый intent требует нового явного подтверждения; чужое/устаревшее не submit. Один unresolved partial UNIQUE.
- [ ] Проверить localTransactionId/applicationId разные поля, нет доверия к их дедупликации без контрактного доказательства. Full routes contract tests и rollback outbox; до W03 VETIS_WRITE_ENABLED=false.
- [ ] Зафиксировать: `feat: prepare immutable verified receipt submissions`.

### Task W02: Poll, доказательства и UNKNOWN

**Files:** создать `backend/src/modules/integrations/vetis/{polling,evidence,reconcile}.py`, `backend/tests/vetis/test_receipt_failures.py`, `backend/tests/vetis/test_reconcile.py`; изменить worker/dispatcher и arrivals.confirmation.

**Interfaces:** `get_operation(application_id,initiator)->ExternalResult`; `reconcile_receipt(intent)->ReconciliationEvidence`; `ReconciliationEvidence` либо complete ReceiptEvidence, либо incomplete diagnostics, не bool success.

- [ ] Написать fault tests: обрыв до submit/после принятия шлюзом/после внешнего success до local commit; lease lost SUBMITTING→reconcile only; duplicate confirmed result→одна confirmation; unproved absence→не resubmit; rejected→нет accepted gate; manual partial без доказанного состава→UNKNOWN. Проверить внешнюю связь исходный UUID/receiver/accepted/returned/акты, не текущее stock balance. 15 мин без результата→UNKNOWN.
- [ ] Запустить `uv run --frozen pytest backend/tests/vetis/test_receipt_failures.py backend/tests/vetis/test_reconcile.py -v`, получить FAIL.
- [ ] Реализовать NOT_SENT→QUEUED→SUBMITTING→PROCESSING→CONFIRMED/REJECTED/UNKNOWN. Перед сетевым submit durable SUBMITTING, applicationId записать немедленно после ответа. Receive result schedules backoff, SQL/HTTP locks не удерживать, job≤120 сек. Poll завершённый gateway результат проверяет business success+composition evidence, затем confirm_receipt atomically. После обрыва известный applicationId читать, неизвестный — read original UUID/stock version/linked return documents; отсутствие исполнения должно быть доказано контрактом до нового submit, timeout/5xx не доказательство. Недостаточно связей→UNKNOWN+INTEGRATION_EVIDENCE_INCOMPLETE+обезличенный diagnostics bundle для интегратора. Явное «Проверить результат» только read/reconcile. Durable evidence/неразрешённые операции без TTL; masked rawSOAP30 дней.
- [ ] Проверить AT-05 и SC-098–101, full returns, ручное гашение с достаточным evidence, restore после локальной потери подтверждения. Случай утраченного applicationId без доказательств остаётся безопасно заблокирован, не обходится администратором.
- [ ] Зафиксировать: `feat: reconcile receipt uncertainty without blind resubmission`.

### Task W03: Подключение UI и итоговая приёмка

**Files:** создать `frontend/src/features/arrivals/{ReceiptOperation,ReceiptConfirmationDialog}.tsx`, stories/tests, `frontend/tests/e2e/vetis-receipt.spec.ts`, `docs/operations/vetis-enable.md`; изменить receipt buttons/context invalidation и release checklist.

**Interfaces:** POST receipt/reconcile и GET operations; only CONFIRMED positive opens local ВСЭ либо пригодный previous conclusion, RETURN_ALL no ВСЭ.

- [ ] Написать e2e202 не даёт зелёное «Принято»; timeout сохраняет сверку и UNKNOWN, только «Проверить результат»; отказ не открывает create/print; confirmation positive открывает нужный маршрут; deleted local recreated без нового submit; локальный reset password не выдаёт внешних полномочий.
- [ ] Запустить адресный e2e с детерминированным adapter и получить FAIL до UI.
- [ ] Подключить ограниченный poll status и русские honest состояния; submit pending disabled, автоматический retry mutation отсутствует, ошибка не теряет допустимую сверку. До включения write выполнить manifest/capability/read-reconcile проверки и заполнить credentials/initiators/site bindings из INPUT-01, получить доступ оператора к разрешённым реальным действиям. Отдельная тестовая среда ВетИС не проектируется; contract fixture tests не исполняют реальные необратимые операции. Реальные приёмки проводятся только на разрешённых оператором документах, без вымышленных возвратов для проверки.
- [ ] Выполнить полный маршрут real incoming→reconciliation→verified receipt→ВСЭ→conclusion, отдельно partial/return/manual/UNKNOWN evidence с обезличенными доказательствами; весь SC001–101/AT01–25 по acceptance.md. Полные quality/performance/restore gates, signed release manifest. Только теперь фиксировать readiness полного MVP; если реальный кейс не выполнен, указать not-run и соответствующий незакрытый release-gate.
- [ ] Зафиксировать: `feat: complete verified VetIS receipt workflow`.
