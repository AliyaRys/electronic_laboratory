# Task C02 — Редакторы и массовые цены (evidence)

Branch: `feature/C02-bulk` · Commits: `9acff74`, `8dbfeed` (`feat: add scoped catalogs and independent bulk pricing`)

## Gates (final run, 2026-11-07)

| Gate | Result |
| --- | --- |
| `uv run --frozen pytest backend/tests --cov=backend/src --cov-fail-under=85 -q` | **196 passed**, total coverage **94.09 %** (exit 0) |
| `frontend` typecheck / lint / format:check | all exit 0 |
| `frontend` unit tests (`vitest run`) | **89 passed / 21 files** (exit 0) |
| `frontend` build + build-storybook | both exit 0 |
| `playwright test catalogs.spec.ts` (real backend + PostgreSQL + Redis) | **2 passed** |

## Named tests

- `backend/tests/catalog_pricing/test_bulk.py`: `test_scope_prevalidation`, `test_partial_retry`, `test_independent_lab_prices` (+5 more) — 8 passed.
- `frontend/src/features/catalogs/*.test.tsx` — editors, deletion warning, bulk dialog (89 unit tests total).
- `frontend/tests/e2e/catalogs.spec.ts` — `test_head_edits_own_catalog`, `test_analyst_bulk_price_partial_coverage` against REAL backend (uvicorn :8001, `vse-pg-c02` :55441, `vse-redis-c02` :56391, vite :4173).

## e2e procedure

```powershell
docker run -d --name vse-pg-c02 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vse -p 127.0.0.1:55441:5432 postgres:18.6
docker run -d --name vse-redis-c02 -p 127.0.0.1:56391:6379 redis:8.10.3-alpine3.23
$env:DATABASE_URL='postgresql+asyncpg://postgres:postgres@127.0.0.1:55441/vse'; $env:REDIS_URL='redis://127.0.0.1:56391/0'
uv run --frozen alembic -c backend/alembic.ini upgrade head
uv run --frozen python frontend/tests/e2e/seed_identity.py   # writes frontend/tests/e2e/identity-seed.local.json
uv run --frozen python -m uvicorn backend.src.interfaces.main:app --host 127.0.0.1 --port 8001
# frontend: npm run dev -- --port 4173 --strictPort  (VITE_API_PROXY_TARGET=http://127.0.0.1:8001)
npm run test:e2e -- catalogs.spec.ts
```

The DB is reset (container recreated + migrate + seed) before each full run: the tests are not idempotent (unique tariffs/methods per scope).

## Real defects found and fixed while wiring e2e

1. **`_require_csrf` origin check ignored non-default ports** (`backend/src/modules/catalog_pricing/router.py`): dev proxy `http://localhost:4173` produced `CSRF_REJECTED` because the netloc comparison dropped `:4173`. Fixed: the port is included unless it is 80/443.
2. **CatalogsPage `refresh()` invalidated a wrong query-key prefix**: keys are `[lab, species, null, "/catalogs/methods", tab]`, the invalidation prefix ended at `"/catalogs"` — react-query never matched, lists/readiness never refetched after a save (page kept showing "Нормы для этой области не заданы." with "Норма сохранена." above it). Fixed: invalidate the scope prefix `[laboratoryId, speciesId, null]`.
3. **RHF checkbox group loses array value on uncheck** (BulkPriceDialog): unchecking one laboratory left the submit validation with an empty/`false` value → "Отметьте хотя бы одну лабораторию охвата." Fixed: coverage checkboxes are controlled local state, resynced to the full coverage when the (async-loaded) laboratory list changes ("adjust state during render" pattern — `setState` in `useEffect` is rejected by the react-hooks lint rule).
4. **`laboratory_ids_text` leaked into the POST body** → backend 422 `Extra inputs are not permitted`. Fixed: the ADMIN manual-entry fallback field is stripped from the write payload.
5. **e2e strict-mode ambiguities**: `getByLabel(..., exact: true)` for the shared labels; the bulk "Закрыть" button is scoped to `bulk-result` (the page Dialog's cancel is also "Закрыть").
6. **Parallel-worker data collision**: both tests wrote the same `(labA, trichinelloscopy, kg)` tariff → unique-constraint 409. Fixed: the bulk test uses its own service code `bulk-e2e-service`.

## Screens (Playwright screenshots in `frontend/test-results/`)

- `c02-head-methods-1440.png`, `c02-head-tariffs-1440.png`, `c02-head-tariffs-390.png` (390/1440 of the same state),
- `c02-bulk-coverage-before-confirm.png` (full coverage listed before confirmation), `c02-bulk-result.png`, `c02-tariff-edited-150.png` (lab B untouched).

## Env hazards observed (same as C01)

- `uv`/node must be on PATH explicitly in fresh shells; `npm.cmd run … | Select-String` pipelines reported a false exit 1 — verify via redirection to a file.
- A stale vite bundle served old dialog code once; verify the served source before debugging client behaviour.
