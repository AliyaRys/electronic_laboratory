# DR30 — визуальная паритет страницы создания карточки ВСЭ

Дата: 16.11.2026 · Ветка: `feature/DR30-examination-design-parity` (base main `372ead4`)
ТЗ: `dorabotka/2026-11-16-examination-create-design-parity.md` (§1–15)
Эталон: `electronic-vse-journal.html` (только визуальная композиция, §4.2 — не источник функциональности)

## 1. Изменённые файлы

**Реализация**
- `frontend/src/shared/ui/FormSection.tsx` — **новый** общий примитив: белая секция-карточка (иконка в тонированном квадрате из общего реестра, `h2`, серое пояснение), геометрия 1:1 из макета (радиус/отступы/тень через токены).
- `frontend/src/shared/ui/ReadonlyField.tsx` — **новый**: readonly-факт в виде `input[readonly]`/`textarea[readonly]` из макета с сохранением доступного вывода (label + значение, пустое = «—»).
- `frontend/src/shared/ui/ui.css` — новые токены DR30 (см. §3), стили `.app-section*`, `.app-readonly-field`, `.vse-page-head/.vse-eyebrow/.vse-legend/.vse-req`.
- `frontend/src/shared/ui/legacy-icons.ts` — в адаптер добавлены 3 иконки разделов карточки ВСЭ (сначала добавлены в общий реестр `components/icons/VseIcon.js`).
- `frontend/src/features/examinations/ExaminationSections.tsx` — **новый**: секции «Сведения об экспертизе», «Участники и продукция» (карточки отправителя/получателя), legacy-композит `PartyReadonlyFacts` (просмотр карточки).
- `frontend/src/features/examinations/ExaminationForm.tsx` — композиция шести секций макета; `specialistName` (readonly ФИО, без select); панель действий `.vse-exam-actions` (sticky, полупрозрачный белый фон); логика и payload не изменены.
- `frontend/src/features/examinations/ResearchFields.tsx` — секция через `FormSection`; карточки `.research`/`.research.primary`; зона «＋ Добавить …» под карточками; строки болезней в стиле макета; тексты без номеров FT.
- `frontend/src/features/examinations/SampleSelection.tsx` — своя секция «Проба»; режимы — сегментированная radio-группа (активное состояние не только цветом); UUID пробы — вторичная техническая строка.
- `frontend/src/features/examinations/examinations.css` — 12-колоночная сетка, карточки участников/исследований, sticky-панель, счёт-заметка; стили журнала не менялись.
- `frontend/src/pages/ExaminationCreatePage.tsx` — заголовок: eyebrow «Новая запись», H1 «Создание карточки ВСЭ», легенда «\* обязательные поля», специалист вторично; обёртка `.vse-exam-page` (≤1180px, ритм 18px).
- `frontend/src/pages/ExaminationViewPage.tsx` — при правке факты партии показывает сама форма (без дублей); `specialistName` передаётся.

**Реестр иконок**
- `components/icons/VseIcon.js` + `README.md` + `ExamSectionIcons.stories.js` — `exam-participants` (весы), `exam-research` (лупа), `exam-sample` (колба).
- `frontend/src/shared/ui/icon.stories.tsx` — группа «Иконки разделов карточки ВСЭ».

**Тесты**
- `frontend/src/features/examinations/ExaminationComposition.test.tsx` — **новый**, 7 композиционных проверок §11.2.
- `frontend/tests/e2e/examinations.spec.ts` — H1 обновлён («Создание карточки ВСЭ»), readonly-факты проверяются по значениям fixture, добавлен e2e-тест композиции DR30 на 1440 + проверка отсутствия горизонтальной прокрутки на 390.

**Storybook**
- `frontend/src/features/examinations/examination.stories.tsx` — новые состояния: REUSE по умолчанию, трихинеллоскопия (свинина/конина), добавленные доп. исследования/болезни, правка ожидающей карточки (без ложного итога), busy/disabled панели действий.

