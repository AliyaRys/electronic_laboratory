# DR-Tails backend — evidence (2026-11-17)

Ветка: `codex/tails-backend` (worktree `C:\electronic_lab_dev-tails-b`, BASE `main` c5ab436). Не мержилось и не пушилось.

## 1. DR38 — XSD pinning (обязательный блокер закрыт)

- Официальный набор схем ВетИС.API скачан с `api.vetrf.ru/schema/platform/services/2.0-last/` (промышленный «last»-набор v2.0, namespace `mercury/vu/applications/v2` + `mercury/vet-document/v2` и зависимости; g2b-вариант того же набора закреплён для справки).
- Закреплено офлайн: `backend/tests/fixtures/vetis/xsd/` (8 файлов) + `manifest.sha256` (SHA-256 каждого файла).
- Новый тест `backend/tests/vetis/test_receipt_xsd_contract.py`:
  - сверяет SHA-256 каждого файла с манифестом;
  - валидирует все шесть обезличенных `scenario-1.x.y.xml` официальной схемой `mercury_vu_applications_v2.0.xsd` (lxml, уже в зависимостях — новых пакетов не потребовалось).
- Исправления fixtures по результатам XSD (обезличенные значения сохранены, секретов нет):
  - `sender/receiver/unit/source-evsd/purpose-guid` заменены на UUID-образные дежурные идентификаторы (XSD pattern UUID);
  - `dt:packageList` → `vd:packageList` (правильный namespace, как в примерах владельца);
  - `dt:package` доведён до последовательности XSD: `level → packingType(globalID BX) → quantity`.
- Попутная синхронизация production-сериализатора (`receipt_mapping.py::_set_package_quantity`): синтетический пакет теперь строится в XSD-порядке `level → packingType → quantity` с `globalID=BX`, чтобы отправляемый XML прошёл тот же официальный gate. Тест `test_six_scenarios_match_deidentified_owner_fragments` остаётся зелёным (сигнатуры совпадают).
- Сеть была доступна; BLOCKED-сценарий не потребовался.

## 2. DR38 Minor — публичное имя `_comparison_source_text`

- `backend/src/modules/arrivals/validation.py`: функция переименована в публичную `comparison_source_text`; прежнее имя сохранено как алиас, чтобы не ломать существующих импортеров.
- `backend/src/modules/integrations/vetis/receipt.py`: импорт переписан через публичное имя (алиас в модуле сохранён для локального использования). Тесты не ослаблялись.

## 3. DR41B Important — провенанс pinned снапшота

- `backend/src/modules/catalog_pricing/service.py` (`_price_vse`): для закреплённой строки (`pinned`) пересборка `method_snapshot` генериком удалена — сохраняются исходные `unit_id` и `method_snapshot` из предыдущего снапшота (включая FIXED/NONE: source, method_version, rule). Генерическая сборка осталась только для новых строк.
- Новый тест `test_pinned_fixed_snapshot_keeps_provenance` (`backend/tests/catalog_pricing/test_dr41b_registry.py`): сохранённый `source.name`/`method_version`/`unit_id` переживают переоценку, цена ADR-020 сохранена.

## 4. DR40 Minor — локальный импорт на верх модуля

- `backend/src/modules/arrivals/validation.py`: импорт `DocumentActual` из `_document_actual_text` вынесен в общий блок импорта из `schemas`.

## Gates

- `uv run --frozen pytest backend/tests/vetis backend/tests/arrivals backend/tests/catalog_pricing -q` → **580 passed**.
- `uv run --frozen ruff check backend` → **All checks passed**.

Коммит: `fix: backend review tails and xsd pinning (DR38/40/41B)`.
