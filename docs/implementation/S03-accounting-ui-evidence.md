# S03 — Экран учёта и история (ТЗ-05)

Task: `feat: expose scoped sample accounting and disposal history` (branch
`feature/S03-history`, from feature/S02-disposal `510deeb`).
Spec sources: API-06, permissions.md (`sample:read`, `sample:dispose`),
SC-071–079 (priority O), SPEC-06, AT-09–12.

## Delivered

### Backend read endpoints (API-06; the S02 read pages did not exist yet)

`backend/src/modules/samples/queries.py` (extended):

- `balance_list(db, laboratory_id)` — the live balances read model: the SUM of
  the active collections (`disposal_id IS NULL`) per species with the basket
  revision (`coalesce(max(basket.rev), 1)`). Computed at query time, never
  materialized (DATA-03); species without active collections are not listed.
- `collection_page(db, laboratory_id, page)` — a stable page of the available
  (not disposed) facts of the laboratory (`created_at, id` order), PAGE_SIZE 20.
- `disposal_page(db, laboratory_id, page, date_from, date_to)` — a stable page
  of the immutable disposal history (`recorded_at desc`), the period filter on
  `disposed_on` **only** — it never touches the balances read model. The view
  fields are built from the stored `sample_disposals` rows through the S02
  `disposal_view` (never from `TechnicalEvent.result` payloads — the view is
  the proper source; no structural payload is needed).

`backend/src/modules/samples/schemas.py`: `BalanceView`
`{product_species_id, mass_kg, revision}` (plain decimal string).
`backend/src/modules/samples/router.py`: `GET /samples/balances`,
`GET /samples/collections` → `Page<CollectionView>`,
`GET /samples/disposals` → `Page<DisposalView>` with `date_from`/`date_to`;
every route authorizes `sample:read` with `ScopeTarget(laboratory_id=…)`
(permissions.md: VET/HEAD of the own scope, ANALYST of the chosen laboratory,
ADMIN forbidden). `Cache-Control: no-store` on the read pages. No migration.

`frontend/src/shared/api/schema.d.ts` regenerated with `npm run gen:api` from
the actual backend OpenAPI document (app served via `app.openapi()` dump, the
generated file is not hand-edited).

### Frontend (reuse of the ТЗ-02/04 conventions)

- `frontend/src/features/samples/api.ts` — the read/command transport on the
  single F01 client; every failure becomes a shared `Problem`; `disposeSamples`
  is the raw POST executor for `useCommand` (If-Match of the basket revision +
  Idempotency-Key).
- `Balances.tsx` — the readonly balances table (no weight input anywhere); the
  row menu «Утилизировать остаток» exists only for VET/HEAD; ANALYST renders no
  affordance at all. Distinct loading/empty/error states.
- `DisposalDialog.tsx` — shows вид/вес/дата/номер **before** the confirm; the
  weight is readonly and never rounded (the exact decimal guards
  `expected_mass_kg`); RHF + Zod validation at submit; a 409 keeps the dialog
  open, shows the problem, refreshes the actual balances through the bound
  query (the NEW remainder becomes visible) and requires an explicit fresh
  confirmation — never a silent re-send; after 201 the balances are re-read
  (the answer carries no ETag) before the dialog closes — no optimistic
  zeroing. The dialog mounts per opened balance (page keys it), so each
  opening starts clean without an effect.
- `Collections.tsx` — the readonly page of available facts with honest
  pagination; `DisposalHistory.tsx` — the immutable history with the URL period
  filter, no edit/delete affordances, no protocol link (a deleted/absent ВСЭ
  link never opens a protocol — honest inert rendering; the examination link
  data itself arrives with E01+).
- `frontend/src/pages/SampleAccountingPage.tsx` — the «Учёт проб» screen under
  «Отчёты» (`/labs/:labId/reports/samples`, the S03 stub is replaced in
  `app/router.tsx`); the period lives in the URL and changes the history only;
  the 5-ВЕТ report link exists for HEAD/ANALYST only — a VET gets no link.
- Stories: `balances.stories.tsx` (VET/ANALYST/empty/loading, collections with
  long values), `disposal.stories.tsx` (dialog facts, dialog without a
  balance, history, empty history, paged history). The same component code is
  used by stories and the page; no duplicated rendering.
