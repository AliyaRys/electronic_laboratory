# Журнал ВСЭ, сверка и таблицы стоимости Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: сначала применить `superpowers:systematic-debugging` и перепроверить описанные причины на актуальном `main`; затем выполнять план через `superpowers:subagent-driven-development` — отдельный implementer на каждую задачу, после него отдельный reviewer соответствия ТЗ и отдельный reviewer качества кода. Для интерфейсных решений обязательно использовать `frontend-design` и канонические правила проекта. После всех задач провести независимый whole-branch review. Все шаги отмечать чекбоксами `- [ ]`.

**Goal:** убрать лишние элементы из сохранённой карточки ВСЭ, исправить пояснение о сроке редактирования, привести журнал к макету `journal.html`, восстановить правильную компоновку сопроводительных документов и унифицировать сокращённые таблицы стоимости на сверке и в карточке ВСЭ.

**Architecture:** Серверные read/write-модели, расчёт тарифов и frozen pricing snapshots остаются неизменными. Исправления выполняются в существующих React-компонентах и общих CSS-владельцах. Журнал сохраняет серверную фильтрацию и URL-state, но воспроизводит композицию макета. Общий `SnapshotPricingTable` получает два явно проверяемых экранных варианта без копирования строк таблицы: live-карточка ВСЭ и сохранённая карточка ВСЭ.

**Tech Stack:** React 19, TypeScript, React Router, TanStack Query, React Hook Form, общие UI-компоненты проекта, CSS, Vitest/Testing Library/MSW, Storybook, Playwright, Docker Compose.

**Spec:** `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, `journal.html`, `journal-cards.css`, `vse-view.html`, `electronic-vse-journal.html`, `components/checks/`, `frontend/src/features/arrivals/`, `frontend/src/features/examinations/`, настоящее ТЗ.

## Global Constraints

- Перед изменением интерфейса полностью прочитать `AGENTS.md`, `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, затем текущую реализацию, тесты и похожие экраны.
- Начать от актуального `main` в отдельной ветке `feature/DR47-journal-reconciliation-pricing-ui-fixes`. Настоящее ТЗ добавить в эту же ветку отдельным первым коммитом.
- Не менять backend API, OpenAPI, модели БД, миграции, расчёт тарифов, frozen snapshots, права, маршруты или правила WAITING/COMPLETED.
- Не фильтровать серверные коллекции по текущей странице в браузере. Поиск, итог, автор, период, status, sort и page журнала остаются серверными параметрами и сохраняются в URL.
- Не копировать общие кнопки, tooltip, иконки, таблицы или SVG в страницы. Использовать существующие `Button`, `Tooltip`, `Icon`, `StatusView`, реестры и варианты общих компонентов.
- Макет `journal.html` — источник композиции, геометрии, интервалов и responsive-поведения, но не источник демонстрационных записей и не основание добавлять отсутствующие значения предметной модели.
- Точное бизнес-название продукта остаётся «Мясо и мясопродукты». UUID ВСД остаётся UUID ВСД; не возвращать устаревшее поле «Номер ВСД» только ради демонстрационного текста макета.
- Не добавлять «Условно-пригодно», пока backend-модель карточки поддерживает только `FIT` и `UNFIT`. Вкладка WAITING сохраняется.
- Денежные значения только отображаются из server snapshot через существующий `moneyLabel`; браузер не пересчитывает сумму и не использует `float`, `Number`, `parseFloat` или `toFixed`.
- `0.00` — настоящее значение, а не отсутствие. Удаление пояснения «Ярмарка» из сохранённой карточки не даёт права заменять нулевой total прочерком.
- Не выполнять живые запросы ВетИС, гашение, удаление внешних данных, очистку БД или volumes.
- Сохранить пользовательское изменение `.gitignore` и любые другие несвязанные изменения рабочего дерева; не включать их в feature-коммиты.

## Review Focus

- Сохранённая карточка с `fair=true` и total `0.00`: сумма видна как `0,00 ₽`, а элемент «Ярмарка» полностью отсутствует.
- Длинное название сопроводительного документа: две кнопки сравнения остаются соседними справа и не попадают между строками текста.
- Журнал на 390 px и при 200% zoom: фильтры и карточки перестраиваются в одну колонку, dropdown даты не выходит за viewport, page-level horizontal scroll отсутствует.
- Переключение COMPLETED/WAITING с активными фильтрами: URL и серверный запрос остаются согласованы, page сбрасывается на 1, default без `status` остаётся COMPLETED.
- Live и saved pricing: обе таблицы имеют четыре нужных столбца, но только live-форма сохраняет readonly-признак «Ярмарка»; сохранённая карточка не показывает его ни при true, ни при false.

---

## 1. Подтверждённые причины дефектов

### 1.1. «Ярмарка» на сохранённой карточке

`frontend/src/features/examinations/SavedPricingTable.tsx` уже вызывает
именованный вариант:

```tsx
<SnapshotPricingTable snapshot={snapshot} variant="saved-examination" />
```

