# D01 — Выбор основания и view-model (ТЗ-07)

Task: `feat: derive conclusions from verified valid bases` (branch `feature/D01-basis`, from main `1b93f3b`).
Spec sources: API-07, INPUT-04, FT-DOC-01–06, AT-06/13, ADR-022; contracts `documents/service.py` (DATA-06).

## Delivered

### `backend/src/modules/documents/service.py` (new)

`build_conclusion(actor_id, party_id, *, uow, authorizer=None) -> ConclusionView` — read-only derivation of the
currently valid basis; nothing is stored and nothing is cached, so every call answers from live state.

- **Access first:** the party is resolved with its document, then `authorize(conclusion:preview,
  ScopeTarget(laboratory_id, product_scope_id), hide_foreign=True)` runs against the live tables on **every** call
  (router DI and service agree; there is no snapshot/cached bypass — viewing and the future export of D02 reuse the
  same view-model and re-check the same way).
- **Gate:** `ensure_confirmed` — no frozen receipt fact is 422 `RECEIPT_NOT_CONFIRMED`; a full return
  (accepted 0 / returned > 0) is 422 `DOCUMENT_BASIS_INCOMPLETE`.
- **Basis selection (FT-DOC-03, the ФТ 04 route table):**
  - `previous_sufficient` (frozen at confirm time, A03) → basis **PREVIOUS**: stamp/date/basis from the CHK
    previous-ВСЭ record of the incoming eVSD; no local ВСЭ is demanded.
  - otherwise basis **LOCAL**: the party's own `COMPLETED` + `FIT` examination supplies its laboratory stamp;
    waiting / unfit / **deleted or missing local** never fall back to the previous basis — an explicit 422.
- **Required fields without substitutions (FT-DOC-04, INPUT-04):** the manifest spaces organization / laboratory /
  date / basis / evsd / owner / product / mass / count / unit / stamp are computed from real data (frozen accepted
  composition for mass/count/unit; laboratory row; eVSD issueNumber/consignee/productItem; local or previous
  basis dates). Every gap is **enumerated** in 422 `DOCUMENT_BASIS_INCOMPLETE` (`detail` + field-level `errors`
  `fields.<name>`). Demo terms, numbers, signatures and foreign requisites are never fabricated; the manual
  `signature` space is always rendered as a mandatory blank place (`""`).
- No migration: the module reads existing tables only (`parties`, `incoming_documents`, `receipt_confirmations`,
  `examinations`, `laboratories`).

### `backend/src/modules/documents/schemas.py` (new)

`ConclusionView{basis_kind: LOCAL|PREVIOUS, basis_id, fields, form_id, form_version, official, warnings}` per
API-07; `form_id` = `conclusion-local` / `conclusion-previous` (separate manifests per INPUT-04), `form_version=1`,
`official=False`, `warnings=["Предварительная форма"]` until the official sample exists.

### `backend/src/modules/documents/router.py` (new) + v1 assembly

`GET /arrivals/{party_id}/conclusion/preview` → 200 `ConclusionView` with `Cache-Control: no-store`; ADMIN and
out-of-scope callers get 404 (`hide_foreign`) even with the known party id. The PDF route itself stays with D02;
this task ships the single view-model it will consume (preview, PDF and print are one server-side model).

## TDD evidence

RED: `uv run --frozen pytest backend/tests/documents/test_conclusion_basis.py` →
`ModuleNotFoundError: No module named 'backend.src.modules.documents'` (pristine collection error).
GREEN after implementation: 14 passed.

Named tests (`backend/tests/documents/test_conclusion_basis.py`):

- `test_no_previous_uses_local_stamp` — no previous → LOCAL stamp of the own completed card.
- `test_previous_with_repeat_keeps_local_stamp_and_source` — previous + repeat → local stamp AND the eVSD
  CHK snapshot is byte-identical after the build (the previous VSE's source data is never mutated).
- `test_previous_without_repeat_uses_slaughter_stamp_without_local` — previous + no repeat → PREVIOUS basis,
  slaughter-point stamp, no local ВСЭ exists.
- `test_partial_acceptance_shows_accepted_mass_only` — 100 accepted of 120 delivered → fields carry the accepted
  100/4, never the delivered 120.
- `test_waiting_examination_blocks_document` / `test_unfit_examination_blocks_document` /
  `test_full_return_blocks_document` / `test_missing_confirmation_blocks_document` — the four blocked routes, all 422.
- `test_missing_previous_fields_are_enumerated` — the incomplete CHK record lists every absent previous requisite
  in the problem detail/errors.
- `test_no_demo_signatures_or_foreign_requisites` — real organization/laboratory/eVSD/owner/product/unit; blank
  signature space.
- `test_deleted_required_local_never_falls_back_to_previous` — deleted local with repeat required → 422 without
  a PREVIOUS substitute.
- `test_correction_shows_current_data_in_next_conclusion` — after the stamp correction the next view answers the
  current data (FT-DOC-06).
- `test_deletion_closes_the_old_conclusion` — after the deletion the previously served URL refuses.
- `test_preview_api_and_admin_forbidden` — scoped VET 200 + no-store over HTTP; ADMIN 404 with the same known id.

## Gates (final run against the committed tree)

- `uv sync --frozen` — ok (63 packages).
- `ruff check backend` — All checks passed; `ruff format --check backend` — 114 files formatted.
- Byte-hazard re-check after format: no BOM, no `except (A, B)` tuple in any touched file, Cyrillic verified as
  explicit UTF-8; compileall ok; `import backend.src.interfaces.main` ok.
- `mypy backend/src` — Success, 72 files.
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` → **328 passed, coverage 94.57%**; documents:
  service 96%, schemas/router 100%.

## AT mapping

- AT-06 (three stamp routes; no previous → the incoming stamp is hidden — the PREVIOUS basis never appears
  without the CHK record) — the three named route tests.
- AT-13 (unfit party has no implementation conclusion) — `test_unfit_examination_blocks_document`; the full-return
  and waiting blocks complete the FT-DOC-02/03 matrix.
- FT-DOC-01–06 as mapped in `docs/TZ_development/plans/traceability.md`: routes FT-DOC-03, requisites FT-DOC-04,
  live view/correction/deletion FT-DOC-05/06.

## Notes / concerns

1. The `unit` space carries the frozen `accepted_unit_id` (the external unit GUID of the confirmation); a
   user-readable unit name requires the dictionary binding that stays with ТЗ-10/11 — no name is invented here.
2. `previousResult`/`previousConclusion` are required as non-blank requisites; a semantic "пригодно" vocabulary
   check on the previous result would need the CHK vocabulary binding — the route decision itself is already frozen
   at confirm time (`previous_sufficient`), so D01 never re-judges it silently.
3. The PDF endpoint (`conclusion.pdf`) and the renderer are ТЗ D02; preview and export share this one view-model,
   so the no-store + re-check contract cannot diverge.
