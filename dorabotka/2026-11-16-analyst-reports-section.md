# Раздел «Отчёты» и контекстная навигация Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать раздел «Отчёты» рабочим для аналитика в контексте выбранной лаборатории, привести главную страницу раздела к макету `analyst_makets/analyst-reports.html` и восстановить согласованную ролевую доступность отчётов без изменения уже реализованных алгоритмов расчёта.

**Architecture:** Канонические маршруты отчётов остаются лабораторно-контекстными (`/labs/:labId/reports...`). `AppShell` формирует ссылки шапки из текущего маршрута и фактических capability пользователя, а не из небезопасных fallback-ссылок. Главная страница отчётов является capability-driven hub: она показывает только разрешённые направления и использует существующие страницы/API операционных показателей, учёта проб и 5-вет. Сервер остаётся окончательным источником авторизации.

**Tech Stack:** React 19, TypeScript, React Router, TanStack Query, Vitest/Testing Library/MSW, Storybook, Playwright, существующие FastAPI API-06/API-08, Docker Compose.

**Spec:** FT-RPT-01–09, FT-ACC-01–04; O-05; PDR-003/016/017; SC-071–088; `docs/TZ_development/plans/2026-11-06-08-reporting.md` (R01–R03); `docs/TZ_development/plans/permissions.md`; `docs/TZ_development/plans/ui-mapping.md`; эталон `analyst_makets/analyst-reports.html`.

## 1. Проблема и подтверждённая причина

Пользователь с ролью `ANALYST` видит в шапке пункт «Отчёты», но переход ведёт на `/labs`, после чего пользователь оказывается в сценарии выбора лаборатории/поступлений, а не в отчётах выбранной лаборатории.

Причина уже локализована в текущем коде:

- `frontend/src/shared/ui/AppShell.tsx` строит `headerLinks` только при `mode === "work"`;
- для аналитика `headerMode(...)` возвращает `analyst`, поэтому объект ссылок остаётся пустым;
- `frontend/src/shared/ui/AppHeader.tsx` подставляет для пустого `links.reports` fallback `/labs`;
- текущий `workingLabId` намеренно вычисляется только для `VET`/`HEAD`, поэтому `labId` из маршрута аналитика не используется в шапке;
- активный пункт шапки сейчас определяется только для `/catalogs`, поэтому даже прямой отчётный маршрут не отмечает «Отчёты» активным.

Одновременно выявлены связанные расхождения ролевой навигации:

- `ADMIN` сейчас получает в шапке пункт «Отчёты», хотя FT-RPT-01 и матрица полномочий полностью запрещают администратору отчёты;
- `HEAD` не получает пункт «Отчёты», хотя должен видеть весь раздел своей лаборатории;
- `VET` не получает пункт «Отчёты», хотя по более позднему O-05/FT-RPT-01 должен видеть внутри него только «Учёт проб»;
- `ReportsPage` безусловно запрещает `VET`, поэтому не может служить безопасной точкой входа в доступный ему учёт проб;
- макет аналитика содержит две карточки, но актуальные ФТ требуют также операционные показатели.

## 2. Источники истины и разрешение расхождений

Перед изменениями полностью прочитать:

- `AGENTS.md`;
- `DESIGN.md`;
- `UX-CONTRACT.md`;
- `STORYBOOK.md`;
- `components/shell/README.md`;
- `docs/TZ_development/plans/specification.md`;
- `docs/TZ_development/plans/ui-mapping.md`;
- `docs/TZ_development/plans/permissions.md`;
- `docs/TZ_development/plans/api-contract.md`, API-06/API-08;
- `docs/TZ_development/plans/2026-11-06-05-samples.md`, S03;
- `docs/TZ_development/plans/2026-11-06-08-reporting.md`, R01–R03;
- `Функциональные требования/v2.0/01-access-and-users.md`;
- `Функциональные требования/v2.0/09-reports.md`;
- `product-design-records/v1.9/02-product-design-records.md`, PDR-003/016/017;
- `product-design-records/v1.9/03-interview-and-validation.md`, SC-071–088;
- `analyst_makets/analyst-reports.html` и `analyst_makets/analyst.css`;
- текущие `ReportsPage`, `OperationalReportPage`, `SampleAccountingPage`, report components/stories и общий `AppHeader`.

