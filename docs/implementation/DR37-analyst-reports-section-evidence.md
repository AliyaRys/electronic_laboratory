# DR37 «Раздел «Отчёты» и контекстная навигация» — evidence

Ветка `codex/analyst-reports-section` (base `main` @ 93c1d53). Все проверки выполнены в worktree `C:\electronic_lab_dev-dr37`.

## 1. Команды и результаты

Node PATH: `C:\Users\Алия\AppData\Local\Temp\opencode\node26\node-v26.13.0-win-x64` (перед каждой командой `$env:Path = ...;$env:Path`).

| Команда (cwd `frontend`) | Результат |
|---|---|
| `npm.cmd ci` | 410 пакетов, ok |
| `npm.cmd test -- AppShell.test.tsx AppHeader.test.tsx ReportsPage.test.tsx` (до реализации, Task 1) | **RED: 18 failed / 19 passed (37)** — failing-фикстура ожидаемого поведения DR37 |
| `npm.cmd test -- AppShell.test.tsx AppHeader.test.tsx` (после Task 2) | 26 passed |
| `npm.cmd test -- ReportsPage.test.tsx reportCapabilities.test.ts` (после Task 3) | 16 passed |
| `npm.cmd test` (полный suite после Task 3 и после Task 4) | **62 файла, 459 тестов — все passed** |
| `npm.cmd run typecheck` | 0 ошибок |
| `npm.cmd run lint` | 0 errors, 1 pre-existing warning (`use-catalog-context.ts` useMemo deps, вне задачи) |
| `npm.cmd run build` | ok (`tsc --noEmit` + vite build) |
| `npm.cmd run build-storybook` | ok (после добавления хаб-историй) |
| `npm.cmd run test:e2e -- reports.spec.ts` | **13 passed** (в т.ч. 4 новых DR37-сценария) |
| `npm.cmd run test:e2e -- samples.spec.ts` | **4 passed** (после обновления /me-фикстур capability) |
| Real-API walkthrough (tmp-скрипт, не коммитится) | см. §3 |

## 2. Коммиты

1. `test: cover contextual report navigation and role matrix` — failing-тесты контекстной навигации и ролевой матрицы (Task 1, RED зафиксирован).
2. `fix: keep report navigation in selected laboratory` — AppHeader/AppShell: contextLabId, active state, пункты по capability, README React-порта (Task 2).
3. `fix: expose only permitted reporting tools` — reportCapabilities, capability-гейты хаба и вложенных экранов, удаление `REPORT_ROLES` (Task 3).
4. `feat: match analyst reports hub design` — ReportHubItem, геометрия `analyst-reports.html`, stories, build-storybook (Task 4).
5. `test: verify analyst reporting journey` — e2e + evidence (Task 5).

ТЗ `dorabotka/2026-11-16-analyst-reports-section.md` включено в коммиты задачи (см. финальный коммит ветки).

## 3. Real-API walkthrough (реальный backend через nginx :8080, SPA ветки через vite proxy :4174)

Выполнено против рабочего локального развёртывания (`docker ps`: `electronic_lab_dev-backend-1`, `…frontend-1` на `127.0.0.1:8080`, БД `…postgres-1`). Скрипт `tmp/dr37-walkthrough.cjs` (Playwright, chromium) — **в git не включён** (tmp/).

Состояние БД развёртывания: пользователи `local-admin` (ADMIN), `analyst` (ANALYST), `arysaeva` (HEAD), `dr5-browser-check` (VET); лаборатория `2812e437-facc-432f-9242-5162c9d9f49f` «Агропромышленный парк».

Внимание контроллеру: в ходе walkthrough пароли демо-пользователей `analyst` и `dr5-browser-check` были сброшены администратором (через UI «Сброс пароля», сеансы отозваны) на (ротированный тестовый пароль), переданный в отчёте задачи отдельно. Пароль `local-admin` не менялся (хранится в локальном не-коммитном файле `.env.initial-admin.txt` инсталляции, в Git не попадает). При необходимости контроллер может снова сменить эти пароли через тот же UI-флоу.

### ADMIN
- Шапка: пункта «Отчёты» нет (`adminHasReportsItem: false`).
- Прямой URL `/labs/2812e437…/reports`: «Раздел отчётов недоступен: у вас нет отчётных полномочий.»; запросов отчётов/проб не было (unit-тест дополнительно фиксирует отсутствие GET).
- Скриншот: `test-results/dr37-admin-direct-url.png`.