Но `frontend/src/features/examinations/PricingSnapshotTable.tsx` выводит
`.vse-rec-invoice-waiver` **после** variant-условий и поэтому рендерит его для
обоих вариантов. Причина — общий безусловный footer-компонент, а не данные
конкретной карточки.

### 1.2. Непонятная служебная подсказка

В `ExaminationViewPage.tsx` пользователю показывается внутреннее обозначение
`AT-07` и формулировка про «действия над итогом ожидающей карточки». Она не
объясняет основное ограничение — редактирование и удаление доступны только в
день создания.

Новая точная формулировка:

> **Редактировать или удалить карточку можно только в день её создания.**

`AT-07` и внутренние коды в пользовательском тексте не показывать.

### 1.3. Журнал не повторяет макет

Текущий `ExaminationJournalPage.tsx` сохраняет правильную серверную модель,
но визуально отличается от `journal.html`:

- выводит отсутствующий в макете breadcrumb;
- объединяет четыре фильтра в одну строку вместо двух строк `3 + 2`;
- показывает два отдельных date-input вместо кнопки и popover с тремя
  режимами;
- использует другие размеры, padding и тени карточки;
- выводит текстовую ссылку «Просмотр» вместо icon-only кнопки с глазом;
- использует нейтральный completed badge вместо зелёного/красного outcome;
- пагинация прижата к списку и оформлена как текст «Страница N из M», а не
  как центрированная группа макета.

Серверная read-модель и URL-state являются рабочими и не подлежат замене
локальной фильтрацией из демонстрационного JavaScript макета.

### 1.4. Кнопка «Не соответствует» в тексте документа

Общий стиль в `reconciliation.css` задаёт:

```css
.vse-rec-check-buttons { display: contents; }
```

Это правильно только для обычного `.vse-rec-compare`, где две label-кнопки
должны стать отдельными детьми трёхколоночной grid-строки. Но
`DocumentComparisonField` помещает тот же wrapper внутрь
`.vse-rec-document-head` с двумя колонками. `display: contents` уничтожает
обёртку; две кнопки становятся отдельными grid-items, и третьему элементу
не хватает колонки — кнопка mismatch переносится в следующую строку среди
текста. Исправлять нужно контекст компонента документа, а не абсолютным
позиционированием.

### 1.5. Лишний столбец на сверке

`ReconciliationForm.tsx` прямо рендерит пять столбцов и отдельную ячейку
`pricingUnitLabel(line.unit_id)`. Для требуемого экрана единица расчёта не
несёт пользовательской ценности. Удаление касается только представления;
`unit_id` остаётся в snapshot и backend-расчёте.

### 1.6. Лишние столбцы и `tfoot` на форме ВСЭ

Общий `SnapshotPricingTable` сейчас разделяет только saved/live:

- saved уже имеет четыре столбца и внешний total;
- live всё ещё показывает «Единица», «Оценка» и `tfoot`.

Нужно оставить один mapper строк и привести live-вариант к четырём столбцам и
внешнему итогу. При этом оценки исследований не удаляются из карточек блока
«Исследования ВСЭ» и из frozen данных — они исчезают только из invoice table.

---

## 2. Целевое поведение и точный внешний вид

### 2.1. Сохранённая карточка ВСЭ: убрать «Ярмарка»

На `/labs/:labId/examinations/:examinationId` внутри блока «Расчёт стоимости
услуг» не должно быть:

```html
<label class="vse-rec-invoice-waiver" data-testid="pricing-waiver">…</label>
```

Требование действует при `snapshot.fair=false` и `snapshot.fair=true`.
Элемент не скрывать CSS: его не должно быть в DOM, accessibility tree и tab
order. Frozen `fair` остаётся в типе и данных; это изменение только readonly
представления.

При `fair=true` сохранённая сумма `0.00` отображается как `0,00 ₽`. Не выводить
вместо удалённого блока новую надпись, badge, tooltip или прочерк.

На live-форме создания/редактирования карточки ВСЭ readonly-пояснение
«Ярмарка» сохранить: пользователь должен видеть, почему сервер вернул
нулевую стоимость, пока он заполняет карточку. На странице сверки оставить
существующий интерактивный checkbox «Ярмарка».

### 2.2. Пояснение о редактировании и удалении

Заменить текущий текст на точный:

```text
Редактировать или удалить карточку можно только в день её создания.
```

Показывать его в том же предметном условии, в котором сейчас скрываются
same-day actions: пользователь имеет право работать с карточкой, но день
создания закончился. Не показывать сообщение пользователю, у которого этих
действий нет по роли независимо от даты.

Текст должен располагаться в зоне действий заголовка, корректно переноситься
и не расталкивать заголовок/секцию. На узком экране он занимает отдельную
строку под действиями. Цвет — существующий muted-readable, размер не меньше
12 px, без внутреннего кода `AT-07`.

### 2.3. Журнал ВСЭ — визуальное соответствие `journal.html`

