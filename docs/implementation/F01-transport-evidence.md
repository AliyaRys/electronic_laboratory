# Evidence: Task F01 — Transport, context и навигация

Дата: 2026-11-06 · Ветка: `feature/F01-transport` (от `feature/03-users`) · Окружение: Windows 11, PowerShell, Node v26.13.0 / npm 12.2.2

Frontend создан с нуля: `frontend/` — React 19.3.1 SPA (SPEC-02/03). Только файлы `frontend/` и этот документ; `.superpowers/`, макеты, `backend/`, `docs/adr` не изменялись.

## 1. Коммиты и файлы

| Коммит | Содержание |
| --- | --- |
| 1. `chore(frontend): scaffold pinned Vite/TS toolchain and OpenAPI codegen` | package.json + package-lock.json (закреплённый стек SPEC-03), tsconfig, vite/vitest, ESLint flat, Prettier, .storybook, playwright.config, scripts/gen-api.mjs, сгенерированный `src/shared/api/schema.d.ts`, .gitignore/.npmrc-замена (см. §4) |
| 2. `feat: add generated API client and scoped SPA routing` | src/shared/api/{client,problem,command,csrf,queryKeys}.ts, src/features/context/{SwitchContext,context}, src/app/{router,providers,context}, src/main.tsx, index.html, src/shared/{ui,lib}, все тесты (17) |
| 3. `docs: add F01 implementation evidence` | этот документ |

Файлы (все новые, `frontend/`):

- Конфигурация: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `index.html`
- App: `src/main.tsx`, `src/app/{router,providers,context}.tsx`
- Shared API: `src/shared/api/{client,problem,command,csrf,queryKeys}.ts`, `src/shared/api/schema.d.ts` (сгенерирован, не редактировался)
- Shared lib/ui: `src/shared/lib/{numbers,dates}.ts`, `src/shared/ui/{AppLayout,PlaceholderPage}.tsx`, `src/shared/ui/placeholder-page.stories.tsx` (PLACEHOLDER — см. §7)
- Features/context: `src/features/context/{SwitchContext.tsx}`
- Тесты: `src/shared/api/client.test.ts`, `src/features/context/SwitchContext.test.tsx`, `src/shared/lib/{numbers,dates}.test.ts`
- Storybook: `.storybook/{main,preview}.ts`; Playwright: `playwright.config.ts` (конфигурация без specs)
- Codegen: `scripts/gen-api.mjs` + npm-скрипт `gen:api`

## 2. Генерация schema.d.ts из работающего backend

Схема взята из реально запущенного backend (не hand-written). Команды (PowerShell):

```powershell
docker run -d --name vse-pg-gen -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vse `
  -p 127.0.0.1:55432:5432 postgres:18.6@sha256:bd5dfa49…478583
docker run -d --name vse-redis-gen -p 127.0.0.1:56379:6379 `
  redis:8.10.3-alpine3.23@sha256:71885d8cc6…1fb80
uv run --frozen alembic -c backend/alembic.ini upgrade head        # -> 0003_user_admin_constraints, exit 0
$env:DATABASE_URL  = "postgresql+asyncpg://postgres:postgres@127.0.0.1:55432/vse"
$env:REDIS_URL     = "redis://127.0.0.1:56379/0"
$env:SECRET_KEY    = "local-dev-secret-key-for-schema-generation-only"
$env:SESSION_COOKIE_SECURE = "false"
uv run --frozen python -m uvicorn backend.src.interfaces.main:app --host 127.0.0.1 --port 8000
# GET http://127.0.0.1:8000/openapi.json -> 200 (приложение отдаёт документ в корне; paths уже содержат /api/v1)
cd frontend; npm run gen:api    # openapi-typescript 7.13.0 -> src/shared/api/schema.d.ts (943 строки, exit 0)
```

Примечания:
- Compose-публикация postgres 5432 занята/запрещена на хосте; БД запущена как отдельный контейнер на 55432 (тот же digest-образ, что в compose).
- `docker compose up postgres` из base+dev упал: контейнер postgres:18.6 перезапускается из-за mount `/var/lib/postgresql/data` (postgres 18 требует mount на `/var/lib/postgresql`) — не менял compose, использовал standalone-контейнер (докладывается владельцу deploy).
- Скрипт `gen:api` принимает `BACKEND_URL` (по умолчанию `http://127.0.0.1:8000/openapi.json`) и перегенерирует файл; CI wiring перегенерации+diff относится к backend CI задачам — здесь реализован только скрипт (см. решение контроллера), workflow не тронут.

## 3. TDD: RED → GREEN

