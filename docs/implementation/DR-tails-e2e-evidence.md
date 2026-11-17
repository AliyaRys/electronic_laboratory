# TAILS-E — e2e выровнены под актуальный UI (комплект тестов Playwright)

Дата: 2026-11-17 · Worktree: `codex/tails-e2e` · Бриф: `.superpowers/sdd/2026-11-17-fixes/task-TAILS-E-brief.md`

## Что сделано

Существующие e2e-тесты Playwright приведены к актуальному продукту: тексты, маршруты,
моки и ассерты выверены по реальным экранам; ассерты не ослаблялись. Данные владельца
не изменялись, операций записи в ВетИС нет; живой стек на 8080 не тронут.

## Изолированный стенд (почему не живая БД)

`seed_identity.py` destructive-очищает таблицы идентификации, поэтому вместо БД владельца
поднят отдельный стенд:

- docker `tails-e2e-pg` (postgres 18.6, `127.0.0.1:55440`, db `vse`) и `tails-e2e-redis`
  (`127.0.0.1:56390`, запущен с `--tcp-keepalive 30 --timeout 0` — без этого простаивающие
  соединения обрывались и логин падал 503 «Хранилище ограничения входа недоступно»);
- применены миграции alembic, затем
  `VSE_E2E_DESTRUCTIVE_SEED=TRUNCATE_ISOLATED_E2E_DATABASE uv run --frozen python frontend/tests/e2e/seed_identity.py`
  → `frontend/tests/e2e/identity-seed.local.json` (gitignored);
- бэкенд: `uv run --frozen python -m uvicorn backend.src.interfaces.main:app --host 127.0.0.1 --port 8001`
  с `DATABASE_URL`, `REDIS_URL`, `SESSION_COOKIE_SECURE=false`, `ENVIRONMENT=development`
  (порт 8000 занят локальным бэкендом владельца, PID 26756).

## Запуск

```
PATH=<node26>  VITE_API_PROXY_TARGET=http://127.0.0.1:8001
node node_modules/@playwright/test/cli.js test tests/e2e/<specs> --workers=2
```

(`npm run test:e2e` не запускается в этом окружении; `npx playwright` подхватывает другой
глобальный пакет.) Финальный прогон, 2026-11-17, все спеки кроме `dr5-real-browser.spec.ts`:

```
96 passed (1.1m)   # EXIT=0
```

## Исправления в тестах

- `examinations.spec.ts` — создание теперь идёт через `GET /examinations/parties/{id}/form`
  (DR35) + `POST pricing-preview`: добавлены `formView`/`mockForm()`/`mockPricingPreview()`,
  иначе немокированные вызовы уходили в бэкенд, теряли сессию и страница падала на логин;
  DR35 §11.2: создание всегда с НОВЫМ семплированием (REUSE не существует), payload
  `sample: { mode: "NEW", collectedOn, massKg: "0.8" }`; страницы просмотра («Просмотр записи»,
  «ВСЭ № …»); журнал — `GET /api/v1/examinations?…`, h1 «Журнал ВСЭ мяса и мясопродуктов»,
  COMPLETED по умолчанию; outcome/direction — кастомный `SelectDropdown` (клик по триггеру →
  `role=option`); FIT автоматически задаёт SALE.
- `users-create.spec.ts` — `getByLabel("Пароль *"/"Роль *", { exact: true })`; helper `login()`
  ждёт `waitForURL(/\/(labs|users)/)`; закрытие dirty-guard («Несохранённый ввод» →
  «Покинуть без сохранения»); уникальные ФИО/логины на каждый прогон; после сохранения
  строка ищется через поиск списка §5 (returnTo несёт `?role=HEAD`, и фильтр теперь реально
  работает); «Подменная лаборатория» — Origin исправлен на `http://localhost:4173`, добавлен
  ассерт `code ≠ CSRF_REJECTED`, чтобы отказ приходил именно от проверки делегирования;
  `test_same_intent_key_never_duplicates` теперь перехватывает РЕАЛЬНЫЙ POST формы
  (payload + клиентский Idempotency-Key) и повторяет его: ожидание — replay 201 с тем же
  `id`, дублирующей строки нет.
- `arrivals.spec.ts` — в таблице приёмок показывается `evsd_uuid` (1f0e6d2a-…), а не номер
  RU016; строгий режим фильтра ACCEPTED (`getByText(/06\.11\.2026/).first()`).
- `vetis-read.spec.ts` — `/Обновление из ВетИС недоступно: интеграция не настроена/`.
- `reports.spec.ts` — `mockOperational()` (`GET /api/v1/reports/operational*` +
  `GET /api/v1/contexts/laboratories*`) в обоих тестах списка отчётов.
- `reconciliation-storybook.spec.ts` — «Результаты сверки» вместо «Решение о приёмке».
- `identity.spec.ts` — перед поиском «Заблокирован Е2Е»/«Связанный Е2Е» применяется
  серверный поиск списка (персистентная E2E-БД накапливает пользователей, посевные уходят
  за страницу 1).

## Попутное исправление продукта (1 строка, подтверждено e2e)

`frontend/src/features/identity/api.ts`, `fetchUsers`: параметры передавались плоско
(`params: query`), а openapi-fetch ждёт `params: { query }` — фильтры `q/role/status/page`
списка пользователей молча игнорировались (подтверждено отладочным прогоном: запрос
уходил без query-string, список не фильтровался и не листался). Исправлено на
`params: { query }`; это же позволило identity-тестам честно находить посевные строки.

## Гейты (foreground, 2026-11-17)

```
npm.cmd --prefix frontend run typecheck  → 0
npm.cmd --prefix frontend run lint       → 0
npm.cmd --prefix frontend run build      → 0 (предупреждение >500 kB chunk — прежнее)
```

## Not-run (честно)

- `dr5-real-browser.spec.ts` — не запускался: требует gitignored
  `frontend/tests/e2e/dr5-real-browser.local.json` (реальный импортированный eVSD fixture),
  которого в этом окружении нет. Проверка Playwright возвращает не 404, а честную ошибку
  чтения файла — имитировать пропуск не стали.
- Catwalk/визуальные сравнения против утверждённых макетов — в рамках этого прогона
  не переснимались; скриншот-бинарники в `docs/implementation/evidence/` восстановлены
  (`git checkout`), в коммит попадут оригиналы.

## Гигиена

Временные `_debug*.spec.ts`, логи `tmp-tails-*.log`/`tmp-users-*.log` удалены/не коммитятся;
стенд (`tails-e2e-pg`, `tails-e2e-redis`, фоновый бэкенд на 8001) остаётся только локальным
окружением этого прогона и не входит в коммит.