Приоритет решений:

1. Актуальные owner decisions и ФТ v2.0.
2. Серверная матрица прав и лабораторная область.
3. TZ_development/API-контракты.
4. Макет как эталон композиции и внешнего вида.
5. Старые формулировки product foundation.

Зафиксированные разрешения:

- более поздний O-05/FT-RPT-01 приоритетнее старой строки PDR-003: ветеринарный врач видит раздел «Отчёты», но только карточку «Учёт проб»;
- аналитик и заведующий видят «Операционные показатели», «Форма 5-вет (раздел III)» и «Учёт проб»;
- отсутствующая в старом макете карточка «Операционные показатели» добавляется в том же визуальном языке;
- администратор не видит пункт «Отчёты» и получает 403/экран запрета при прямом URL;
- макеты не дают права подменять реальные данные статическими строками вроде «I полугодие 2026 · Республика Татарстан».

## 3. Матрица ожидаемого поведения

| Роль/capability | Пункт в шапке | Главная `/labs/:labId/reports` | Разрешённые направления |
|---|---|---|---|
| `VET`, `sample:read` | Да | Да | Только «Учёт проб» |
| `HEAD`, `sample:read` + report capabilities | Да | Да | Учёт проб, операционные показатели, 5-вет своей лаборатории |
| `ANALYST`, `sample:read` + report capabilities | Да после выбора лаборатории | Да | Учёт проб, операционные показатели, 5-вет выбранной лаборатории |
| `ADMIN` | Нет | Нет | Ничего; прямой URL запрещён |
| Любая роль без нужного capability | Только если существует хотя бы одно доступное отчётное направление | Только разрешённые карточки | Нельзя получить функцию только по названию роли |

Capability определяет показ действия, роль и область остаются дополнительными серверными ограничениями. Скрытая кнопка не заменяет backend-проверку.

## 4. Границы задачи

### Входит

- исправление contextual links и active state шапки;
- корректная навигация аналитика в пределах выбранной лаборатории;
- capability-driven главная страница отчётов;
- визуальное соответствие `analyst-reports.html`;
- доступ ветврача только к учёту проб;
- доступ заведующего и аналитика к уже реализованным трём направлениям;
- запрет пункта и экрана для администратора;
- сохранение текущего списка, создания, просмотра, удаления и экспорта 5-вет;
- loading/empty/error/forbidden/long/narrow states;
- unit, Storybook и e2e-проверки;
- merge ветки вместе с этим ТЗ в `main` и обновление контейнеров.

### Не входит

- изменение формул операционного отчёта или 5-вет;
- изменение правил учёта/утилизации проб;
- создание новых backend report endpoints, если текущие API-06/API-08 отвечают контракту;
- объединённый отчёт сразу по всем лабораториям Татарстана;
- формирование 1-вет;
- ручное редактирование рассчитанных ячеек 5-вет;
- демонстрационные данные вместо API;
- отдельная копия страниц специально для аналитика;
- изменение React-фреймворка, локальная копия шапки или SVG.

## 5. Целевой пользовательский сценарий

1. Аналитик открывает `/labs` и выбирает одну доступную лабораторию.
2. На любом canonical route этой лаборатории пункт «Отчёты» ведёт строго на `/labs/<выбранный-labId>/reports`.
3. На странице отчётов активен пункт «Отчёты» в общей шапке.
4. Пользователь видит человекочитаемый заголовок и три доступных направления:
   - `Форма 5-вет (раздел III)`;
   - `Операционные показатели`;
   - `Учёт проб`.