Маршрут остаётся `/labs/:labId/examinations`. Заголовок остаётся точным для
текущей предметной области:

```text
Журнал ВСЭ мяса и мясопродуктов
```

#### 2.3.1. Разрешённое отличие от статического макета

Ранее владельцем уже утверждены две реальные вкладки:

- «Завершённые» (`COMPLETED`) — активна по умолчанию, если `status` отсутствует;
- «Ожидание результатов» (`WAITING`) — открывается только явно.

Их не удалять. Это единственное композиционное расширение макета, необходимое
для существующего функционального требования. Tabs расположить между title
row и панелью фильтров, использовать существующий общий стиль вкладок,
одинаковую ширину/высоту без скачков. Всё остальное в рабочей области журнала
должно повторять `journal.html`.

Не добавлять из демонстрационного макета неподдерживаемый outcome
«Условно-пригодно». Для WAITING фильтр «Итог ВСЭ» можно скрыть или disabled
только если это уже определено API/UX-контрактом; предпочтительно сохранить
геометрию и disabled с пояснением «Итог ещё не сформирован». Исполнитель не
должен менять это поведение без подтверждения существующими требованиями и
тестами.

#### 2.3.2. Рабочая область

- `max-width: 1180 px`;
- margin по центру;
- padding desktop `37px 24px 96px`;
- без breadcrumb `← Поступления`;
- title row margin-bottom `22 px`, h1 `30 px`, line-height `1.15`, letter-spacing
  `-0.035em`;
- общий shell/header не копировать и не переопределять в journal CSS.

#### 2.3.3. Панель фильтров

Одна белая секция `.vse-journal-filters`/business-named shared composition:

- `display:grid`, gap `13 px`;
- padding `16 px`;
- border `1px solid var(--app-line)`;
- radius `16 px`;
- shadow `0 8px 24px #1f5a5b08`;
- margin-bottom `18 px`.

Первая строка — ровно три колонки:

1. **Поиск** — `minmax(260px, 1.35fr)`, placeholder
   **«Хозяйство или UUID ВСД»**;
2. **Итог ВСЭ** — `minmax(180px, .85fr)`, «Все итоги», «Пригодно»,
   «Непригодно»;
3. **Автор** — `minmax(190px, .9fr)`, «Все авторы» и серверный список ФИО.

Не использовать подпись «Врач»: макет и пользовательский смысл требуют
«Автор». Значение фильтра остаётся `specialist_id`, запрос — server-side.

Вторая строка — две колонки:

1. **Сортировка** — `minmax(180px, .75fr)`, «Сначала новые» / «Сначала
   старые»;
2. **Период обращения** — `minmax(350px, 1.25fr)`, одна кнопка-trigger с
   иконкой календаря и кратким резюме.

Размеры поля:

- label: 11 px, uppercase, weight 760, letter-spacing `.06em`;
- input/select/trigger: width 100%, min-height `41 px`, border 1 px, radius
  `9 px`, padding `0 11 px`;
- focus: teal border и ring `0 0 0 3px #1b8b9130`;
- select использует существующий общий caret/стиль, не data-URI-копию, если
  проект уже имеет канонический select.

Date trigger открывает popover как в макете:

- top `calc(100% + 8px)`, right `0`, z-index не ниже `20`;
- width 100% колонки, но не выходит за viewport;
- padding `14 px`, radius `14 px`, border и shadow макета;
- закрытие: Escape, клик снаружи, «Применить», «Сбросить»;
- после закрытия фокус возвращается на trigger;
- режимы: **«Дата»**, **«Дата и время»**, **«Диапазон»**;
- active mode обозначен не только цветом и имеет `aria-pressed`/эквивалентную
  семантику;
- резюме: «Любая дата», `Дата: ДД.ММ.ГГГГ`,
  `Дата и время: ДД.ММ.ГГГГ ЧЧ:ММ`, либо
  `ДД.ММ.ГГГГ ЧЧ:ММ — ДД.ММ.ГГГГ ЧЧ:ММ`.

Серверные границы периода:

- «Дата»: Moscow `[00:00; 00:00 следующего дня)`;
- «Дата и время»: минутный интервал `[выбранная минута; +1 минута)`;
- «Диапазон»: начало включительно, конечная выбранная минута включительно в
  UI и передаётся серверу как exclusive `to = выбранное значение + 1 минута`;
- открытый край диапазона допускается, если текущий API это поддерживает;
- режим и введённые значения сохраняются в URL, Back/Forward и reload
  восстанавливают popover summary;
- изменение фильтра сбрасывает `page` на 1;
- invalid range (`from > to`) не отправляется: показать русскую inline-ошибку
  и оставить popover открытым.

Не применять debounce к select/date. Для search использовать существующий
debounce проекта либо отправку по Enter; нельзя посылать новый запрос на
каждый символ без отмены предыдущего. Старый ответ не должен перезаписать
более новый query state.

#### 2.3.4. Карточки журнала

Каждая реальная запись — `<article>` с композицией `.vse-card` макета:

- grid desktop:
  `166px minmax(0,.92fr) minmax(0,.95fr) minmax(0,.82fr) 154px 54px`;
- gap `12 px`, align-items center;
- padding `16px 18px`;
- white background, border 1 px, radius `14 px`;
- shadow `0 8px 24px #1f5a5b08`;
- hover border `#c8dddd`, shadow `0 12px 28px #1f5a5b10`;
- вторая колонка desktop получает left padding `22 px` как в макете.

Порядок колонок и подписи:

1. **Дата и время обращения** — `created_at`, формат Москва
   `ДД.ММ.ГГГГ ЧЧ:ММ`;
2. **Хозяйство** — `consignor_name`, честный fallback
   «Название не получено»;
3. **UUID ВСД** — `evsd_uuid`;
4. **Автор** — сохранённый `specialist_name`, не текущий пользователь и не
   UUID;
5. result/status badge;
6. icon-only действие просмотра.

Label: 11 px, weight 760, uppercase, letter-spacing `.06em`, muted, margin
bottom `3 px`. Value: weight 720, ellipsis в одной строке; полное длинное
значение доступно по focus/tooltip, а не только мышью.

Badges:

- COMPLETED + FIT: «Пригодно», зелёный `.good`;
- COMPLETED + UNFIT: «Непригодно», красный `.bad`;
- WAITING: «Ожидание результатов», жёлтый warning;
- неизвестный/повреждённый completed outcome не окрашивать зелёным или
  красным; показать честное «Итог не указан» нейтральным стилем и покрыть
  тестом.

Кнопка просмотра:

- реальная ссылка на `/labs/:labId/examinations/:examinationId`;
- общий secondary icon-only control `43 × 43 px`;
- существующая иконка глаза `admin-view`;
- `aria-label="Посмотреть карточку ВСЭ"`;
- tooltip с тем же текстом виден по hover и focus;
- никаких screen-local SVG.

#### 2.3.5. Пагинация, пустое и ошибочное состояние

Пагинация под списком:

- центрирована;
- gap `8 px`;
- margin-top `96 px` при непустом списке;
- стрелки и текущая страница `36 × 36 px`, radius `10 px`;
- слева предыдущая, затем текущий номер страницы с `aria-current="page"`,
  затем следующая;
- disabled arrow сохраняет место, имеет спокойный серый вид и native
  `disabled`;
- доступные имена «Предыдущая страница»/«Следующая страница»;
- не выводить рядом текст `Страница N из M`, которого нет в макете; общее
  количество страниц можно сообщать screen reader через visually-hidden/live
  region.

Пустое состояние визуально как `.empty-state` макета: белая карточка,
dashed border, radius `14 px`, padding `22 px`, текст
**«По заданным условиям записи не найдены»**. Ошибка сети остаётся общим
`StatusView` с retry; loading — общий `StatusView`, но контейнеры должны
сохранять геометрию страницы без layout shift.

#### 2.3.6. Responsive

- `≤1120 px`: обе filter rows переходят в две равные колонки;
- `≤980 px`: карточка — две колонки, left padding второй колонки сбрасывается,
  действие выравнивается слева;
- `≤800 px`: filter rows — одна колонка, date popover привязан слева и не шире
  viewport, карточка — одна колонка;
- 390 px и 200% zoom: page-level horizontal overflow отсутствует;
- не менять responsive общей шапки локальными journal-селекторами.

### 2.4. Сопроводительные документы: вернуть кнопки в одну группу

В `DocumentComparisonField` две кнопки всегда образуют одну визуальную группу
в правой части `.vse-rec-document-head`:

```text
[длинное название документа, может переноситься] [✓] [×]
```

Требования:

- wrapper `.vse-rec-check-buttons` остаётся реальным flex/grid container
  именно в контексте `.vse-rec-document-head`;
- `display:flex`, gap `6 px`, align-items center, justify-self end;
- обе кнопки `40 × 40 px`, не уменьшаются и не переносятся отдельно;
- head: `grid-template-columns:minmax(0,1fr) auto`, align-items start/center;
- название получает `min-width:0`, `overflow-wrap:anywhere` и не залезает под
  кнопки;
- generic `display:contents` сохраняется только для обычного
  `.vse-rec-compare` либо заменяется явным business-вариантом. Не применять
  глобальный override, который сломает обычные поля;
- на 390 px группа остаётся справа, а текст переносится в левой колонке;
- radio semantics, checked state, title/accessible labels, error association
  и раскрытие «Фактическое значение» не меняются.

Запрещено исправлять через `position:absolute`, отрицательные margin, ручные
`left/top` или перестановку кнопки после текста средствами JavaScript.

### 2.5. Таблица стоимости на странице сверки

В `ReconciliationForm` таблица должна иметь ровно четыре столбца:

1. **Услуга**;
2. **Количество**;
3. **Тариф**;
4. **Сумма**.

Не рендерить header «Единица расчёта» и соответствующий `<td>`. Поле
`line.unit_id` остаётся в snapshot и API, но не показывается.

