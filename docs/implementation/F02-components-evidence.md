# F02 — Канонические компоненты и доступные состояния: доказательство

Дата: 2026-11-07 · Ветка `feature/F02-components` (от dfed1a2). Коммит кода: `c62fb75`.

## 1. Файлы

Компоненты (новые, `frontend/src/shared/ui/`): `AppShell.tsx`, `AppHeader.tsx`, `Button.tsx`, `Field.tsx`, `Dialog.tsx`, `StatusView.tsx`, `DataTable.tsx`, `Icon.tsx`, `legacy-icons.ts`, `ui.css`, `app-header.css`, `Icon.css`; stories: `button/field/dialog/status-view/data-table/app-header/app-shell/icon.stories.tsx`; тесты co-located: `*.test.tsx` (8 файлов). Прочее: `shared/lib/legacyRoutes.ts` + тест; `shared/api/me.ts` (GET /me, API-02); `tests/e2e/shell.spec.ts` (новый каталог `frontend/tests/e2e`, `testDir` в playwright.config обновлён на `./tests/e2e`, tsconfig include `tests`).

Интеграция F01: `app/router.tsx` теперь импортирует `AppShell` из `shared/ui/AppShell` (единый источник правды: header + Outlet + детей). Dirty-диалог и `performLogout` подключены в app-слое (`AppShellLayout`), поэтому `shared` не зависит от `features` (SPEC-02). F01-тест dirty-blocker адаптирован: `RouterProvider` обёрнут в `AppProviders` (теперь shell требует query-клиент) — ассерты не менялись. `AppLayout.tsx` удалён как dead code (router больше не использует его).

## 2. Источники и правила

- Icon адаптер `legacy-icons.ts`: дефиниции перенесены 1:1 из `components/icons/VseIcon.js` + `components/shell/AppHeader.js` + `components/app/Icon.js` (meat/milk дедуплицированы). Новых SVG нет. Ключи `data-check-section` строго из README (document, participants, product, transport, documents, priorVse, results, invoice) — тест `Icon.test.tsx`.
- `ui.css` — токены и состояния скопированы из `components/app/tokens.css`/`app.css`; `app-header.css` — каноническая геометрия из `components/shell/app-header.css` 1:1 (76px, брейкпоинты 1240/1200/920/800).
- Header — React-порт `VseAppHeader.create()`: режимы work/admin/analyst/no-products, переключатель продукции с клавиатурой (Escape → возврат фокуса), режим admin/analyst ссылки задаются вызывающим кодом.
- Header показывает пользователя только из UserView (`headerUserFromView(me)`): тесты «никогда не выводит специалиста открытой ВСЭ» (AppHeader + AppShell с MSW, специалист «Ринат Усманов» отсутствует в DOM).
- Dialog — Radix 1.3.1; safe-cancel first (onOpenAutoFocus → фокус «Остаться»), Escape, возврат фокуса на триггер (собственный restore, т.к. Radix возвращает фокус только своему Trigger), error → `aria-describedby`.
- Button — контракт `components/app/Button.js`: busy блокирует повторную отправку, `aria-busy`, icon-only берёт имя из label.
- Field — контракт `components/auth/TextField.js` в рабочих токенах: `aria-describedby` (hint+error), `aria-invalid`, `aria-live="polite"`, ошибка снимается при вводе.
- StatusView — состояния UI-03: loading/empty/no-match/not-found/forbidden/blocked/network-error/unknown/no-scope; текст+тон (цвет не единственный носитель), технический trace в свёрнутом `<details>`, retry.
- DataTable — горизонтальная прокрутка только внутри таблицы; длинные значения переносятся (`overflow-wrap:anywhere`) и не прячутся в title — полный текст в DOM; меню строки — отдельный `<button role=menuitem>`, не участвует в навигации строки (ссылка — в первой ячейке).
- Legacy resolver (`shared/lib/legacyRoutes.ts`): только реальные UUID (`party_id`/`examination_id`/`report_id`/`user_id`) и только из инвентаря LEGACY_HTML_NAMES; demo-имена (`party_id=usmanov`, `party_id=1`) и отсутствие identity → честное «Запись не указана» без данных; labId берётся из scope-стора (entities/session). Интеграция в AppShell: `*.html`-путь → redirect (replace) на canonical маршрут либо StatusView not-found.

## 3. TDD

RED зафиксирован до реализации: 8 файлов падали («Failed to resolve import», модули отсутствовали). Затем GREEN:

- Vitest: **13 files / 55 passed / 0 failed**, включая обязательные `test_dialog_focus_and_escape` (Dialog.test), `test_row_menu_does_not_navigate` + `test_long_values_keyboard` (DataTable.test), `test_legacy_url_without_identity` (legacyRoutes.test + AppShell.test через MSW).
- Playwright: `npm run test:e2e -- shell.spec.ts` — **5 passed / 0 failed** (~3.3s): те же 4 именованные проверки e2e (диалог/меню/длинные значения — на Storybook iframe; legacy URL — на app с `page.route`-моком /me) + скриншоты шапки/шелла.

## 4. Команды и коды выхода (все Windows PowerShell, Node 26.13.0)

