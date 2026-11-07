# S01 — Учёт и внутренний контракт отбора (ТЗ-05)

Task: `feat: add independent physical sample collections` (branch `feature/S01-sampling`, from feature/A03-confirm `1d2175b`).
Spec sources: DATA-03, API-06, FT-SMP-01..04, AT-09/10 (S01 share), O-01/02/04/07, ADR-016/017.

## Delivered

### Migration `backend/migrations/versions/0008_samples.py` (new; head)

Controller decision applied: the brief's «0004_samples.py» is a stale artifact; the real head was
`0007_confirmation_route_flag`, so the migration is **`0008_samples`** and
`CURRENT_SCHEMA_REVISION` in `backend/src/modules/identity/router.py` was bumped accordingly
(the `/health/ready` schema guard test enforces this pairing).

Tables (DATA-03):

- `sample_baskets(laboratory_id, product_species_id)` — composite PK, `rev ≥ 1`; the serialization
  point of one laboratory/species pair.
- `sample_collections(id, party_id RESTRICT, laboratory_id RESTRICT, product_species_id,
  classification_snapshot JSONB, collected_on, mass_kg Numeric(20,6) CHECK >0, collected_by RESTRICT,
  created_at, disposal_id? RESTRICT → sample_disposals, rev ≥ 1)` — the independent physical fact.
- `sample_disposals(id, laboratory_id RESTRICT, product_species_id, disposed_on, mass_kg >0,
  external_vsd_number nonblank, actor_id RESTRICT, recorded_at)` — created here because
  `sample_collections.disposal_id` references it; the disposal *command* lands in S02.
- `examination_samples` is **not** created (controller decision: it lands in E01 after the
  examination FK exists); no public standalone collection endpoint was added.

### `backend/src/modules/samples/service.py` (new)

`apply_sample(uow, actor_id, party_id, examination_id, selection: SampleSelection) -> SampleCollection`
(DATA-06 internal contract; `examination_id` is the future owner of the E01 link — the contract itself
neither creates the link nor touches the examination):

- **Never commits.** The coordinator (E01 `save_examination`) owns the transaction; a coordinator
  rollback leaves neither a collection nor a balance increase (tested against a second connection).
- **Locks before any write:** the party row, the target collection row and the laboratory/species
  basket row are taken `FOR UPDATE`. The basket is get-or-created under its UNIQUE PK; a lost
  creation race is retried with a fresh locked read inside a savepoint (never a 500).
- **NEW** validates the date (not in the future → 422 `VALIDATION_ERROR`) and the weight (positive;
  more than six decimal places → 422, **no silent rounding**) and inserts a collection with its own
  frozen classification snapshot, author and date. NEW never deletes or overwrites earlier collections.
- **REUSE** links an existing fact **of the same party** (foreign/unknown → 404 `NOT_FOUND`)
  under lock: no second row, no weight change, the fact's own date and revision untouched.
- **EDIT** corrects the same fact: If-Match `expected_revision` against the collection revision
  (stale → 409 `REVISION_CONFLICT`), then mass (and the explicitly carried date) are replaced —
  the balance changes by the difference, exactly once per revision.
- **Disposed facts are immutable:** any collection with `disposal_id` set refuses REUSE and EDIT
  with 409 `SAMPLE_DISPOSED`; the disposed weight/date are never rewritten and never count toward
  the balance.
- `detach_examination_samples(uow, examination_id)` — the prepared E03 hook: deleting a ВСЭ
  removes only the (future) `examination_samples` links, never the collections (FT-SMP-02). Until
  E01 creates the table it is an explicit no-op returning 0.

### `backend/src/modules/samples/schemas.py` (new)

API-06 `SampleSelection` as a discriminated union —
`NEW{collected_on, mass_kg: DecimalString} | REUSE{collection_id} |
EDIT{collection_id, expected_revision, collected_on, mass_kg}` — all strict (`extra=forbid`,
camelCase wire names); `CollectionView` (id, party/laboratory/species, snapshot, collected_on,
mass as DecimalString, author, created_at, disposal?, revision).

### `backend/src/modules/samples/queries.py` (new)

`list_available_collections(db, party_id)` — only facts with `disposal_id IS NULL`, stable
`created_at, id` order; `active_party_mass(db, party_id)` — the balance as a query-time
`SUM(mass_kg)` over active collections (DATA-03: no materialized balance, no second source of truth).
All arithmetic is `Decimal` end-to-end (`Numeric(20,6)` columns typed `Mapped[Decimal]`); no float.

### `backend/tests/samples/test_collections.py` (new; TDD)

16 tests, written first (RED: module missing) then made GREEN. Named assertions, all green:

- NEW 0.8 → balance 0.8, collection carries its own snapshot/author/date;
- repeat of the same card save via REUSE → still 0.8, exactly one collection, original date and
  revision preserved (no double count);
- EDIT 0.8→0.6 → same fact id, balance 0.6 (delta semantics, applied once); a repeat does not
  subtract again;
- EDIT with a stale `expected_revision` → 409 `REVISION_CONFLICT`, mass unchanged;
- explicit NEW 0.5 after 0.6 → balance 1.1, two collections, the old one never deleted;
- REUSE and EDIT on a disposed fact → 409 `SAMPLE_DISPOSED`, fact immutable, balance 0;
- coordinator rollback → neither collection nor balance increase; the service never commits
  (verified from a second PostgreSQL connection);
- future date → 422; zero/negative mass → 422; scale > 6 → 422 without rounding;
- foreign collection id → 404;
- real PostgreSQL concurrency (two sessions): NEWs serialize on the basket lock (0.8 + 0.8 = 1.6);
  a stale EDIT loses with 409 `REVISION_CONFLICT`, no lost update;
- Decimal exactness 0.1 + 0.2 = 0.3, `Decimal` instances end-to-end;
- available list excludes disposed facts; the detach hook is a no-op that leaves collections.

`backend/tests/conftest.py` — the three sample tables added to the per-test truncation list.

## Verification

- `uv sync --frozen` — ok.
- `ruff check backend` / `ruff format --check backend` — ok (all 91 files formatted; bytes of the
  Cyrillic literals verified after formatting, plus `compileall` and import checks — exit 0).
- `mypy backend/src` — `Success: no issues found in 58 source files`.
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` — **265 passed**; total coverage
  **94.57%**; samples module: `service.py` 98%, `models/schemas/queries` 100% (≥90% required).
- PostgreSQL: testcontainers `postgres:18.6`, real Alembic upgrade head (0008 applied),
  real cross-session locking for the concurrency tests.

## Interpretation note (for review)

«Повтор той же команды не удваивает остаток» реализован на уровне внутреннего контракта S01 как
REUSE-повтор: карта, повторно сохранённая координатором, связывает тот же физический факт
(REUSE), а дедупликация повторного сохранения одной и той же ВСЭ (ссылка `examination_samples`
UNIQUE «один отбор не начисляется повторно») — обязанность координатора E01 согласно DATA-03.
Сырое двойное NEW на этом слое создаёт второй физический факт по дизайну (два реальных отбора).

## Not in this task

- Disposal command/API and competition of disposals (S02); the disposal table exists, the fact is
  simulated in tests by attaching `disposal_id` directly.
- Balances/collections/disposals HTTP endpoints and the accounting screen (S03).
- Full delete/recreate examination scenario with the link table (E01/E03; AT-09 S01-share covered
  at the contract level).
