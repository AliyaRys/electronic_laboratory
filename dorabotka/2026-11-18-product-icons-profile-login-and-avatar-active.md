# Иконки типов продукции и профиль пользователя — Implementation Plan

> **Для ИИ-агента:** ОБЯЗАТЕЛЬНЫЕ НАВЫКИ: сначала применить `superpowers:systematic-debugging` и подтвердить описанные ниже причины на актуальном `main`; затем выполнять план через `superpowers:subagent-driven-development` — отдельный implementer на каждую задачу, после него отдельный reviewer соответствия ТЗ и отдельный reviewer качества кода. Для UI обязательно использовать `frontend-design`, а также прочитать `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, `components/shell/README.md` и `components/icons/README.md`. После задач провести независимый whole-branch review. Все шаги вести чекбоксами `- [ ]`.

**Цель:** заменить три самодельно выглядящие пиктограммы в меню типов продукции на точные и неизменённые иконки из Font Awesome Free, убрать повтор логина из визуального резюме профиля и сделать активное состояние профиля в шапке круглым — зелёным кольцом вокруг аватарки, без прямоугольной подложки.

**Архитектура:** владельцем шапки и её иконок остаётся общий `AppHeader`; страницы не получают локальные SVG или собственные стили шапки. Источником трёх новых пиктограмм служит закреплённый пакет `@fortawesome/free-solid-svg-icons`, а legacy-реестр и React-адаптер получают проверяемые данные из одного источника. Профиль остаётся одним экраном с двумя представлениями идентичности: краткое резюме содержит аватар и ФИО, подробная карточка — в том числе единственное видимое поле «Логин».

**Tech Stack:** обычный JavaScript-компонент `globalThis.VseApp`, React 19, TypeScript, CSS, Font Awesome Free Solid, Storybook, Vitest/Testing Library, Playwright, Docker Compose.

**Spec:** настоящее ТЗ; решение владельца от 18.11.2026; `AGENTS.md`; `DESIGN.md`; `UX-CONTRACT.md`; `STORYBOOK.md`; `components/shell/README.md`; `components/icons/README.md`.

## Global Constraints

- [ ] Начать от актуального `main` в ветке `feature/DR50-product-icons-profile-active-state`.
- [ ] Настоящее ТЗ добавить в ту же ветку отдельным первым коммитом. Не переписывать и не удалять его при реализации.
- [ ] Не менять backend, API профиля, роли, права, маршруты, данные пользователя, доступность продуктовых направлений или логику переключателя.
- [ ] Не менять порядок и подписи шести пунктов меню: «Мясо и мясопродукты», «Молоко и молочные продукты», «Яйца и яйцепродукция», «Рыба и рыбная продукция», «Мёд и медовая продукция», «Растительная пищевая продукция».
- [ ] Доступным остаётся только «Мясо и мясопродукты». Остальные пять пунктов остаются видимыми, серыми, `disabled` и `aria-disabled="true"` с подписью «Пока недоступно».
- [ ] Не добавлять CDN, внешний сетевой запрос, webfont или Pro-набор Font Awesome. Иконки должны работать в собранном образе без интернета.
- [ ] Не копировать вручную SVG в `AppHeader.tsx`, страницу профиля, HTML, stories или CSS. Не перерисовывать и не упрощать пути Font Awesome.
- [ ] Не создавать второй переключатель продукции или второй вариант шапки. Изменить общий реестр/адаптер, который уже используют экран и Storybook.
- [ ] Не удалять поле «Логин» из блока «Данные пользователя». Удаляется только повтор под ФИО в кратком резюме.
- [ ] Не убирать доступный keyboard focus у ссылки профиля. Активное состояние и `:focus-visible` — разные состояния и оба должны быть различимы.
- [ ] Не включать в коммиты пользовательское изменение `.gitignore` и любые другие несвязанные изменения рабочего дерева.

## Review Focus

- В DOM нет второго текста с логином, но поле «Логин» в подробных данных осталось и показывает прежнее значение.
- У трёх иконок официальные `viewBox` и path data Font Awesome, а не path, вручную подогнанный под `0 0 24 24`.
- Filled-иконки используют `fill: currentColor` и не наследуют общий outline-стиль `fill:none; stroke:currentColor`.
- На `/profile` зелёное кольцо повторяет окружность аватара; за ним нет прямоугольного фона или прямоугольной тени.
- На других маршрутах аватар не помечен активным. Hover и keyboard focus не вызывают сдвига размеров шапки.
- Legacy Storybook и производственная React SPA показывают одинаковые иконки и одинаковую геометрию активного профиля.

---

## 1. Подтверждённые причины дефектов

До реализации агент обязан повторить проверку на актуальном `main` и зафиксировать результат в журнале задачи.

### 1.1. Иконки типов продукции

Сейчас ключи `product-eggs`, `product-fish`, `product-plant` определены локальными outline-path в двух местах:

- `components/shell/AppHeader.js` — legacy-владелец шапки;
- `frontend/src/shared/ui/legacy-icons.ts` — React-адаптер.

`frontend/src/shared/ui/Icon.tsx` жёстко использует `viewBox="0 0 24 24"`, а общий CSS рассчитан на контурные иконки. Это не позволяет честно подставить исходные Font Awesome Solid, у которых собственные размеры viewBox и заливка.

### 1.2. Повтор логина

В `frontend/src/pages/ProfilePage.tsx` логин выводится дважды:

1. `.vse-profile-login` непосредственно под ФИО;
2. `InfoField` с подписью «Логин» в подробной карточке.

Legacy-компонент `components/profile/ProfileSummary.js` делает тот же повтор через `.profile-login`, тогда как `components/profile/ProfileScreen.js` уже содержит подробное поле «Логин».

### 1.3. Прямоугольное активное состояние профиля

В `frontend/src/shared/ui/app-header.css` `.user-link` включён в общий прямоугольный стиль `.navlink`, а `.user-link.active` получает фон и `box-shadow` на всей ссылке. В legacy-примере это дополнительно повторено в `components/profile/profile.css`. Поэтому круглая аватарка выделяется прямоугольником.

Исправлять нужно геометрию общего компонента шапки, а не добавлять переопределение только на странице `/profile`.

---

## 2. Готовые библиотечные иконки

### 2.1. Утверждённая библиотека и точное сопоставление

Использовать официальный бесплатный пакет [`@fortawesome/free-solid-svg-icons`](https://www.npmjs.com/package/%40fortawesome/free-solid-svg-icons), закрепив точную версию `7.3.1` в lock-файле. Допустима более новая версия только после отдельного согласования с владельцем и обновления ожидаемых данных в тестах.

| Ключ приложения | Пункт меню | Экспорт Font Awesome | Официальная иконка |
|---|---|---|---|
| `product-eggs` | Яйца и яйцепродукция | `faEgg` | [`egg`](https://fontawesome.com/icons/egg?s=solid) |
| `product-fish` | Рыба и рыбная продукция | `faFish` | [`fish`](https://fontawesome.com/icons/fish?s=solid) |
| `product-plant` | Растительная пищевая продукция | `faWheatAwn` | [`wheat-awn`](https://fontawesome.com/icons/wheat-awn?s=solid) |

Не заменять их «похожими» иконками, emoji, текстовыми символами или собственными рисунками. Не менять иконки мяса, молока и мёда в рамках этой задачи.

### 2.2. Один проверяемый источник данных

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `frontend/package.json` и `frontend/package-lock.json` только если пакет импортируется непосредственно React-сборкой
- Create: `scripts/sync-product-icons.mjs` или эквивалентный генератор
- Modify: `components/shell/AppHeader.js`
- Modify: `frontend/src/shared/ui/legacy-icons.ts`
- Modify: `frontend/src/shared/ui/Icon.tsx`
- Create/Modify: тест целостности реестра рядом с существующими icon/header tests
- Modify: `components/shell/README.md`
- Modify: `components/icons/README.md`
- Create/Modify: файл third-party notices, если в проекте ещё нет подходящего реестра лицензий

- [ ] Добавить точную зависимость Font Awesome Free Solid и зафиксировать её lock-файлом. Не использовать диапазон `^` для источника vendor-данных.
- [ ] Создать скрипт, который импортирует `faEgg`, `faFish`, `faWheatAwn` из пакета и формирует данные трёх ключей приложения. Сгенерированные данные должны включать собственные `width`, `height`, `svgPathData` и признак `solid`.
- [ ] Скрипт должен поддерживать режим `--check`: завершаться ненулевым кодом, если committed registry расходится с закреплённым пакетом. Это защищает legacy и React от ручного расхождения.
- [ ] Не держать две независимо написанные копии path. Допустимы два сгенерированных артефакта для legacy и TypeScript, если оба создаются одним скриптом и их равенство проверяется `--check`.
- [ ] Сохранить публичные ключи `product-eggs`, `product-fish`, `product-plant`, чтобы не менять `ROADMAP_PRODUCTS`, stories и вызывающий код.
- [ ] Расширить контракт иконки минимально: renderer берёт реальный `viewBox="0 0 {width} {height}"`; для `solid` использует заливку, для остальных существующих outline-иконок сохраняет прежнее поведение.
- [ ] Учесть, что Font Awesome может возвращать `svgPathData` как строку или массив строк. Renderer должен отрисовать каждую часть в исходном порядке, не объединяя и не преобразуя координаты.
- [ ] Для этих трёх иконок итоговый SVG получает `fill="currentColor"`, `stroke="none"`; для остальных иконок существующие stroke/fill не меняются.
- [ ] Размер контейнера в меню остаётся текущим. Иконка центрируется в существующем квадрате, сохраняет пропорции и не выходит за него на 100%, 125% и 200% масштабировании браузера.
- [ ] Цвет не задавать внутри path. Активный/недоступный цвет продолжает приходить через `currentColor`; disabled-пункты остаются визуально серыми.
- [ ] Добавить в notice название пакета, точную версию, имена трёх иконок и лицензию Font Awesome Free. Не добавлять весь пакет в runtime bundle, если используются только три определения.
- [ ] Обновить README: закрепить библиотеку, соответствие ключей и запрет ручного SVG; прежнее указание на Lucide для этих трёх ключей удалить как устаревшее.

### 2.3. Проверки и Storybook

**Files:**

- Modify: `components/shell/AppHeader.stories.js`
- Modify: `frontend/src/shared/ui/app-header.stories.tsx`
- Modify: `frontend/src/shared/ui/Icon.test.tsx`
- Modify: `frontend/src/shared/ui/AppHeader.test.tsx`
- Modify/Create: legacy registry test

- [ ] Story `ProductRoadmap` показывает раскрытое меню со всеми шестью пунктами при обычной и узкой ширине.
- [ ] Добавить icon-gallery состояние, где три новые иконки видны рядом при одинаковом размере и `currentColor`.
- [ ] Unit test сравнивает `width`, `height` и `svgPathData` каждого ключа с экспортом закреплённого пакета; snapshot одного случайного `<path>` недостаточен.
- [ ] Unit test подтверждает, что итоговый `viewBox` не принудительно `0 0 24 24`, если библиотека задаёт другие размеры.
- [ ] Unit test подтверждает `fill=currentColor`, отсутствие stroke и неизменность outline-иконки, например `meat`.
- [ ] Existing header test продолжает подтверждать шесть пунктов, их порядок, disabled-состояние пяти направлений и отсутствие вызова `onProductChange` при попытке выбрать недоступный пункт.
- [ ] Проверить визуально 1440, 1024, 768 и 390 px: иконки находятся на одной вертикальной оси, подписи начинаются на одной координате, статус не налезает на текст и не выходит из меню.

---

## 3. Убрать повтор логина в профиле

**Files:**

- Modify: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/pages/ProfilePage.test.tsx`
- Modify: `frontend/src/features/identity/identity.css`
- Modify: `components/profile/ProfileSummary.js`
- Modify: `components/profile/ProfileSummary.stories.js`
- Modify: `components/profile/AdminProfileSummary.stories.js`
- Modify: `components/profile/profile.css`
- Modify: `components/profile/README.md`, если API summary там документирует `login`

