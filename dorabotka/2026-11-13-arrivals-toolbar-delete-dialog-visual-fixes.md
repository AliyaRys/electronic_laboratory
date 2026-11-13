# ТЗ на исправление визуальных дефектов страницы поступлений

Дата: 13.11.2026  
Тип задачи: frontend visual fixes + shared dialog layering + arrivals actions

## 1. Цель

Исправить три визуальных дефекта на странице поступлений, не меняя бизнес-логику
обновления, скрытия партий, polling операций и серверные контракты.

Затрагиваемый маршрут:

```text
/labs/:laboratoryId/arrivals
```

Канонические источники:

- `DESIGN.md`;
- `UX-CONTRACT.md`;
- `STORYBOOK.md`;
- `frontend/src/pages/ArrivalsPage.tsx`;
- `frontend/src/features/arrivals/ArrivalsScreen.tsx`;
- `frontend/src/features/arrivals/arrivals.css`;
- `frontend/src/features/arrivals/ArrivalTables.tsx`;
- `frontend/src/shared/ui/DataTable.tsx`;
- `frontend/src/shared/ui/Dialog.tsx`;
- `frontend/src/shared/ui/ui.css`;
- существующие stories и tests поступлений/Dialog.

Использовать существующие общие `Button`, `DataTable`, `Dialog` и токены. Не
создавать локальную копию диалога или отдельный вариант кнопки только для одной
страницы.

## 2. Подтверждённое текущее поведение

### 2.1. Статус автоматического обновления

Сейчас `ArrivalsScreen` выводит `syncStatus` отдельным абзацем после
`arrivals-title-row`:

```text
Поступления                                      [Обновить]
Автообновление из ВетИС каждые 15 минут
```

Нужно визуально связать этот статус именно с кнопкой обновления.

### 2.2. Подзаголовок EXPECTED

Для очереди `EXPECTED` описание берётся из общего
`STAGE_DESCRIPTIONS`/`STAGE_DESCRIPTIONS[queue]`:

```text
Транспортные эВСД из системы «Меркурий», где получателем указана текущая лаборатория
```

После перестановки статуса оно должно быть немного опущено вниз, чтобы не
возникал чрезмерный пустой промежуток между заголовком и подзаголовком.

### 2.3. Действия строки и удаление

Скрытие ожидаемой партии рендерится внутри общего контейнера:

```html
<div class="app-table-row-actions">
  <a class="app-table-icon-action">...</a>
  <button class="arrivals-icon-action danger" ...>...</button>
</div>
```

Общие стили `DataTable` и глобальный `:focus-visible` применяются к action
container/кнопкам. Нужно сохранить focus только на реально сфокусированном
элементе, не подсвечивать всю область actions и не менять соседнюю ссылку
«Сверить».

Общий `Dialog` на Radix Portal имеет `.app-dialog-overlay` и `.app-dialog`, но
сейчас не задаёт явные уровни `z-index`. Из-за этого контент диалога может
оказаться под overlay/другим stacking context, а текст становится плохо
читаемым.

## 3. Исправление панели обновления

### 3.1. Требуемая композиция

На desktop справа в заголовке должна быть вертикальная группа:

```text
                              Автообновление из ВетИС каждые 15 минут
                                                            [Обновить]
```

Требования:

- текст статуса находится непосредственно над кнопкой «Обновить»;
- правый край текста совпадает с правым краем кнопки;
- статус не выходит вправо за границы кнопки;
- текст выравнивается по правому краю (`text-align: right`), а не по левому;
- ширина группы определяется шириной кнопки либо не превышает её ширину;
- длинный статус переносится внутри этой ширины, не расширяя страницу;
- кнопка сохраняет текущие размеры, variant, accessible name, busy/disabled
  состояния и обработчик `runSync()`;
- во время retry/busy меняется только существующий текст busy/status, геометрия
  группы не прыгает.

Разрешённая структурная форма:

```tsx
<div className="arrivals-sync">
  <p className="arrivals-sync-status">Автообновление из ВетИС каждые 15 минут</p>
  <Button>Обновить</Button>
</div>
```

Но источник текста должен остаться единым: не дублировать статус одновременно в
старом месте `ArrivalsScreen` и в панели кнопки.

### 3.2. Адаптивность

На узком экране:

- группа остаётся справа/под заголовком согласно существующей responsive-сетке;
- текст не обрезается и не выходит за viewport;
- разрешён перенос на 2 строки внутри ширины кнопки;
- кнопка остаётся полностью доступной для pointer и keyboard;
- проверить 1440, 1024, 800, 390 px и 200% zoom.

## 4. Исправление вертикального ритма подзаголовка

После переноса `syncStatus` над кнопкой изменить только локальный spacing
заголовка поступлений:

- `arrivals-title-row` не должен получать лишнюю высоту из-за status text;
- абзац `Транспортные эВСД...` опустить на небольшой согласованный интервал
  относительно заголовка;
- не добавлять большой margin, который снова создаёт пустой участок;
- на narrow layout сохранить существующее вертикальное расположение и не
  допустить наложения подзаголовка на sync group;
- описание других очередей (`WORK`, `ACCEPTED`) не должно измениться.

Проверить визуально, что до stage tabs/filters нет резкого провала пустого
пространства и что высота заголовочного блока стабильна при статусах loading,
retry и error.

## 5. Исправление focus/hover области кнопки скрытия

### 5.1. Только кнопка

Для кнопки:

```html
<button
  type="button"
  class="arrivals-icon-action danger"
  aria-label="Скрыть поступление из очереди"
  title="Скрыть поступление из очереди"
>
  ...
</button>
```