5. «Создать отчёт» открывает `/labs/:labId/reports/new`; кнопка существует только при `report:5vet-preview` и `report:5vet-save`.
6. «Открыть» у операционных показателей ведёт на `/labs/:labId/reports/operational`.
7. «Открыть» у учёта проб ведёт на `/labs/:labId/reports/samples`.
8. Сохранённые 5-вет открываются по `/labs/:labId/reports/:reportId`; список остаётся постраничным и не теряет query-параметры.
9. Возврат со вложенных страниц ведёт в отчёты той же лаборатории.
10. Смена лаборатории выполняется через существующий разрешённый сценарий выбора контекста; данные нескольких лабораторий не смешиваются.

## 6. Внешний вид главной страницы

Использовать `analyst_makets/analyst-reports.html` как эталон, но собирать страницу из существующих React/shared компонентов.

Обязательная композиция:

- рабочая область шириной до `1180px`, с адаптивными боковыми отступами макета;
- заголовочная строка: слева `Отчёты` и пояснение `Формирование регламентированной отчётности по доступным лабораториям`, справа основная кнопка `Создать отчёт`;
- кнопка скрывается, а не disabled, если capability создания отсутствует;
- белая карточка с границей, радиусом и лёгкой тенью как у `.analyst-card`;
- элементы отчётов в виде строк-карточек как `.analyst-item`: название, краткое описание/реальные метаданные и кнопка `Открыть`;
- текст не содержит технических UUID, если доступно человекочитаемое название лаборатории;
- сохранённый 5-вет показывает реальные период, лабораторию, число источников и время формирования согласно FT-RPT-07;
- при отсутствии сохранённых 5-вет выводится спокойное пустое состояние, но карточки операционного отчёта и учёта проб остаются доступны;
- 20 сохранённых строк на страницу и существующая URL-пагинация сохраняются;
- на ширине до 720px заголовок/действие и строки карточек складываются вертикально;
- на 390px нет горизонтальной прокрутки всей страницы; прокрутка допустима только внутри действительно широкой таблицы;
- видимый `focus-visible`, клавиатурные ссылки и кнопки, `aria-current="page"`, русские доступные имена;
- длинные названия лаборатории и ФИО не ломают сетку и доступны полностью без обязательного hover.

Не переносить в SPA:

- inline-скрипт макета;
- статического пользователя «Марат Хусаинов»;
- `href="#"`;
- локальную шапку;
- CSS-классы макета как вторую независимую дизайн-систему;
- SVG, отсутствующие в общем реестре.

## 7. Состояния и ошибки

- `loading`: skeleton/status без ложного текста «отчётов нет»;
- `empty`: нет сохранённых 5-вет, но разрешённые направления видны;
- `no scope`: лаборатория не выбрана — объяснение и ссылка `Выбрать лабораторию`, без запроса данных произвольной лаборатории;
- `forbidden`: прямой URL без capability — общий экран запрета, без утечки отчётных данных;
- `not found`: удалённый в другой вкладке snapshot — честное «Не найден»;
- `network error`: повтор запроса, сохранение `labId`, страницы и фильтров;
- отзыв доступа: следующий запрос закрывает данные и очищает относящийся к ним query cache;
- пользователь без `report:5vet-list` не инициирует GET списка 5-вет;
- пользователь без `report:operational` не инициирует GET операционных показателей;
- `ADMIN` не инициирует ни один рабочий report/sample запрос.

## 8. План реализации

### Task 1: Зафиксировать регрессии маршрутизации и доступа тестами

**Files:** изменить `frontend/src/shared/ui/AppShell.test.tsx`, `frontend/src/shared/ui/AppHeader.test.tsx`, `frontend/src/pages/ReportsPage.test.tsx`; при необходимости создать fixtures в существующей тестовой папке, не в production-коде.

**Interfaces:** `headerMode(user, role, hasScopes)`; contextual `HeaderLinks`; capability predicates для `sample:read`, `report:operational`, `report:5vet-*`.