Порядок числовых столбцов строго как выше. Total остаётся существующим:

```html
<p class="vse-rec-invoice-total">
  <span>Итого</span>
  <strong>… ₽</strong>
</p>
```

Интерактивный checkbox «Ярмарка» на сверке остаётся. На узком экране скролл
разрешён только внутри table-wrap; total и checkbox не должны уезжать вместе
с внутренним scroll или выходить из секции.

### 2.6. Таблица стоимости на форме создания/редактирования ВСЭ

Live `SnapshotPricingTable` в блоке «Расчёт стоимости услуг» должен иметь
ровно четыре столбца:

1. **Исследование**;
2. **Количество**;
3. **Тариф**;
4. **Сумма**.

Не рендерить «Единица», «Оценка» и их `<td>`. `EvaluationBadge` и критерий
нормы остаются в карточках блока «Исследования ВСЭ»; evaluation snapshot не
удаляется из данных.

Удалить `tfoot` в live-варианте. Сразу после таблицы вывести:

```html
<p class="vse-rec-invoice-total">
  <span>Итого</span>
  <strong>200,00 ₽</strong>
</p>
```

Сумма берётся только из `snapshot.total`. Readonly-индикатор «Ярмарка» на
live-форме остаётся после строки итога.

Saved-вариант использует те же четыре столбца и внешний total, но **не
рендерит «Ярмарка»** согласно 2.1. Не дублировать mapper строк и не скрывать
ячейки CSS. Целевой API допускается оформить так:

```ts
export type PricingTableVariant = "live-examination" | "saved-examination";
```

или эквивалентным именованным вариантом с явными правилами:

| Элемент | live-examination | saved-examination |
| --- | --- | --- |
| 4 столбца | да | да |
| внешний `p.vse-rec-invoice-total` | да | да |
| `tfoot` | нет | нет |
| readonly «Ярмарка» | да | нет |

---

## 3. План реализации

### Task 1: RED-тесты сохранённой карточки и текста ограничения

**Files:**

- Modify: `frontend/src/features/examinations/SavedPricingTable.test.tsx`
- Modify: `frontend/src/pages/ExaminationViewPage.test.tsx`

**Interfaces:**

- Consumes: `SavedPricingTable`, `ExaminationViewPage`, существующий
  `PricingSnapshotView`.
- Produces: зафиксированный contract отсутствия waiver в saved view и точной
  пользовательской формулировки.

- [ ] Добавить test `saved card never renders pricing waiver for fair false`:
  `queryByTestId("pricing-waiver") === null`.
- [ ] Добавить test `saved fair zero keeps total but omits waiver`: виден
  `0,00 ₽`, waiver отсутствует.
- [ ] Изменить старый тест DR46, который ошибочно требует waiver для saved.
- [ ] Добавить test старой карточки: exact text
  «Редактировать или удалить карточку можно только в день её создания.»;
  `AT-07` отсутствует, icon actions отсутствуют.
- [ ] Добавить отрицательный test роли без права: пояснение не показывается.
- [ ] Запустить только эти tests и зафиксировать RED по текущим причинам.
- [ ] Commit tests отдельно.

### Task 2: Варианты общей таблицы стоимости ВСЭ

**Files:**

- Modify: `frontend/src/features/examinations/PricingSnapshotTable.tsx`
- Modify: `frontend/src/features/examinations/SavedPricingTable.tsx`
- Modify: `frontend/src/features/examinations/PricingPreview.test.tsx`
- Modify: `frontend/src/features/examinations/SavedPricingTable.test.tsx`
- Modify: `frontend/src/features/examinations/examination.stories.tsx`
- Modify only if required: `frontend/src/features/examinations/examinations.css`

**Interfaces:**

- Produces: named variants `live-examination` and `saved-examination` с
  общей строкой table и различием waiver.

- [ ] Обновить variant API, не создавая копию таблицы.
- [ ] Для обоих вариантов рендерить только четыре столбца и внешний total.
- [ ] Для live сохранить waiver; для saved не рендерить его.
- [ ] Удалить ставшие неиспользуемыми `pricingUnitLabel`/`EvaluationBadge`
  imports только если они больше не нужны в этом файле; сами функции и
  evaluation UI других блоков не удалять.
- [ ] Test live: headers exact; «Единица», «Оценка», `tfoot` отсутствуют;
  внешний total и waiver присутствуют.
- [ ] Test saved: те же headers/total; waiver отсутствует при fair true/false.
- [ ] Test long name, `0.00`, normal total, empty lines и fair=true.
- [ ] Storybook: live normal, live fair, saved normal, saved fair-zero, long
  text, 390 px.
- [ ] Запустить tests, добиться GREEN, commit.

### Task 3: Понятное ограничение действий карточки

**Files:**

- Modify: `frontend/src/pages/ExaminationViewPage.tsx`
- Modify: `frontend/src/pages/ExaminationViewPage.test.tsx`
- Modify: `frontend/src/features/examinations/examinations.css`

