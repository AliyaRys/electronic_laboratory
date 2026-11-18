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

- [ ] Task A — RED и источник иконок
- [ ] Task B — профиль без повтора логина
- [ ] Task C — круглый active profile