- [ ] В React удалить только `<div className="vse-profile-login">…</div>` из краткого резюме рядом с аватаром и ФИО.
- [ ] В legacy `ProfileSummary` не создавать `.profile-login` и не добавлять логин в `identity`.
- [ ] В подробном блоке «Данные пользователя» сохранить `InfoField` с подписью «Логин» и исходным значением без маскирования, переименования или изменения регистра.
- [ ] Удалить ставшие неиспользуемыми CSS-селекторы `.vse-profile-login` и `.profile-login`.
- [ ] Если параметр `login` после удаления больше не нужен публичному `ProfileSummary`, удалить его из API, stories и README согласованно. В `ProfileScreen` сам `data.login` оставить, потому что он нужен подробному полю.
- [ ] Не оставлять пустой узел или лишний вертикальный отступ под ФИО. Аватар, ФИО и следующий блок должны сохранить согласованный ритм макета.
- [ ] Тест React должен искать значение логина и подтверждать, что оно встречается ровно один раз, внутри поля с accessible label «Логин».
- [ ] Storybook профиля обновить для обычного и длинного ФИО: отсутствие повторного логина не должно ломать высоту/выравнивание карточки.

## 4. Круглое активное состояние профиля в шапке

### 4.1. Визуальный контракт

На маршруте `/profile` ожидается:

```text
кликабельная область: не меньше 42 × 42 px
аватар:             32 × 32 px, круг
active ring:         2 px, цвет primary #146c73, по окружности аватара
прямоугольный фон:   отсутствует
прямоугольная тень:  отсутствует
layout shift:        0 px
```

Кольцо выполнять через `box-shadow: 0 0 0 2px var(--app-teal, #146c73)` или эквивалентный outline на `.avatar`, а не через border, меняющий размер. Скругление активной области должно быть `50%`.

### 4.2. Реализация общего компонента

**Files:**

- Modify: `frontend/src/shared/ui/app-header.css`
- Modify: `components/shell/app-header.css`
- Modify: `components/profile/profile.css`
- Modify: `frontend/src/shared/ui/AppHeader.test.tsx`
- Modify: `frontend/src/shared/ui/app-header.stories.tsx`
- Modify: `components/shell/AppHeader.stories.js`

- [ ] Исключить `.user-link.active` из общего прямоугольного active-правила `.navlink.active`.
- [ ] Удалить `box-shadow` и tint-background с внешнего `.user-link.active`.
- [ ] Сама `.user-link` остаётся ссылкой с кликабельной областью не меньше 42×42, центрирует аватар и имеет круглую геометрию. Не уменьшать hit target до 32×32.
- [ ] Active ring применять только к `.user-link.active .avatar` (или семантически эквивалентному селектору общего компонента).
- [ ] На hover изменять только круг аватара/его кольцо; не возвращать прямоугольную подложку. Hover не должен скрывать active ring.
- [ ] `:focus-visible` сохранить с контрастным внешним индикатором. Он должен быть круглым и отличимым от active ring, например дополнительным кольцом/отступом; нельзя использовать `outline: none` без полноценной замены.
- [ ] Удалить legacy-переопределения `.vse-profile-document .user-link.active`, которые снова создают прямоугольник. Legacy-страница должна наследовать общий `components/shell/app-header.css`.
- [ ] Не затрагивать прямоугольную геометрию обычных `.navlink` разделов и не менять их active/hover.
- [ ] На `/profile` сохранить `aria-current="page"`; на остальных маршрутах его нет. Кольцо является визуальным дополнением, а не заменой семантики.
- [ ] Тест проверяет наличие `active`/`aria-current` только на профиле и отсутствие active у ссылки профиля на другом маршруте.
- [ ] Добавить Storybook-состояния: обычный avatar-link, hover (через pseudo-state либо отдельное состояние), active profile, keyboard focus, длинное ФИО в `title`/`aria-label`, ширина 390 px.
- [ ] Визуальная проверка: кольцо является окружностью без видимых прямоугольных углов на белом и tint-фоне; логотип, навигация и выход не смещаются при переходе на `/profile`.

