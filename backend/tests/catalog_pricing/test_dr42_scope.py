"""ТЗ DR42 §2/§3/§4 (Вариант A): tariff scope, diagnostics and evaluation mode.

Named plan tests (§8 pricing 1–7):

- ``test_tariff_in_catalog_scope_is_found_by_preview`` — a tariff saved in the
  chosen catalog species scope is found by the pricing preview;
- ``test_legacy_laboratory_scope_tariff_is_not_a_valid_scope`` — a legacy row
  carrying the laboratory UUID as ``product_species_id`` is never treated as a
  valid VSE scope: the preview fails with the concrete actionable diagnostic
  (CONFIGURATION_MISSING stays the technical code);
- ``test_missing_tariff_message_names_indicator_and_action`` — the message
  contains the indicator name, code and the «Стоимость исследований» action;
- ``test_zero_price_differs_from_missing_price`` — an explicit 0.00 tariff
  prices 0.00 while an absent one is CONFIGURATION_MISSING;
- ``test_catalog_change_does_not_reprice_saved_snapshot`` — a saved snapshot
  keeps its pinned price after the catalog changes;
- ``test_evaluation_mode_is_part_of_the_snapshot`` — FIXED / CONFIGURABLE /
  NONE are derived server-side by the result schema;
- ``test_tariffs_context_lists_species_names_and_legacy_rows`` — the editor
  context carries human species names (UUID internal) and the legacy
  mis-scoped rows for migration diagnostics only.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import UnitOfWork
from backend.src.core.problems import ProblemError
from backend.src.modules.catalog_pricing import context as context_module
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.models import Tariff
from backend.src.modules.catalog_pricing.schemas import ResearchValue
from backend.src.modules.catalog_pricing.service import evaluate_and_price, missing_tariff_message
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2
from backend.tests.catalog_pricing.test_pricing import _rule, _seed, _tariff, _vse_request

MICROSCOPY = _mandatory.MICROSCOPY_INDICATOR_ID
TEMPERATURE = _mandatory.TEMPERATURE_INDICATOR_ID
PH = _mandatory.PH_INDICATOR_ID
BACTERIOSCOPY = _mandatory.BACTERIOSCOPY_INDICATOR_ID


# --- §2/§3: scope -------------------------------------------------------------------


@pytest.mark.integration
async def test_tariff_in_catalog_scope_is_found_by_preview(db_session: AsyncSession) -> None:
    """§8.1: a tariff saved in the chosen catalog species scope is found."""
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, uuid.uuid4(), MICROSCOPY, result_schema="DECIMAL", unit_id="RUB"))
    db_session.add(_tariff(env.lab.id, species, str(MICROSCOPY), "120.00", unit="RUB"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [ResearchValue.model_validate({"indicator_id": str(MICROSCOPY), "performed": True, "value": "2.5"})],
            quantity="1",
        ),
        None,
    )
    assert snapshot.lines[0].unit_price == "120.00"
    assert snapshot.lines[0].amount == "120.00"


@pytest.mark.integration
async def test_legacy_laboratory_scope_tariff_is_not_a_valid_scope(db_session: AsyncSession) -> None:
    """§8.2: the legacy mis-scoped row is invisible to pricing and the error is
    the concrete actionable diagnostic, never a generic «тариф отсутствует»."""
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, uuid.uuid4(), MICROSCOPY, result_schema="DECIMAL", unit_id="RUB"))
    # The historical bad row: product_species_id = laboratory UUID.
    db_session.add(_tariff(env.lab.id, env.lab.id, str(MICROSCOPY), "120.00", unit="RUB"))
    await db_session.commit()

    with pytest.raises(ProblemError) as missing:
        await evaluate_and_price(
            UnitOfWork(db_session),
            _vse_request(
                env.lab.id,
                species,
                uuid.uuid4(),
                [ResearchValue.model_validate({"indicator_id": str(MICROSCOPY), "performed": True, "value": "2.5"})],
            ),
            None,
        )
    assert missing.value.code == "CONFIGURATION_MISSING"
    detail = missing.value.detail
    assert "Микроскопия" in detail
    assert "VSE-F24" in detail
    assert "Стоимость исследований" in detail
    assert str(species) in detail  # the scope of the request, not the legacy row


@pytest.mark.integration
async def test_missing_tariff_message_names_indicator_and_action() -> None:
    message = missing_tariff_message(MICROSCOPY, uuid.uuid4())
    assert "Не настроена стоимость исследования «Микроскопия»" in message
    assert "(код VSE-F24)" in message
    assert "Откройте справочник «Стоимость исследований»" in message


# --- §4.2: zero vs missing -----------------------------------------------------------


@pytest.mark.integration
async def test_zero_price_differs_from_missing_price(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, uuid.uuid4(), MICROSCOPY, result_schema="DECIMAL", unit_id="RUB"))
    db_session.add(_tariff(env.lab.id, species, str(MICROSCOPY), "0.00", unit="RUB"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [ResearchValue.model_validate({"indicator_id": str(MICROSCOPY), "performed": True, "value": "2"})],
        ),
        None,
    )
    assert snapshot.lines[0].unit_price == "0.00"
    assert snapshot.lines[0].amount == "0.00"


# --- §4.2/§11: snapshot stability ------------------------------------------------------


@pytest.mark.integration
async def test_catalog_change_does_not_reprice_saved_snapshot(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    rule = _rule(env.lab.id, species, uuid.uuid4(), MICROSCOPY, result_schema="DECIMAL", unit_id="RUB")
    db_session.add(rule)
    db_session.add(_tariff(env.lab.id, species, str(MICROSCOPY), "120.00", unit="RUB"))
    await db_session.commit()

    from backend.tests.catalog_pricing.test_pricing import _prev_snapshot

    previous = _prev_snapshot(species, uuid.uuid4(), MICROSCOPY, "100.00", rule)
    # The catalog changes afterwards: the same tariff row is re-priced higher,
    # and the saved snapshot must keep its pinned price.
    tariff = (await db_session.execute(select(Tariff).where(Tariff.service_code == str(MICROSCOPY)))).scalars().one()
    tariff.price = Decimal("500.00")
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [ResearchValue.model_validate({"indicator_id": str(MICROSCOPY), "performed": True, "value": "2.5"})],
        ),
        previous,
    )
    assert snapshot.lines[0].unit_price == "100.00"


# --- §4.3: evaluation mode -------------------------------------------------------------


@pytest.mark.integration
async def test_evaluation_mode_is_part_of_the_snapshot(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add_all(
        [
            _rule(
                env.lab.id,
                species,
                uuid.uuid4(),
                MICROSCOPY,
                result_schema="DECIMAL",
                unit_id="RUB",
                rule={"type": "interval", "lower": "0", "upper": "5"},
            ),
            _rule(
                env.lab.id,
                species,
                uuid.uuid4(),
                BACTERIOSCOPY,
                result_schema="TEXT",
                unit_id="",
                rule={"type": "qualitative", "accepted_values": ["рост не обнаружен"]},
            ),
        ]
    )
    db_session.add_all(
        [
            _tariff(env.lab.id, species, str(MICROSCOPY), "10.00", unit="RUB"),
            _tariff(env.lab.id, species, str(BACTERIOSCOPY), "10.00", unit="RUB"),
        ]
    )
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [
                ResearchValue.model_validate({"indicator_id": str(MICROSCOPY), "performed": True, "value": "2.5"}),
                ResearchValue.model_validate(
                    {"indicator_id": str(BACTERIOSCOPY), "performed": True, "value": "рост не обнаружен"}
                ),
            ],
        ),
        None,
    )
    by_code = {line.service_code: line for line in snapshot.lines}
    microscopy = by_code[str(MICROSCOPY)]
    bacterioscopy = by_code[str(BACTERIOSCOPY)]
    # The configurable interval carries the verdict and the mode; TEXT has no
    # norm at all and stays UNKNOWN without a fabricated verdict.
    assert microscopy.evaluation["evaluation_mode"] == "CONFIGURABLE"
    assert microscopy.evaluation["status"] == "IN_NORM"
    assert bacterioscopy.evaluation["evaluation_mode"] == "NONE"
    assert bacterioscopy.evaluation["status"] == "UNKNOWN"
    assert microscopy.method_snapshot is not None
    assert microscopy.method_snapshot["rule"] == {"type": "interval", "lower": "0", "upper": "5"}


@pytest.mark.integration
async def test_fixed_enum_evaluation_mode(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    indicator = _mandatory.ORGANOLEPTIC_INDICATOR_ID
    db_session.add(
        _rule(
            env.lab.id,
            species,
            uuid.uuid4(),
            indicator,
            result_schema="ENUM",
            unit_id="",
            rule={"type": "qualitative", "accepted_values": ["Соответствует"]},
        )
    )
    db_session.add(_tariff(env.lab.id, species, str(indicator), "10.00", unit="RUB"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [
                ResearchValue.model_validate(
                    {"indicator_id": str(indicator), "performed": True, "value": "Соответствует"}
                )
            ],
        ),
        None,
    )
    assert snapshot.lines[0].evaluation["evaluation_mode"] == "FIXED"
    assert snapshot.lines[0].evaluation["status"] == "IN_NORM"


# --- §3: the tariff editor context ------------------------------------------------------


@pytest.mark.integration
async def test_tariffs_context_lists_species_names_and_legacy_rows(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species_a = uuid.uuid4()
    species_b = uuid.uuid4()
    db_session.add_all(
        [
            MercuryProductGuidLvl2(
                contour="PILOT",
                guid=species_a,
                current_uuid=species_a,
                name="Говядина",
                tnved_codes="0201",
                product_type=1,
                active=True,
                is_last=True,
                external_status=200,
                source="VETIS_LOOKUP",
                requires_trichinelloscopy=False,
            ),
            MercuryProductGuidLvl2(
                contour="PILOT",
                guid=species_b,
                current_uuid=species_b,
                name="Свинина",
                tnved_codes="0203",
                product_type=1,
                active=True,
                is_last=True,
                external_status=200,
                source="VETIS_LOOKUP",
                requires_trichinelloscopy=True,
            ),
        ]
    )
    # One correctly scoped tariff and one legacy mis-scoped row.
    db_session.add(_tariff(env.lab.id, species_a, str(MICROSCOPY), "10.00", unit="RUB"))
    db_session.add(_tariff(env.lab.id, env.lab.id, str(PH), "5.00", unit="RUB"))
    await db_session.commit()

    context = await context_module.tariffs_context(db_session, env.lab.id)
    assert context.product_area_code == "meat"
    names = {option.name: str(option.id) for option in context.species_options}
    # The seed registry may carry more meat species; the two mirrored ones are
    # selectable by their human names.
    assert names.get("Говядина") == str(species_a)
    assert names.get("Свинина") == str(species_b)
    assert all(option.id != env.lab.id for option in context.species_options)
    assert len(context.legacy_tariffs) == 1
    assert context.legacy_tariffs[0].product_species_id == env.lab.id
    assert context.legacy_tariffs[0].service_code == str(PH)


@pytest.mark.integration
async def test_tariffs_context_unknown_laboratory_is_honest(db_session: AsyncSession) -> None:
    from backend.src.modules.catalog_pricing.context import configuration_missing as ctx_missing

    with pytest.raises(ProblemError) as missing:
        await context_module.tariffs_context(db_session, uuid.uuid4())
    assert missing.value.code == "CONFIGURATION_MISSING"
    assert ctx_missing is not None
