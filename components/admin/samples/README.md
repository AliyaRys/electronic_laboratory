# Учёт проб

Компонент реализует отчёт по текущим остаткам проб и истории их утилизации. Страница и Storybook подключают один runtime: `SampleData.js` и `SampleAccounting.js`.

## Подключение

После `VseApp`, `VseIcons`, `VseReports` и их стилей подключите:

- `SampleData.js` — демонстрационные данные и операции регистра;
- `SampleAccounting.js` — экран, таблицы, фильтры и диалог;
- `samples.css` — оформление и адаптивность.

## API

- `VseSampleAccounting.createScreen(options)` создаёт экран учёта. Поддерживаются `initialLaboratoryId`, `initialState` (`ready`, `loading`, `error`, `empty`), `canDispose`, `showLaboratorySelector` и `restoreState`.
- `VseSampleAccounting.createDisposalDialog({ onSaved })` создаёт диалог регистрации полной утилизации остатка.
- `VseSampleAccounting.getBalances(laboratoryId)` возвращает остатки по всем 20 видам продукции.
- `VseSampleAccounting.getAvailableSamples(laboratoryId)` возвращает доступные физические отборы.
- `VseSampleAccounting.getDisposals(laboratoryId)` возвращает историю утилизаций.
- `VseSampleAccounting.downloadXlsx(laboratoryId)` формирует XLSX по текущим остаткам.
- `VseSampleAccounting.createPrintView(laboratoryId)` создаёт белую печатную форму для PDF и печати.
- `VseSampleAccounting.registerDisposal(data)` атомарно списывает весь актуальный остаток выбранного вида продукции. Частичное списание в MVP не поддерживается.
- `VseSampleAccounting.resetDemo()` очищает локальные изменения демонстрационного регистра.

Утилизацию разрешается показывать только ролям, которым доступна операция. Для остальных ролей передавайте `canDispose: false`; перераспределение раздела по ролям выполняется отдельно.
