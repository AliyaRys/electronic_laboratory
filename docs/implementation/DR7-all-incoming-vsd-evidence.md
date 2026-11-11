# DR7 — Evidence: import and display ALL matching incoming VSDs

Задача: `dorabotka/2026-11-11-all-incoming-vsd-arrivals.md` (§1–14).
Ветка: `feature/DR7-all-incoming-vsd` (от main 3ea1cc5). Дата: 11.11.2026.

## 1. Подтверждённая причина отсутствия второго ВСД

- Экран `/labs/:id/arrivals?queue=expected` читает только локальный
  `GET /api/v1/arrivals` (`parties`); браузер не обращается к ВетИС (§2.1 ТЗ).
- Для лаборатории `2812e437-…` последняя операция синхронизации — `FAILED`,
  причина `INTEGRATION_NOT_CONFIGURED`, `pages_done=0`, `imported=0`.
- В `backend/resources/vetis/manifest.json` `schema_pins.status = "PENDING"`;
  `VetisReadAdapter.require_live_ready()` честно запрещает сетевой вызов до
  закрепления WSDL/XSD — worker останавливается до первого SOAP-вызова.
  Единственная строка в БД — результат более раннего импорта, а не текущего
  прохода.
- Не причина (закреплено тестами): `GET /arrivals` не имеет лимита «1»
  (`page_size=20`), `ArrivalsPage` не делает `slice(0,1)`/`find()`,
  adapter обходит внешние страницы через `next_cursor`.

## 2. Schema pins / secret profile (§6.1–6.2)

- Я НЕ менял манифест, `require_live_ready()`, `.env*`, compose-файлы и не
  хардкодил `PINNED` — путь §6.1 у локальной установки уже подготовлен
  владельцем/контроллером: `.env.vetis-pins.json` содержит `status: "PINNED"`,
  WSDL + 6 XSD с SHA-256, монтируется через `VETIS_SCHEMA_PINS=/run/secrets/…`,
  secret profile — через `VETIS_SECRET_PROFILE=/run/secrets/vetis-profile.json`.
- Пересборка/активация контейнеров — шаг контроллера (R-DR7-9).
- Предупреждение контроллеру (обнаружено, не тронуто): локальный `.env`
  содержит `VETIS_WRITE_ENABLED=true`. Для прод-безопасности должно быть
  `false`; защита чтения на уровне кода сохранена (manifest
  `initiator.write_capability=false`, adapter отвергает write-операции,
  spy-тест `test_no_write_on_read_stage`).
- Из-за этой локальной переменной тесты запускались с
  process-local `VETIS_WRITE_ENABLED=false` (в окружении теста, не в `.env`).

## 3. Кодовые изменения

Backend:
- `backend/src/core/contracts.py`: `CommandStateView` + `pages_done`,
  `imported`, `diagnostics` (опциональные; API-01).
- `backend/src/modules/integrations/vetis/sync.py`:
  - проход страниц накапливает `received / kept / filtered[причина]` и пишет
    их в `VetisOperation.diagnostics` (JSONB) на каждой странице и при ошибке;
  - §7.3: подходящий документ, не прошедший импорт, не теряется молча —
    `VETIS_IMPORT_FAILED` с внешним UUID, этапом и кодом ошибки; операция
    `FAILED`, checkpoint не двигается, остальные валидные документы страницы,
    импортированные до ошибки, сохраняются (upsert-only);
  - `command_state_view` отдаёт страницы/импортировано/диагностику.
- Предикат §5 уже был точным (`normalizer.filter_entries`: receiver /
  TRANSPORT / CONFIRMED / productType==1, отсутствующий/неразбираемый ≠ 1) —
  закреплено тестами, не менялся.
- Формат-фиксы ruff в `identity/queries.py`, `identity/router.py` (были
  сломаны до задачи, I001/E501 — механические).

Frontend:
- `frontend/src/pages/ArrivalsPage.tsx`: после завершения sync и после
  скрытия — прямой `refetch()` списка и трёх счётчиков этапов (известный
  дефект prefix-`invalidateQueries` не обновляет `arrivals-count`);
  честное сообщение `INTEGRATION_NOT_CONFIGURED`:
  «Обновление из ВетИС недоступно: интеграция не настроена.»; строка
  диагностики «Обработано страниц: N; импортировано документов: M.»