RED: тесты написаны первыми; первый прогон `npm run test` — все 4 файла падают из-за отсутствия поведения (модули `./client`, `./command`, `./SwitchContext`, `./numbers`, `./dates` не существуют; ошибок пропуска нет), exit 1.

GREEN после реализации: **17 passed / 0 failed** (`npm run test`, exit 0).

| Тестовый ID | Файл | Что доказывает |
| --- | --- | --- |
| `test_api_prefix_once` | client.test.ts | запрос `/api/v1/arrivals` доходит ровно один раз с префиксом `/api/v1` (openapi-fetch, baseUrl пустой, ADR-010) |
| `test_mutation_not_auto_retried` | client.test.ts | таймаут мутации → вызов ровно 1, `error.code=NETWORK_ERROR`; ручной `retry()` повторяет с ТЕМ ЖЕ Idempotency-Key (ADR-008) |
| `test_conflict_keeps_input` | client.test.ts | 409 REVISION_CONFLICT → `error.code` показан, введённая причина не очищена |
| `test_stale_context_response_ignored` | SwitchContext.test.tsx | поздний ответ лаборатории А (delay 500ms) не появляется в Б и не остаётся в кеше после switchContext (cancel+remove по scope ключу) |
| `test_logout_clears_cache` | SwitchContext.test.tsx | performLogout: POST /auth/logout → кеш Query пуст, контекст сброшен, CSRF очищен |
| dirty switch cancel | SwitchContext.test.tsx | заблокированная навигация при несохранённом вводе; «Остаться» сохраняет локацию и ввод |
| navigation back re-requests page 2 | SwitchContext.test.tsx | фильтры/страница в URL; возврат назад повторно запрашивает page=2 |
| from>to → 422 | SwitchContext.test.tsx | 422 VALIDATION_ERROR показан со стабильным кодом, URL-фильтры не сбрасываются |
| parseDecimal (17 проверок) | numbers.test.ts | 0/запятая/точка принимаются и нормализуются в строку с точкой; abc/NaN/пустое/отрицательное/экспонента/неполные/лишняя точность отвергаются; пустое ≠ 0 |
| dates (4 проверки) | dates.test.ts | полуоткрытый день Europe/Moscow `[from 00:00, to+1d 00:00)`, форматирование; никаких числовых преобразований ID |

## 4. Доказанная несовместимость закреплённого стека и точечное решение (аналог ADR-014)

SPEC-03 закрепляет **TypeScript 7.0.2** (нативный компилятор) вместе с **openapi-typescript 7.13.0** (peer `typescript@^5.x`) и ESLint/typescript-eslint 8.72.1 (peer `typescript@<6.1.0`). Диагностика:

```
node -e "import('typescript').then(m=>console.log(Object.keys(m.default)))"
  -> ['version','versionMajorMinor']   // JS API компилятора (ts.factory) в TS 7 отсутствует
npm run gen:api -> TypeError: Cannot read properties of undefined (reading 'createKeywordTypeNode')
```

TS 7.0.2 не предоставляет legacy JS API, необходимый openapi-typescript и typescript-eslint. Решение (без смены закреплённого компилятора):

- `typescript@5.9.3` — корневой devDependency, среда runtime для инструментов, которым нужен legacy API (генератор типов, ESLint-парсер, storybook docgen, peer msw `>=5.9.x`);
- `typescript7: npm:typescript@7.0.2` — **закреплённый компилятор проекта**; все проверки типов (`typecheck`, `build`) выполняются им: `node node_modules/typescript7/bin/tsc --noEmit` (`tsc --version` → `7.0.2`).

Версии из SPEC-03 не изменены; конфликт peer у openapi-typescript снят корректным резолвом (без `--legacy-peer-deps`; инсталляция и `npm ci` — exit 0).

## 5. Команды SPEC-06 и результаты (Windows, `frontend/`)

| Команда | Exit | Результат |
| --- | --- | --- |
| `npm.cmd ci` | 0 | воспроизводимая установка из package-lock.json; `allowScripts: esbuild@0.28.2` зафиксирован в package.json (npm 12 блокирует install-скрипты) |
| `npm.cmd run lint` | 0 | ESLint flat (js + typescript-eslint recommended + react-hooks) |
| `npm.cmd run format:check` | 0 | Prettier |
| `npm.cmd run typecheck` | 0 | `typescript7` (7.0.2), strict + exactOptionalPropertyTypes |
| `npm.cmd run test` | 0 | Vitest 5.1.0, jsdom + MSW 3.0.4 + RTL 16.3.3: 17 passed |
| `npm.cmd run build` | 0 | Vite 8.3.6 production build (dist/, 350 kB → 110 kB gzip) |
| `npm.cmd run build-storybook` | 0 | Storybook 10.6.6, @storybook/react-vite |
| `npm.cmd run test:e2e` | not-run | Playwright 1.65.0 настроен (`playwright.config.ts`); specs приходят в F02/F03 по плану. Инфраструктура проверена: webServer поднимает dev-сервер (порт 4173), ответ Playwright — `No tests found` (по плану) |
| `npm.cmd run gen:api` | 0 | перегенерация schema.d.ts (см. §2) |

