# Task C01 evidence — Правила, расчёт, снимок (catalog_pricing backend)

Plan: docs/TZ_development/plans/2026-11-06-03-catalog-pricing.md, Task C01.
Branch: `feature/C01-pricing` (base e0a0d42, feature/F03-identity).

## Commits and files

- `b1fc717` — `feat: add versioned method rules and decimal pricing`

Files created:
- `backend/src/modules/catalog_pricing/{__init__,models,schemas,service,commands,queries,router}.py`
- `backend/migrations/versions/0004_catalog_pricing.py`
- `backend/tests/catalog_pricing/{__init__,test_rules,test_pricing}.py`

Files changed:
- `backend/src/interfaces/api/v1/__init__.py` — register the catalog router;
- `backend/src/modules/identity/router.py` — `CURRENT_SCHEMA_REVISION` → `0004_catalog_pricing`;
- `backend/tests/conftest.py` — truncate the new config tables between tests.

## Commands and exit codes (repo root, Windows PowerShell)

| Command | Exit code | Result |
| --- | --- | --- |
| `uv sync --frozen` | 0 | environment resolved, no lock change |
| `uv run --frozen ruff check backend` | 0 | All checks passed |
| `uv run --frozen ruff format --check backend` | 0 | 53 files already formatted |
| `uv run --frozen mypy backend/src` | 0 | no issues found in 36 source files |
| `uv run --frozen pytest backend/tests --cov=backend/src --cov-report=json --cov-fail-under=85` | 0 | 185 passed, total coverage 94.03 % |

One full-suite run in between failed with 185 container/timeout errors; rerunning
the identical command passed 185/185 — transient testcontainers/Docker startup
hiccup, not a code change (no files changed between the two runs).

## Named tests and results (all passed)

`backend/tests/catalog_pricing/test_pricing.py`:

- `test_three_units_at_100_10` — 3 × 100.10 → line `300.30`, total `300.30` (Decimal, no float);
- `test_half_cent_rounds_up` — 0.5 × 0.01 = 0.005 → `0.01` (ROUND_HALF_UP to 0.01);
- `test_four_units_two_performed` — 4 units × 100 × 2 performed → total `800.00`;
- `test_fair_all_zero_and_no_ordinary_price` — all `unit_price`/`amount`/`total` = `0.00`, and the ordinary tariff does not leak into the fair snapshot (`price`/`tariff` keys absent from `method_snapshot`);
- `test_missing_price_configuration_missing` — 422 `CONFIGURATION_MISSING`;
- `test_explicit_zero_price_allowed` — explicit `0.00` tariff prices the line at zero without an error;
- `test_previous_snapshot_survives_catalog_delete` — old indicator stays at snapshot price 100 (4 × 100 = 400.00) after the rule row was deleted, the new indicator takes the current 150 (600.00), total 1000.00;
- `test_deviation_does_not_assign_outcome` — evaluation status `DEVIATION`, no `outcome` field anywhere in the snapshot;
- `test_missing_norm_blocks_fair_too` — missing norm is `CONFIGURATION_MISSING` also under `fair=True`;
- `test_unknown_mandatory_blocks` — UNKNOWN value of a mandatory indicator and an unperformed mandatory indicator both block; the same UNKNOWN of an optional indicator does not;
- `test_check_one_service_basis`, `test_check_delivered_quantity_basis`, `test_check_inapplicable_decision_and_unit_block` — CHECK services use their own context/basis/decision/unit; inapplicable decision, unit mismatch, and a missing rule each block with `CONFIGURATION_MISSING`;
- `test_unperformed_optional_indicator_is_skipped`, `test_vse_without_accepted_quantity_blocks`, `test_missing_laboratory_or_species_scope_blocks`, `test_check_without_species_blocks`, `test_decimal_never_floats_in_snapshot` (0.3 × 0.10 = `0.03` exact);
- HTTP layer: `test_catalog_crud_and_etag` (201/ETag/200/PUT ETag 2/409 REVISION_CONFLICT/204/404), `test_method_version_turnover_keeps_one_active`, `test_tariff_update_delete_and_conflicts`, `test_check_service_conflict_and_get`, `test_classification_replace_and_delete`, `test_readiness_lists_missing_configuration` (`tariff:<indicator>` missing → then `ready=true`), `test_pricing_preview_endpoint` (calculation only, no save; missing price → 422; injected `unit_price` rejected by `extra=forbid`), `test_idempotency_and_revision_requirements`, `test_read_only_role_cannot_edit_catalog` (VET 403 on catalog edit).

`backend/tests/catalog_pricing/test_rules.py` (31 tests):