- [ ] Заменить текст на exact copy из 2.2.
- [ ] Сохранить role/same-day condition и существующую логику late outcome.
- [ ] Обеспечить wrap внутри title action area без отрицательных margin и
  overflow.
- [ ] Tests: same-day actions видны и hint нет; после дня actions нет и hint
  есть; роль без права не получает ложный hint.
- [ ] GREEN, commit.

### Task 4: Исправить группу сравнения сопроводительного документа

**Files:**

- Modify: `frontend/src/features/arrivals/reconciliation.css`
- Modify only if a named variant is needed:
  `frontend/src/features/arrivals/DocumentComparisonField.tsx`
- Create: `frontend/src/features/arrivals/DocumentComparisonField.test.tsx`
- Modify: relevant Storybook story in reconciliation/check components

**Interfaces:**

- Consumes: существующая `DocumentComparisonFieldProps` без изменения
  payload.
- Produces: устойчивый document-head layout; обычный ComparisonField остаётся
  без изменений.

- [ ] Test DOM: radiogroup остаётся wrapper с двумя label; обе radio имеют
  правильные accessible names и checked state.
- [ ] Component/browser test с названием 120+ символов: bounding boxes обеих
  кнопок находятся в одной строке, справа от текстовой колонки и внутри card.
- [ ] Добавить scoped rule/variant из 2.4; не менять generic grid semantics
  обычного поля.
- [ ] Проверить mismatch: открывается фактическое значение и reason, кнопки не
  перемещаются.
- [ ] Storybook: normal, match, mismatch, error, long label, 390 px.
- [ ] GREEN, commit.

### Task 5: Сократить таблицу стоимости сверки

**Files:**

- Modify: `frontend/src/features/arrivals/ReconciliationForm.tsx`
- Modify: `frontend/src/features/arrivals/ReconciliationForm.test.tsx`
- Modify only if widths require: `frontend/src/features/arrivals/reconciliation.css`
- Modify relevant Storybook story

- [ ] Обновить RED-test: exact четыре headers в порядке из 2.5; header/ячейка
  unit отсутствуют.
- [ ] Удалить только presentation cell и неиспользуемый import; snapshot и
  submit payload не менять.
- [ ] Проверить две услуги, long service name, normal price, zero/fair price.
- [ ] Проверить внешний total и интерактивную «Ярмарку».
- [ ] Browser test на 390 px: локальный table scroll при необходимости,
  total/waiver внутри секции, page overflow отсутствует.
- [ ] GREEN, commit.

### Task 6: Перестроить журнал по `journal.html`

**Files:**

- Modify: `frontend/src/pages/ExaminationJournalPage.tsx`
- Modify: `frontend/src/pages/ExaminationJournalPage.test.tsx`
- Modify: `frontend/src/features/examinations/examinations.css`
- Modify: `frontend/src/features/examinations/examination.stories.tsx`
- Reuse: `frontend/src/shared/ui/Button.tsx`
- Reuse: `frontend/src/shared/ui/Tooltip.tsx`
- Reuse: `frontend/src/shared/ui/Icon.tsx` (`admin-view`, `calendar`)
- Possibly create a focused journal date-filter component next to the page if
  `ExaminationJournalPage.tsx` would otherwise mix popup state, URL parsing
  and rows in one large unit.

**Interfaces:**

- Consumes: `fetchJournal(query, signal)`, `fetchJournalAuthors`, existing
  `JournalQuery`, URL params.
- Produces: same API behavior in the exact target composition; helper parsing
  functions for date mode must be unit-testable and timezone-explicit.

- [ ] Сначала добавить tests структуры: no breadcrumb; one filter panel;
  row1 search/outcome/author; row2 sort/date trigger; exact labels.
- [ ] Добавить URL/query tests для date, datetime и range, включая Moscow
  half-open boundaries, reload и invalid range.
- [ ] Добавить row tests FIT/UNFIT/WAITING/missing outcome, exact label order,
  icon-only link and route.
- [ ] Добавить pagination/empty tests по 2.3.5.
- [ ] Запустить и зафиксировать RED.
- [ ] Перестроить JSX без изменения fetch/read model. Удалить breadcrumb.
- [ ] Реализовать authored date popover с Escape/outside/focus return. Если в
  проекте уже есть канонический date popover, расширить/переиспользовать его.
- [ ] Привести CSS к точным значениям 2.3; не копировать shell rules.
- [ ] Outcome badge class вычислять из `view.status + view.outcome`, а не только
  из tab status.
- [ ] Текстовую ссылку просмотра заменить общей icon-only link/button
  композицией с Tooltip и `admin-view`.
- [ ] Реализовать центрированную пагинацию макета, сохранив server page.
- [ ] Добавить Storybook states: completed FIT, completed UNFIT, waiting,
  missing outcome, empty, loading, error, long values, open date popover,
  1180/980/800/390 px.
- [ ] Unit GREEN, commit.

### Task 7: Интеграционная и визуальная проверка

