# Общие компоненты рабочих экранов

Этот слой задаёт небольшие базовые элементы для экранов после входа. Он не заменяет компоненты авторизации: у входа другая плотность и визуальная роль.

## API

| Функция | Параметры | Результат |
| --- | --- | --- |
| `createIcon(name)` | `key`, `check`, `user`, `meat`, `milk`, `camera` | Декоративная SVG-иконка |
| `createButton(options)` | `label`, `busyLabel`, `variant` (`secondary`, `primary`, `danger`), `type`, `icon`, `iconOnly`, `disabled`, `busy`, `onClick` | Нативная кнопка с `setBusy` и `setDisabled`. `danger` используется только для подтверждения необратимых или прерывающих доступ действий. |
| `createInfoField(options)` | `label`, `value`, `wide` | Неизменяемая пара «подпись — значение» |
| `getCompletedTransportStatusTone(kind, value)` | `kind` (`cargo`, `combined`), сохранённое значение | Семантическое состояние `positive`, `negative` или `neutral` |
| `applyCompletedTransportStatuses(root)` | корневой элемент или `document` | Применяет состояние к карточкам с `data-completed-status` |

Канонические токены этого слоя находятся в `tokens.css`; `app.css` содержит общие состояния. Все компоненты создают безопасный текст через `textContent`. У кнопки-иконки обязательное доступное имя берётся из `label`.

`evsd-check-values.css` задаёт общую белую поверхность для значений из эВСД на экранах сверки. На сохранённых сверках он также окрашивает ответы о состоянии грузового отделения и совместной перевозке по правилам `CompletedCheckStatus.js`. Таблица состава партии сохраняет собственное оформление.

`vse-library-select.css` задаёт единое оформление раскрывающихся списков Choices.js на экранах создания ВСЭ. Инициализация и синхронизация выполняются через `globalThis.MilkVseSelects`.
