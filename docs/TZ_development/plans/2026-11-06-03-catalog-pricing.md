# Нормы и тарифы Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать конфигурацию исследований и воспроизводимую серверную стоимость.

**Architecture:** catalog_pricing владеет активными правилами и тарифами; рабочие операции получают независимые снимки. Массовая цена — одно намерение и отдельная транзакция на лабораторию.

**Tech Stack:** SPEC-03, Decimal, PostgreSQL, React forms.

**Spec:** DATA-04, API-03, inputs INPUT-02/03/05; ФТ 06 и VSE-03–05, ADR-020. Зависит I/F.

## Global Constraints

- «Строка стоимости: тариф×принятое количество, округление ROUND_HALF_UP до 0,01; итог — сумма округлённых строк».
- «Ярмарка: все сохранённые начисления и суммы равны 0»; гипотетический тариф в рабочем снимке отсутствует.
- «Свинина/конина определяются согласованными идентификаторами».
- Каталог не может выключить обязательность исследования, заданную ФТ.

## Review Focus

- Цена отсутствует и цена ноль: C01 различает их.
- Половина копейки 0,005: C01 округляет до 0,01.
- Старое правило удалено: C01 читает snapshot, не новый каталог.
- Чужая лаборатория среди массовых целей: C02 отклоняет весь охват до записи.
- Частичная ошибка массовой записи: C02 повторяет только failed, не succeeded.

### Task C01: Правила, расчёт, снимок

**Files:** создать `backend/src/modules/catalog_pricing/{models,schemas,service,commands,queries,router}.py`, миграцию `0002_catalog_pricing.py`, `backend/tests/catalog_pricing/test_pricing.py`, `backend/tests/catalog_pricing/test_rules.py`.

**Interfaces:** `evaluate_and_price(uow,request,previous)->PricingSnapshot` из DATA-06/API-03; `readiness(lab_id,product_species_id)->Readiness`; typed rule schema из inputs.

- [x] Написать тесты assert Decimal('3')*100.10→300.30; 0.005→0.01; 4 единицы×100×2 performed→800.00; fair→все 0.00 и нет ordinary price; missing price→CONFIGURATION_MISSING, явный 0 допустим. `test_previous_snapshot_survives_catalog_delete` assert старый показатель остаётся по 100, новый по 150; отклонение нормы не назначает outcome.
- [x] Запустить `uv run --frozen pytest backend/tests/catalog_pricing/test_pricing.py backend/tests/catalog_pricing/test_rules.py -v`, получить FAIL.
- [x] Создать типизированные нормы/единицы/границы с включённостью/источником; mandatory набор из FT; internal masses scale6, price scale2. Для существующего результата применять прежнюю норму/цену, нового — текущую; оценка по типу правила, UNKNOWN обязательного блокирует. Две услуги CHECK не смешивать с VSE: отдельный context и performed факт/время. Классификации не угадывать по строке. CRUD editors строго scoped.
- [x] Тестировать границы нормы below/on/above, qualitative, pH0/14, microscopy0; no floats; отсутствие нужной нормы блокирует также fair. Пройти coverage≥90% pricing и SQL constraints.
- [x] Зафиксировать: `feat: add versioned method rules and decimal pricing`.

### Task C02: Редакторы и массовые цены

**Files:** создать `backend/src/modules/catalog_pricing/bulk.py`, `backend/tests/catalog_pricing/test_bulk.py`, `frontend/src/pages/CatalogsPage.tsx`, `frontend/src/features/catalogs/{MethodEditor,TariffEditor,CheckServiceEditor,BulkPriceDialog}.tsx` и stories/tests, `frontend/tests/e2e/catalogs.spec.ts`; изменить router.

**Interfaces:** API-03 CRUD/readiness/bulk; BulkPriceJob targets status PENDING/SUCCEEDED/FAILED. Заведующий редактирует только свои; массовая команда ADMIN/ANALYST.

- [ ] Написать `test_scope_prevalidation` assert целиком 403 при одной чужой цели и 0 изменённых; `test_partial_retry` assert А/Б succeeded не повторяются, В failed→success; `test_independent_lab_prices` assert после bulk А=Б 100, правкаА 150 оставляетБ 100. UI test удаление нормы предупреждает блокировку будущего сохранения, старый snapshot прежний.
- [ ] Запустить `uv run --frozen pytest backend/tests/catalog_pricing/test_bulk.py -v` и адресные frontend tests, ожидается FAIL.
- [ ] Реализовать неизменяемый job + независимые SQL-транзакции target, actual results по целям, safe retry; доступ заново на каждую цель. UI показывает охват до подтверждения и частичный результат. Удаление active позиции не трогает Mercury classification/фиксированные роли/snapshots; нет наследования лабораторий. Отсутствующие реальные INPUT показывать в readiness; fixture цены только тесты.
- [ ] Проверить роли через прямые запросы, AT-14/15/21, SC-093–097, build-storybook и экран 390/1440; полный C01 regression.
- [ ] Зафиксировать: `feat: add scoped catalogs and independent bulk pricing`.
