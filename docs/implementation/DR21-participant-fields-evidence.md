# DR21 — Предприятие и хозяйствующий субъект в сверке: доказательства реализации

Дата: 2026-11-13. Ветка: `feature/DR21-participant-fields` (worktree
`C:\electronic_lab_dev-dr21`, BASE = main @ 1c2e913). Спецификация:
`dorabotka/2026-11-13-participant-enterprise-owner-fields.md` (§1–9), rulings
R-DR21-1..6 (`.superpowers/sdd/2026-11-13-participant-fields/progress.md`).

## Что сделано

### Reconciliation UI (frontend)

- `frontend/src/features/arrivals/api.ts` — `comparedFields()`:
  - CHK-F05: подпись «Отправитель — предприятие» → **«Предприятие»**, source —
    `senderEnterprise` (устаревший ключ `consignor` оставлен только как
    толерантность проекции для старых fixtures, после `senderEnterprise`);
  - CHK-F06: **«Хозяйствующий субъект»**, source — `senderOwner`;
  - CHK-F07: **«Предприятие»**, source — `receiverEnterprise` (после него
    `consignee` как толерантность);
  - CHK-F08: **«Хозяйствующий субъект»**, source — `receiverOwner`.
- `frontend/src/features/arrivals/ReconciliationForm.tsx` — карточки
  «Сведения об отправителе»/«Сведения о получателе»: ровно два поля в порядке
  «Предприятие», затем «Хозяйствующий субъект». Разрешённое имя рендерится
  общей `ComparisonField`-картой (одинаковые кнопки совпадения/несоответствия,
  доступность с клавиатуры — родные radio с полными русскими aria-label);
  неразрешённое имя рендерит честный DR18 §10 fallback
  («Уточняем названия организаций…» / «Название не получено» /
  «Название временно недоступно»), без карты сравнения — ни фиктивной отметки,
  ни сырого GUID/UUID, форма не блокируется. Дублирования механизмов нет:
  информационные DR18-поля рядом с картами сравнения убраны (один слот —
  один механизм по состоянию).
- ID `CHK-F05/06/07/08` в payload/БД/checks JSONB не менялись (R-DR21-3);
  миграции нет; старые сохранённые сверки читаются прежним кодом.

### Существующая DR18-интеграция (проверено, не дублировано)

DR18 уже в main: таблица `vetis_reference_names` (уникальность
`(contour, entity_kind, guid)`), worker `resolve_due_reference_names`
(read-only `GetEnterpriseByGuid v2` / `GetBusinessEntityByGUID` через
закреплённый manifest), read-model `participant_name_overrides` с
`<key>NameSource`, поля `senderOwner/senderEnterprise/receiverOwner/
receiverEnterprise` в `source_projection` (backend
`modules/arrivals/reconciliation.py`), серверная матрица inadmissible
`CHK-F05..F08` в `validation.py` — не менялась. DR21 использует только её;
ни новой таблицы, ни второго словаря, ни браузерных вызовов VetIS.

### Тесты

Backend (новое в `backend/tests/vetis/test_reference_names.py`):

1. `test_dr21_enterprise_named_creates_job_only_for_business_entity` — XML
   с enterprise name и businessEntity без name: очередь только для
   businessEntity (§7.1);
2. `test_dr21_business_entity_lookup_reaches_the_read_model` — после
   успешного `GetBusinessEntityByGUID` read model отдаёт
   `senderOwner`/`receiverOwner`, GUID не подменяет имя (§7.2).

Остальные §7 (3–8) покрыты существующими DR18-тестами (переиспользованы, не
дублированы): раздельное хранение kind/contour (`test_4`,
`test_read_path_kind_isolation_same_guid`), cache-miss fallback не блокирует
сохранение (`test_missing_name_does_not_block_reconciliation`), дедупликация
повторного sync (`test_3`), ошибка сохраняет имя и назначает retry
(`test_7`), raw XML/checksum/revision/факты не изменяются (`test_9`).

Frontend (новый блок «participant enterprise/owner comparison cards (ТЗ
DR21 §5)» в `ReconciliationForm.test.tsx`, + обновлённые DR18-фикстуры без
устаревших `consignor/consignee`):

1. две карты сравнения у каждого участника, порядок Предприятие →
   Хозяйствующий субъект, без информационных дублей;
2. подписи F05/F07 «Предприятие», F06/F08 «Хозяйствующий субъект»;
3. все четыре карты используют одинаковые radio-контролы, доступны с
   клавиатуры (focus + полный aria-label);
4. mismatch открывает «Фактическое значение»/«Причина несоответствия» того же
   общего контракта;
5. fallback без карты сравнения, без GUID, форма не блокируется;
6. payload сохранения несёт прежние CHK-ключи (инвариантность ID).
   Состояния loading/error/long-name/missing — существующие DR18-тесты
   (адаптированы под единый источник имён).

## Запуски (gate)

- `uv run --frozen ruff check backend frontend/tests/e2e` — All checks passed!
- `uv run --frozen pytest backend/tests/arrivals backend/tests/vetis -q` —
  **303 passed** (216 s).
- `npm.cmd run format:check` — OK; `typecheck` — OK; `lint` — 0 errors
  (1 pre-existing warning `react-hooks/exhaustive-deps` в другом файле);
  `test -- --run` — **343 passed (53 files)**; `build` — OK;
  `build-storybook` — OK (см. логи прогона).

## Честно не выполнено / ограничения

- Ширины 1440/1024/768/390 px: jsdom не измеряет раскладку — проверка CSS
  media-queries и ручная браузерная проверка ширины в пределах этого
  subagent-прогона не выполнялись (карты сравнения используют уже
  существующую геометрию `vse-rec-compare`, изменений CSS нет).
- `backend/tests/examinations/test_delete.py` — 2 известных несвязанных
  падения на main; в gate-набор (`arrivals`, `vetis`) не входят, не
  воспроизводились здесь.
- Контейнеры docker не пересобирались и merge в main не выполнялся — по
  инструкции контроллера (DR21 §8 выполняет контроллер).
- Экран `features/examinations/SampleSelection.tsx` показывает участников со
  старыми подписями (`consignorOwner` и т.п.); DR21 §5 нормирует только блок
  сверки, этот экран не входил в объём и не менялся (дискlosed).
- Живых write-вызовов VetIS нет: все тесты на fixtures + transport spy.

## Git

- Коммит: `fix: participant enterprise and owner labels in reconciliation`
  (+ файл ТЗ в той же ветке).
- Push: `origin feature/DR21-participant-fields`. Merge в main/Pull Request —
  контроллер.
