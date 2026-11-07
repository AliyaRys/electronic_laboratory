# ВСЭ, ожидание и удаление Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать одну местную ВСЭ принятой партии с результатами, ожиданием, итогом и ограниченным удалением.

**Architecture:** examinations координирует одну SQL-транзакцию результатов/оценок/цены/пробы/статуса. Неполная форма живёт только в памяти; поздний итог — отдельная команда.

**Tech Stack:** SPEC-03; PostgreSQL, Pydantic discriminated unions, React/RHF.

**Spec:** DATA-03/06, API-05/06, VSE-F01–38; ФТ 03/04/05, ADR-016/017/020/023. Зависит A/S/C/I/F.

## Global Constraints

- «Максимум одна существующая карточка, в ожидании либо завершённая».
- «В день создания все поля; позднее только итог»; поздний итог VSE-F35–37.
- «Дата создания и создатель фиксируются при первом успешном сохранении».
- «first_completed_at фиксируется один раз»; результаты на всю партию, без строк туш.
- Сохранённых черновиков/истории медицинских версий/восстановления нет.

## Review Focus

- Два врача создают карточку одной партии: E01 допускает только одну.
- Отрицательная реакция и микроскопия 0: E01 считает их результатом, не пустотой.
- Lock ожидает до полуночи: E02 проверяет время после ожидания.
- Потеря ответа после сохранения ожидания: E01 повтор не создаёт вторую пробу.
- Потеря backup во время DELETE commit: E03 оставляет UNKNOWN и проверяет LSN.

### Task E01: Типы результатов и атомарное первое сохранение

**Files:** создать `backend/src/modules/examinations/{models,schemas,validation,commands,queries,router}.py`, `backend/migrations/versions/0009_examinations.py`, `backend/tests/examinations/test_create.py`, `backend/tests/examinations/test_results.py`; подключить examination_samples FK из S01.

**Interfaces:** `save_examination(ctx,party_id,payload)->ExaminationView`; API-05. Потребляет authorize/ReceiptEvidenceReader/evaluate_and_price/apply_sample; это один UoW, все нижележащие сервисы без commit.

- [x] Написать тесты: параллельный create→одна ВСЭ/одна проба; trim(' 001 ') сохраняет 001, в той же lab duplicate409, другая lab допустима; missing evidence422. microscopy0 pass,−1/1.5 fail; pH0/14 pass,14.1 fail; dose требует 2 числа;11 noncontagious fail; Other без текста fail; invasive без location fail. Трихинеллоскопия обязательна ровно для четырёх строк `mercury_product_guid_lvl_2` с `requires_trichinelloscopy=true`: свинина, конина, субпродукты и жиры свиные, субпродукты и жиры конские; для остальных 24 строк pilot-справочника она необязательна. Inject error после sample→полный rollback. Неполная форма не создаёт reserve/пробу даже на следующий день.
- [x] Запустить `uv run --frozen pytest backend/tests/examinations/test_create.py backend/tests/examinations/test_results.py -v`, получить FAIL.
- [x] Реализовать typed research и словари field-mapping/ФТ 10; organoleptic/identification/temperature mandatory, trichinella conditional по сохранённому идентификатору продукции второго уровня и локальному флагу `requires_trichinelloscopy`, без сравнения названий; optional performed только с полным результатом. Bacterioscopy=text, microscopy=int≥0, pH0..14, peroxide/copper enums, cooking Other text, dosimetry2 Decimal, invasive пары/noncontagious≤10. Предупреждение нормы не меняет итог. Первый wait требует sent_to_lab=true, все прочие mandatory кроме разрешённого итога. Complete требует полный допустимый итог/пробу/клеймо/нормы/цену, без sent_to_lab unresolved. Atomic snapshot цены/нормы/result/sample/status/command event; creator/time server only. Закрепить one-party/trim-number DB uniques, обработать constraint conflict без дубля.
- [x] Проверить AT-09/10/13–15/25, отсутствие HTTP draft/save-partial, after timeout повтор того же key возвращает тот же UUID. Coverage examinations≥90%; тесты настоящего PostgreSQL.
- [x] Зафиксировать: `feat: save complete or waiting party examinations atomically`.

### Task E02: Исправление и позднее завершение

**Files:** создать `backend/src/modules/examinations/lifecycle.py`, `backend/tests/examinations/test_lifecycle.py`; изменить commands/router.

**Interfaces:** `update_examination(ctx,id,payload)->ExaminationView`; `complete_waiting(ctx,id,outcome:OutcomeWrite)->ExaminationView`. OutcomeWrite только outcome/direction/reason, extra forbid.