---

## 5. Порядок реализации с обязательными review-loop

### Task A — RED и источник иконок

- [ ] Implementer создаёт/обновляет тесты, которые сначала падают на текущих path/viewBox/style.
- [ ] Implementer подключает pinned Font Awesome, генератор/проверку и обновляет оба реестра.
- [ ] Spec reviewer проверяет библиотечное происхождение, точное сопоставление и отсутствие ручного SVG.
- [ ] Quality reviewer проверяет bundle, типы, лицензию, generated-files и отсутствие двух источников истины.
- [ ] Исправить все замечания и повторить reviewers до approve.

### Task B — профиль без повтора логина

- [ ] Implementer сначала добавляет тест «логин виден ровно один раз», затем меняет React и legacy component.
- [ ] Spec reviewer проверяет сохранность подробного поля «Логин».
- [ ] Quality reviewer проверяет отсутствие мёртвых props/CSS/stories и регрессий длинного ФИО.
- [ ] Исправить все замечания и повторить reviewers до approve.

### Task C — круглый active profile

- [ ] Implementer сначала фиксирует тестами semantics и добавляет Storybook state, затем меняет общий CSS.
- [ ] Spec reviewer сравнивает геометрию и цвета с разделом 4.1.
- [ ] Quality reviewer проверяет focus-visible, hit target, responsive и отсутствие локальных overrides.
- [ ] Исправить все замечания и повторить reviewers до approve.

### Task D — whole-branch review

- [ ] Отдельный reviewer проверяет весь diff, в том числе lock-файлы, notices, README, stories, тесты и отсутствие backend-изменений.
- [ ] Отдельно проверить, что `.gitignore` и другие пользовательские изменения не попали в коммиты.

---

## 6. Обязательная проверка

### 6.1. Автоматические команды