- [ ] Написать failing tests: у `ANALYST` на `/labs/<LAB>/arrivals` ссылка «Отчёты» равна `/labs/<LAB>/reports`, на `/labs/<LAB>/reports` имеет `aria-current="page"`; переход не ведёт на `/labs` и не подменяет лабораторию.
- [ ] Добавить матричные failing tests: `VET+sample:read` видит «Отчёты»; `HEAD` видит; `ANALYST` видит; `ADMIN` не видит; отсутствие всех отчётных capability скрывает пункт.
- [ ] Добавить tests главной страницы: VET видит только «Учёт проб» и не вызывает список 5-вет; HEAD/ANALYST видят три направления; ADMIN получает forbidden и не вызывает report/sample API.
- [ ] Запустить `npm.cmd --prefix frontend test -- AppShell.test.tsx AppHeader.test.tsx ReportsPage.test.tsx` и сохранить ожидаемый RED в отчёте реализации.
- [ ] Зафиксировать тестовый коммит: `test: cover contextual report navigation and role matrix`.

### Task 2: Исправить контекстные ссылки и active state общей шапки

**Files:** изменить `frontend/src/shared/ui/AppShell.tsx`, `frontend/src/shared/ui/AppHeader.tsx`, `frontend/src/shared/ui/AppShell.test.tsx`, `frontend/src/shared/ui/AppHeader.test.tsx`; при изменении публичного API обновить `frontend/src/shared/ui/app-header.stories.tsx` и соответствующее README владельца.

**Interfaces:** одна функция построения ссылок из `{role, capabilities, routeLabId, assignedLabId}`; `HeaderActive` вычисляется по canonical route; ссылки не являются доказательством доступа.

- [ ] Отделить `contextLabId` от текущего `workingLabId`: для `VET/HEAD` использовать проверенную назначенную лабораторию, для `ANALYST` — `labId` текущего canonical route; на `/labs` не угадывать лабораторию.
- [ ] Строить `reports: /labs/:labId/reports` для аналитика в выбранной лаборатории и для VET/HEAD в собственной; без `labId` вести на честный выбор `/labs`, а не на поступления другой области.
- [ ] Показывать пункт «Отчёты» только если `/me.capabilities` содержит хотя бы `sample:read` или одно разрешение `report:*`; удалить административную fallback-ссылку и пункт отчётов у `ADMIN`.
- [ ] Вычислять active state для `arrivals`, `journal`, `directories`, `reports`, `users`; любой `/labs/:labId/reports...` активирует «Отчёты».
- [ ] Не использовать `href="#"`, не создавать локальную шапку, не доверять `labId` для доступа: каждый backend запрос продолжает серверную проверку области.
- [ ] Обновить stories шапки состояниями Analyst-selected-lab, Analyst-no-lab, VET-samples-only, HEAD-all-reports, ADMIN-without-reports и narrow.
- [ ] Запустить адресные unit tests до GREEN и зафиксировать: `fix: keep report navigation in selected laboratory`.

### Task 3: Сделать главную отчётов capability-driven

**Files:** изменить `frontend/src/pages/ReportsPage.tsx`, `frontend/src/pages/ReportsPage.test.tsx`, `frontend/src/features/reports/api.ts`; при необходимости создать `frontend/src/features/reports/reportCapabilities.ts` и `reportCapabilities.test.ts`.

**Interfaces:** единый typed predicate `reportAccess(capabilities)` возвращает как минимум `{samples, operational, list5vet, create5vet}`; `create5vet` требует одновременно preview и save; роль сама по себе не открывает действие.