- `ArrivalsScreen.tsx`: проп `syncDiagnostics`; `api.ts`: поля
  `pages_done/imported/diagnostics` в `SyncOperationState`;
  `schema.d.ts` регенерирован из backend OpenAPI (offline, без сервера).

## 4. Тесты (§10)

Новый файл `backend/tests/vetis/test_sync_all_pages.py`:
- 21 → 21 партия; 100 → 100; 1000 → 1000 (нет лимита 1/2/20);
- 2 документа на 2 страницах → оба импортированы (`pages_done=2`);
- адаптер: одна страница с двумя подходящими → `items.length == 2`;
- 2 подходящих + 4 неподходящих → `imported=2`,
  `diagnostics.filtered = receiver:1, status:1, product_type:2`;
- два разных UUID с одинаковым `issueNumber` → 2 партии;
- не запиненный адаптер: `transport.calls == 0`, операция `FAILED`
  `INTEGRATION_NOT_CONFIGURED`, `pages_done=0`, партий 0 — честно;
- «битый» подходящий документ: операция `FAILED`, `problem_detail` содержит
  UUID, другой документ той же страницы сохранён, checkpoint не двигался.

Уже существовавшее покрытие (не дублировалось): дедуп по повтору/оверлапу
(`test_pagination_replay_does_not_duplicate`,
`test_repeat_job_no_duplicates`), ошибка последней страницы без сдвига
checkpoint, `INTEGRATION_NOT_CONFIGURED` без SOAP, API §10.2
(`test_arrival_list_is_scoped_paged_and_searchable`: total=22 → 20+2,
страница 2, q внутри scope, чужая лаборатория 403; stable ordering),
дедуп/новый UUID с тем же issueNumber на уровне upsert
(`test_upsert_stable_identity`).

Frontend (`ArrivalsPage.test.tsx`): две строки из two-item fixture; 21 запись
→ 20 на первой + «свинина» на второй (page=2 в URL); после успешного sync
таблица и три счётчика перечитываются (≥4 запросов после терминала);
`INTEGRATION_NOT_CONFIGURED` показывает честное сообщение, без «Поступления
обновлены» и без «эВСД не найдены», строки остаются.

e2e (`frontend/tests/e2e/arrivals.spec.ts`): two-item fixture → две строки;
21 запись → страница 2 через кнопку «2», `page=2` в URL, оставшаяся строка
видна. Оба новые e2e прошли локально (Chrome).

## 5. Результаты прогонов

- `uv run --frozen ruff check backend frontend/tests/e2e` — 0 ошибок
  (2 предсуществующие ошибки в identity-файлах исправлены механически).
- `uv run --frozen pytest backend/tests/vetis backend/tests/arrivals` —
  163 passed. Полный `backend/tests` — см. отчёт.
- `npm run format:check`, `typecheck`, `lint` (0 errors, 1 предсуществующий
  warning в `use-catalog-context.ts`), `test -- --run` (264 passed),
  `build`, `build-storybook` — всё зелёное.
- `playwright test tests/e2e/arrivals.spec.ts`: 6 passed / 2 failed —
  оба падения предсуществующие (воспроизведены на дереве без моих правок:
  «control screenshots…» и «column chooser…», порт storybook/моки строк).
  Мои два новых e2e — passed.

## 6. Честные not-run

- Live read-only проверка §10.4 (реальный ВетИС: external_total, pages,
  received/kept/filtered/imported, отсутствие дублей на повторе,
  `ProcessIncomingConsignment calls = 0`) — not-run исполнителем: живая
  конфигурация и пересборка контейнеров принадлежат контроллеру
  (R-DR7-9, координационное сообщение). Контур PILOT запинен локально —
  после пересборки проверка должна быть выполнена контроллером по §10.4.
- Docker-пересборка — не выполнялась (шаг контроллера).
- Браузерная проверка `http://127.0.0.1:8080/...` на реальном dev-стеке —
  not-run (та же причина); проверка выполнена на mock-стеке (MSW/e2e).

## 7. Внешние записи ВетИС

Ни одного внешнего вызова ВетИС не выполнено (только fixtures/spy);
никаких `ProcessIncomingConsignment`/withdraw/gash; никаких удалений в БД
локальной установки; секреты в Git не попадали.
