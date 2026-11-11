# DR6 — Catalog editor pages aligned with approved mockups

Branch: `feature/DR6-catalog-editors` (from main `6d65abd`).
Spec: `dorabotka/2026-11-11-catalog-editor-pages-match-mockups.md` (owner file, not committed).
Binding rulings: `.superpowers/sdd/2026-11-11-catalog-editors/progress.md` (R-DR6-1…10).

## Result

The three catalog tabs now render real editors built on the approved mockup
geometry instead of the old single Overview pane:

- `?tab=tariffs` — TariffsEditorPage: two tariff rows (PRODUCT_IDENTIFICATION,
  TRANSPORT_INSPECTION) with price cards, bulk price dialog (ADMIN/ANALYST).
- `?tab=check-services` — CheckServicesEditorPage: editor of the TWO tariff
  prices (same two service codes), no norm rows, no bulk price (R-DR6-8).
  `CheckServiceRule` data is never modified by price saves — saves go only to
  the tariff API endpoints (`POST /api/v1/contexts/{id}/tariffs` family).
- `?tab=methods` — MethodsEditorPage: norm rows with min/max bounds and
  qualitative indicator blocks.

`CatalogsPage` keeps the overview and routes each tab to its editor page.
No pill-tab strip on the edit pages (R-DR6-4).

## Reused / extended components

- `components/shell/AppHeader` — unchanged, reused as-is.
- `components/icons/VseIcon` + `frontend/src/shared/ui/legacy-icons.ts` — added
  `directory-price`, `directory-norms` (registered in the icons README).
- New shared editor parts in `frontend/src/features/catalogs/editor-parts.tsx`:
  CatalogEditorPage, CatalogSectionHeader, CatalogContextSelector, PriceCard,
  NormRow, QualitativeBlock, SaveSummary. Storybook:
  `editor-parts.stories.tsx` (PriceCard filled/zero/unset/error/busy+readonly/
  long-name; NormRow both-bounds / one-bound+order-error / long-unit;
  QualitativeBlock normal / add-remove-error; ContextSelector many/single/
  disabled; SaveSummary success/partial/conflict).
- `frontend/src/features/catalogs/catalogs.css` — editor geometry (1180px
  column, 24px gutters, 37px labels, 96px actions, r18 sections, r13 cards,
  43px inputs, sticky actions).

## Context source and per-role behavior

- `use-catalog-context.ts`: HEAD (0 labs assigned, selector hidden, single
  assigned lab auto-selected; 0 or 2+ labs → blocking config error card),
  ADMIN/ANALYST (compact selector with human-readable names, deep link
  `?context=<id>`), VET (read-only, selector disabled).
- Names come from the §6.4 read-model (`laboratory_name`, `territory_name` in
  ScopeView; `LaboratoryOptionView`; `GET /api/v1/contexts/laboratories`).
  Fallback to `me.scopes` when the new endpoint is absent (older backend).
  Unknown/missing names render «Название лаборатории недоступно» — raw UUIDs
  are never shown as names.
- Dirty-leave uses the shared dialog; partial save shows an honest summary;
  0 vs absent price = «Не настроено»; prices are DecimalString (no floats).

## Backend change (§6.4 only — additive read-model labels)

- `backend/src/modules/identity/schemas.py`: `laboratory_name`/`territory_name`
  added to ScopeView; new `LaboratoryOptionView`.
- `backend/src/modules/identity/queries.py`: names resolved for scopes;
  laboratories options query.
- `backend/src/modules/identity/router.py`: `GET /api/v1/contexts/laboratories`.
- No entity mapping, no write-model change. `OpenAPI` regenerated into
  `frontend/src/shared/api/schema.d.ts`.
- Tests: `backend/tests/identity/test_contexts.py` (3 new) and updated
  `test_users.py` (territory_name assertion).

## VSE/CHECK tariff separation

Tariff rows are filtered by exact `service_code` (PRODUCT_IDENTIFICATION,
TRANSPORT_INSPECTION); CheckServiceRule rows are a separate read model and are
not touched by price saves (confirmed by CheckServicesEditorPage tests).

## Fix round 1 (review needs-fixes)

- ADMIN/ANALYST selector now built from the purpose-built scoped endpoint
  `GET /api/v1/contexts/laboratories` (`use-catalog-context.ts`): the
  `/contexts` rows of ADMIN carry only territories, so the old build produced
  an empty selector and a false blocking error. `/contexts` stays the source
  of the role/context facts and the product pair; a problem answer from the
  endpoint falls back to the older `/contexts` shape. MSW fixtures mirror the
  REAL contract (territory-only rows for ADMIN in `/contexts`; laboratory
  options only from the endpoint) and a unit test asserts a valid ADMIN gets a
  non-empty named selector.
