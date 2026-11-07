# A03 — Подтверждённый состав и downstream gate (ТЗ-04)

Task: `feat: establish immutable verified receipt boundary` (branch `feature/A03-confirm`, from A02 `123cbc5`).
Spec sources: DATA-02/06, API-04, FT-ARR-12/14/15, AT-05, ADR-016/019.

## Delivered

### `backend/src/modules/arrivals/confirmation.py` (new)

`confirm_receipt(uow, evidence: ReceiptEvidence | None) -> ReceiptConfirmation | None` — the only writer of
`receipt_confirmations` (DATA-06). A service command for the worker/composition root; it never commits and never
touches the network (no SOAP). Behaviour:

- **Evidence gate (FT-ARR-14):** `None` evidence (absent/UNKNOWN external result) confirms nothing. Evidence whose
  `external_status` is not in `CONFIRMED_EVIDENCE_STATUSES` (UNKNOWN, UTILIZED, absent) is refused 422
  `INTEGRATION_EVIDENCE_INCOMPLETE`; a receiver mismatch (`receiver_enterprise_id` ≠ the eVSD consignee enterprise
  GUID), an unknown local party, an unusable/absent `operation_id`, and an incomplete composition are refused the
  same way — no row is ever left behind.
- **Composition arithmetic (DATA-02):** ACCEPT_ALL ⇒ accepted = documentary (mass+quantity), returned 0;
  PARTIALLY ⇒ both parts positive and accepted+returned = delivered; RETURN_ALL ⇒ accepted 0, returned =
  delivered; the evidence unit must match the eVSD unit GUID.
- **Dedup:** the fingerprint is SHA-256 over the canonical immutable evidence. A repeat of the same
  operation/fingerprint is an idempotent replay of the same fact (no second row, no revision churn). A second,
  incompatible confirmation is **rejected** 409 `STATE_CONFLICT`, never an overwrite.
- **Atomic freeze:** in ONE transaction with the confirmation row (caller commits): the reconciliation row (if any)
  is frozen to the external fact — state CONFIRMED (positive) / RETURNED (full return), `completed_at`, accepted/
  returned quantities+units, `rev+1` — and the party `rev+1` (the ETag of the read view moves). If a saved
  reconciliation decision contradicts the evidence decision, the confirmation is refused (no silent override).
  The queue label stays a query-time read model (DATA-02): the confirmation row plus the frozen state are exactly
  what the queue read model already consumes, so queue status needs no separate write.
- **Downstream gate:** `ensure_confirmed(db, party_id)` — missing real evidence blocks dependent commands
  (ВСЭ creation, conclusion printing — ТЗ-05/07) with an explicit 422 `RECEIPT_NOT_CONFIRMED`, never silent
  success. `downstream_route(db, party_id)` recalculates from live state (FT-ARR-12): full return → `NONE` (no
  examination is ever created); previous ВСЭ present **and** repeat explicitly not required → `CONCLUSION`;
  otherwise → `EXAMINATION`. The route is never stored.

### `backend/src/modules/arrivals/ports.py` (changed)

`ReceiptEvidence.external_status: str | None` (backward-compatible) + `CONFIRMED_EVIDENCE_STATUSES = {"CONFIRMED",
"COMPLETED"}` — the gate needs a way to distinguish a verified result from UNKNOWN/UTILIZED. Set only by the VetIS
adapter; no HTTP surface can set it (verified below).

### `backend/src/modules/arrivals/reconciliation.py` (changed)

`save_reconciliation` now checks If-Match **before** the frozen-state guard: a stale client gets 409
`REVISION_CONFLICT` (the revision moved when the confirmation bumped the reconciliation `rev`); a client holding
the current revision gets 409 `STATE_CONFLICT` (the frozen state). The A02 semantics otherwise unchanged.

### `queries.py` — deliberately unchanged

The A01/A02 read models already expose `IncomingView.confirmation?`, the queue read model and the reconciliation
view recomputation; the confirmation joins them through the frozen reconciliation row and the party revision. No
new view surface was needed for API-04.

### Test-only fixture — `backend/tests/fixtures/receipt_evidence.py`

`FixtureReceiptEvidenceReader` (plants evidence per party), `receipt_evidence(...)` builder, and
`confirm_via_reader(uow, reader, party_id)` — the composition-root seam exactly as ТЗ-11 will replay it
(`reader.read` → `confirm_receipt`). Explicitly marked test-only; nothing under `backend/src` imports it; there is
no runtime or demo switch. The VetIS adapter stays `DisabledVetisAdapter` (503 `INTEGRATION_NOT_CONFIGURED`); no
SOAP submission was prepared beyond the seam.

