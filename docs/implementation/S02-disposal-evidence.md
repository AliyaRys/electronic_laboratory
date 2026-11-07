# S02 — Полная утилизация и конкуренция (ТЗ-05)

Task: `feat: register atomic full sample disposal` (branch `feature/S02-disposal`, from feature/S01-sampling `b7397e6`).
Spec sources: API-06, DATA-03, FT-SMP-06/07, AT-11/12 (S02 share), O-01/O-07, R-06, permissions.md (`sample:dispose`, `sample:disposal-update/delete`).

## Delivered

### `backend/src/modules/samples/commands.py` (new)

`dispose_samples(ctx, payload: DisposalWrite, *, uow) -> DisposalView` — the atomic full disposal of
one laboratory/species basket:

- **Lock order (SPEC-04):** the basket row `FOR UPDATE` (the serialization point) → the idempotency
  claim → the `If-Match` basket revision (`ensure_revision`: absent → 422 `REVISION_REQUIRED`,
  stale → 409 `REVISION_CONFLICT`) → **all** active collections of the species locked `FOR UPDATE`
  in one stable `id` order → server-side `Decimal` sum (the client mass is never trusted).
- **The claim precedes the revision check on purpose:** a committed command replayed with the same
  `Idempotency-Key` (client timeout after the commit) answers the saved disposal from
  `record.result_id` without re-running any guard and never records a second event. A first-time
  request falls through to the checks; a failing request rolls its claim record back with the
  transaction.
- **Validation (FT-SMP-06/07, R-06, field catalog):** the shown `expected_mass_kg` is only the
  readonly confirmation guard — a mismatch with the recomputed balance is 409 `REVISION_CONFLICT`
  («Остаток изменился после открытия диалога»); a zero balance is 422 (no partial/zero disposal
  ever, O-01); `disposed_on` in the future → 422 and earlier than `max(collected_on)` → 422
  («Утилизация не может предшествовать включённым отборам»); the outgoing eVSD number is trimmed
  and must be nonblank → 422. The number is a manually entered fact, never an API-confirmed value.
- **One atomic write:** the `sample_disposals` row (server mass) + `disposal_id` attached to every
  locked collection + the basket revision bump + one `TechnicalEvent` (`action="sample:dispose"`,
  `result` = the plain decimal mass, `revision` = the new basket rev) + the idempotency record
  completion. The command never commits — the HTTP coordinator owns the transaction.
- **Decimal hygiene:** the mass is `Decimal` end-to-end (`Numeric(20,6)`); `_plain_decimal` strips
  the asyncpg numeric scale for the wire (`12.600000` → `12.6`). No float anywhere.
- `load_disposal_view(db, disposal_id)` — the replay/read path; `disposal_view(row)` builds the
  API-06 `DisposalView`.

**Context id:** the idempotency `context_id` is a stable `uuid5` of the composite basket key
(`sample-basket:{lab}:{species}`), because `SampleBasket` has no single UUID.

### `backend/src/modules/samples/router.py` (new) + v1 mount

`POST /api/v1/samples/disposals` → 201 `DisposalView`. CSRF + `Idempotency-Key` +
`If-Match` (basket revision) are all required; `sample:dispose` is authorized for
`ScopeTarget(laboratory_id=…)` (permissions.md: VET/HEAD of the own scope only; ANALYST/ADMIN are
refused 403 by the policy matrix itself). **No PUT/DELETE routes exist** (O-07,
`sample:disposal-update/delete` denied for every role): mutation attempts answer 405 on the
collection route and 404 on item routes. The read endpoints (balances/collections/disposals
pages) belong to S03.

### `backend/src/modules/samples/schemas.py` (extended)

API-06 `DisposalWrite` (strict, `extra=forbid`, camelCase aliases + `populate_by_name`):
`laboratory_id, product_species_id, disposed_on, external_vsd_number, expected_mass_kg`
(DecimalString); `DisposalView`: id, laboratory/species, disposed_on, mass (plain decimal
string), external_vsd_number, actor, recorded_at. No migration was needed — `sample_disposals`
already exists since `0008_samples`; the schema revision stays `0008_samples`.

## TDD

`backend/tests/samples/test_disposal.py` written first: RED evidence — initial run
`ModuleNotFoundError: No module named 'backend.src.modules.samples.commands'` (collection error).
Then GREEN: **17 passed**.

