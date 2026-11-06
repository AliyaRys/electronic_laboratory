# Компоненты профиля

`profile.html` и Storybook используют один код из этой папки. Экран повторно использует общие рабочие `Button`, `InfoField` и системные иконки из `components/app/`.

## API

| Функция | Параметры | Результат |
| --- | --- | --- |
| `createSummary(options)` | имя, логин, инициалы, права, типы продукции, `disabled`, `onPhotoSelect(file)` | Карточка пользователя с `.photoInput` |
| `createPasswordChangeForm(options)` | `idPrefix`, `open`, `disabled`, `busy`, `error`, `onSubmit` | Раскрываемая форма с `setOpen`, `setBusy`, `setError`, `.fields`, `.toggleButton`, `.submitButton` |
| `createScreen(options)` | `user`, `title`, состояния формы, обработчики фото и пароля | Основное содержимое профиля с `.summary` и `.passwordForm` |

`onSubmit` получает `{ currentPassword, newPassword }`, может вернуть `{ error }` или завершиться успешно. Поля маскированы, используют `current-password` и `new-password`, не сохраняются. Макет не меняет реальный пароль и не загружает фото на сервер.

Блок «Доступные типы продукции» выводится только при непустом списке продукции. Если продукция не назначена, блок не рисуется.

`createScreen` строит поля по данным пользователя: при наличии `user.city` вместо «Учреждение» выводится широкое поле «Город/МО», при наличии `user.role` вместо «Должность» выводится поле «Роль». Профиль администратора (`admin_makets/admin-profile.html`) использует `city: 'г. Казань'`, `role: 'Администратор'` и пустой список продукции, а заголовок задаёт через `title`.

Общая шапка приложения создаётся `components/shell/AppHeader.js`, подключается через `app-shell.js` и показана отдельным компонентом Storybook. Экран профиля её не копирует.