- [ ] `npm.cmd install --package-lock-only`/принятый в репозитории frozen-процесс обновления lock выполняется без незаявленных dependency changes.
- [ ] Запустить проверку генератора с `--check`.
- [ ] `npm.cmd --prefix frontend run test -- --run frontend/src/shared/ui/Icon.test.tsx frontend/src/shared/ui/AppHeader.test.tsx frontend/src/pages/ProfilePage.test.tsx` — либо корректные относительно `frontend` пути этих файлов.
- [ ] `npm.cmd --prefix frontend run typecheck`.
- [ ] `npm.cmd --prefix frontend run lint`.
- [ ] `npm.cmd --prefix frontend run build`.
- [ ] `npm.cmd run build-storybook` для legacy-компонентов.
- [ ] `npm.cmd --prefix frontend run build-storybook` для React Storybook.
- [ ] Запустить относящиеся к шапке/профилю Playwright e2e; если отдельного spec нет — добавить адресный сценарий в существующий shell/identity spec.
- [ ] Не применять повреждённый локальный formatter ко всему репозиторию. Форматировать только изменённые файлы проверенным инструментом; существующий unrelated drift не исправлять этой веткой.

### 6.2. Браузерная приёмка

Проверить производственную SPA, а не только stories:

- [ ] войти как `arysaeva`, открыть любой рабочий экран, раскрыть меню продукции;
- [ ] убедиться, что Egg/Fish/Wheat Awn визуально библиотечные, выровнены, серые в disabled-состоянии и не выбираются;
- [ ] открыть `/profile`: логин отображается один раз в поле «Логин»;
- [ ] убедиться, что вокруг «РА» зелёное круглое кольцо и нет прямоугольника;
- [ ] перейти обратно в рабочий раздел: кольцо исчезает;
- [ ] повторить клавиатурой Tab/Enter, проверить читаемый круглый focus;
- [ ] повторить на 1440, 1024, 768 и 390 px и при browser zoom 200%; горизонтальной прокрутки и обрезанных иконок нет;
- [ ] проверить профиль пользователя с длинным ФИО и длинным логином: ФИО не выходит из карточки, единственное поле логина переносится по существующим правилам.

Сохранить screenshot evidence минимум для:

1. раскрытого меню 1440 px;
2. раскрытого меню 390 px;
3. `/profile` active 1440 px;
4. `/profile` keyboard focus 390 px.

---

## 7. Git, merge и обновление контейнеров

- [ ] Коммиты делать небольшими и тематическими: ТЗ; tests/RED; Font Awesome registry; profile cleanup; circular active state; docs/evidence.
- [ ] Перед merge убедиться, что ветка содержит и настоящее ТЗ, и реализацию.
- [ ] Подтянуть актуальный `main`, разрешить конфликты без перезаписи чужих изменений, повторить обязательные проверки.
- [ ] Объединить `feature/DR50-product-icons-profile-active-state` в `main` обычным merge-коммитом; не squash, чтобы история решений и ТЗ сохранилась.
- [ ] Запушить feature branch и обновлённый `main` в настроенный remote.
- [ ] Проверить `docker compose config --quiet`.
- [ ] Пересобрать и обновить frontend через действующий local compose-профиль проекта; не перезапускать/пересоздавать PostgreSQL и не выполнять миграции, поскольку schema не меняется.
- [ ] После обновления дождаться healthy-состояния, открыть `http://127.0.0.1:8080/profile` и повторить короткий smoke: меню продукции, единственный логин, круглое active ring, переход на другой раздел.
- [ ] Зафиксировать в итоговом отчёте: commit feature, merge commit main, выполненные команды/результаты, имена обновлённых контейнеров и пути к screenshot evidence.

## Definition of Done

- [ ] У Eggs/Fish/Plant используются ровно `faEgg`, `faFish`, `faWheatAwn` из закреплённого Font Awesome Free Solid, с исходной геометрией и лицензией.
- [ ] Ни одна страница или story не содержит локальной копии новых SVG.
- [ ] Все пять будущих направлений остаются недоступными; продуктовая логика не изменилась.
- [ ] На профиле логин виден ровно один раз — в поле «Логин».
- [ ] Активный профиль обозначается зелёным круглым кольцом вокруг аватара; прямоугольного active-фона нет.
- [ ] Keyboard focus доступен, hit target не меньше 42×42, layout не прыгает.
- [ ] Legacy и React Storybook, unit/e2e, build и browser matrix пройдены.
- [ ] ТЗ и код слиты в `main`, remote обновлён, frontend-контейнер пересобран, smoke на `127.0.0.1:8080` успешен.