Named assertions (controller decisions, all green):

- `test_dispose_all` — 11.8 + 0.8 → disposal 12.6, balance 0, every collection of the species
  attached, one event with result "12.6", the other species of the same laboratory keeps its fact
  and its 2.0 balance;
- `test_stale_dialog_after_new_collection[revision|mass]` — a collection added after the dialog
  opened makes the old confirmation 409 `REVISION_CONFLICT` (stale revision or stale shown mass),
  nothing disposed, balance keeps both collections;
- `test_parallel_disposals` — two real concurrent PostgreSQL sessions: the first holds the basket
  lock and commits, the loser re-reads the bumped revision and answers 409; exactly one disposal,
  one event;
- `test_disposal_date[0|−1|+1]` — the day of the latest collection is allowed; earlier than
  `max(collected_on)` → 422; future → 422; failed attempts store nothing;
- `test_no_disposal_mutation_routes` — PUT/DELETE on `/samples/disposals` → 405; on
  `/samples/disposals/{id}` → 404 (create-once, O-07).

Contract tests: `test_disposal_api_endpoint` (no Idempotency-Key → 422 `IDEMPOTENCY_KEY_REQUIRED`,
no If-Match → 422 `REVISION_REQUIRED`, wrong shown mass → 409, correct → 201 with the
server-computed mass "1.2", one disposal, one event, balance 0); `test_replay_same_key_one_event`
(timeout after commit + the replay of the same key → the same disposal id, still exactly one
event); `test_replay_different_payload_is_mismatch` (same key, different body → 409
`IDEMPOTENCY_MISMATCH`); `test_new_collection_after_disposal_positive_balance` (the disposal froze
only the locked set: a NEW afterwards owns a fresh positive balance); `test_zero_balance_rejected`
(nothing left → 422, nothing stored); `test_blank_external_number_rejected[""|"   "]` → 422;
`test_analyst_and_admin_cannot_dispose` (both roles → 403 `ACCESS_DENIED` through the API);
`test_load_disposal_view_roundtrip`.

## Verification

- `uv sync --frozen` — ok.
- `ruff check backend` — All checks passed; `ruff format --check backend` — 94 files already
  formatted. Post-format byte verification: `compileall` exit 0; the Cyrillic literals of
  `commands.py` and the test file verified by a UTF-8 round-trip read.
- `mypy backend/src` — `Success: no issues found in 60 source files`.
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` — **282 passed**, total coverage
  **94.68%**; samples module: `commands.py` 97%, `router/schemas/models/queries` 100%,
  `service.py` 98% (≥90% requirement met).
- PostgreSQL: testcontainers `postgres:18.6`, real Alembic head; the concurrency assertions run on
  two real sessions (basket `FOR UPDATE` serialization; no application-level sleeps).

## Interpretation notes (for review)

1. **Disposal date rule.** The brief's «раньше max collected_on/будущее 422» is implemented per
   the authoritative FT (field catalog v2.0: «Утилизация не может предшествовать включённым
   отборам», R-06: «будущее событие запрещено»): `disposed_on < max(collected_on)` → 422,
   `disposed_on > today` → 422, `== max(collected_on)` allowed. So a date *earlier* than
   `max(collected_on)` is a 422, not "ok".
2. **Claim-before-revision-check.** SPEC-04 lists If-Match before the idempotency claim (the
   reconciliation command keeps that order). For the disposal the brief explicitly demands a
   committed replay with the same key to answer idempotently; with the If-Match-first order the
   replay (which necessarily carries the original, now-stale If-Match) would die with 409 before
   its key could resolve. The claim is therefore taken right after the basket lock; the revision
   check runs on the non-replay path only. Different-body replays still fail loudly with
   `IDEMPOTENCY_MISMATCH` (hash mismatch).
3. **Event mass.** `TechnicalEvent.result` (String 64) carries the disposal mass as a plain
   decimal string; the disposal row itself remains the source of truth.
4. `GET /samples/balances|collections|disposals` pages are S03 read endpoints and are not added
   here; the disposal view of a stored fact is available through `load_disposal_view` for S03.

## Not in this task

- Balances/collections/disposals HTTP read endpoints and the accounting screen (S03).
- AT-12's deletion leg (E03/E04: deleting the ВСЭ after the disposal).
- SOAP submission for samples — absent by design (API-06).
