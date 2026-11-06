# SPA, маршруты и взаимодействия Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить новый клиент с входом, общим API и устойчивым контекстом лаборатории.

**Architecture:** Отдельная frontend/ SPA; старые HTML остаются эталоном. Одна реализация React-компонента для страницы и Storybook; Query хранит серверные ответы, формы — только память.

**Tech Stack:** SPEC-03; React/Vite/TS, Query/Zustand, Radix Primitives, RHF/Zod, openapi-fetch.

**Spec:** SPEC, [UI mapping](ui-mapping.md), API-01/02, ФТ 07/01, ADR-007–012. Зависимость: I01–I03.

## Global Constraints

- «persist для медицинских форм, JWT и рабочих записей отключён».
- «Автоповтор мутаций выключен»; optimistic update для предметных команд запрещён.
- «Русский интерфейс»; проверки 1440/1024/768/390 px.
- Перед работой прочитать DESIGN.md, UX-CONTRACT.md, STORYBOOK.md и README владельцев компонентов.

## Review Focus

- Ответ старой лаборатории приходит позже: F01 не показывает его в новом контексте.
- 401 в открытой форме: F01 очищает закрытые данные и сеанс.
- Прямой старый HTML URL без identity: F02 не открывает пример чужой партии.
- Диалог удаления клавиатурой: F02 начинает с отмены и возвращает фокус.
- 409 при сохранении: F01 сохраняет допустимый ввод без автоматического слияния.

### Task F01: Transport, context и навигация

**Files:** создать `frontend/package.json`, lock/config Vite/TS/ESLint/Prettier, `frontend/src/app/{router,providers,context}.tsx`, `frontend/src/shared/api/{client,problem,command}.ts`, `frontend/src/shared/api/schema.d.ts`, `frontend/src/shared/lib/{numbers,dates}.ts`, `frontend/src/features/context/SwitchContext.tsx`, `frontend/src/shared/api/client.test.ts`, `frontend/src/features/context/SwitchContext.test.tsx`, `frontend/.storybook/{main,preview}.ts`.

**Interfaces:** API types генерируются; `apiClient` с empty baseUrl; `useCommand()` возвращает submit/status/error и удерживает key до однозначного результата; Query key `[userId,labId,productId,resource,params]`; формы не помещаются в Zustand.

- [x] Написать `test_api_prefix_once` assert URL=/api/v1/arrivals; `test_stale_context_response_ignored`; `test_conflict_keeps_input` assert введённая причина прежняя при 409; `test_mutation_not_auto_retried` assert вызов=1 при timeout; `test_logout_clears_cache` assert закрытых данных нет.
- [x] Запустить `npm.cmd --prefix frontend run test -- --run` после минимальной test-конфигурации; ожидаемый FAIL — отсутствие поведения, не пропуск тестов.
- [x] Реализовать middleware CSRF/If-Match/key/Problem, AbortSignal, URL filters/page, контекст и router blockers. Strict decimal parser принимает 0/запятую/точку, отвергает abc/NaN/пустое/-массу; номера не преобразует в number. Генерировать schema.d.ts из OpenAPI, CI regeneration+diff. 401 очищает cache/forms, 403 не перезагружает запретные данные, 409 предлагает актуальное состояние без слияния. Никаких fetch вручную по страницам.
- [x] Выполнить frontend scripts SPEC-06; MSW должен доказать поздний ответ А→Б, навигацию назад на page2, from>to422, отмену dirty switch. Production deep-link refresh проходит nginx fallback, API error не возвращает index.html.
- [x] Зафиксировать: `feat: add generated API client and scoped SPA routing`.

### Task F02: Канонические компоненты и доступные состояния

**Files:** создать `frontend/src/shared/ui/{AppShell,AppHeader,Button,Field,Dialog,StatusView,DataTable,Icon}.tsx`, соответствующие `.stories.tsx`, CSS и tests; `frontend/src/shared/ui/legacy-icons.ts`; `frontend/tests/e2e/shell.spec.ts`. Источники — components/{app,shell,icons,auth,profile,admin,checks}; произвольные SVG не добавлять.

**Interfaces:** AppShell получает UserView/current scope/capabilities из API; Header не выводит специалиста открытой ВСЭ как текущего пользователя. Icon адаптирует существующий реестр; CheckSection keys строго из README. Таблица и меню не конфликтуют с row link.

- [x] Написать `test_dialog_focus_and_escape` assert safe cancel initial focus и возврат trigger; `test_row_menu_does_not_navigate`; `test_legacy_url_without_identity` assert понятный выход без подставной записи; `test_long_values_keyboard` assert полное значение доступно без hover.
- [x] Запустить адресные Vitest/Playwright и получить FAIL до компонентов.
- [x] Реализовать по ui-mapping и токенам: рабочая кнопка/поле отличаются от auth, Header canonical styles, диалоги на Radix, ошибки aria-describedby, фокус visible, disabled/loading/error/empty/no matches/not found/no scope. Добавить stories значимых состояний, длинных данных/390px; не копировать код в stories. Compatibility route resolver только реальный UUID, старые demo-specific ссылки не открывают demo в production.
- [x] Собрать новый Storybook, проверить компоненты на реальных страницах и 4 ширинах. При изменении старой библиотеки выполнить корневой build-storybook; для auth также test:ui. Не объявлять каталог доказательством рабочего сценария.
- [x] Зафиксировать: `feat: establish shared accessible application components`.

### Task F03: Вход, профиль и администрирование

**Files:** создать `frontend/src/pages/{LoginPage,RecoveryPage,ProfilePage,UsersPage,UserEditorPage,UserHistoryPage}.tsx`, `frontend/src/features/identity/{LoginForm,PasswordForm,UserEditor}.tsx` и stories/tests, `frontend/tests/e2e/identity.spec.ts`.

**Interfaces:** API-02; recovery только объяснение обращения к администратору; маршруты ui-mapping; read-only profile кроме смены известного пароля.

- [ ] Написать e2e `test_four_role_landing`, `test_admin_cannot_open_working_data`, `test_password_reset_keeps_blocked`, `test_no_email_recovery`: assert роль-specific landing; ADMIN journal403; reset blocked остаётся blocked; нет отправки email/токена.
- [ ] Запустить `npm.cmd --prefix frontend run test:e2e -- identity.spec.ts`, ожидаемый FAIL до страниц.
- [ ] Подключить существующие backend команды I03; ADMIN поиск/фильтры/история/reset/block/delete с подтверждениями и сохранённым URL-контекстом; ошибки привязать полям, секреты очищать после submit/закрытия. Заблокирован/нет доступа/нет назначенной продукции различать. ANALYST выбирает одну лабораторию, VET/HEAD переходят в рабочий контекст.
- [ ] Выполнить e2e с настоящим API/PostgreSQL/Redis, все frontend gates; сверить FT-ACC-01–10 и FT-COM-01–10, AT-20/24. Не переносить email-сценарий старого recovery макета поверх ФТ.
- [ ] Зафиксировать: `feat: connect identity screens to scoped API`.