- 409 (§12.6): after the fresh revision loads, the card shows the explicit
  conflict state — server's current value vs the user's draft with two
  choices: «Сохранить моё значение» (retry with If-Match of the fresh
  revision) and «Взять значение сервера» (draft dropped, no save). A second
  «Сохранить справочник» never re-submits a conflicted card silently.
  Implemented for the price cards (tariffs/check-services) and the norm rows;
  unit tests cover both choice paths.
- e2e `catalogs.spec.ts` and `catalogs-profile-visual.spec.ts` rewritten to
  the dedicated editor pages (editor heading/eyebrow, diagnostic cards, bulk
  command «Применить стоимость к лабораториям», selector switch, return to
  overview). Both specs re-run GREEN on the seeded isolated stack
  (vse-pg-c02 55441 / vse-redis-c02 56391 / backend 8001, seed_identity.py):
  4 passed. Full suite with the seeded stack: 64 passed / 6 failed — all six
  pre-existing environmental ones (arrivals×2, dr5-real-browser×2,
  examinations×2; they need arrivals/examinations/eVSD domain fixtures that
  seed_identity does not create; identical failures before DR6). The
  identity.spec failures of the unseeded baseline are gone on the seeded
  stack.
- Discovered during the re-run (pre-existing, app-wide, NOT fixed here):
  `queryClient.invalidateQueries({ queryKey: <prefix> })` never refetches in
  this app (verified with an isolated react-query probe). The DR6 editor
  pages now refresh with a direct `refetch()` after create/delete/bulk and
  conflict resolution; the older dialogs elsewhere still rely on the broken
  prefix invalidation and need the same treatment later.
- Evidence slip corrected: R-DR6-7 → R-DR6-4.

## Screenshots

`docs/implementation/evidence/` (captured via Storybook stories
`C02/EditorPages` with MSW fixtures, Playwright + system Chrome):

- `catalog-editor-tariffs-1440.png`, `catalog-editor-tariffs-390.png`
- `catalog-editor-check-services-1440.png`, `catalog-editor-check-services-390.png`
- `catalog-editor-methods-1440.png`, `catalog-editor-methods-390.png`

No horizontal overflow at 1440. At 390 the only 16px scrollWidth delta comes
from Storybook's `sb-main-padded` wrapper (8px padding each side around the
390px story container); the page container itself is exactly 390px. Production
routes are covered by the same `noHorizontalOverflow` pattern used by other
DR specs.

## Gate results (final tree)

- `format:check` — PASS
- `typecheck` — PASS
- `lint` — PASS
- `test -- --run` — 255 passed
- `build` — PASS (chunk-size warning only)
- `build-storybook` — PASS
- `test:e2e` — 55 passed, 15 failed. All 15 failures are pre-existing
  environmental ones: the specs need the isolated C02 stack
  (postgres 55441 / redis 56391 / backend 8001 + `seed_identity.py`) or the
  seeded local stack; the running container backend at :8080 has no e2e seed
  users, so login fails («Неверный логин или пароль») and DR5 real-backend
  fixtures are absent. Verified not caused by DR6 changes (failures are
  login/seed dependent, identical pattern on unrelated specs).
- Backend `uv run --frozen pytest backend/tests/identity
  backend/tests/catalog_pricing` — 173 passed, 1 failed:
  `test_sessions.py::test_me_contexts_and_session_failures` (health/ready 503,
  alembic revision mismatch in test env) — pre-existing, verified via
  `git stash` on a clean tree before DR6 changes.

## Not run / limitations (honest)

- Real-backend browser login for the three routes was not possible (no seeded
  e2e users on the running stack; browser sandbox of the agent session could
  not attach), so page-level screenshots were taken from the Storybook page
  stories with the same production components + MSW fixtures.
- `product_scope_name` is not available in the read model: PRODUCT_SPECIES has
  no per-scope name, so product context labels fall back to the shell's
  productType naming («Мясо и продукты убоя», «Молоко…»). API gap.
- Bulk price on check-services is intentionally absent (R-DR6-8);
  BulkPriceDialog remains on the tariffs page only.

## Remaining deviations

- Product context naming as above (needs a future read-model field).
- e2e seed stack provisioning for full route walkthrough stays with the
  controller/CI environment.