**Инструментарий**
- `frontend/scripts/dr30-shots.mjs` — скриншоты маршрута с честными route-моками и макета на контрольных ширинах.

## 2. Скриншоты (до/после/эталон)

- `docs/implementation/evidence/dr30/baseline/w{1440,1024,768,390}.png` — страница **до** (base main).
- `docs/implementation/evidence/dr30/after/w{1440,1024,768,390}.png` — страница **после**.
- `docs/implementation/evidence/dr30/mockup/w{1440,1024,768,390}.png` — эталонный макет.

Снимки сделаны одной и той же программой (`dr30-shots.mjs`) с одинаковыми route-моками; живой маршрут проверен отдельной DOM-проверкой (H1 и шесть секций — см. §4).

## 3. Токены (в макете значения были, токена не было → добавлен токен, не хардкод)

`ui.css`, блок `.vse-app`, с комментарием «DR30»: `--app-section-radius: 18px`, `--app-section-shadow: 0 8px 24px #1f5a5b08`, `--app-panel-translucent: #ffffffed`, `--app-req: #bd3d48`, `--app-readonly-bg/-ink/-line` (f5f9f9 / 4f6768 / d8e5e5), `--app-heading-ink: #29474d`. Остальные значения выводятся из существующих токенов (`--app-line`, `--app-tint`, `--app-mandatory-tint/-line`, `--app-card-*`, `--app-input-line` и т.д.).

## 4. Выполненные проверки

| Проверка | Результат |
| --- | --- |
| `npm run typecheck` (tsc) | ✅ |
| `npm run lint` | ✅ 1 предсуществующее предупреждение catalogs (`use-catalog-context.ts`) |
| `npm run format:check` | ✅ (попутно отформатирован предсуществующе неотформатированный `ReceiptOperation.tsx`) |
| `npm test -- --run` | ✅ 58 файлов, 413 тестов |
| `npm run build` | ✅ |
| `npm run build-storybook` (frontend) | ✅ |
| `npm run build-storybook` (корневой каталог) | ✅ |
| e2e `examinations.spec.ts` (12 сценариев, vite dev + route-моки) | ✅ 12 passed |
| Живой DOM-осмотр маршрута (vite dev, route-моки): H1 «Создание карточки ВСЭ», шесть секций, три действия панели | ✅ |

## 5. Честно не выполнено в этой среде

- **Browser-сравнение пиксель-в-пиксель с развёрнутой системой** (§11.3, §13.12) — не запускалось: backend/данные в этой среде недоступны. Маршрут проверен в браузере с route-моками (скриншоты + DOM-проверка), финальное сравнение с макетом на живом URL — за контроллером (после merge+deploy).
- **Storybook-состояния «серверная ошибка» и «конфликт 409»** — не добавлены: статический Storybook не управляет `useCommand`; поведение покрыто unit- и e2e-тестами (409 сохраняет ввод, ошибка не выдаётся за успех).
- **jsdom-измерения геометрии** (горизонтальная прокрутка, перекрытие панелью) в unit-тестах невозможны — там проверяется классовый состав композиции; реальные измерения сделаны в e2e (ширина ≤1181px, overflow ≤0 на 390, зазор панель/контент ≥ −1px на 1440).

## 6. Соответствие ключевым запретам ТЗ (§4.2)

Черновик-кнопки нет; команды «Отправить в ожидание результата» / «Завершить ВСЭ» / «Отменить» сохранены; специалист — readonly ФИО (select отсутствует, тесты фиксируют); ручного выбора эВСД нет; поля «Номер решения…»/«Дата обращения» не добавлены; расчёт стоимости не фабрикуется (честное состояние «стоимость будет рассчитана сервером при сохранении…»); демонстрационные значения макета не переносятся (тест `queryByDisplayValue(/Шайдуллин|Хусаинова|…/)` = null); payload-контракт не изменён (тест POST-тела в `ExaminationComposition.test.tsx` и e2e-проверки payload).