- [ ] Написать `test_waiting_day_rules` с созданием 05.11: full edit05 разрешено,06 температура 422/409 DAY_CLOSED,08 итог разрешён и first_completed_at=08; после complete обычная поздняя правка запрещена. `test_lock_crosses_midnight` assert save открытого 23:59 блокирован после 00. `test_original_author_and_completion` assert создательА и first_completed_at прежние при правкеБ. `test_outcome_matrix` FIT→SALE/reason null; UNFIT→DISPOSAL|DESTRUCTION/nonblank; conditional-fit rejected; completed→waiting rejected.
- [ ] Запустить `uv run --frozen pytest backend/tests/examinations/test_lifecycle.py -v`, получить FAIL.
- [ ] Реализовать state/time/revision/auth под locks SPEC-04, без transaction-start now. Полная разрешённая правка не меняет автора/первое завершение; существующий indicator использует старый price/norm snapshot, новый — текущий с явным сообщением. WAITING completion не перезаписывает sample/research/cost/stamp/sent_to_lab. Ответ спецлаборатории подтверждается явным действием завершения, без введения нового протокола/вложений. FIT очищает reason; UNFIT свободный текст, медицинский итог всегда врача.
- [ ] Проверить поздний запрос с лишними полями extra=forbid, старый If-Match409 без слияния, отзыв назначения после открытия формы; AT-07/08. Запустить E01/E02.
- [ ] Зафиксировать: `feat: enforce examination day boundaries and late outcomes`.

### Task E03: Удаление без потери самостоятельных фактов

**Files:** создать `backend/src/modules/examinations/deletion.py`, `backend/src/core/durability.py`, `backend/tests/examinations/test_delete.py`; изменить queries/router. В OPS этап проверяется реальный backup; здесь интерфейс и fault tests.

**Interfaces:** `delete_examination(ctx,id)->DeleteOutcome`; `DurabilityGuard.ready()->bool`, `wait_flushed(lsn)->bool`; CommandState API-01. Тот же idempotency record определяет результат после timeout.

- [ ] Написать assertions после delete: старый GET404/old PUT EXAMINATION_DELETED, номер свободен, party WORK с прежним confirmation, collections/disposals/saved report прежние, нет research/charges/medical versions. Новый create→новый UUID и REUSE без начисления. backup not ready→503 без удаления. uncertain COMMIT→UNKNOWN, проверяющий повтор не выполняет второй DELETE и ждёт receiver flush_lsn до текущей верхней LSN.
- [ ] Запустить `uv run --frozen pytest backend/tests/examinations/test_delete.py -v`, получить FAIL.
- [ ] Реализовать атомарный tombstone+physical delete+event+command record; SET LOCAL synchronous_commit=on для DELETE. До COMMIT проверить base-copy/WAL continuity/receiver readiness. Success только remote flush; связь потеряна во время commit→202 UNKNOWN. Recovery/replay читает fact и текущий WAL LSN, ждёт durable upper bound, не воскрешает/не удаляет повторно вслепую. Коллекции/гашение/report evidence не CASCADE, медицинский payload не в tombstone/логах.
- [ ] Проверить concurrency delete/update/create/disposal и полночь; реальные destroy/restore критерии передать OPS02. AT-08/09/12/16, no external cancel. Без рабочего DurabilityGuard production DELETE не подтверждается.
- [ ] Зафиксировать: `feat: delete examinations with durable independent facts`.

### Task E04: Форма, журнал и просмотр

**Files:** создать `frontend/src/pages/{ExaminationCreatePage,ExaminationViewPage,ExaminationJournalPage}.tsx`, `frontend/src/features/examinations/{ExaminationForm,ResearchFields,FindingsFields,SampleSelection,OutcomeFields,DeleteDialog}.tsx`, stories/tests, `frontend/tests/e2e/examinations.spec.ts`.

**Interfaces:** API-05; header=me, specialist=view.created_by; form only memory, default new sample0.8; REUSE default при наличии доступного.

- [ ] Написать e2e wait→reload→late outcome, delete→create→REUSE, dirty leave,409 preserves values, error no success; assert no draft button/no parts/head/organs/conditional-fit/outgoing dialog, WAITING no conclusion. Keyboard research/Other/disease removal проверяются доступными именами.
- [ ] Запустить адресные frontend tests/e2e до реализации, получить FAIL.
- [ ] Реализовать readonly участников/четырёх уровней/accepted volume; номер/клеймо/исследования/проба/итог согласно typed schema; warnings нормы читаемые, no auto outcome; значимые busy/disabled/errors/long/narrow stories. Кнопки wait/complete/update/late outcome строго отдельные API; delete объясняет необратимость, сохранность внешних документов/проб/отчётов, safe cancel initial focus. Журнал WAITING/COMPLETED различим, только реальные IDs.
- [ ] Сборка Storybook+браузер 4 ширин, полный backend+frontend E regression и AT-07–16/25. Подтверждение приёмки fixture-only явно обозначить в evidence.
- [ ] Зафиксировать: `feat: connect examination lifecycle and journal screens`.
