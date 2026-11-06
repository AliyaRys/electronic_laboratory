# electronic_laboratory

Электронная лаборатория ВСЭ: документация для разработки, HTML/JavaScript-макеты и библиотека компонентов Storybook. Серверная часть системы ещё не реализована.

## Документация

- [Технические задания и порядок реализации](docs/TZ_development/plans/README.md).
- [Архитектурные решения](docs/adr/README.md).
- [Продуктовые решения](product-design-records/README.md).
- [Запуск и работа со Storybook](STORYBOOK.md).

## Локальный запуск

Требуются Node.js с npm и Git. В PowerShell из папки проекта:

```powershell
npm.cmd ci
npm.cmd run storybook
```

Каталог компонентов открывается по адресу http://localhost:6006.

Для сборки каталога: `npm.cmd run build-storybook`. Для существующих UI-проверок после сборки: `npm.cmd run test:ui` (по умолчанию используется установленный Google Chrome).

## Контроль версий

Репозиторий: https://github.com/AliyaRys/electronic_laboratory. Основная ветка — `main`.

Перед новой задачей получите изменения и создайте отдельную ветку:

```powershell
git switch main
git pull --ff-only
git switch -c feature/task-name
```

Чтобы сохранить и отправить результат:

```powershell
git status
git diff
git add .
git diff --cached --stat
git commit -m "Describe the change"
git push -u origin HEAD
```

После отправки ветки создайте Pull Request в `main` на GitHub. Коммит сохраняет версию локально, а `push` отправляет её на GitHub; автоматически изменения не сохраняются.

Зависимости, сборки, временные файлы, отчёты тестов и локальные `.env` исключены через `.gitignore`. `package-lock.json`, исходники и проектная документация сохраняются в истории. Репозиторий публичный: перед коммитом проверяйте состав файлов; реальные пароли, токены и персональные данные в него добавлять нельзя.