## Port closure / negative API proof (`test_no_http_force_success`)

- A PUT of the reconciliation with a client-supplied `"verified": true` extra field → 422 `VALIDATION_ERROR`
  (`extra=forbid`): a client cannot assert verified flags anywhere.
- `POST /api/v1/arrivals/{id}/receipt` with an evidence-shaped body → 404: no receipt route exists yet (the ТЗ-11
  intent endpoint is a separate 202 operation and never accepts a verified fact).
- The OpenAPI schema of the live app contains no `ReceiptEvidence` schema at all: no endpoint accepts one.

## TDD evidence

RED: `uv run --frozen pytest backend/tests/arrivals/test_confirmation.py` → `ModuleNotFoundError: No module named
'backend.src.modules.arrivals.confirmation'` (collection error, pristine). GREEN after implementation: all 6 named
tests pass.

Named tests (`backend/tests/arrivals/test_confirmation.py`):

- `test_evidence_gate` — UNKNOWN/UTILIZED/foreign receiver/incomplete PARTIAL never create a confirmation;
  `downstream_route`/`ensure_confirmed` answer `RECEIPT_NOT_CONFIRMED` with an explicit Russian reason.
- `test_duplicate_evidence` — re-confirmation is idempotent (same row id, exactly one row, no rev churn);
  a different operation with the same composition is rejected 409 and the frozen fact stays intact.
- `test_freeze_after_confirmation` — the confirmation freezes state/`completed_at`/accepted composition and
  bumps the reconciliation `rev`; afterwards a stale PUT → 409 `REVISION_CONFLICT`, a current PUT → 409
  `STATE_CONFLICT`; the read model shows the frozen accepted mass/quantity.
- `test_routes` — positive + local ВСЭ required → `EXAMINATION`; previous ВСЭ sufficient → `CONCLUSION`; full
  return → `NONE`.
- `test_confirmation_survives_deletion` — deleting the reconciliation row leaves the confirmation; the route is
  recalculated from live state (DATA-02 «партия „В работе", confirmation остаётся»; the analogous ВСЭ deletion
  case is `test_queue_after_examination_delete` from A01, still green).
- `test_no_http_force_success` — see above.

## Gates (final run against the committed tree)

- `uv sync --frozen` — ok (63 packages).
- `ruff check backend` — All checks passed; `ruff format --check backend` — 82 files formatted.
- Byte-hazard re-verification after `ruff format`: no BOM, no `except (A, B)` tuple in any touched file
  (`confirmation.py` has only `except ArithmeticError`), compileall 0, `import backend.src.interfaces.main` ok.
- `mypy backend/src` — Success, 53 files.
- `pytest backend/tests --cov=backend/src --cov-fail-under=85` → **248 passed, coverage 94.40%**. Arrivals:
  confirmation 90%, reconciliation 97%, router 100%, commands 93%, queries 90%, validation 93%, schemas 98%,
  models/ports 100%.

## AT mapping

- AT-05 (loss of the receipt answer): covered by the evidence gate + `RECEIPT_NOT_CONFIRMED` blocker +
  idempotent duplicate handling; the final acceptance of the full external loop is ТЗ-11 per plan.
- FT-ARR-12 (route semantics), FT-ARR-14 (UNKNOWN ≠ confirmed; no one-click/manual-number confirmation exists
  anywhere in the surface), FT-ARR-15 (immutability + If-Match semantics) — asserted in the named tests.

## Notes / concerns

1. `ReceiptEvidence.external_status` is an optional field addition to the A01 DTO — required to model the
   UNKNOWN/UTILIZED gate; default `None` is refused by the gate (absence is never a proof).
2. `external_status` accepts `{"CONFIRMED", "COMPLETED"}` — the exact external enum binding stays with ТЗ-11
   (same posture as A02's `external_return_allowed`).
3. `ReceiptConfirmation.operation_id` is UUID-unique per migration; a non-UUID external operation id is refused
   by the gate until ТЗ-10/11 bind the real id shape.
4. Full-repo `mypy backend` still has the pre-existing test-file errors documented in A01; the shipped code gate
   `mypy backend/src` is clean.
5. `ruff check --fix` re-sorted import blocks in `reconciliation.py` and `test_reconciliation.py` (whitespace-only
   moves); verified byte-safe afterwards.