- [ ] `npm.cmd run test -- ExaminationJournalPage ReconciliationForm DocumentComparisonField PricingPreview SavedPricingTable ExaminationViewPage` из `frontend` — GREEN.
- [ ] `npm.cmd run typecheck` из `frontend` — GREEN.
- [ ] `npm.cmd run lint` из `frontend` — GREEN или честно зафиксирован только
  pre-existing unrelated failure.
- [ ] `npm.cmd run build` из `frontend` — GREEN.
- [ ] `npm.cmd run build-storybook` из `frontend` и `npm.cmd run build-storybook`
  из корня для затронутых двух каталогов — GREEN, если оба остаются частью
  проекта.
- [ ] `npm.cmd run test:e2e` из `frontend` и затронутый `npm.cmd run test:ui`
  из корня — GREEN.
- [ ] Проверить реальным Chrome, не только jsdom:
  1. saved examination fair false/true;
  2. старую карточку и новый hint;
  3. журнал COMPLETED/WAITING и все фильтры;
  4. длинный сопроводительный документ match/mismatch;
  5. сверочную стоимость;
  6. live стоимость создания ВСЭ.
- [ ] Viewports: 1440, 1180, 1024, 980, 800, 768, 390 px и 200% zoom.
- [ ] Для документов browser assertion по bounding boxes: обе кнопки имеют
  одинаковый `top`, расстояние между ними `6 px`, находятся внутри head/card.
- [ ] Для каждого viewport проверить
  `document.documentElement.scrollWidth === clientWidth`; допускается только
  локальный scroll table-wrap.
- [ ] Снять screenshots и записать пути/команды в evidence.

### Task 8: Review, merge и обновление контейнеров

- [ ] После каждой задачи отдельный spec-review и code-quality review; fixes
  отдельными коммитами и повторным review.
- [ ] Whole-branch reviewer сверяет все шесть требований, макет, URL-state,
  accessibility, responsive и отсутствие server/business изменений.
- [ ] Заполнить `Implementation evidence` настоящего ТЗ: commits, tests,
  screenshots, not-run.
- [ ] Убедиться, что feature-ветка содержит ТЗ, реализацию, tests и stories,
  но не содержит несвязанное изменение `.gitignore`.
- [ ] Слить `feature/DR47-journal-reconciliation-pricing-ui-fixes` в `main`
  отдельным merge-коммитом (`--no-ff`) и отправить feature/main в remote.
- [ ] Пересобрать и пересоздать frontend-контейнер актуальной Compose-командой
  проекта. Backend/worker/DB не пересобирать без изменения их кода.
- [ ] Проверить health всех контейнеров и smoke через
  `http://127.0.0.1:8080`: login → журнал → карточка → сверка → создание ВСЭ.
- [ ] Во время smoke не удалять данные, не гасить ВСД и не выполнять ВетИС
  write-вызовы.
- [ ] Финальный `git status` чист относительно изменений задачи; `main` и
  remote содержат merge-коммит.

---

## 4. Критерии приёмки

- [ ] На сохранённой карточке ВСЭ элемента «Ярмарка» нет в DOM при любом fair.
- [ ] Fair total `0,00 ₽` на сохранённой карточке остаётся видимым.
- [ ] Старый пользовательский текст заменён точной короткой формулировкой без
  `AT-07`.
- [ ] Журнал визуально повторяет `journal.html`: рабочая ширина, title,
  двухрядные фильтры, date popover, карточки, badges, eye-action, pagination,
  empty state и responsive.
- [ ] Вкладки COMPLETED/WAITING сохранены; default — COMPLETED.
- [ ] Фильтры журнала серверные, URL восстанавливается после reload/Back.
- [ ] В сопроводительном документе ✓ и × всегда стоят рядом справа и не
  попадают в текст даже при длинном названии.
- [ ] На сверке нет столбца «Единица расчёта» и соответствующих ячеек.
- [ ] В live-таблице ВСЭ нет «Единица», «Оценка» и `tfoot`; итог — внешний
  `p.vse-rec-invoice-total`.
- [ ] В live-форме «Ярмарка» остаётся; в saved view отсутствует.
- [ ] Backend payload, frozen values, права и маршруты не изменились.
- [ ] Нет page-level horizontal overflow на 390 px и 200% zoom.
- [ ] Unit/type/build/Storybook/E2E зелёные; feature с ТЗ слита в `main`, remote
  обновлён, frontend-контейнер пересобран и smoke пройден.

## 5. Обязательные анти-регрессии

- [ ] Обычные `ComparisonField` по-прежнему используют три колонки; scoped
  исправление документа не складывает их кнопки в одну ячейку.
- [ ] Mismatch документа сохраняет reason и structured actual value.
- [ ] Изменение UI таблиц не удаляет `unit_id`, evaluation или fair из API и
  snapshot.
- [ ] Отсутствующий snapshot остаётся сообщением «Расчёт стоимости не
  сохранён.», а не пустой таблицей или нулём.