- e2e: `frontend/tests/e2e/samples.spec.ts` (Playwright, Chrome, 4 tests).

## TDD

Backend tests first in `backend/tests/samples/test_reads.py`: RED —
`AttributeError: module 'backend.src.modules.samples.queries' has no attribute
'balance_list'` (6 collection/test errors). Then GREEN: **6 passed**.

- `test_balances_view` — 11.8 + 0.8 → `12.6` for the species, `2` for the
  second species, revision from the basket;
- `test_disposal_removes_species_from_balances` — the disposal empties the
  species line, the fact becomes immutable;
- `test_balances_endpoint` — `GET /samples/balances` 200 with `mass_kg/revision`;
- `test_collections_endpoint_lists_active_only` — 2 facts before, the full
  disposal consumes the whole basket, the disposal appears in the history page;
- `test_disposals_period_filter_keeps_balance` — `date_from/date_to` change the
  history totals (1 / 0) and never the balances (`[]` after the disposal, the
  party mass 0);
- `test_read_roles_matrix` — VET/HEAD/ANALYST read 200 (own/chosen scope),
  ADMIN 403, a laboratory outside the scope 403 for VET and ANALYST.

Frontend tests (named controller assertions, all green):

- shown weight readonly: `DisposalDialog` renders `disposal-shown-mass`
  («12.6 кг») and has no mass input; e2e asserts the same;
- stale dialog 409: the problem text is shown, exactly one POST before the
  fresh confirmation, the confirm label becomes «Подтвердить заново», the
  fresh confirmation resends with `If-Match` + a fresh Idempotency-Key (the
  refetched balance shows the NEW remainder);
- period change updates the history query (`date_from/date_to`) and the
  balances GET count stays 1;
- VET gets no 5-ВЕТ link, HEAD does;
- ANALYST sees no disposal action (unit + e2e).

## Verification (against the working tree before commit)

- Backend: `ruff check backend` — All checks passed; `ruff format --check
  backend` — 95 files already formatted; post-format byte verification:
  `compileall` exit 0 and UTF-8 round-trip reads of the Cyrillic literals in
  `test_reads.py` / `queries.py` / `router.py`. `mypy backend/src` — Success
  (60 files). `pytest backend/tests --cov=backend/src --cov-fail-under=85` —
  **288 passed**, total coverage **94.73%**; samples module: `router.py` 100%,
  `queries.py` 98%, `commands.py` 97%, `service.py` 98% (≥90% met).
- Frontend: `npm.cmd run lint` 0; `format:check` 0; `typecheck` 0;
  `npm.cmd test` — **130 passed (30 files)**; `build` 0; `build-storybook` 0
  (stories of the new features build).
- e2e `npx.cmd playwright test samples.spec.ts` — **4 passed** (installed
  Chrome, vite dev server): screen under «Отчёты» with the readonly weight,
  the disposal dialog facts before the confirm, the ANALYST read-only view,
  the 390px stacked layout (screenshots in `test-results/s03-*.png`).

## Honest not-run / limitations (SPEC-06)

- **Real-API e2e: not-run.** The full stack (PostgreSQL + backend) was not
  brought up in this environment; the e2e follows the established MSW-style
  route-mock pattern of `arrivals.spec.ts` (honest, no fake API). The backend
  behaviour is covered by the real-PostgreSQL backend tests above.
- **Сквозной delete/recreate сценарий (до E03): not-run** — the examination
  link data (`examination_samples`, E01) does not exist yet, so the history
  rows carry no examination link at all; the inert-link rule is covered by the
  unit/e2e absence assertions and will be re-checked in the E03 walkthrough.
- **Ширины 768/1024: not-run** — the e2e covers 1440 and 390; 768/1024 were
  not separately screenshotted (the flex/stacked layout is fluid).
- **Keyboard walkthrough: partial** — Escape/focus-trap/safe-cancel-first come
  from the shared Radix `Dialog` (own tests); the e2e asserts the labelled
  inputs and the row-menu flow, but an explicit full keyboard pass (Tab order
  across all three blocks) was not performed manually.
- The disposal mass is read from the `sample_disposals` view (S02 note
  resolved): no structural event payload is needed by this screen.
