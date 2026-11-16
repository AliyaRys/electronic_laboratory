# DR33 — Russian capability labels in profile (evidence)

Ветка: `feature/DR33-capability-labels` (worktree `../electronic_lab_dev-dr33`, база main @372ead4).
Коммиты: `e0a8722` docs: DR33 task spec · `59b7234` feat: Russian capability labels in profile via shared registry.

## Реализация

- `frontend/src/features/identity/capabilityLabels.ts` — единый типизированный реестр (ТЗ §6.1–6.8): неизменяемая карта `code → label` (Object.freeze), `capabilityLabel()` с русским fallback, `capabilityTooltip()`, `isKnownCapability()`. В dev/test — `console.warn` для неизвестного кода (ТЗ §7).
- `frontend/src/features/identity/CapabilityTag.tsx` — общие компоненты метки и блока прав (используются страницей и Storybook; дублирования нет). Для неизвестного кода — `data-capability-code`.
- `ProfilePage.tsx` рендерит русские названия; коды, маршрут и API не изменены; backend не тронут.
- CSS (ТЗ §8.1): только визуальное сокращение — `max-width: 240px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis` в `.vse-profile-right-tag`; контейнер продолжает `flex-wrap`. Полное название остаётся в DOM/accessible name; подсказка — `title` с полным текстом (минимально допустимый вариант §8.2; общий интерактивный tooltip-компонент не создан — существующего в `shared/ui` нет, README identity не добавлялся).

## Покрытие матрицы

Все 52 action актуальной `PERMISSION_MATRIX` (`backend/src/modules/identity/policies.py`) сверены с `docs/TZ_development/plans/permissions.md` и таблицей ТЗ §6.1–6.8 — расхождений нет; **код, отсутствующий в карте ТЗ, не обнаружен** (DENIED_ACTIONS не возвращаются как права). Тест-зеркало матрицы: `capabilityLabels.test.ts`.

## Тесты (TDD, сначала тесты)

- `capabilityLabels.test.ts` — 5 тестов (§12.1: полный охват матрицы; label ≠ код; нет `:`/kebab-case в видимом тексте; fallback + код только в tooltip/diagnostic; дубли названий отсутствуют).
- `ProfilePage.test.tsx` — 8 тестов (§12.2: arrivals:read → «Просмотр поступления»; create-complete → «Создание и завершение ВСЭ»; коды не видны; полное название в DOM/title; подсказка; пустой массив → «Прав не назначено.»; неизвестный код → fallback с `data-capability-code`; маршруты/действия не изменились) + тесты DR4 (UUID, фото, композиция). Fixture заменён: несуществующий `examination:create` → реальные коды матрицы.
- Полная роль (§12.3): тест HEAD-набора из 37 прав — все метки рендерятся, ни одна не потеряна, nowrap/ellipsis/max-width проверены по правилу CSS (jsdom не применяет стили; computed styles — в браузере).

Итого: **416 тестов / 58 файлов — все проходят**.

## Гейты (Node 26, frontend)

- `test -- --run` ✅ 416 passed · `lint` ✅ · `typecheck` ✅ · `build` ✅ · `build-storybook` ✅
- `format:check` ⚠️: один pre-existing варнинг `src/features/arrivals/ReceiptOperation.tsx` (файл главной ветки, зона DR30 — не трогал; мои файлы отформатированы).
- Backend-гейты пропущены (backend не изменялся). Catalogs lint warning — pre-existing (заметка контроллера).

## Stories (§13)

`capability-tag.stories.tsx` (F03/CapabilityTags): VetBasic, HeadLongSet, AdminUsers, NoRights, UnknownCapability, LongNames, NarrowViewport (390px). Все — через тот же реестр/компонент, локальных русских строк нет.

## Честно не выполнено

- Живая браузерная проверка /profile и computed styles на 1440/1024/768/390 — браузер десктоп-приложения был не подключён; за контроллером (§12.4/§15.8/§15.10). Локальный статический прогон storybook не заменяет проверку рабочего экрана.
- Пересборка frontend-контейнера и merge — за контроллером (R-DR33-10).
