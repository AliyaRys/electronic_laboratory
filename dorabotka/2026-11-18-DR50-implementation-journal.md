# DR50 — журнал имплементатора

## Проверка причин §1 на актуальном коде (3b0d05c / base 2b48a05)

- **§1.1 Иконки продукции.** Подтверждено: `components/shell/AppHeader.js:47-66` и
  `frontend/src/shared/ui/legacy-icons.ts:279-304` содержат одинаковые локальные
  outline-пути Lucide для `product-eggs`, `product-fish`, `product-plant`
  (две независимо написанные копии). `Icon.tsx` жёстко ставит
  `viewBox="0 0 24 24"` (Icon.tsx:29); CSS `.product-icon svg` задаёт
  `fill:none; stroke:currentColor` — Solid Font Awesome без доработки renderer
  не подставить.
- **§1.2 Повтор логина.** Подтверждено: `ProfilePage.tsx:99`
  `.vse-profile-login` под ФИО + `InfoField label="Логин"` (строка 115);
  legacy `ProfileSummary.js:43-46` `.profile-login` при том, что
  `ProfileScreen.js` уже выводит поле «Логин» в подробной карточке.
- **§1.3 Прямоугольный active.** Подтверждено: React `app-header.css:109-151`
  включает `.user-link` в прямоугольный `.navlink`-стиль, `.user-link.active`
  получает tint + `box-shadow inset 0 0 0 1px #c9e6e2`; legacy
  `components/profile/profile.css:51-52` повторяет прямоугольник
  (`.vse-profile-document .user-link.active`). Legacy
  `components/shell/app-header.css:100-102` даёт прямоугольный hover.

Проверки проведены чтением актуального кода в worktree `C:\electronic_lab_dev-dr50`.

## Статус

- [x] Task A — RED и источник иконок (коммиты 719c1b2 → 648349b)
- [x] Task B — профиль без повтора логина (коммит b1fa3bd)
- [x] Task C — круглый active profile (коммиты e90cdaf → 3fae805)

## Выявленные попутные дефекты legacy (исправлены в рамках DR50)

1. `AppHeader.js`: опции меню продукции передавали в `iconSlot` ключ
   (`'eggs'`) вместо `config.icon` (`'product-eggs'`) — после появления
   рабочих FA-определений это сразу ломало раскрытое меню
   («Неизвестная иконка шапки: eggs»). Исправлено на `config.icon`.
2. `product-honey` был случайно удалён при замене блока — восстановлен как
   прежний outline (FA касается только eggs/fish/plant).
3. Динамический `AppHeader` не задавал `aria-label` навигационным ссылкам;
   на мобильной ширине navtext скрывается CSS, и профильная страница
   (где ранее динамическая шапка не собиралась из-за п.1 и оставалась
   статичной) получала axe-нарушение `link-name`. Добавлены `aria-label`.

## Gates

- `node scripts/sync-product-icons.mjs --check` — ok
- `npm.cmd --prefix frontend run test -- --run` — 76 файлов / 659 тестов passed
- `npm.cmd --prefix frontend run typecheck` / `lint` / `build` — ok
- `npm.cmd run build-storybook` и `npm.cmd --prefix frontend run build-storybook` — ok
- `npm.cmd run test:ui` (Playwright, Chrome) — 33 failed / 266 passed;
  на базовом main 2b48a05: 34 failed / 264 passed. Все падения —
  pre-existing (отсутствующие макеты `admin_makets/account-activation.html`,
  storybook-истории вне DR50); DR50-сценарий и профильные тесты зелёные.

## Honest not-run

- §6.2 производственная SPA-приёмка (вход `arysaeva`, docker-контейнеры,
  smoke на 127.0.0.1:8080) не выполнялась — Task D/§7 контроллера.
- Скриншоты сняты со Storybook, а не из SPA; визуальную оценку 4 PNG
  (`dorabotka/evidence-dr50/`) не делал сам (нет возможности просмотра
  изображений) — проверить контроллеру.