- [ ] Удалить page-level модель `REPORT_ROLES` как единственный источник UI-доступа; использовать capability из `/me`, сохранив серверную роль/область как окончательную защиту.
- [ ] Разрешить VET открыть hub только с карточкой «Учёт проб»; не загружать 5-вет list query при отсутствии `report:5vet-list`.
- [ ] Для HEAD/ANALYST показать карточки «Операционные показатели» и «Учёт проб», а 5-вет — только при соответствующих capability.
- [ ] Показывать «Создать отчёт» только при preview+save; просмотр/экспорт/удаление внутри существующих экранов также не должны появляться без своих capability.
- [ ] Сохранить существующие API, signed preview, pagination, immutable snapshot и обработку ошибок; не пересчитывать сохранённые отчёты.
- [ ] Проверить прямые URL всех вложенных страниц: каждый экран имеет собственный capability guard и не полагается на скрытую карточку hub.
- [ ] Запустить `npm.cmd --prefix frontend test -- ReportsPage.test.tsx ReportCreatePage.test.tsx ReportViewPage.test.tsx OperationalReportPage.test.tsx SampleAccountingPage.test.tsx` и зафиксировать: `fix: expose only permitted reporting tools`.

### Task 4: Привести страницу к макету аналитика без копирования runtime

**Files:** изменить `frontend/src/pages/ReportsPage.tsx`, `frontend/src/features/reports/reports.css`, `frontend/src/features/reports/reports.stories.tsx`; при оправданном переиспользовании создать `frontend/src/features/reports/ReportHubItem.tsx` и тест рядом.

**Interfaces:** `ReportHubItem{name, meta, to, actionLabel}`; только реальные `Link`/`Button`, без кликабельного контейнера, который дублирует вложенную кнопку.

- [ ] Реализовать title row, ширину, карточку, list item и responsive geometry по `analyst-reports.html`/`analyst.css`, используя существующие tokens/Button/AppShell.
- [ ] Добавить три направления с понятными описаниями; не показывать статический период или регион как будто это реальные данные.
- [ ] Сохранённые отчёты представить в согласованном списке с реальными метаданными FT-RPT-07 и отдельной keyboard-accessible ссылкой «Открыть».
- [ ] Получать человекочитаемое название выбранной лаборатории из уже доступного scoped context endpoint/read model; UUID не делать основным видимым названием и не расширять область API.
- [ ] Добавить Storybook: analyst normal, HEAD normal, VET samples-only, empty 5-вет, loading, network error, long laboratory/user data, 390px narrow.
- [ ] Запустить `npm.cmd --prefix frontend run build-storybook` и visual check на 1440/1024/768/390; зафиксировать: `feat: match analyst reports hub design`.

### Task 5: Сквозная проверка реальных маршрутов

**Files:** изменить `frontend/tests/e2e/reports.spec.ts`, при необходимости `frontend/tests/e2e/samples.spec.ts`; сохранить evidence в `docs/implementation/analyst-reports-section-evidence.md`.

**Interfaces:** canonical routes `/labs/:labId/reports`, `/operational`, `/samples`, `/new`, `/:reportId`; API-06/API-08 без изменения payload.

- [ ] Добавить e2e: аналитик выбирает лабораторию, открывает «Отчёты» из шапки, остаётся с тем же `labId`, видит три направления и открывает каждое.
- [ ] Добавить e2e: переходы со вложенных страниц назад сохраняют лабораторию и список/страницу; refresh на отчётном URL не возвращает в поступления.
- [ ] Добавить e2e ролевой матрицы: VET — только учёт проб, HEAD — все направления своей лаборатории, ADMIN — нет пункта и прямой URL запрещён.
- [ ] Проверить, что аналитик не может открыть чужой `labId` подменой URL, а отказ не раскрывает список/метрики.
- [ ] Запустить `npm.cmd --prefix frontend run test:e2e -- reports.spec.ts samples.spec.ts`, затем `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run lint`, `npm.cmd --prefix frontend run build`.
- [ ] Выполнить browser walkthrough на реальном локальном API, проверить шапку/страницу на 1440/1024/768/390 и отсутствие console errors; записать фактические команды/результаты в evidence.
- [ ] Зафиксировать: `test: verify analyst reporting journey`.