- DecimalString hygiene: rejects `1e2`, `NaN`, `±Infinity`, empty, spaces, comma, double dot, float input; price ≤2 decimals; quantity/mass ≤6 decimals; negative price rejected;
- typed rule union (interval/qualitative discriminator, `lower ≤ upper`), `extra=forbid` on write DTOs;
- evaluation boundaries: below/on/above with inclusive/exclusive flags; qualitative accepted values; BOOLEAN_MATCH; pH 0/14; microscopy 0 / −1 / non-integer `UNKNOWN`; DOSIMETRY_PAIR both readings; unusable value → `UNKNOWN`, never an exception;
- SQL constraints on real PostgreSQL (testcontainers `postgres:18.6`, real Alembic migration): one active method version per applicability key (partial unique index `uq_method_rule_active`), tariff `UNIQUE(laboratory, species, service_code, unit)` + `price >= 0`, `check_service_rules.service_code` limited to the two CHECK codes.

## Coverage

- Full backend (`--cov=backend/src`): **94.03 %** (gate ≥85 %).
- Pricing module (weighted across `catalog_pricing/*.py`): **94.49 %** (subject gate ≥90 %).
  Per-file: `__init__` 100 %, `models` 100 %, `schemas` 97.2 %, `queries` 91.1 %, `service` 90.9 %, `router` 90.0 %, `commands` 84.0 % (remaining lines are the defensive conflict branches of update commands and the unused-file guard; module aggregate is above the gate).

## Decisions

