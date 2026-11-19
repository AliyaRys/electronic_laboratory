# Сверка, повторное гашение, журнал ВСЭ и очистка справочников — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: сначала применить `superpowers:systematic-debugging` и повторно подтвердить причины на актуальном `main`; затем выполнять план через `superpowers:subagent-driven-development` — отдельный implementer на каждую задачу, после него отдельный reviewer соответствия ТЗ и отдельный reviewer качества кода. Для интерфейсных задач обязательно использовать `frontend-design`, `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md` и канонические компоненты проекта. После всех задач провести независимый whole-branch review. Все шаги отмечать чекбоксами `- [ ]`.

**Goal:** обеспечить живой серверный пересчёт стоимости сверки при отметке «Ярмарка», убрать дублирование сопроводительного документа, восстановить безопасную ручную повторную попытку после отклонённого ВетИС гашения, уточнить фильтры журнала и убрать из рабочих справочников самовольно добавленные диагностические/технические элементы, одновременно закрепив правильную семантику трихинеллоскопии.

**Architecture:** расчёты денег и XML остаются серверными и детерминированными. Для сверки добавляется read-only preview, использующий ту же функцию ценообразования, что сохранение. Отклонённая внешняя операция остаётся неизменяемым фактом аудита, но не блокирует явно подтверждённую новую попытку. Справочники показывают только редактируемые пользователем данные; исторические строки сохраняются в БД/аудите, но не выводятся как технические карточки. Трихинеллоскопия становится фиксированно оцениваемым показателем, а не настраиваемой нормой.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, PostgreSQL, VetIS SOAP/XML/XSD, React 19, TypeScript, React Hook Form, TanStack Query, CSS, Vitest/Testing Library/MSW, Storybook, Playwright, pytest, Docker Compose.