### ANALYST (`analyst`)
- Вход → `/labs` → выбор лаборатории → `/labs/2812e437…/arrivals?queue=expected`.
- Шапка `#analyst-reports-link` → `/labs/2812e437…/reports`; на хабе `aria-current="page"`.
- Хаб: заголовок «Отчёты», подзаголовок, человекочитаемое имя «Агропромышленный парк» (не UUID), кнопка «Создать отчёт», три направления (5-вет, Операционные показатели, Учёт проб).
- `Открыть` → `/…/reports/operational` и `/…/reports/samples`; возврат назад сохраняет лабораторию.
- F5 на `/…/reports`: лаборатория и активный пункт сохраняются.
- Чужой labId (`00000000…`) прямым URL: сервер отвечает 403 `ACCESS_DENIED`; список/метрики не отрисовываются, карточка честно показывает «Список сохранённых отчётов недоступен.» — утечки данных нет.
- 390px: горизонтальной прокрутки страницы нет (`horizontalScroll390: false`); скриншоты 1440/1024/768/390: `dr37-analyst-hub-{1440,1024,768,390}.png`, `dr37-analyst-{operational,samples}.png`.
- Console: одна ожидаемая запись 403 (честный отказ сервера по чужому labId), иных ошибок нет.

### VET (`dr5-browser-check`, sample:read)
- Вход → сразу `/labs/2812e437…/arrivals?queue=expected`; шапка «Отчёты» → `/…/reports`.
- Хаб: только «Учёт проб»; нет карточек 5-вет/операционных показателей и кнопки «Создать отчёт».
- Прямой URL сохранённого отчёта: «Просмотр отчёта недоступен: у вас нет полномочия чтения отчётов.»; GET снимка не выполняется.
- Console ошибок нет. Скриншот: `dr37-vet-hub.png`.

### HEAD
Реальный вход HEAD (`arysaeva`) не выполнялся: пароль демо-пользователя неизвестен, а ротация второго пользователя не требовалась — поведение HEAD/ANALYST покрыто одинаковыми capability в unit- (модель `reportAccess`) и e2e-тестах (MSW-матрица). Честная пометка: браузерный walkthrough выполнен для ADMIN/ANALYST/VET; HEAD не запускался.

## 4. Прочее

- «Не выполнено»: нет. Все шаги Task 1–5 выполнены; Task 6 ограничена коммитом ТЗ/evidence и проверкой отсутствия секретов (merge/push/контейнеры — контроллер).
- Пароли в Git не попадают: `tmp/` игнорируется; сценарий walkthrough (tmp/dr37-walkthrough.cjs) и пароль администратора живут в локальных не-коммитных файлах (`tmp/`, `.env.*`). Пароль пары walkthrough-пользователей — (ротированный тестовый пароль), одноразовое значение локальной dev-инсталляции, изменённое официальным UI-флоу reset-password; контроллер может сменить его при необходимости.
- Один ранее существовавший lint-warning (`use-catalog-context.ts:340`) не относится к задаче и не менялся.

## 5. Fix-loop (ревью DR37)

Исправлены два Important-замечания (коммит `fix: honest five-vet meta without list access and redacted walkthrough password`):

1. **False-empty в карточке 5-вет** (`frontend/src/pages/ReportsPage.tsx`): при `access.list5vet === false` (read5vet=true) meta показывала «Сохранённых отчётов пока нет.», хотя список не запрашивался. Теперь `fiveVetMeta` вычисляется только при реальном доступе к списку; при `list5vet=false` карточка показывает нейтральный «Список сохранённых отчётов недоступен.».
   - Новый unit-тест: «without report:5vet-list the 5-вет card never claims «пока нет» (false-empty fix)» — фиксирует отсутствие ложного empty-текста, нейтральный текст и ноль запросов списка.
2. **Литерал walkthrough-пароля** в evidence (строки секций «Внимание контроллеру» и «Прочее») заменён на «(ротированный тестовый пароль)».

Проверка: поиск литерала walkthrough-пароля по tracked-файлам worktree — совпадений нет (после этого коммита литерал остаётся только в истории Git до вычистки контроллером; ожидаемо).

Gates (foreground, cwd `frontend`): `npm.cmd test -- ReportsPage.test.tsx` → 12 passed; `npm.cmd run typecheck` → 0 ошибок; `npm.cmd run lint` → 0 errors / 1 предсуществующий warning; `npm.cmd run build` → ok.