## 6. Реализация по контроллерным решениям

- `apiClient` — openapi-fetch 0.17.0, `baseUrl: ""` (same-origin; в тестах — `http://localhost`, т.к. undici не принимает относительный URL; прод-сборка оставляет ""). Middleware: `x-csrf-token` на мутациях из `shared/api/csrf.ts` (память + fallback cookie `vse_csrf`, путь `/api/v1`); `onResponse` рассылает `vse:session-expired` при 401 → providers очищают кеш/формы (`clearQueryCache`). Никакого ручного `fetch` в страницах.
- `shared/api/problem.ts` — разбор `application/problem+json` (API-01) + `problemFromParsed` для уже разобранного openapi-fetch `error` (тело ответа нельзя читать дважды).
- `shared/api/command.ts` `useCommand()` — submit/retry/abort/reset, статус idle/pending/success/error; Idempotency-Key удерживается до однозначного результата (любой HTTP-ответ = однозначный; сетевая неоднозначность — ключ сохраняется для ручного retry); AbortSignal; опциональный клиентский timeout; авто-retry отсутствует. If-Match передаёт вызывающий код заголовком.
- Query keys `[userId,labId,productId,resource,params]` — `shared/api/queryKeys.ts`; forms в компонентном состоянии/RHF, в Zustand — только контекст и dirty-флаг; persist для медицинских форм/JWT отключён (нет persist вообще).
- Context: `features/context/SwitchContext.tsx` — `switchContext` (cancel+remove неродных ключей), `performLogout`/`clearQueryCache`, `useDirtyGuard`+`DirtyLeaveDialog` (router useBlocker, диалог с безопасным «Остаться»).
- Router: `src/app/router.tsx` — все маршруты UI-01 (`/login`, `/password-help`, `/profile`, `/users*`, `/catalogs*`, `/labs/:labId/{arrivals,examinations,reports…}`), history routing (createBrowserRouter), catch-all «Запись не найдена». Deep-link/refresh — nginx fallback на deploy-стороне (deploy/nginx.conf уже проксирует `/api/` и отдаёт index.html), здесь ничего запекать не требуется; dev-proxy `/api` → `127.0.0.1:8000`.
- Storybook: конфигурация рабочая; единственная история `F01/Заглушка навигации` помечена `tags: ["placeholder"]` с комментарием — удаляется при появлении первых модульных stories в F02.
- Playwright: конфигурация есть, specs не созданы (решение: минимальный конфиг, e2e в F02/F03).

## 7. Ограничения и замечания для ревью

1. **TS 7.0.2 / legacy JS API** (§4) — редкое, документированное отклонение: инструменты, требующие компиляторного API, работают на копии 5.9.3; все проверки типов проекта — на закреплённом 7.0.2. Просьба подтвердить это решение на ревью платформы.
2. **DESIGN.md отсутствует** в корне репозитория (упомянут в UX-CONTRACT/UI-02 и в задании как обязательное чтение). Прочитаны UX-CONTRACT.md и STORYBOOK.md; токены не потреблялись — F01 не создаёт UI-компонентов оформления.
3. Схема сгенерирована только для текущего identity-поверхности backend (I02/I03); маршруты arrivals/examinations появятся в схеме с backend-задачами — `gen:api` перегенерирует без правок клиента. Типизированные вызовы в тестах используют untyped-cast для ещё не существующих эндпоинтов.
4. `docker-compose.yml` postgres:18.6 не стартует с текущим volume-mount (§2) — не мой файл, требуется отдельная правка владельцем (mount `/var/lib/postgresql`).
5. Покрытие (≥80%) не собиралось: `@vitest/coverage-v8` не входит в закреплённый перечень и относится к CI-настройке; критические сценарии покрыты поведенческими тестами §3.
6. В `useDirtyGuard` dirty-флаг синхронизируется в store; диалог блокирует навигацию по pathname/search — экранные формы F02 помечают dirty и подписывают `vse:logout` для очистки закрытых форм.