Требуется:

- hover background/border применяются только к `.arrivals-icon-action.danger`;
- `focus-visible` outline применяется только к этой кнопке;
- `.app-table-row-actions` не получает border/background/outline при фокусе
  дочерней кнопки;
- соседняя ссылка «Сверить» не меняет фон и границу;
- action cell таблицы не окрашивается целиком;
- иконка и 40×40 touch target сохраняются;
- `aria-label`, `title`, клавиатурное действие и callback `onHide` сохраняются;
- pointer/keyboard focus states должны быть различимы, но не выглядеть как
  подсветка всей группы.

Не удалять общий глобальный focus-ring для остальных кнопок. Если для icon
action нужен более точный selector, ограничить его `.arrivals-icon-action` и
не менять стили всех `.app-table-row-actions`.

### 5.2. Не менять поведение скрытия

Нажатие кнопки по-прежнему:

1. открывает подтверждающий Dialog;
2. не переходит на сверку;
3. не скрывает строку до подтверждения;
4. после ошибки сохраняет диалог/ошибку;
5. после успеха обновляет список и счётчики по текущему контракту.

## 6. Исправление слоя Dialog

### 6.1. Stacking order

В общем `frontend/src/shared/ui/ui.css` задать явный порядок:

```text
app-dialog-overlay: ниже контента диалога, выше страницы;
app-dialog: выше overlay и всех таблиц/шапки/стicky элементов.
```

Конкретные значения выбрать централизованно и документировать рядом с
селектором, например overlay `z-index: 1000`, content `z-index: 1001`, если они
не конфликтуют с токенами проекта.

Требования:

- затемнение покрывает страницу и таблицу;
- белая карточка диалога полностью видна над затемнением;
- заголовок, описание, error и buttons имеют нормальный контраст;
- диалог не оказывается под `AppHeader`, sticky action cell или другим Portal;
- не использовать `!important` без доказанной необходимости;
- не создавать отдельный z-index только для arrivals delete dialog;
- Radix focus trap, Escape и возврат focus к исходной кнопке сохраняются.

### 6.2. Состояния Dialog

Проверить общий Dialog в состояниях:

- обычное подтверждение скрытия партии;
- danger border/title;
- длинное описание;
- ошибка после отказа backend;
- busy confirm;
- narrow viewport и 200% zoom.

Если исправление общего слоя меняет другие диалоги, обновить их regression
tests/stories, а не делать локальное исключение.

## 7. Тесты и визуальная проверка

### Unit/component

1. `ArrivalsScreen` рендерит sync status внутри/над sync button group, не в
   отдельном нижнем месте.
2. Status text имеет right alignment и ограниченную ширину относительно button.
3. Описание EXPECTED остаётся видимым и получает новый небольшой spacing.
4. Focus/hover class/style скрытия привязаны к кнопке, а не к action group.
5. Нажатие delete button вызывает только `onHide` и не вызывает ссылку сверки.
6. Dialog после открытия имеет title/description/confirm/cancel поверх overlay.
7. Escape/Cancel возвращают focus на исходную delete button.
8. Error и busy состояния не ломают stacking и читаемость.

### Storybook

Добавить/обновить состояния arrivals:

- EXPECTED с обычным статусом;
- retry/busy статус с длинным текстом;
- narrow 390 px;
- action buttons: hover и keyboard focus на delete отдельно от соседнего
  «Сверить»;
- открытый danger delete Dialog на фоне таблицы.

### Browser/e2e

Проверить реальный маршрут страницы поступлений в Chrome на 1440/1024/800/390
px и при 200% zoom:

- правый край status line совпадает с правым краем «Обновить»;
- status line не выходит за кнопку;
- описание EXPECTED не имеет лишнего вертикального провала;
- focus-ring виден только у активной кнопки;
- Dialog читается поверх overlay;
- длинное описание диалога прокручивается внутри карточки, страница не
  получает нежелательный горизонтальный overflow.

## 8. Docker, данные и Git

После реализации выполнить frontend-проверки и пересобрать контейнеры без
удаления данных:

```powershell
cd C:\electronic_lab_dev\frontend
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build-storybook
npm.cmd run build
npm.cmd run test:e2e

cd C:\electronic_lab_dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend vetis-worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Не выполнять `docker compose down -v`, destructive reset/seed и не удалять
пользователей, партии, ВСД, сверки, ВСЭ, пробы или отчёты.

Работать в feature-ветке. ТЗ добавить в тот же commit с кодом. После проверок:

1. проверить `git status` и `git diff`;
2. отправить feature-ветку в GitHub;
3. выполнить `git pull --ff-only` для `main`;
4. объединить feature-ветку с `main` без force-push;
5. отправить обновлённый `main` в GitHub.

При защищённом `main` создать Pull Request. В отчёте указать фактические
результаты тестов, Storybook/browser-проверки, Docker и merge/push.

## 9. Критерии готовности

- строка «Автообновление из ВетИС каждые 15 минут» находится над кнопкой
  «Обновить» и не выходит за её правый край;
- подзаголовок про транспортные эВСД имеет согласованный небольшой отступ;
- focus/hover delete выделяет только delete button;
- delete Dialog полностью отображается поверх overlay и читаем;
- существующие доступные имена, keyboard focus, delete behavior и refresh
  behavior сохранены;
- tests, Storybook, browser checks и Docker rebuild выполнены;
- feature-ветка вместе с этим ТЗ объединена с `main` и отправлена в GitHub либо
  создан Pull Request.
