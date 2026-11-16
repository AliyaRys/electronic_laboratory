# DR32 — Dialog top layer and overlay (evidence)

ТЗ: `dorabotka/2026-11-16-dialog-top-layer-and-overlay.md` §1–12. Ветка: `feature/DR32-dialog-top-layer`.
Работа выполнена в изолированном worktree `../electronic_lab_dev-dr32`.

## 1. Подтверждённый дефект (TDD FAIL до фикса)

Новый e2e `frontend/tests/e2e/dialog-layer.spec.ts` воспроизвёл дефект §3 **до** исправления:

- `getComputedStyle(.app-dialog).backgroundColor` → alpha **0** (прозрачная карточка: portal в
  `document.body` вне `.vse-app`, токены `--app-*` не определены);
- горизонтальная прокрутка страницы при 390 px (`scrollWidth` 455 > 390).

## 2. Решение (rulings R-DR32-1..7)

- **Один централизованный механизм темы:** общий wrapper `div.app-dialog-layer` внутри
  `RadixDialog.Portal` (`shared/ui/Dialog.tsx`); токены объявлены для `.vse-app, .app-dialog-layer`
  в одном блоке `shared/ui/ui.css` (без копий и второй палитры). Focus-ring расширен на portal.
- **Порядок слоёв:** overlay z-index 1000 / карточка 1001 централизованно в `ui.css`; overlay выше
  AppHeader (100) и sticky (8/120); без отрицательных z-index и `!important`.
- **Карточка:** непрозрачный `var(--app-panel)`, max-height + внутренняя прокрутка, длинный
  fingerprint переносится (`overflow-wrap: anywhere`).
- **§6.1:** `reconciliation.css`: пары `dt/dd` резюме перестраиваются в одну колонку ≤700 px;
  `.vse-receipt-fields` — одна колонка ≤480 px (убирает горизонтальную прокрутку 390 px).
- Контракт Radix (aria/focus/Escape/модальность) не изменён; содержимое и действия диалога
  гашения не тронуты; реальное гашение нигде не выполнялось (write-эндпоинт перехватывается и
  считается в e2e — 0 записей).

## 3. Coverage

- Unit: `Dialog.test.tsx` — прежние проверки сохранены + новый структурный тест portal-темы
  (`.app-dialog-layer` на `document.body`, вне `.vse-app`, aria-контракт). **57 файлов / 407 тестов — все проходят.**
- E2E (FAIL → PASS подтверждён): `dialog-layer.spec.ts` — computed styles overlay/content,
  `elementFromPoint` центр/вне карточки, блокировка реального клика по ссылке шапки (URL не
  изменился), фокус-трап (24 Tab), Escape + возврат в документ, скриншоты 1440/1024/768/390,
  нет горизонтальной прокрутки, fingerprint читаем. Примечание: в реальном сценарии кнопка
  «Подготовить гашение» недоступна (disabled) во время async preview, поэтому при открытии
  `activeElement` = body — возврат фокуса на триггер покрыт unit-тестом, e2e проверяет возврат
  фокуса в документ.
- Регрессия Dialog-пользователей: `vetis-receipt.spec.ts` (гашение), `reconciliation.spec.ts`
  (страница сверки vs макет, клавиатура, без записей), `reconciliation-storybook.spec.ts`
  (включая axe), `arrivals.spec.ts` (26 passed; 2 падения `control screenshots…`/`column chooser`
  воспроизводятся на базовом коммите без моих изменений — предсуществующие, вне зоны DR32).
- Storybook: `build-storybook` — успех; новые stories `Busy` и `ReceiptSummaryLongFingerprint`
  на том же portal-контракте.
- Гейты: format:check ✅ (включая формат-фикс предсуществующего `ReceiptOperation.tsx`), lint ✅
  (1 предсуществующее предупреждение catalogs), typecheck ✅, build ✅, test ✅, build-storybook ✅.
- Не запускалось честно: backend-гейты (backend не тронут), полная матрица e2e на живых стендах,
  слияние/контейнеры/живая проверка URL — зона контроллера (R-DR32-10).

## 4. Скриншоты (коммичены рядом)

`docs/implementation/evidence/dr32-dialog-1440.png`, `…-1024.png`, `…-768.png`, `…-390.png`.