### Task 6: Ветка, merge и обновление контейнеров

**Files:** добавить в коммит это ТЗ `dorabotka/2026-11-16-analyst-reports-section.md`, evidence и все относящиеся к задаче изменения; не включать чужие незавершённые файлы.

**Interfaces:** Git history + локальный Compose deployment; миграция БД не ожидается.

- [ ] Начать с актуального `main` в отдельной ветке `codex/analyst-reports-section`; проверить `git status`, сохранить и не перезаписывать чужие изменения.
- [ ] Выполнить итоговый frontend unit suite, Storybook build, targeted e2e, typecheck/lint/build; backend smoke/report tests запустить, если затронут контракт или сервер.
- [ ] Закоммитить ТЗ вместе с реализацией и evidence; убедиться, что секреты, локальные `.env`, credentials и test data не попали в Git.
- [ ] Последовательно влить ветку в `main` без force/reset и запушить `main` в настроенный remote; сохранить понятные коммиты задачи.
- [ ] Пересобрать и обновить затронутые контейнеры существующим Compose-профилем без удаления volumes/БД; минимум frontend, backend — только если реально изменён.
- [ ] Проверить `docker compose ps`, health endpoints и `http://127.0.0.1:8080`; войти тестовыми пользователями каждой роли и повторить матрицу доступа.
- [ ] В финальном отчёте указать ветку, коммиты, merge commit, результаты проверок, обновлённые контейнеры и любые честные not-run.

## 9. Обязательные критерии приёмки

- [ ] Аналитик на маршруте выбранной лаборатории нажимает «Отчёты» и попадает на `/labs/<тот же labId>/reports`, а не `/labs` и не в поступления.
- [ ] После F5 на странице отчётов выбранная лаборатория сохраняется.
- [ ] «Отчёты» отмечены активным пунктом на hub, operational, samples, create и saved view.
- [ ] Аналитик видит 5-вет, операционные показатели и учёт проб выбранной лаборатории.
- [ ] Заведующий видит эти же направления только своей лаборатории.
- [ ] Ветврач видит только учёт проб и не может открыть 5-вет/операционный отчёт прямым URL.
- [ ] Администратор не видит пункт «Отчёты» и не читает отчётные данные по прямому URL.
- [ ] Пользователь без `report:5vet-list` не вызывает endpoint списка 5-вет.
- [ ] Кнопка создания 5-вет отсутствует без preview/save capability.
- [ ] Страница соответствует `analyst-reports.html` по композиции, размерам рабочей области, карточкам, кнопкам и адаптивному поведению.
- [ ] В интерфейсе нет статических mock-данных, `href="#"`, видимых технических UUID вместо доступных названий и локальной копии шапки.
- [ ] Существующие preview/save/export/delete, operational metrics и sample accounting не регрессировали.
- [ ] На 390px нет прокрутки всей страницы; клавиатура, focus-visible и доступные имена работают.
- [ ] ТЗ и код находятся в истории `main`; контейнеры пересобраны, health checks зелёные.

## 10. Review Focus

- Не исправить только один `href`: после F5, перехода назад и открытия вложенного отчёта контекст лаборатории должен оставаться тем же.
- Не считать `labId` из URL разрешением; backend обязан повторно проверить область аналитика.
- Не использовать только роль вместо capabilities и не скрывать серверный 403 декоративной навигацией.
- Не возвращать администратору отчёты из-за старого `admin_makets`/README.
- Не лишить ветврача учёта проб из-за старой формулировки PDR-003.
- Не удалить из hub операционные показатели только потому, что их нет в старом analyst mockup.
- Не сломать неизменяемость сохранённого 5-вет, подпись preview, ведущие нули семи кодов, export/print и URL-pagination.
- Не создавать аналитическую копию `AppHeader`, `ReportsPage` или report API.
- Не считать сборку Storybook подтверждением работы приложения: нужен реальный browser/API walkthrough.