| Команда | Результат |
| --- | --- |
| `npm run typecheck` (TS 7.0.2 strict) | 0 |
| `npm run lint` | 0 (1 pre-existing warning в `shared/api/command.ts` — файл F01, не тронут) |
| `npm run format:check` | 0 |
| `npm run test -- --run` | 55 passed / 0 failed |
| `npm run build` | 0 |
| `npm run build-storybook` | 0 (44 истории F02 + F01 placeholder) |
| `npm run test:e2e -- shell.spec.ts` | 5 passed (chromium, `npx playwright install chromium` — ок) |

## 5. Скриншоты (gitignored `frontend/test-results/`)

`shell-1440.png`, `shell-1024.png`, `shell-768.png`, `shell-390.png` — шапка + рабочая область на реальных ширинах вьюпорта (mok /me через page.route). Истории «Narrow» в Storybook используют width-обёртку 390 (медиа-запросы шапки против вьюпорта проверяются именно в Playwright).

## 6. Решения и ограничения

1. **DESIGN.md отсутствует в репо** (никогда не был в git) — требование ТЗ-02 «прочитать DESIGN.md» не выполнено по этой причине; дизайн-авторитет — UX-CONTRACT.md + README/CSS владельцев. Токены не выдумывались, скопированы из `components/app/tokens.css`.
2. **Логотип 43×43**: бинарник `vse-lab-icon-transparent.png` живёт в корне макетов и не копировался во frontend — в шапке зарезервирован слот `.brand-logo` 43×43 с нейтральной иконкой реестра. Замена на реальный asset — однострочная правка AppHeader.
3. **Переключатель продукции** меняет состояние шапки, но не строит canonical URL стадий — URL стадий появятся с их страницами (A01/E04, UX-CONTRACT: переключение сохраняет этап). Отмечено комментарием в AppShell.
4. **Session banner, а не gate**: при ошибке GET /me AppShell показывает честный network-error баннер над Outlet (не фейковые данные); политику блокировки контента без сеанса определяют страницы (F03+). Из-за этого F01-тест dirty-blocker потребовал обёртки AppProviders — ассерты сохранены.
5. **Story ids латиницей** («F02/Button — Primary»), чтобы id были детерминированными для e2e (toId калечил бы кириллицу до дефисов); русский текст — в args/UI.
6. Vitest exclude дополнен `tests/e2e/**` (иначе vitest подхватывал playwright-спеку).
7. `test:ui` (корневой) и корневой `build-storybook` старой библиотеки не запускались: старая библиотека `components/` не изменялась (только чтение) — условие запуска из brief не наступило.

-

---

# Fix round 1 (по итогам ревью контроллера)

Дата: 2026-11-07 · Коммит: `fix: derive header mode and product switcher state from UserView scope`. Исправлены оба Important-замечания; 8 Minor не тронуты.

## Finding 1 (Important) — режим заголовка из UserView, а не зашитый

- `shared/ui/AppShell.tsx`: режим шапки выводится `headerMode(user, role, hasScopes)` по API-02 семантике: ADMIN → admin (навигация «Управление пользователями»/«Отчёты», без рабочих ссылок и переключателя продукции); ANALYST → analyst; VET/HEAD → work при наличии scopes; пустой scopes или отсутствие пользователя → no-products. Роль и scopes — из реального UserView (GET /me); для инъекций (stories/тесты) добавлены пропсы `role`/`hasScopes`.
- Продуктовый контекст шапки берётся из scope-стора (`productType`); зашитый DEFAULT_PRODUCT="meat" удалён; canonical URL стадий остаются за страницами (ui-mapping).

## Finding 2 (Important) — переключатель продукции оперативный

- `entities/session/context.ts`: в scope-стор добавлен `productType: "meat"|"milk"` + `setProductType` (не персистится; reset возвращает meat). aria-label триггера и подпись автоматически следуют фактическому продукту.
- `features/context/SwitchContext.tsx`: `ScopeUpdate` расширен `productType`; `switchContext` публикует его после штатной семантики F01 — cancelQueries() (stale in-flight ответы предыдущего контекста игнорируются) + удаление чужих scope-ключей.
- `app/router.tsx`: AppShellLayout передаёт `onProductChange={(product) => switchContext(queryClient, { productType: product })}` — переключение реально меняет контекст; заглушка `() => {}` удалена. Переключатель скрыт в no-products/admin/analyst режимах (нет product scope → нет переключателя).
- Ограничение: доступные пользователю типы продукции из /contexts появятся с задачей F03 — пока допустимы оба варианта.

## Новые тесты (через реальные компоненты)

- AppShell.test: «an ADMIN user gets the administration header without working navigation»; «a user without assigned scopes lands in no-products mode»; «a milk-scoped VET defaults to the milk product context»; «switching the product updates the scope store and the trigger label» (клик по опции → useContextStore.productType === "meat" и новый aria-label). `server.resetHandlers()` в beforeEach.
- SwitchContext.test: «switchContext publishes the product type and ignores stale in-flight reads» — вечно висящий prefetch, switchContext(milk) → productType === "milk", отмена in-flight, устаревший ответ не попадает в кеш.
- app-shell.stories: инъекция `role="VET" hasScopes`.

## Команды и результаты (все exit 0)

| Команда | Результат |
| --- | --- |
| `npm run test -- --run` | 13 files / 60 passed / 0 failed (было 55) |
| `npm run typecheck` (TS 7.0.2 strict) | 0 |
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run build` | 0 |
| `npm run build-storybook` | 0 |
| `npm run test:e2e -- shell.spec.ts` | 5 passed / 0 failed (скриншоты 1440/1024/768/390 перегенерированы в frontend/test-results/) |