- [ ] WAITING journal не показывает ложный FIT/UNFIT.
- [ ] Неизвестный completed outcome не окрашен как успешный.
- [ ] Date/time не сдвигается браузером из Moscow в локальную/UTC дату.
- [ ] Старый ответ поиска не заменяет более новый результат.
- [ ] Tooltip кнопки просмотра доступен клавиатурой, а ссылка сохраняет
  нормальную навигацию и доступное имя.
- [ ] Общая шапка не получает journal-specific override.

---

## 6. Implementation evidence

Заполняет исполнитель до merge:

- Feature branch: `feature/DR47-journal-reconciliation-pricing-ui-fixes` (worktree `C:\electronic_lab_dev-dr47`, base main 2975d25)
- Commit ТЗ: `e0f1fc6` docs: DR47 journal, reconciliation and pricing UI spec
- Implementation commits: `d846e19` (task 1 red), `efa4301` (task 2), `7c98843` (task 3), `251c71d`+`0e7adb5` (task 4), `f760064`+`614756e` (task 5), `6b7b55a`+`9bf6e34` (task 6), `ebafa18` (gates cleanups)
- Review/fix commits: не выполнялись отдельными reviewer-субагентами (по брифу контроллера reviewer-агентов не создавать); самопроверка правил ТЗ выполнена по ходу
- Whole-branch review: не проводился (Task 8 — контроллер)
- Unit tests: `npm.cmd test -- --run` из `frontend` — 73 files / 629 tests PASSED (vitest; css:false, jsdom)
- Typecheck/lint/build: `typecheck` 0, `lint` 0, `build` 0 (все из `frontend`)
- Storybook: `npm.cmd run build-storybook` из `frontend` — 0; из корня — 0 (после `npm.cmd ci`)
- UI/E2E: `npm.cmd run test:e2e` — 78 passed / 20 failed: все падения — таймаут логина/сценариев без работающего backend (`identity-seed.local.json` скопирован из main-репо; backend в этой среде не запущен); затронутые DR47 спеки (examinations 9–11) падают тем же способом. `npm.cmd run test:ui` (корень) — 229 passed / 67 failed, из них 34 — pre-existing (на main тоже 34 failed); дополнительные 33 — Storybook-истории корневого каталога свежей сборки с axe `color-contrast` и т. п. — корневые `components/` макеты веткой не менялись (git diff main без frontend пуст, кроме evidence-скриншотов из коммита ТЗ)
- Browser screenshots 1440/1180/980/800/390 and 200%: not-run — в этой среде нет работающего backend/контейнеров для живых страниц; контроллер повторит (макетная геометрия перенесена из `journal.html`/CSS-значений §2.3)
- Docker Compose rebuild/health: not-run (Task 8 — контроллер)
- Smoke result: not-run (Task 8 — контроллер)
- Merge commit in `main`: not performed (Task 8 — контроллер)
- Remote push: not performed (Task 8 — контроллер)
- Honest not-run / pre-existing failures: см. UI/E2E и screenshots выше; также не создавались reviewer-субагенты и не менялись backend/OpenAPI/модели/миграции/права/маршруты; `acceptance.local.json` main-репо не тронут; Playwright-прогон `test:ui` перезаписал evidence-скриншоты в worktree — восстановлены через `git checkout -- docs/implementation/evidence`

### 6.1. Fix-loop DR47 (review finds)

- Commit: `fix: journal date URL compatibility and popover escape (DR47 review)` — worktree `C:\electronic_lab_dev-dr47`, ветка `feature/DR47-journal-reconciliation-pricing-ui-fixes`; merge/push не выполнялись.
- Find 1 (major, URL-совместимость): `journalDateOf` в `ExaminationJournalPage.tsx` — отсутствие `date_mode` при наличии `from`/`to` теперь интерпретируется как режим «Диапазон» (старые ссылки `?from=…&to=…` больше не теряют период); date-only границы обрабатываются `journalDateWindow` (from → `T00:00:00+03:00`, to → следующий день, полуприкрытое окно как у режима «Дата»). Тест: старая ссылка восстанавливает summary «01.11.2026 — 10.11.2026» и серверный запрос.
- Find 2 (major, popover): Escape в `JournalDateFilter.tsx` обрабатывается на контейнере popover (`onKeyDown` на корневом div) — работает из trigger, кнопок режимов и любого input; после закрытия фокус возвращается на trigger. Тест: Escape при фокусе в input закрывает поповер.
- Find 3 (minor): debounce-таймер поиска снимается на unmount (`useEffect` cleanup).
- Find 4 (minor): `searchDraft` синхронизируется из URL при смене параметра `q` (Back/Forward); при pending debounce draft не затирается. Тест: навигация на URL с `q=…` обновляет поле поиска.
- Gates (все из `frontend`): `npm.cmd test -- --run` — 73 files / 632 tests PASSED; `typecheck` 0; `lint` 0; `build` 0.
- Not-run: Storybook/браузер/E2E и прочее из §6 — без изменений (нет работающего backend в среде).