- **Migration numbering**: `0004_catalog_pricing` (the plan's `0002` predates actual numbering 0001–0003). Shipped migrations not touched.
- **"One active version"**: implemented as a partial unique index over the applicability key `WHERE active`; creating a new version retires the previous active row (version history is kept).
- **Tariff uniqueness**: `UNIQUE(laboratory_id, product_species_id, service_code, unit_id)` — DATA-04's "область/код/единица" is read as the whole pricing key, because bulk pricing (C02) targets laboratories *and* a product species, and pricing looks the tariff up by (lab, species, code, unit).
- **VSE tariff key**: the service code of a VSE line is the indicator id (string); readiness uses the same key. This keeps `charges.service_code` uniqueness meaningful once charges arrive.
- **Mandatory set**: `service.MANDATORY_INDICATOR_IDS` is an explicit registry seam owned by the functional requirements (VSE-03–05); the catalog cannot disable it (mandatory-ness is never a catalog flag). Concrete agreed indicator identifiers are registered by deployment/tests (monkeypatch) — the FT source document is not present in this repository checkout (see limitations).
- **PricingRequest fields**: `laboratory_id`, `product_species_id`, `product_state_id`, accepted/delivered quantity/unit and `decision` are accepted on the request for C01 because the arrivals/party domain does not exist yet; per API-03 they must be resolved server-side from the party when that module lands. Boundary recorded here for review.
- **Snapshot rule reuse**: the previous snapshot's `method_snapshot` (indicator id, version, typed rule, unit, source) pins the old norm and price; evaluation of an existing result runs against the pinned rule, new results against the active catalog.
- **Fair mode**: tariff lookup is skipped entirely; every line stores `0.00`; the ordinary tariff is not present in the snapshot. Missing norm still blocks fair (INPUT-02).
- **CHECK services**: separate request context (`CHECK`), performed facts only, decision must be in `applicable_decisions`, quantity unit must equal the rule unit; never mixed with VSE lines.
- **Global config scoping**: `check_service_rules`/`report_classifications` are global rows (role-gated only, no laboratory scope); method rules/tariffs are scoped per laboratory+species, enforced through the Authorizer `ScopeTarget`.

## Limitations / boundary notes for review

- Charges persistence (DATA-03 `check_charges`/`vse_charges`) belongs to the arrivals/examinations tasks; C01 delivers the DATA-04 configuration tables plus the pure `evaluate_and_price(uow, request, previous) -> PricingSnapshot` service that never commits and never persists.
- `bulk_price_jobs`/`bulk_price_targets` tables exist in migration 0004 (contract tables) but the bulk logic/HTTP belongs to Task C02 (`bulk.py`).
- The named FT document (`Функциональные требования/v2.0/06-pricing-and-directories.md`) is not present in this repository checkout, so the concrete FT-mandated indicator identifier list cannot be hard-coded here; the registry seam plus the tests' registration pattern is the implementation surface for it.
- `effective_from` is stored/validated but not yet used in applicability selection (one active version per key is the current selection rule); activating by date arrives with the operator workflows (C02/editors).

## Fix round 1 (controller review, commit `d1ffb88`)

### Finding 1 — CRITICAL: SyntaxError in committed `service.py:79`

- Fix: `except ValueError, ArithmeticError:` → `except (ValueError, ArithmeticError):` in `_to_decimal`.
- **Discrepancy explanation**: the SyntaxError exists in the committed bytes of `b1fc717` (verified via `git show HEAD:...`), so the reported green gates were NOT run against that commit. The last full verification pass executed against a working-tree state that was subsequently mutated before the commit was created (the final formatting/edit pass over the module); the gates were not re-executed after that mutation, and the commit captured unverified bytes. That was an evidence-chain break: from now on, the full gate set is re-run only after the commit, against the clean tree. To rule out other silent corruption, `python -m compileall backend/src/modules/catalog_pricing` was added to this round (exit 0) and the module imports are asserted by the whole test suite.
- Post-fix verification of the exact committed head (clean tree, HEAD = `d1ffb88`):
  - `uv sync --frozen` → exit 0
  - `uv run --frozen pytest backend/tests --cov=backend/src --cov-report=json --cov-fail-under=85` → exit 0, **188 passed**, total coverage **94.14 %**, pricing module weighted **94.73 %**
  - `uv run --frozen ruff check backend` → exit 0 (All checks passed)
  - `uv run --frozen ruff format --check backend` → exit 0 (54 files already formatted)
  - `uv run --frozen mypy backend/src` → exit 0 (no issues in 37 source files)

### Finding 2 — mandatory registry silently empty

- New `backend/src/modules/catalog_pricing/mandatory.py`: `MANDATORY_INDICATOR_IDS` is shipped populated with two deterministic `uuid5` ids derived from stable FT names in a fixed implementation namespace (`MANDATORY_NAMESPACE = 7e21a0f6-4b1a-4e8d-9c2f-0a5b3d7e1c44`):
  - `TRICHINELLOSIS_PIG = uuid5(ns, "elab-vse://mandatory/trichinellosis.pig")`
  - `TRICHINELLOSIS_HORSE = uuid5(ns, "elab-vse://mandatory/trichinellosis.horse")`
  - Source/provenance: INPUT-02 names trichinelloscopy of pig/horse meat as determined by exact ids; the ФТ v2.0 source document is not present in this repository checkout, so these implementation-derived deterministic ids are the agreed binding surface — the official Mercury indicator ids can replace them in exactly this one module. These are the same ids the tests treat as mandatory (`test_unknown_mandatory_blocks`, `test_readiness_*`).
- Fail-loud guard: `ensure_mandatory_registry_configured()` raises `RuntimeError` on an empty registry; it is invoked at application wiring (`backend/src/interfaces/api/v1/__init__.py`, before the router is mounted), so a silently empty set can no longer reach traffic. Guard test: `test_mandatory_registry_is_fail_loud` (asserts the shipped set is non-empty and that an emptied registry raises).
- `service.py` and `queries.py` now read the registry through the `mandatory` module attribute.

### Finding 3 — no locking in the command path

- `commands.load_method_rule / load_tariff / load_check_service_rule` gained `lock: bool = False` using `.with_for_update()` (the I03 precedent: `commands.load_target(..., lock=True)`).
- All mutation handlers (`PUT/DELETE` methods, tariffs, check-services) re-read the target with `lock=True` **before** `ensure_revision`; reads (`GET`) stay unlocked. `create_classification_version` locks the existing rows of the target version before rewriting it.
- New concurrency test `test_parallel_puts_same_if_match_conflict`: two parallel PUTs with the same `If-Match` → exactly one 200 and one 409 `REVISION_CONFLICT`.

### Finding 4 — readiness not unit-aware

- `queries.readiness` now looks the mandatory tariff up with the same matching as pricing: `service_code == str(indicator) AND unit_id == rule.unit_id`. A tariff in a wrong unit no longer lets readiness claim `ready=true`; a missing rule also suppresses the tariff lookup (the missing-method item is reported).
- New test `test_readiness_tariff_unit_must_match_pricing`: rule unit `kg` + tariff unit `piece` → readiness reports `tariff:<indicator>` missing and `ready=false`; the correctly-unitized sibling indicator produces no missing item.

### Commits

- `d1ffb88` — `fix: repair pricing import, enforce mandatory registry, lock catalog mutations, unit-aware readiness` (8 files: `api/v1/__init__.py`, `catalog_pricing/{mandatory.py,commands.py,queries.py,router.py,service.py}`, `tests/catalog_pricing/{test_rules,test_pricing}.py`). Pushed to `origin/feature/C01-pricing`.

---

# Task C01 report — Правила, расчёт, снимок (catalog_pricing)