**Spec:** `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, `docs/TZ_development/plans/API REQUESTS.txt`, ФТ, Product Foundation, TZ_development, [официальное описание ProcessIncomingConsignment v2](https://help.vetrf.ru/wiki/ProcessIncomingConsignment_v2), настоящее ТЗ.

## Global Constraints

- Начать от актуального `main` в отдельной ветке `feature/reconciliation-retry-journal-catalog-cleanup`.
- Настоящее ТЗ добавить в feature-ветку отдельным первым коммитом.
- Не выполнять живое гашение ВетИС в тестах этой задачи. Тесты XML — только offline/XSD/transport spy с доказанным нулём внешних write-вызовов.
- Не удалять и не изменять старую отклонённую внешнюю операцию: это аудит реально отправленного запроса.
- Никогда не повторять SOAP write автоматически при открытии страницы, загрузке, refetch, mount или восстановлении сессии.
- Деньги не считать в браузере. Нули режима «Ярмарка» тоже возвращает серверный pricing engine.
- Не принимать от браузера тарифы, суммы, laboratory scope или готовый pricing snapshot.
- Не удалять исторические тарифы/нормы из БД в рамках очистки интерфейса. Если потребуется физическая миграция данных, это отдельное решение владельца.
- Удаление поясняющей строки о лаборатории/категории не меняет server scope и права. Для ролей с несколькими лабораториями selector остаётся.
- Не добавлять в пользовательские справочники новые audit/legacy/migration/diagnostic cards без отдельного согласования владельца.
- Не копировать общие кнопки, таблицы, dropdown, status, date filter, иконки или SVG. Расширять существующие компоненты и stories.
- Сохранить несвязанные изменения рабочего дерева, в том числе пользовательский `.gitignore`, и не включать их в коммиты задачи.

## Review Focus

- Быстрое переключение «Ярмарка» `false → true → false`: поздний ответ первого preview не должен вернуть интерфейс к нулевой цене.
- Отклонённое гашение: новая попытка возможна только после нового preview и нового явного подтверждения; `UNKNOWN` и `CONFIRMED` повторно не отправляются.
- Старый document mismatch с сохранённым `actual`: карточка читается совместимо, но факты документа не дублируются и новый payload не фабрикует `actual`.
- Скрытие контекстных строк: multi-lab пользователь по-прежнему видит и использует selector, single-lab пользователь не получает пустой контейнер.
- Старая активная MethodRule для трихинеллоскопии не должна влиять на оценку; тариф трихинеллоскопии при этом продолжает участвовать в расчёте стоимости.

---

## 1. Подтверждённые причины и факты

### 1.1. «Ярмарка» на сверке

`frontend/src/features/arrivals/ReconciliationForm.tsx` при нажатии меняет только React Hook Form field `fair`, а таблица продолжает выводить `initial.pricing` — последний сохранённый snapshot. Preview-запроса и защиты от устаревшего ответа нет. Сервер считает CHECK-услуги только в `save_reconciliation()` через `_price_check_services()`.

### 1.2. Дублирование сопроводительного документа

`DocumentComparisonField.tsx` сначала показывает исходный `<dl>`, а при mismatch выводит второй такой же `<dl>` внутри `.vse-rec-document-actual`. Более того, `ReconciliationForm.toPayload()` записывает этот же исходный документ в `actual`, а backend требует `actual`, поэтому визуальное дублирование закреплено неверной моделью данных. Простое CSS-скрытие недопустимо: выдуманное «фактическое значение» останется в payload и акте.

### 1.3. Почему партия `efe483f4-b505-40c2-b49c-4aab5f0d0448` не даёт повторить гашение

Read-only проверкой БД подтверждено:

- party: `a560d943-38e3-467f-956c-e2a885514cad`;
- rejected operation: `bd332dfc-0f6b-5ab3-94dc-8b1781acf54a`;
- applicationId: `31ad1307-3aa8-4e57-9460-e14093103554`;
- операция создана `16.11.2026 13:49:23 МСК`;
- отклонение: `Элемент 'info' не предусмотрен`;
- операция создана до исправляющего коммита `d7d3720` от `16.11.2026 14:28:53 МСК`;
- она закреплена за reconciliation revision 8, а текущая сверка уже имеет revision 10 и причину `OTHER_REASON`.

Старый генератор помещал `<vd:info>` внутрь `mercvu:discrepancyReport`, где XSD допускает `reason` и `description`, но не `info`. Текущий `main` уже формирует `discrepancyReport/reason + description`, а `docInspection/info` использует только в допустимом месте.

Оставшийся дефект находится в `ReceiptOperation.tsx`: `REJECTED` входит в terminal states, после чего компонент возвращает только `StatusView`. Backend уже разрешает новую явную попытку после `REJECTED` и выдаёт новый operation/localTransactionId, но UI не предоставляет путь к этой возможности.

### 1.4. Журнал

- «Итог ВСЭ» рендерится всегда; во вкладке WAITING он только disabled.
- «Период обращения» захардкожен одновременно в странице и `JournalDateFilter`/ARIA.
- backend сейчас фильтрует WAITING по `created_at`, а COMPLETED — по `first_completed_at`. Простое переименование в «Дата создания ВСЭ» без изменения запроса будет ложным интерфейсом.

### 1.5. Справочники

Текущие context notes, legacy audit table, `method-legacy-*`, unknown-code diagnostics, delete controls и «Дополнительные настройки» создаются непосредственно экранными компонентами. Это не обязательные backend-ошибки и не часть макетов — это самовольно добавленные UI-решения.

### 1.6. Трихинеллоскопия

В `mandatory.py` показатель `VSE-F21` не имеет явного `evaluation_mode`, поэтому наследует `CONFIGURABLE` и попадает в справочник норм. На форме обязательная для конкретной продукции трихинеллоскопия попадает в ветку `required` и получает неверные подписи «Соответствует / Не соответствует». При необязательном отображении тот же компонент уже использует предметные подписи «Не обнаружено / Обнаружено».

---

### Task 1: Живой серверный preview стоимости сверки

**Files:**
- Modify: `backend/src/modules/arrivals/schemas.py`
- Modify: `backend/src/modules/arrivals/reconciliation.py`
- Modify: `backend/src/modules/arrivals/router.py`
- Modify: `frontend/src/features/arrivals/api.ts`
- Modify: `frontend/src/features/arrivals/ReconciliationForm.tsx`
- Create or modify: `frontend/src/features/arrivals/ReconciliationPricingPreview.tsx`
- Modify: `frontend/src/features/arrivals/reconciliation.css`
- Test: backend arrivals pricing/router tests
- Test: `frontend/src/features/arrivals/ReconciliationForm.test.tsx` and/or a focused preview test
- Modify generated: `frontend/src/shared/api/schema.d.ts`

**Interfaces:**
- Produces endpoint: `POST /api/v1/arrivals/{party_id}/reconciliation-pricing-preview`.
- Consumes current typed reconciliation draft; never consumes money, tariffs, laboratory id or service list from the client.
- Produces the same typed `PricingSnapshot` used by final save plus a request identity/revision sufficient to reject stale UI responses.

- [ ] **Step 1: Write backend RED tests for a side-effect-free preview.**
  - Payload uses the current `ReconciliationWrite` fields required for validation/pricing, but `services`, amounts, tariffs and laboratory are not client inputs.
  - Endpoint applies the same party scope/authorization as `reconciliation:save`, requires CSRF, returns `Cache-Control: no-store`.
  - It loads party/source context server-side, runs `normalize_payload()`, `validate_receipt()` and the same `_price_check_services()` used by save.
  - It performs no INSERT/UPDATE, no idempotency claim, no audit event and no external call.

- [ ] **Step 2: Implement one shared server computation path.**
  - Extract only as much as necessary so preview and save cannot diverge.
  - A complete draft returns snapshot.
  - An incomplete/invalid draft returns the existing typed validation/configuration problem; it must not fabricate `0`.
  - Final `PUT reconciliation` still recalculates independently in its transaction and never trusts the preview total.

- [ ] **Step 3: Write frontend RED tests for immediate fair recalculation.**
  - Saved snapshot total `230.00`; click «Ярмарка»; before any save/PUT, POST preview with `fair:true` completes and UI shows `0,00 ₽`.
  - Uncheck; server preview returns normal snapshot and UI restores `230,00 ₽`.
  - Rapid `true → false`: an older `fair:true` response arriving last is ignored.
  - Preview failure keeps entered form values and shows a clear inline state; the old sum is never presented as current without «Пересчитываем стоимость…».

- [ ] **Step 4: Implement controlled preview state.**
  - Build the preview request from the same canonical `toPayload()` data used for save.
  - Checkbox change starts preview immediately; no save is required.
  - Abort superseded requests and additionally compare request identity before applying a response.
  - During first calculation show stable loading geometry; during recalculation the previous table may remain only with an `aria-live` status «Пересчитываем стоимость…».
  - Disable final save while a pricing preview for the current draft is pending or failed, so the user never confirms a sum belonging to another fair state.

- [ ] **Step 5: Keep UI composition.**
  - Current four columns and external total remain.
  - Checkbox remains in the same invoice block and keeps its existing wording.
  - Do not reintroduce unit/evaluation columns or client-side multiplication.

- [ ] **Step 6: Regenerate OpenAPI types, run focused tests, commit.**

---

### Task 2: Сопроводительный документ — только причина при несоответствии

**Files:**
- Modify: `frontend/src/features/arrivals/DocumentComparisonField.tsx`
- Modify: `frontend/src/features/arrivals/ReconciliationForm.tsx`
- Modify: `frontend/src/features/arrivals/reconciliation.css`
- Modify: `backend/src/modules/arrivals/schemas.py`
- Modify: `backend/src/modules/arrivals/validation.py`
- Modify: `backend/src/modules/integrations/vetis/receipt.py`
- Test: `frontend/src/features/arrivals/DocumentComparisonField.test.tsx`
- Test: `frontend/src/features/arrivals/ReconciliationDocuments.test.tsx`
- Test: `backend/tests/arrivals/test_dr40_accompanying.py`
- Test: relevant receipt mapping/intent tests

**Interfaces:**
- New writes use `DocumentCheck { matches, reason? }`; `actual` stays read-compatible for legacy stored rows but is not required or generated for new document-level mismatch.
- Act item for a document mismatch carries source document text + reason; `actual=null` unless a future explicitly designed UI really captures an actual document.

- [ ] **Step 1: Write RED UI tests.**
  - After «Не соответствует» the original type/number/date remain visible exactly once.
  - Appears exactly one `Field` named «Причина несоответствия».
  - «Фактическое значение» and the second `<dl>` are absent from DOM and accessibility tree.
  - Empty reason blocks save and is associated with the field.

- [ ] **Step 2: Remove the duplicate visual block at the component source.**
  - Do not hide with CSS.
  - Keep the reason inside the same document card under the original facts.
  - Preserve radio controls, long-text wrapping, keyboard focus and error announcement.

- [ ] **Step 3: Stop fabricating `actual` in `toPayload()`.**
  - New mismatch payload contains only `matches:false` and trimmed `reason`.
  - `matches:true` remains `{matches:true}`.
  - Old stored `actual` remains parseable, but the UI does not display a duplicate block.

- [ ] **Step 4: Update server validation and act construction.**
  - Unknown/removed document key remains blocking.
  - Mismatch requires reason, but no longer requires `actual`/CHK-F42.
  - Act preview and ReceiptIntent use the stable source document description plus reason; do not invent changed document details.
  - If `actual` exists in a legacy record, read it compatibly but do not require or propagate it as a new user fact without explicit input.

- [ ] **Step 5: Add regression tests proving that the XML discrepancy description has the document source and reason, but no duplicated fabricated actual.**

- [ ] **Step 6: Run focused tests and commit.**

---

### Task 3: Безопасная новая попытка после `REJECTED` и XSD-защита XML

**Files:**
- Modify: `frontend/src/features/arrivals/ReceiptOperation.tsx`
- Modify: `frontend/src/features/arrivals/ReceiptOperation.test.tsx`
- Modify if needed: receipt operation stories
- Verify/modify: `backend/src/modules/integrations/vetis/receipt_mapping.py`
- Verify/modify: `backend/src/modules/integrations/vetis/receipt.py`
- Test: `backend/tests/vetis/test_receipt_mapping.py`
- Test: `backend/tests/vetis/test_receipt_failures.py`
- Test fixtures: `backend/tests/fixtures/vetis/xsd/`
- Modify if required: `.gitattributes` and schema pin tests; do not blindly update manifest hashes

**Interfaces:**
- `CONFIRMED`: final, no retry.
- `UNKNOWN`: only poll/check result, no new submission.
- `REJECTED`: immutable prior attempt + explicit UI action to build a fresh preview; never automatic resend.

- [ ] **Step 1: Preserve the proven XML contract.**
  - `docInspection` order: `responsible → result → info` only for mismatch.
  - `discrepancyReport`: optional document fields, then `reason`, then `description`; no `info` child.
  - `CORRESPONDS`: neither `docInspection/info` nor `discrepancyReport`.
  - MISMATCH + ACCEPT_ALL/PARTIALLY: discrepancy report exists.
  - MISMATCH + RETURN_ALL: no discrepancy report.
  - PARTIALLY: accepted `delivery` + `returnedDelivery`.
  - RETURN_ALL: accepted consignment is absent, returned delivery contains full return.
  - `OTHER_REASON` requires text and is serialized once in returned certificate special marks.

- [ ] **Step 2: Pin all six scenarios with generated-XML XSD tests.**
  - Validate the XML produced by `build_process_incoming_application()`, not only hand-written fixtures.
  - Transport spy must prove zero SOAP/network calls.
  - Fix the existing schema-pin failure caused by CRLF checkout safely: use `.gitattributes`/canonical bytes so hashes do not depend on Windows `core.autocrlf`. Never “fix” this by accepting arbitrary local hashes.

- [ ] **Step 3: Write RED UI tests for recovery from REJECTED.**
  - Rejected message and VetIS detail remain visible as previous-attempt history.
  - A visible button is named **«Подготовить гашение заново»**.
  - Clicking it does not POST receipt and does not replay the old operation.
  - It restores/opens the inspection and date fields, fetches fresh receipt context, creates a new local preview, then opens a new confirmation dialog.
  - Only the second explicit confirmation submits.
  - New response operation id replaces active polling id.

- [ ] **Step 4: Implement the state machine without weakening one-shot safety.**
  - Remove `REJECTED` from the early-return branch that permanently hides the form, or create an explicit rejected-recovery branch.
  - Keep prior rejection visible until the user starts a new preview.
  - Reset old preview/dialog/submitted ref before a fresh preview.
  - Backend must create a fresh `operation_id`, `localTransactionId`, fingerprint, idempotency key and outbox row. Old row stays REJECTED unchanged.
  - Re-read source/reconciliation revisions and rebuild intent from the current revision; for the example this means revision 10/`OTHER_REASON`, not frozen revision 8/`QUANTITY_DISCREPANCY`.

- [ ] **Step 5: Test non-retry states.**
  - `CONFIRMED` never shows retry.
  - `UNKNOWN` exposes only safe result recheck.
  - QUEUED/SUBMITTING/PROCESSING cannot submit again.
  - Stale source/revision conflict stops before external write and requires a new preview.

- [ ] **Step 6: Run focused tests and commit.**

---

### Task 4: Фильтры журнала ВСЭ

**Files:**
- Modify: `frontend/src/pages/ExaminationJournalPage.tsx`
- Modify: `frontend/src/pages/JournalDateFilter.tsx`
- Modify: `backend/src/modules/examinations/journal.py`
- Test: `frontend/src/pages/ExaminationJournalPage.test.tsx`
- Test: `backend/tests/examinations/test_journal.py`
- Update relevant Storybook/E2E coverage

**Interfaces:**
- `occurred_from/occurred_to` now mean **creation date of VSE card** for both statuses.
- Outcome filter exists only for COMPLETED.

- [ ] **Step 1: Write RED tests for WAITING composition.**
  - No label, disabled select or note «Итог ВСЭ» exists in DOM/accessibility tree.
  - Grid closes the empty space; remaining filters align at one level and do not leave a blank column.
  - Switching COMPLETED → WAITING removes stale `outcome` from URL while preserving search/author/sort/date/page rules.

- [ ] **Step 2: Render outcome only for COMPLETED.**
  - COMPLETED keeps «Итог ВСЭ» with FIT/UNFIT.
  - WAITING does not replace it with another explanatory card.

- [ ] **Step 3: Rename the date filter everywhere.**
  - Visible label: **«Дата создания ВСЭ»**.
  - Trigger `aria-label`, dialog accessible name, test ids/messages and Storybook use the same phrase.
  - Remove every user-visible «Период обращения» on both tabs.

- [ ] **Step 4: Make backend semantics match the label.**
  - Both WAITING and COMPLETED filter `occurred_from/to` by `Examination.created_at`, with existing Moscow half-open range rules.
  - Current «Сначала новые / Сначала старые» sort on this screen also uses creation time for both tabs, so the same control does not silently change meaning between tabs.
  - Keep deterministic id tie-breaker and pagination behavior.

- [ ] **Step 5: Run URL/back-forward, timezone boundary, responsive and accessibility tests; commit.**

---

### Task 5: Очистить пользовательские справочники от служебных блоков и удаления

**Files:**
- Modify: `frontend/src/features/catalogs/catalog-context-slot.tsx`
- Modify: `frontend/src/features/catalogs/TariffsEditorPage.tsx`
- Modify: `frontend/src/features/catalogs/CheckServicesEditorPage.tsx`
- Modify: `frontend/src/features/catalogs/MethodsEditorPage.tsx`
- Modify only after usage audit: `frontend/src/features/catalogs/editor-parts.tsx`
- Modify: `frontend/src/features/catalogs/catalogs.css`
- Test: corresponding `*.test.tsx` and stories

**Interfaces:**
- Catalog APIs/scopes remain intact.
- Historical `legacy_tariffs`/legacy method rules remain server-side audit data but are ignored by these editor screens.
- Backend DELETE endpoints may remain for compatibility/internal administration; ordinary UI no longer exposes delete actions requested here.

- [ ] **Step 1: Remove all requested context notes.**
  - Tariffs: remove «Лаборатория … · Продукция …» and «Категория продукции … стоимость одна…».
  - Check services: remove `check-services-laboratory`.
  - Methods: remove laboratory/product/context/category note.
  - If a user may switch laboratories, keep `CatalogContextSelector` unchanged.
  - If `onPick === null`, `CatalogContextSlot` returns `null`; no empty wrapper.

- [ ] **Step 2: Remove tariffs diagnostics from the user screen.**
  - Do not render `tariffs-legacy-diag`, legacy audit table, `tariff-diag-*`, UUID/source/version/migration details or instruction to clean rows manually.
  - Do not delete/migrate old rows and do not auto-select a new “winner”.
  - Unknown/legacy technical facts go to structured server logs/monitoring, not a custom page card.

- [ ] **Step 3: Remove tariff delete controls.**
  - No «Удалить», «Удалить тариф» button, delete dialog or delete state/wiring in **«Стоимость исследований ВСЭ»**.
  - Editing and saving prices remain.
  - Do not accidentally remove delete behavior from «Платные услуги»: пункт владельца для этой страницы касается только context note.

- [ ] **Step 4: Remove methods details and delete controls.**
  - No `<details>`, «Дополнительные настройки», inclusive checkboxes, «Дополнительные действия», «Удалить норму» or delete dialog.
  - Existing saved `lower_inclusive/upper_inclusive` must survive ordinary edits unchanged even though controls are hidden.
  - New interval norm defaults remain `true/true` unless current domain contract explicitly says otherwise.
  - Do not hardcode `true/true` on every update and thereby rewrite old exclusive boundaries.

- [ ] **Step 5: Remove methods diagnostic cards.**
  - Do not render `method-legacy-*`, fixed-method messages, NONE messages or unknown-code diagnostics.
  - Fixed/NONE methods are simply absent from the editable list.
  - No empty section/gap remains.

- [ ] **Step 6: Add tests.**
  - None of the removed texts/controls exist in DOM/accessibility tree.
  - Multi-lab selector still changes scoped requests.
  - Single-lab page has no empty context container.
  - Editing/saving tariff and norm still works.
  - A stored interval with `lower_inclusive=false` remains false after editing only upper bound.
  - Legacy rows are not deleted or overwritten by opening/saving unrelated entries.

- [ ] **Step 7: Build Storybook, inspect all three pages at 1440/1024/390 px and 200% zoom; commit.**

---

### Task 6: Трихинеллоскопия — фиксированная оценка и правильные варианты

**Files:**
- Modify: `backend/src/modules/catalog_pricing/mandatory.py`
- Modify if necessary: `backend/src/modules/catalog_pricing/service.py`
- Modify: catalog context/readiness tests
- Modify: `frontend/src/features/examinations/indicators.ts`
- Modify: `frontend/src/features/examinations/ResearchFields.tsx`
- Test: `backend/tests/catalog_pricing/test_dr41b_registry.py`
- Test: `backend/tests/catalog_pricing/test_methods_context.py`
- Test: `backend/tests/catalog_pricing/test_meat_scope.py`
- Test: `frontend/src/features/examinations/ExaminationForm.test.tsx`
- Update examination stories
- Update ФТ/Product Foundation/TZ_development sections that currently describe configurable F21 norm

**Interfaces:**
- `VSE-F21` remains `BOOLEAN_MATCH`, conditional by four product level-2 GUID groups, but becomes `evaluation_mode="FIXED"`.
- Wire value remains boolean/string-compatible: `true` = «Не обнаружено» = `IN_NORM`; `false` = «Обнаружено» = `DEVIATION`.
- Tariff configuration remains; only norm configuration disappears.

- [ ] **Step 1: Write RED registry/pricing tests.**
  - F21 is FIXED, conditional, not globally mandatory.
  - Fixed mapping accepts `true`, `"true"`, «Не обнаружено» as `IN_NORM`.
  - Accepts `false`, `"false"`, «Обнаружено» as `DEVIATION`.
  - Criterion text: **«норма: Не обнаружено»**.
  - No MethodRule is required for readiness/pricing.
  - A legacy active F21 MethodRule does not override fixed evaluation.
  - POST/PUT a new F21 norm is rejected as a FIXED indicator.

- [ ] **Step 2: Implement explicit trichinella mapping.**
  - Do not reuse `_MATCH_OPTIONS`/«Соответствует» labels.
  - Preserve conditional requirement for: свинина; конина; субпродукты и жиры свиные; субпродукты и жиры конские.
  - Existing historical F21 MethodRule may remain in DB for audit but is not displayed or used.

- [ ] **Step 3: Remove F21 from Methods editor by server semantics, not a fragile name filter.**
  - Context exposes it as FIXED/non-editable or omits it from editable rows according to the existing FIXED contract.
  - Page renders no trichinelloscopy norm card and no diagnostic explaining its absence.

- [ ] **Step 4: Correct the examination form labels independent of `required`.**
  - Required and optional F21 both display only **«Не обнаружено»** and **«Обнаружено»**.
  - Required controls whether the research can be removed and whether a value is mandatory; it never changes the option names.
  - Use the canonical `SelectDropdown`/existing research control; do not fork markup.
  - Payload remains BOOLEAN `true/false`; no Russian label is sent as wire value.

- [ ] **Step 5: Prove tariffs remain.**
  - «Трихинеллоскопия» still appears in «Стоимость исследований ВСЭ».
  - When performed, its tariff and quantity still enter pricing snapshot.

- [ ] **Step 6: Run focused backend/frontend tests, Storybook states for optional/required/in-norm/deviation, commit.**

---

### Task 7: Общая проверка, документация и выпуск

**Files:**
- Modify relevant ФТ/Product Foundation/TZ_development decisions
- Update component/catalog README where public behavior changed
- Append implementation evidence/report without replacing this plan

- [ ] **Step 1: Run backend gates.**
  - Formatter/lint/typecheck by repository commands.
  - Focused arrivals, VetIS, examinations journal and catalog pricing suites.
  - Full backend suite.
  - Alembic single-head check; no migration is expected unless implementation truly changes schema. Do not create a decorative migration.

- [ ] **Step 2: Run frontend gates.**
  - `npm.cmd test -- --run`
  - `npm.cmd run typecheck`
  - `npm.cmd run lint`
  - production build
  - `npm.cmd run build-storybook`

- [ ] **Step 3: Run browser/E2E flows.**
  - Reconciliation fair live preview.
  - One document mismatch with reason only.
  - REJECTED receipt recovery up to new confirmation dialog using mocked/offline transport; do not perform live VetIS write.
  - WAITING/COMPLETED journal filters and URL back/forward.
  - All three catalog pages for single- and multi-lab roles.
  - Examination with conditional required trichinelloscopy.
  - Viewports 1440×900, 1024×768, 390×844 and 200% zoom; keyboard and screen-reader names.

- [ ] **Step 4: Run premium UI audit and inspect results.**
  - Run the installed frontend-design-premium strict audit.
  - Resolve findings relevant to changed files; report unrelated baseline findings separately, do not expand scope silently.

- [ ] **Step 5: Whole-branch review.**
  - Reviewer must explicitly check: no external VetIS call; no client money; no duplicate document actual; no automatic resend; no legacy cards; no loss of multi-lab selector; no use of old trich norm.

- [ ] **Step 6: Commit final documentation/evidence.**

---

## Implementation Order and SDD Ledger

1. Task 1 — reconciliation pricing preview.
2. Task 2 — document mismatch contract; Task 3 consumes its act/intent semantics.
3. Task 3 — rejected-operation recovery and XML/XSD gate.
4. Task 4 — journal filters.
5. Task 5 — catalog presentation cleanup.
6. Task 6 — fixed trichinelloscopy semantics (may share catalog tests but gets its own implementer/review).
7. Task 7 — full verification, whole-branch review and release.

For each task:

- create a task brief from this plan;
- record base commit in the SDD ledger;
- implement with RED → GREEN → REFACTOR;
- run focused tests;
- make a cohesive commit;
- dispatch a fresh task reviewer with exact diff package;
- fix Critical/Important findings and re-review before moving on.

Recommended commits:

```text
docs: add reconciliation retry journal and catalog cleanup plan
feat(arrivals): add live reconciliation pricing preview
fix(arrivals): keep only mismatch reason for documents
fix(vetis): allow explicit retry after rejected receipt
fix(journal): use VSE creation date and hide waiting outcome
fix(catalogs): remove technical notes diagnostics and delete controls
fix(examinations): make trichinelloscopy evaluation fixed
test: cover reconciliation receipt journal and catalog regressions
```

---

## Final Acceptance

- «Ярмарка» на сверке меняет отображаемую серверную стоимость на `0,00 ₽` до сохранения; обратное переключение возвращает обычную стоимость.
- У несоответствующего сопроводительного документа факты показаны один раз, ниже только поле причины.
- Старая ошибка партии остаётся в истории; пользователь может нажать «Подготовить гашение заново», получить новый preview и отдельно подтвердить новую попытку.
- Ни загрузка страницы, ни refetch не отправляют гашение автоматически.
- Во вкладке WAITING нет «Итог ВСЭ»; на обеих вкладках фильтр называется и работает как «Дата создания ВСЭ».
- В тарифах нет legacy/migration table, context notes и кнопок удаления.
- В платных услугах нет context note; остальной функционал страницы не потерян.
- В нормах нет context notes, details, inclusive controls, delete buttons, fixed/legacy diagnostics и карточки трихинеллоскопии.
- На форме ВСЭ трихинеллоскопия всегда предлагает «Не обнаружено» / «Обнаружено», корректно оценивается без MethodRule и остаётся тарифицируемой.

---

## Git, Main and Containers

- После clean task reviews и whole-branch review объединить feature-ветку вместе с настоящим ТЗ в актуальный `main`.
- Разрешать конфликты содержательно; не использовать слепо `ours/theirs`, не перезаписывать чужие изменения.
- Запушить feature-ветку и обновлённый `main` в подключённый remote.
- Пересобрать и обновить контейнеры штатной compose-командой проекта без удаления volumes/БД.
- Если миграции отсутствуют, явно зафиксировать это; если появилась обоснованная миграция — применить штатно и проверить единственную head.
- Выполнить post-deploy smoke на `http://127.0.0.1:8080`: вход, сверка fair preview, document mismatch, отображение REJECTED retry, журнал, три справочника и форма ВСЭ.
- В отчёте указать ветку, коммиты, merge commit, тестовые команды и результаты, compose-команду, состояние контейнеров и честные not-run.

**Definition of Done:** код, ТЗ, тесты и документация находятся в `main`; контейнеры обновлены; live preview, безопасный retry, журнал и справочники проверены в реальном браузере; внешнее гашение в ходе автоматической проверки не выполнялось.
