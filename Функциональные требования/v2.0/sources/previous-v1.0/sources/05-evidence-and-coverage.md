# Источники и охват исследования

**Исследование 21–22.10.2026 · выпуск v1.0 от 22.10.2026.**

## 1. Фиксация версии и изменения

Репозиторий получен через Git: `https://github.com/AliyaRys/el_vse_lab.git`.

- Исследованное исходное состояние: `0c954ca8c24554be7964844625306e128e750be9`, commit «Обновление макетов», 21.10.2026 14:36 МСК.
- По прямому указанию владельца удалён только файл «ТЗ_бэкенд_Электронная_лаборатория_ВСЭ.docx». [Commit удаления](https://github.com/AliyaRys/el_vse_lab/commit/55e6f83d6e0446cf881ec7206f847b5b39dab1c3) опубликован в `main`; удалённое состояние проверено по GitHub remote.
- Содержимое удалённого ТЗ исключено из оснований PDR. Его технологии, роли, нагрузки и эксплуатационные числа не перенесены.
- 22.10.2026 по D-26 в макетах удалены кнопки, диалоги и обработчики отправки заключений в Max; скачивание и печать сохранены. Также обновлены DESIGN.md и UX-CONTRACT.md. [Изменение c0ae401](https://github.com/AliyaRys/el_vse_lab/commit/c0ae401e8179637cbd346693f00963a154d0c63e) опубликовано в `main`; совпадение полного commit SHA проверено по remote. Аудит исходных экранов выше относится к закреплённому исходному commit.
- Документы этого комплекта сохранены отдельно для согласования и не опубликованы в репозиторий.

## 2. Приоритет свидетельств

Прямые ответы текущего чата имеют приоритет над репозиторием. Явные решения в документации сильнее случайного демонстрационного значения. Конфликты между документацией и реализацией сохраняются в аудите, а не разрешаются молча. Для внешних действий отдельно рассматриваются НПА и техническая документация выбранного профиля; техническая возможность API не доказывает нормативную допустимость произвольной операции.

Предыдущее обсуждение прочитано доступным инструментом. Текст ответов прежнего ассистента вернулся как непрозрачные ссылки; из него не извлекались и не приписывались владельцу дополнительные решения.

## 3. Источники репозитория

Ссылки закреплены за исходным commit, чтобы вывод можно было воспроизвести после дальнейших изменений. ID обозначает группу связанных материалов.

| ID | Назначение | Материалы |
|---|---|---|
| S-01 | Замысел, путь врача, пилот, нормативные ориентиры | [база знаний.txt](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/%D0%B1%D0%B0%D0%B7%D0%B0%20%D0%B7%D0%BD%D0%B0%D0%BD%D0%B8%D0%B9.txt); [Исходные поля журнала](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/journal%20laboratia.txt) |
| S-02 | Мясная сверка и предыдущая ВСЭ | [evsd-check-usmanov.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-usmanov.html); [Ветвление частичной приёмки](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-agro.html#L278); [evsd-check-usmanov-complete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-usmanov-complete.html); [evsd-check-agro-complete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-agro-complete.html) |
| S-03 | Создание ВСЭ и молочная сверка | [electronic-vse-journal-agro.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal-agro.html#L122); [electronic-vse-journal-biektau.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal-biektau.html); [electronic-vse-journal-kazan-bacon.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal-kazan-bacon.html); [milk-vse-create.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-vse-create.js#L45); [Разбор фактического числа](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-evsd-check.js#L47); [Ветвление завершения](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-evsd-check.js#L147); [vse-invoice.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-invoice.js) |
| S-04 | Части, итоги и сохранённые карточки | [vse-part-outcomes.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-part-outcomes.js); [vse-view.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view.html); [vse-view-conditional.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view-conditional.html); [vse-view-bad.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view-bad.html); [milk-section-research.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-section-research.js) |
| S-05 | Транспорт после ВСЭ | [Запасное количество](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-transport-vsd.js#L13); [Демонстрационные номера](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-transport-vsd.js#L22) |
| S-06 | Общий контракт администрирования | [docs/admin-mockups/README.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/docs/admin-mockups/README.md#L25); [docs/admin-mockups/03-user-edit.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/docs/admin-mockups/03-user-edit.md); [docs/admin-mockups/05-user-block.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/docs/admin-mockups/05-user-block.md); [docs/admin-mockups/06-user-delete.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/docs/admin-mockups/06-user-delete.md); [docs/admin-mockups/08-user-history.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/docs/admin-mockups/08-user-history.md) |
| S-07 | Пять прав и шесть категорий доступа | [docs/admin-mockups/04-access-editor.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/docs/admin-mockups/04-access-editor.md); [components/admin/AdminData.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/components/admin/AdminData.js) |
| S-08 | Реальная реализация административных макетов | [components/admin/README.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/components/admin/README.md); [components/admin/AdminDemoStore.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/components/admin/AdminDemoStore.js); [admin_makets/admin-users.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-users.html); [admin_makets/admin-user-create.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-create.html); [admin_makets/admin-user-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-edit.html); [admin_makets/admin-user-history.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-history.html) |
| S-09 | Нормы и молочные показатели | [Общий base для десяти продуктов](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-norms-data.js#L8); [milk-directory-data.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-directory-data.js); [milk-norms.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-norms.js); [directory-norms-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit.html) |
| S-10 | UX-контракт, дизайн и справочники | [UX-CONTRACT.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/UX-CONTRACT.md); [DESIGN.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/DESIGN.md); [directories.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directories.html); [directory-price-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-price-edit.html); [directory-repeat-price-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-repeat-price-edit.html) |
| S-11 | Заключения и завершённые поступления | [conclusion-permit.svg](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/conclusion-permit.svg); [conclusion-print.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/conclusion-print.js); [arrivals-accepted.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/arrivals-accepted.html); [milk-accepted-parties.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-accepted-parties.js); [accepted-concepts/README.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/accepted-concepts/README.md) |
| S-12 | Повторный осмотр | [additional-vet-inspection-create.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/additional-vet-inspection-create.html); [additional-vet-inspection-create-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/additional-vet-inspection-create-milk.html); [milk-repeat-inspection.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-repeat-inspection.js); [Сохранение наблюдаемого остатка](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/milk-repeat-inspection.js#L59) |
| S-13 | Вход, восстановление и профиль | [components/auth/README.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/components/auth/README.md); [components/profile/README.md](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/components/profile/README.md); [components/auth/RecoveryForm.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/components/auth/RecoveryForm.js); [components/profile/ProfileScreen.js](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/components/profile/ProfileScreen.js) |

Дополнительно изучены README, AGENTS, Storybook-описания, компоненты оболочки и доступные тестовые сценарии авторизации, профиля и истории администратора. Старые инструкции вида «ещё реализовать» сопоставлены с наличием реальных страниц и компонентов.

## 4. Внешние первичные источники

Проверены 21.10.2026. Для правил приёмки использована найденная актуальная редакция приказа № 862 от 07.05.2025, действующая с 01.09.2025, размещённая в справочной системе Россельхознадзора. Конкретный продуктивный профиль интеграции, полномочия лаборатории и поведение тестового сервиса не проверены.

| ID | Источник | Предел использования |
|---|---|---|
| W-01 | [Профиль MercuryG2B 3.0](https://help.vetrf.ru/wiki/MercuryG2B:Services:v3.0) | Наличие сервисов и профиля; не подтверждение выдачи доступа конкретной организации |
| W-02 | [ProcessIncomingConsignment v3.0](https://help.vetrf.ru/wiki/MercuryG2B:ProcessIncomingConsignment:v3.0) | Поля приёмки, расхождения и возврата; в тексте сохранилось описание ±5% |
| W-03 | [UpdateVeterinaryEvents v3.0](https://help.vetrf.ru/wiki/MercuryG2B:UpdateVeterinaryEvents:v3.0) | Лабораторные мероприятия; наличие события не доказывает его применимость как полной ВСЭ |
| W-04 | [ProcessIncomingConsignment v2](https://help.vetrf.ru/wiki/ProcessIncomingConsignment_v2) | Различение сценариев фактической приёмки и возврата; не выбранная версия интеграции |
| W-05 | [Гашение в Меркурий.ГВЭ](https://help.vetrf.ru/wiki/Гашение_продукции,_поступившей_по_электронным_ВСД) | Актуализированная инструкция с ограничением увеличения 1%; конфликт с API явно сохранён в документе 04 |
| W-06 | [Приказ № 862, редакция 07.05.2025, на сайте Россельхознадзора](https://help.vetrf.ru/images/8/8a/Order862_20251119.pdf.pdf#page=24) | Изучены применимые к приёмке пп. 21–27 приложения № 2 и сведения о редакции; не заявляется полный аудит 117 страниц |
| W-07 | [Корректировка объёма отправителя по акту](https://help.vetrf.ru/wiki/Возврат_объема_отправителю_по_Акту_несоответствия_в_Меркурий.ХС) | Отдельная операция отправителя, отличная от физического возврата |
| W-08 | [Сценарии приёмки входящей партии](https://help.vetrf.ru/wiki/Сценарии_приёмки_входящей_партии) | Сценарий полного приёма фактической партии с расхождением |
| W-09 | [Официальное опубликование приказа № 269, сведения Минюста](https://minjust.consultant.ru/documents/31386?items=100) | Подтверждены реквизиты исходного акта; актуальная методическая матрица по всем видам мяса в этой работе не утверждена |

| W-10 | [GetVetDocumentByUuid v3.0](https://help.vetrf.ru/wiki/MercuryG2B:GetVetDocumentByUuid:v3.0) | В ответе описаны признак проведённой ВСЭ и сведения о лабораторных исследованиях; полнота данных конкретного входящего ВСД и достаточность для печатного заключения не проверены |
| W-11 | [Скан исходного приказа № 269 в FAOLEX](https://faolex.fao.org/docs/pdf/rus211478.pdf); [регистрация изменения № 501 от 16.05.2023](https://minjust.consultant.ru/documents/47955?items=100) | Дополнительно прочитаны положения исходной редакции о рынке и журнале. Это не проверенная сводная редакция на дату запуска и не утверждённая методическая матрица |

Приказ № 421 и технические регламенты по молоку названы в репозитории. Проверка всех применимых редакций, методов и числовых норм для каждого вида молочной продукции не выполнена; поэтому молочные значения в PDR не признаны нормативно правильными.

## 5. Что проверено в браузере

Открыты 69 HTML-страниц проекта (включая альтернативные концепции, исключая служебный `.storybook/preview-head.html`). Получены фактически отрисованные тексты и значения полей. Это проверка отображаемого состояния, не полная проверка всех действий на всех страницах.

Визуально просмотрены репрезентативные экраны поступлений «В работе» и «Завершённые», мясной сверки и создания ВСЭ, условного результата, молочного создания ВСЭ и справочника норм, повторного осмотра, создания и редактирования пользователя. Для редактирования пользователя дополнительно открыт действительный `?user=u-1001`; открытие без ID само по себе показывает «не найден», что не считается дефектом карточки.

На общем маршруте `access-denied.html` без параметра причины зафиксирована ошибка «Неизвестная причина отказа в доступе». Полная матрица демонстрационных причин не тестировалась; этот технический случай не использован как доказательство нарушения реального разграничения доступа.

### Воспроизведённые граничные случаи

Путь: молочная сверка «Ак Барс» → «Все соответствует» → допустимые условия перевозки → расхождение поля объёма → ввод факта → «Завершить». Исходный объём 120 л. Внешних операций не было.

| Ввод | Фактически показано макетом |
|---|---|
| 130 | Полное гашение исходных 120 л, возврат 0 |
| 100 | Частичное гашение 100 л, возврат 20 л |
| 0 | Частичное гашение 0 л, при этом 3 секции приняты |
| −1 | Частичное гашение 1 л, возврат 119 л |
| abc | Полное гашение исходных 120 л, возврат 0 |

Проверки сделаны по результатам реальных обработчиков страницы, а не по ожиданиям теста. Мясная сверка имеет другое ветвление: вывод об автоматическом полном гашении излишка не распространён на все мясные страницы.

## 6. Полный перечень открытых HTML-страниц

Ниже указан факт открытия страницы. Для JS-генерируемых форм изучались также компоненты и данные; это не означает ручное прохождение каждой ветки.

### Рабочие мясные и общие страницы (29)

- [additional-vet-inspection-create.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/additional-vet-inspection-create.html)
- [additional-vet-inspection-view-882.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/additional-vet-inspection-view-882.html)
- [arrivals-accepted.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/arrivals-accepted.html)
- [arrivals-work.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/arrivals-work.html)
- [arrivals.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/arrivals.html)
- [directories.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directories.html)
- [directory-norms-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit.html)
- [directory-price-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-price-edit.html)
- [directory-repeat-price-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-repeat-price-edit.html)
- [electronic-vse-journal-agro.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal-agro.html)
- [electronic-vse-journal-biektau.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal-biektau.html)
- [electronic-vse-journal-kazan-bacon.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal-kazan-bacon.html)
- [electronic-vse-journal.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal.html)
- [evsd-check-agro-complete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-agro-complete.html)
- [evsd-check-agro.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-agro.html)
- [evsd-check-complete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-complete.html)
- [evsd-check-usmanov-complete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-usmanov-complete.html)
- [evsd-check-usmanov.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-usmanov.html)
- [evsd-check.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check.html)
- [journal.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/journal.html)
- [login.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/login.html)
- [password-recovery-sent.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/password-recovery-sent.html)
- [password-recovery.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/password-recovery.html)
- [profile.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/profile.html)
- [vse-view-agro.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view-agro.html)
- [vse-view-bad.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view-bad.html)
- [vse-view-biektau.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view-biektau.html)
- [vse-view-conditional.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view-conditional.html)
- [vse-view.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view.html)

### Молочные страницы (24)

- [additional-vet-inspection-create-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/additional-vet-inspection-create-milk.html)
- [additional-vet-inspection-view-milk-204.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/additional-vet-inspection-view-milk-204.html)
- [arrivals-accepted-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/arrivals-accepted-milk.html)
- [arrivals-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/arrivals-milk.html)
- [arrivals-work-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/arrivals-work-milk.html)
- [directory-norms-edit-milk-butter-unsalted.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-butter-unsalted.html)
- [directory-norms-edit-milk-cheese-hard.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-cheese-hard.html)
- [directory-norms-edit-milk-curd.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-curd.html)
- [directory-norms-edit-milk-drinking-cream.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-drinking-cream.html)
- [directory-norms-edit-milk-drinking-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-drinking-milk.html)
- [directory-norms-edit-milk-ice-plombir.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-ice-plombir.html)
- [directory-norms-edit-milk-kefir.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-kefir.html)
- [directory-norms-edit-milk-sour-cream.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-sour-cream.html)
- [directory-norms-edit-milk-yogurt.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk-yogurt.html)
- [directory-norms-edit-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-norms-edit-milk.html)
- [directory-price-edit-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-price-edit-milk.html)
- [directory-repeat-price-edit-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/directory-repeat-price-edit-milk.html)
- [electronic-vse-journal-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/electronic-vse-journal-milk.html)
- [evsd-check-milk-ak-bars-complete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-milk-ak-bars-complete.html)
- [evsd-check-milk-ak-bars.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-milk-ak-bars.html)
- [evsd-check-milk-nur-complete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-milk-nur-complete.html)
- [evsd-check-milk-nur.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/evsd-check-milk-nur.html)
- [journal-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/journal-milk.html)
- [vse-view-milk.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/vse-view-milk.html)

### Администрирование (10)

- [admin_makets/access-denied.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/access-denied.html)
- [admin_makets/account-blocked.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/account-blocked.html)
- [admin_makets/admin-access-editor.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-access-editor.html)
- [admin_makets/admin-user-create.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-create.html)
- [admin_makets/admin-user-delete.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-delete.html)
- [admin_makets/admin-user-edit.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-edit.html)
- [admin_makets/admin-user-history.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-history.html)
- [admin_makets/admin-user-status.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-user-status.html)
- [admin_makets/admin-users.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/admin-users.html)
- [admin_makets/no-products.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/admin_makets/no-products.html)

### Альтернативные концепции (6)

- [accepted-concepts/concept-1.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/accepted-concepts/concept-1.html)
- [accepted-concepts/concept-2.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/accepted-concepts/concept-2.html)
- [accepted-concepts/concept-3.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/accepted-concepts/concept-3.html)
- [accepted-concepts/index.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/accepted-concepts/index.html)
- [accepted-concepts/vse-card.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/accepted-concepts/vse-card.html)
- [work-card-concepts.html](https://github.com/AliyaRys/el_vse_lab/blob/0c954ca8c24554be7964844625306e128e750be9/work-card-concepts.html)

## 7. Методика и ограничения

Superpowers найден установленным и включённым. Прочитаны `using-superpowers` и `brainstorming`; применены исследование контекста, уточнение намерения, последовательное интервью, сравнение альтернатив и явное разделение принятых и предлагаемых решений. Это продуктовый аудит и подготовка записей: разработка приложения, её планирование и утверждение технической архитектуры не выполнялись.

Для чтения исходного DOCX использовались инструкции documents; после указания владельца источник исключён и удалён. Для чтения нормативного PDF использовались инструкции pdf. Новые DOCX/PDF не создавались: итоговые материалы — Markdown, пригодный для версионирования и дальнейшего согласования.

Не выполнялись реальные вызовы Меркурия/Цербера, проверка реквизитов доступа, отправка в Max/почту, оценка промышленной защиты, нагрузочное тестирование или проверка замены бумажного учёта на практике. Имеющиеся тесты интерфейса не выдаются за доказательство предметной или нормативной корректности.

## 8. Проверка изменения каналов выдачи — 22.10.2026, D-26

Удалены кнопки, диалоги ввода телефона, демонстрационные обработчики и стили Max из мясных и молочных макетов. Изменены 11 файлов; скачивание и печать используют прежние реализации и документы. Изменение не добавляет молочный бэкенд.

- Открыты 8 экранов в Chrome, включая 6 экранов с удалённой отправкой и два соседних. На этих страницах ошибок JavaScript не было.
- На 6 изменённых экранах выполнены 8 скачиваний заключений; проверено содержимое файлов SVG. Клавиатурное скачивание работает. Формат файла сохранён из существующего прототипа; новый формат этим решением не выбирался.
- Выполнены 8 действий печати с перехватом `window.print`: подтверждён вызов браузерной печати после загрузки документа. Физическая печать на принтере не проверялась.
- Проверены широкая и узкая ширина 390 px; просмотр повторных осмотров на мясной и молочной страницах открывается, показывает записи и закрывается Escape.
- `npm.cmd run build-storybook` завершился успешно. Настроенный статический аудит premium UI до и после изменения — 0 замечаний в объявленной области авторизации и профиля; это не полный аудит всех старых макетов.
- `npm.cmd run test:ui`: 192 пройдено, 32 ошибки. Ошибки относятся к неизменённым сценариям: ожиданию счётчика пользователей, отсутствующей странице `account-activation.html`, проверке корневого элемента отдельных stories и контрасту компонентов/профиля. Общий набор тестов не объявляется проходящим. Исправления этих сценариев не включены в удаление Max.
- Проверены отсутствие сценариев Max в изменённых HTML/JS/CSS, сохранность дизайн-токенов и чистота diff. После публикации рабочая копия Git чистая.

## 9. Дополнение по индивидуальным пользователям и ХС — 22.10.2026

По D-37 у каждого врача есть своя учётная запись Меркурия. Повторно проверен W-02: логин инициатора гашения отделён от логина базовой аутентификации; для перевозки без смены владельца поле ХС-владельца сохраняет значение отправителя, а площадка указывается отдельно. Это выявило проверку A-27 для совместной трактовки D-07/08. Реальный входящий эВСД и сопоставление учётных записей ещё не получены; работоспособность конкретной операции не подтверждена. В аудите теперь 27 находок, включая эту незавершённую проверку; исходные 26 находок сохранены.

## 10. Завершение PDR — 22.10.2026

Комплект v1.0 учитывает 48 прямых решений интервью и содержит 16 PDR. Повторяющиеся открытые продуктовые вопросы закрыты ответами; технические и предметные проверки выделены в реестр следующего этапа. Неутверждённые рекомендации не повышены до решений автоматически. Дополнительные ответы: излишек и возврат (D-45), ручной остаток (D-46), бумажная подпись (D-47), ручная работа в Меркурии при неудачной отправке без разбора каждой ошибки (D-48).

**Точность нормативного вывода W-11:** в исходном приложении № 2 к приказу № 269 пункты 27–28 различают поступление с прежней ВСЭ и проведение ВСЭ на рынке; пункты 32–33 рассматривают передачу результатов в ФГИС и журнал на рынке. Упоминание электронной формы в пункте 24 относится к журналам в местах убоя: переносить его без проверки на рынок нельзя. Это вывод из прочитанного исходного текста, не заключение о текущей нормативной допустимости всего MVP. [Исходный текст, страницы 21–26](https://faolex.fao.org/docs/pdf/rus211478.pdf#page=21).

Найдено официальное опубликование изменения № 501; актуальность всех положений и методические нормы не объявлены полностью проверенными. Отдельная копия редакции с изменениями на сайте `mosbbg.ru` открылась, но извлечение её текста искажено; по нему не делались новые содержательные выводы. Повторные точечные обращения к справке ВетИС во время финализации частично возвращали HTTP 503; полнота живого API не подтверждена. Ранее зафиксированное расхождение описаний допусков остаётся задачей проверки выбранного профиля, а не произвольно выбранным процентом.

**Что проверяет выпуск:** согласованность статусов, ссылки и нумерацию документов/решений/сценариев, сохранение решений интервью и состав архива. Это не клиническая валидация исследований и не испытание реального Меркурия. Продуктовый код и документы в GitHub этим выпуском не менялись; новая самостоятельная публикация не выполнялась.
