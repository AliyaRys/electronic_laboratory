# UI: соответствие эталонов и новой SPA

Перед изменением интерфейса исполнитель читает целиком `DESIGN.md`, `UX-CONTRACT.md`, `STORYBOOK.md`, затем README владельцев и существующий похожий экран. ФТ v2/O приоритетнее старых mock labels/сценариев. В DESIGN.md уже присутствуют участки с искажённой кодировкой текста: это состояние baseline, его нельзя копировать в русский интерфейс или исправлять массово в рамках отдельного компонента. Токены и доступные значения подтверждаются owners CSS/README. Этот пакет UI-файлы не изменяет.

## UI-01. Маршруты

Новая SPA всегда содержит контекст `labId` и реальный UUID сущности. Legacy route resolver работает с query `party_id`, `examination_id`, `report_id`, `user_id`; проверяет API-доступ и перенаправляет на canonical URL. Без identity для detail нельзя угадывать хозяйство по именифайла/порядку строки. Показывается «Запись не указана» с доступным списком. Старые demo-specific названия не являются ключом production. List URL может выбрать только очередь, сохранив согласованные фильтры.

| Эталонные HTML / группа | Canonical SPA route | Владелец задачи |
| --- | --- | --- |
| login.html | /login | F03 |
| password-recovery.html, password-recovery-sent.html | /password-help (инструкция обращения, без email) | F03 |
| profile.html, admin_makets/admin-profile.html | /profile | F03 |
| arrivals.html | /labs/:labId/arrivals?queue=expected | A01 |
| arrivals-work.html | /labs/:labId/arrivals?queue=work | A01 |
| arrivals-accepted.html | /labs/:labId/arrivals?queue=accepted | A01 |
| evsd-check*.html (мясные), complete варианты | /labs/:labId/arrivals/:partyId/reconciliation | A02 |
| journal.html | /labs/:labId/examinations | E04 |
| electronic-vse-journal*.html (мясные) | /labs/:labId/arrivals/:partyId/examination/new | E04 |
| vse-view*.html (мясные) | /labs/:labId/examinations/:examinationId | E04 |
| conclusion-*.svg / print actions | /labs/:labId/arrivals/:partyId/conclusion | D02 |
| directories.html, directory-norms-edit.html | /catalogs, /catalogs/methods?labId=... | C02 |
| directory-price-edit.html, directory-paid-services-edit.html | /catalogs/tariffs?context=vse, /catalogs/tariffs?context=check | C02 |
| admin_makets/admin-users.html, user create/edit/history/status/delete | /users, /users/new, /users/:id/edit, /users/:id/history; status/delete — диалоги | F03 |
| admin_makets/sample-accounting*.html | /labs/:labId/reports/samples; print той же read model | S03 |
| admin_makets/admin-reports.html, create/view/print | /labs/:labId/reports, /labs/:labId/reports/new, /labs/:labId/reports/:reportId | R03 |
| analyst_makets/ и zaveduushii_lab/ | Те же canonical working/report routes по текущим capability, не отдельные копии | F02/R03 |
| milk, additional-vet-inspection, directory-repeat-price, conditional/bad legacy demos вне новых правил | Честное «Функция не входит в текущую версию», доступный возврат; безсоздания данных | F02 |

`vse-view-bad` может использоваться как визуальный образец нового UNFIT, но старые conditional treatments не переносятся. Все остальные HTML inventory исполнитель F02 фиксирует в `docs/implementation/legacy-routes.json` с disposition supported-list/supported-detail/out-of-scope/reference-only; отсутствие файла в таблице не даёт права молча сломать существующий макет. Старый каталог/HTML сохраняют дисковое открытие script dependencies; story-support.js не подключать как HTML ESM.

## UI-02. Владение компонентами

| Возможность | Источник эталона | Новая canonical реализация |
| --- | --- | --- |
| Auth screen/field/button | components/auth/README.md; VseAuth | frontend features/identity, auth styles отдельные; не использовать auth размеры на рабочих экранах |
| Working button/info/alerts | components/app/README.md + tokens.css | shared/ui, styles по рабочим токенам |
| Header | components/shell/AppHeader.js/app-header.css/README.md | shared/ui/AppHeader.tsx, один владелец геометрии/интервалов, без локальных override страниц |
| Icons | components/icons/VseIcon.js и README.md | shared/ui/legacy-icons.ts adapter к реестру, не новая SVG-копия |
| CheckSection/Comparison/PriorConclusion | components/checks/README.md | features/arrivals, один код+stories |
| Research/findings | components/research/ и VSE field catalogue | features/examinations, обязательный tone из app research-tone.css |
| Users/reports/samples | components/admin/ и docs/admin-mockups | features соответствующего модуля, пути admin_makets не определяют права |

Для разделов «Документ», «Участники перевозки», «Идентификация продукции», «Идентификация транспорта», «Сопроводительные документы», «Ранее проведённая ВСЭ», «Расчёт стоимости» использовать закреплённые keys data-check-section из icons README. Не перерисовывать SVG в JSX/stories. Нет нужного key — сначала общий реестр+Storybook. React wrapper может монтировать global API или адаптировать данные реестра, но SVG source остаётся одним. Styles header и styles рабочего контрола не копировать в страницы.

## UI-03. Общие acceptance states

У каждого применимого компонента stories обычное/disabled/error/loading/long/narrow. Приложение различает loading/empty/no matches/forbidden/blocked/no product/not found/network error/UNKNOWN. Сохранение не оптимистическое. Ошибка оставляет доступный ввод, отзыв очищает закрытый ввод/кеш. Query включает user/lab/product, cancel+keys защищают от позднегоответа. Dirty leave/switch/cancel подтверждаются, никакого скрытого автосохранения.

Keyboard menu Escape, trap/return focus dialogs, safe cancel first, aria labels/errors, видимый focus. Text+color статус, полные длинные значения доступны без hover. Ширины 1440/1024/768/390; горизонтальная прокрутка только в таблице, не всей странице. Медицинский ввод в memory, filters/page в URL, persist отключён. На итоговых экранных данных не показывать механизмы SQL/outbox/XML; технический trace/code доступен как деталь ошибки для поддержки.
