# DR26 — сравнение: раскладка строки по утверждённому макету (evsd-check-usmanov.html)

Ветка: `feature/DR26-compare-row-layout` (worktree `C:\electronic_lab_dev-dr26`). Раунд 3; предыдущие попытки DR25 ставили название поля в ту же строку — макет требует иначе.

## Что сделано (только фронтенд: `reconciliation.css` + тесты)

Утверждённая геометрия макета (`.compare-row` из `evsd-check-usmanov.html`), применена 1:1 к `.vse-rec-compare`:

```css
.vse-rec-compare {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px 40px;
  gap: 9px;
  align-items: end;
  padding: 13px; border-radius: 14px; /* карточка — уже была, проверена */
}
.vse-rec-compare-name { grid-column: 1 / -1; font-weight: 780; font-size: 13px; line-height: 1.2; }
.vse-rec-mercury-value { height: 40px; border: 1px solid …; border-radius: 10px; padding: 9px 11px;
  line-height: 20px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vse-rec-check { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 11px; }
@media (max-width: 800px) { .vse-rec-compare { grid-template-columns: minmax(0, 1fr) 40px 40px; } }
```

- Название поля — отдельная строка НА ВСЮ ширину карточки СВЕРХУ (R-DR26-1); ниже — одна линия: бокс значения + кнопка «Совпадает» + кнопка «Не совпадает», выровнены по низу.
- Бокс значения как выключенный input: 40px высота, тинты match/mismatch сохранены (border/background как в макете).
- Радиогруппа: `.vse-rec-check-buttons { display: contents; }` (R-DR26-2) — обёртка не занимает трек; её два `label.vse-rec-check` становятся непосредственными grid-элементами треков 2 и 3. `role="radiogroup"`, `aria-label`, keyboard/focus-логика сохранены в DOM без дублирования механизма; JSX не менялся.
- Mismatch-блок «Фактическое значение/Причина» остаётся ниже строки внутри карточки (`grid-column: 1/-1`), строка не сдвигается (R-DR26-3).
- PENDING/ERROR/MISSING — контролы видимы, disabled, без отметок; aria-live сохранены (DR24/DR21 не тронуты) (R-DR26-4).
- Узкие экраны: внешняя сетка 1 колонка ≤1020px (существовала); внутренняя линия значение+2 кнопки сохраняется ≤800px (явное правило по макету); значение эллипсируется, без горизонтального скролла.
- Тесты `Dr24RecControls.test.tsx` переписаны под DR26: имя сверху (grid-column 1/-1), 3-трековая линия, `display: contents` обёртки + роль/метка радиогруппы, геометрия 40px, mismatch-блок снизу, PENDING-disabled — прежние тесты DR25 (4-трек `[name][value][btn][btn]`) удалены.

## Проверки (frontend, Node v26.13.0)

| Шаг | Результат |
|---|---|
| `npm run format:check` | OK |
| `npm run lint` | OK (1 известное предупреждение catalogs — pre-existing) |
| `npm run typecheck` | OK |
| `npm run test -- --run` | 380 тестов / 56 файлов — все прошли |
| `npm run build` | OK |
| `npm run build-storybook` | OK (в worktree) |

Backend не менялся (R-DR26-5) — backend-шлюзы не запускались. Живой экран 390px/200% не проверялся в браузере этим агентом (JSDOM-тест «no horizontal scroll at 390px» пройден; живую проверку в браузере выполняет контроллер по R-DR26-4). Storybook-стори `components/checks/ComparisonField.stories.js` использует HTML-библиотеку макета с `.compare-row` — её геометрия уже совпадает с макетом, изменений не потребовалось.
