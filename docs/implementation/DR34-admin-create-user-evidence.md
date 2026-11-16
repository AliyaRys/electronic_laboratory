# DR34 — Evidence: delegated user creation from the admin users list

Task: `dorabotka/2026-11-16-admin-create-user.md` (§1–17, gate §15)
Branch: `codex/admin-create-user` (isolated worktree `C:\electronic_lab_dev-dr34`)
Requirements: FT-ACC-08/09 (ФТ 01), FT-ADM-01 (ФТ 13), O-08; rulings R-DR34-1..12.

## Delegation model resolution (§8, R-DR34-5)

The existing `delegation_grants` table already expresses «какая роль разрешена к
делегированию» (`role`, `territory_id`, `may_delegate`) — **no migration was
needed**. Semantics implemented in `commands.delegatable_territories`:

- a grant with `may_delegate=true` and role `ADMIN` enables delegating **all
  four roles** inside its territory subtree (O-08: any of the four roles within
  the delegated authority — this keeps the bootstrap `local-admin` able to
  create working users, which the §15/§16 acceptance gate requires);
- a grant of a working role enables delegating only that role;
- nothing is ever issued above/wider/outside the granted subtree; a plain
  ADMIN role or `may_delegate=false` grants nothing anywhere;
- self-escalation stays impossible (own login → duplicate-login 409; a wider
  territory → 403; grants are not editable through the API).

`POST /api/v1/users` for role `ADMIN` accepts an additive optional
`territory_id` (always chosen from the server options; no screen asks for a
UUID) and atomically writes User + DelegationGrant + UserEvent, with no
working `UserScope` for the target or the actor. Working roles create
User + UserScope. HEAD is appointed for exactly one laboratory at creation
(updates may still detach scopes, as before). Failures leave no partial
records (one transaction; the idempotency claim rolls back with it). History
carries role + a safe area description, never a password or hash. The
bootstrap CLI remains the only creator of the FIRST root administrator.

## Server-authoritative options (§7.2, R-DR34-3)

New read-only endpoint `GET /api/v1/users/assignable` (session + `users:create`)
returns, per delegable role: Russian label, allowed territories (ADMIN),
laboratories (id + name), product areas (id + name for VET, read from the
local VetIS level-2 classification read model, migration 0005 — read-only,
no vetis schema/code files touched) and selection multiplicity
(`max_laboratories`). A caller without any `may_delegate=true` grant honestly
receives `roles: []`. Foreign laboratories/territories never appear.
OpenAPI and `frontend/src/shared/api/schema.d.ts` updated additively
(`UserWrite.territory_id` optional, new option DTOs).

## Frontend (§5/§6/§7/§9–§12, R-DR34-1..4, 6–9)

- `UsersPage`: honest states — the button «Создать пользователя» (shared
  Button + registry icon `admin-user-add`) appears only after `/me` LOADED and
  `users:create` is confirmed; `me === null || role === "ADMIN"` replaced by
  loading / error-with-retry / forbidden / admin-without-capability states;
  administrative area subtitle from the loaded scopes; narrow screens stack
  vertically with the full-width button.
- Return path: the list URL (`q/role/status/page`) is passed as `returnTo`
  (navigation state) and restored after cancel/success with the
  «Пользователь создан» notice; the list query cache is invalidated — no
  silent filter reset.
- `UserCreatePage` + `UserCreateForm` (mockup `admin-user-create.html`
  composition over the working tokens; no header/SVG/mock copies): back link
  «К списку пользователей», cards «Основные сведения» / «Доступ пользователя»,
  actions «Отмена» / «Создать пользователя» with busy state «Создаём…».
- No UUID fields: role, laboratory, territory and product are chosen by name;
  ids travel only inside the payload. Role switch clears incompatible
  selections, asks before losing a chosen area, and never sends stale scope
  fields; ADMIN sends `territory_id` with empty scopes.
- Fields: ФИО*, login* (trimmed, unique — server 409 binds to the field),
  password* 12–128 (`autocomplete="new-password"`, cleared on
  success/cancel/unmount, never in URL/storage/history/error text),
  confirmation*, email*, optional position (null when empty). The account is
  created ACTIVE; no status switcher.
- One `Idempotency-Key` per user intent: repeated on network uncertainty
  while the input is unchanged, regenerated after an edit.
- Errors by `Problem.errors.path`; stale area → the options are re-fetched
  (query invalidated on page entry) and non-secret input is kept; 403 shown as
  «Недостаточно прав для создания пользователя» without disclosure; focus
  moves to the first error; visible labels, `aria-describedby`, requiredness
  marked «*» (not color-only).
- Dirty guard: the shared `Dialog` («Продолжить редактирование» /
  «Выйти без сохранения» clears the password) for cancel/back plus the
  app-level router blocker (`useDirtyGuard`); no warning after success.

## Verification (all commands actually run in this worktree)

Backend (Postgres via testcontainers, real Alembic migrations):
- `uv run --frozen ruff check backend frontend/tests/e2e` — **All checks passed!**
- `uv run --frozen pytest backend/tests/identity -q` → **113 passed**
  (incl. the 12 new DR34 scenarios in `test_delegated_creation.py`:
  delegated VET/HEAD/ANALYST/ADMIN creation, HEAD one-lab rule, forged
  role/territory/laboratory UUID rejection, no foreign area in options,
  options without delegation right, self-escalation, no auto UserScope,
  idempotency replay, parallel same-login 201+409, history without secrets).
- `uv run --frozen pytest backend/tests/identity backend/tests/test_platform.py
  backend/tests/catalog_pricing backend/tests/arrivals -q` → **345 passed**.
- `uv run --frozen pytest backend/tests/examinations/test_delete.py -q` →
  **2 failed, 8 passed** (`test_concurrent_delete_and_disposal_preserve_the_
  disposal_fact`, `test_delete_http_204_and_unknown_202`) — these are the two
  known failures named by the dispatch; a run on the clean main baseline (the
  working tree stashed) reproduces them, so they are pre-existing and
  unrelated to DR34.
- Existing checks preserved: last-admin, foreign-UUID hiding, parallel
  duplicate login, history redaction — none weakened (one test updated where
  it asserted the now-removed unconditional ADMIN rejection; the updated test
  additionally covers the no-delegation 403 path and grant atomicity).

Frontend (Node 26.13.0):
- `npm run typecheck` — passed; `npm run lint` — 0 errors (one pre-existing
  warning in features/catalogs, and a one-line unused-variable lint error in
  scripts/dr30-shots.mjs removed); `npm run format:check` — clean;
- `npm run test` — **61 files / 437 tests passed** (incl. 8 new UserCreateForm
  and 4 new UsersPage tests);
- `npm run build` — passed; `npm run build-storybook` — completed successfully
  (new stories: F03/UserCreateForm — empty, options-loading, no-delegation,
  without-admin-role, duplicate login, field errors, busy, long values,
  unsaved dialog, 390 px).

## Not-run / honest notes

- `npm run test:ui` — not applicable: no `components/` (HTML library) files
  were touched; only React SPA code changed.
- E2E (`frontend/tests/e2e/users-create.spec.ts`, §13.3 scenarios) — the spec
  is committed and follows the identity.spec.ts fail-loudly pattern, but a
  live run was NOT possible here (no running backend/Redis/isolated E2E
  database in this environment): **honestly not-run**.
- Manual browser pass of `/users` + `/users/new` at 1440/390 px is covered by
  component tests and the 390 px story; a live browser acceptance on the
  обновлённом стенде (вход local-admin, создание тестового пользователя, его
  вход) belongs to the controller's deploy step.
