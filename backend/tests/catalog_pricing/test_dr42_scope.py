"""ТЗ DR43 (owner ruling 2026-11-17): tariff AREA scope, diagnostics.

Named tests (adapted from the DR42 plan; honest checks are never weakened):

- ``test_tariff_in_catalog_scope_is_found_by_preview`` — a tariff saved in the
  meat-area scope is found by the pricing preview;
- ``test_legacy_species_scope_tariff_is_not_found`` — a legacy row carrying a
  species (or a laboratory UUID) as the scope is never treated as a valid
  tariff: the preview fails with the concrete actionable diagnostic
  (CONFIGURATION_MISSING stays the technical code);
- ``test_tariff_of_another_area_is_not_found`` — an area row of a DIFFERENT
  product area never serves the meat calculations;
- ``test_missing_tariff_message_names_indicator_and_action`` — the message
  contains the indicator name, code and the «Стоимость исследований» action;
- ``test_zero_price_differs_from_missing_price`` — an explicit 0.00 tariff
  prices 0.00 while an absent one is CONFIGURATION_MISSING;
- ``test_catalog_change_does_not_reprice_saved_snapshot`` — a saved snapshot
  keeps its pinned price after the catalog changes;
- ``test_evaluation_mode_is_part_of_the_snapshot`` — FIXED / CONFIGURABLE /
  NONE are derived server-side by the result schema;
- ``test_tariffs_context_lists_legacy_rows_without_species_options`` — the
  editor context carries NO species selector any more and the rows outside
  the area scope for migration diagnostics only.
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
    """§8.1: a tariff saved in the meat-area scope is found regardless of the
    party's species — one price for the whole «Мясо и мясопродукты»."""
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, uuid.uuid4(), MICROSCOPY, result_schema="DECIMAL", unit_id="RUB"))
    db_session.add(_tariff(env.lab.id, None, str(MICROSCOPY), "120.00", unit="RUB"))
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
async def test_legacy_species_scope_tariff_is_not_found(db_session: AsyncSession) -> None:
    """§8.2: a legacy species-scoped row (including the historical mis-scoped
    row with the laboratory UUID as the species) is invisible to pricing and
    the error is the concrete actionable diagnostic, never a generic
    «тариф отсутствует»."""
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, uuid.uuid4(), MICROSCOPY, result_schema="DECIMAL", unit_id="RUB"))
    # The historical bad row: product_species_id = laboratory UUID, area NULL.
    db_session.add(
        Tariff(
            laboratory_id=env.lab.id,
            product_species_id=env.lab.id,
            product_area_code=None,
            service_code=str(MICROSCOPY),
            unit_id="RUB",
            price=Decimal("120.00"),
            version=1,
            source={"name": "прейскурант"},
        )
    )
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


@pytest.mark.integration
async def test_tariff_of_another_area_is_not_found(db_session: AsyncSession) -> None:
    """§8.2b: an area row of a DIFFERENT product area never serves the meat
    calculations; only the 'meat' area scope is read."""
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, uuid.uuid4(), MICROSCOPY, result_schema="DECIMAL", unit_id="RUB"))
    db_session.add(
        Tariff(
            laboratory_id=env.lab.id,
            product_species_id=None,
            product_area_code="milk",
            service_code=str(MICROSCOPY),
            unit_id="RUB",
            price=Decimal("120.00"),
            version=1,
            source={"name": "прейскурант"},
        )
    )
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


@pytest.mark.integration
async def test_missing_tariff_message_names_indicator_and_action() -> None:
    message = missing_tariff_message(MICROSCOPY)
    assert "Не настроена стоимость исследования «Микроскопия»" in message
    assert "(код VSE-F24)" in message
    assert "Мясо и мясопродукты" in message
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
                TEMPERATURE,
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
            _tariff(env.lab.id, species, str(TEMPERATURE), "10.00", unit="RUB"),
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
                ResearchValue.model_validate({"indicator_id": str(TEMPERATURE), "performed": True, "value": "2.5"}),
                ResearchValue.model_validate(
                    {"indicator_id": str(BACTERIOSCOPY), "performed": True, "value": "рост не обнаружен"}
                ),
            ],
        ),
        None,
    )
    by_code = {line.service_code: line for line in snapshot.lines}
    temperature = by_code[str(TEMPERATURE)]
    bacterioscopy = by_code[str(BACTERIOSCOPY)]
    # The configurable interval carries the verdict and the mode; TEXT has no
    # norm at all and stays neutral (NOT_APPLICABLE) without a fabricated
    # verdict (ТЗ DR41-B §6.2/§7.1).
    assert temperature.evaluation["evaluation_mode"] == "CONFIGURABLE"
    assert temperature.evaluation["status"] == "IN_NORM"
    assert bacterioscopy.evaluation["evaluation_mode"] == "NONE"
    assert bacterioscopy.evaluation["status"] == "NOT_APPLICABLE"
    assert temperature.method_snapshot is not None
    assert temperature.method_snapshot["rule"] == {"type": "interval", "lower": "0", "upper": "5"}


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
async def test_tariffs_context_lists_legacy_rows_without_species_options(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species_b = uuid.uuid4()
    # One correctly scoped area tariff and one legacy species-scoped row.
    db_session.add(_tariff(env.lab.id, None, str(MICROSCOPY), "10.00", unit="RUB"))
    db_session.add(
        Tariff(
            laboratory_id=env.lab.id,
            product_species_id=species_b,
            product_area_code=None,
            service_code=str(PH),
            unit_id="RUB",
            price=Decimal("5.00"),
            version=1,
            source={"name": "прейскурант"},
        )
    )
    await db_session.commit()

    context = await context_module.tariffs_context(db_session, env.lab.id)
    assert context.product_area_code == "meat"
    # DR43: no species selector exists any more.
    assert not hasattr(context, "species_options")
    # The legacy rows carry the REAL losing values: service, price, version
    # and the audit species by its HUMAN name (never a bare UUID).
    assert len(context.legacy_tariffs) == 1
    legacy = context.legacy_tariffs[0]
    assert legacy.product_species_id == species_b
    assert legacy.product_area_code is None
    assert legacy.service_code == str(PH)
    assert legacy.species_name is None  # a GUID outside the local mirror stays nameless, never a UUID

    # A species that the local Mercury mirror knows gets its human name.
    db_session.add(
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
            requires_trichinelloscopy=False,
        )
    )
    await db_session.commit()
    context = await context_module.tariffs_context(db_session, env.lab.id)
    assert context.legacy_tariffs[0].species_name == "Свинина"


@pytest.mark.integration
async def test_tariffs_context_unknown_laboratory_is_honest(db_session: AsyncSession) -> None:
    from backend.src.modules.catalog_pricing.context import configuration_missing as ctx_missing

    with pytest.raises(ProblemError) as missing:
        await context_module.tariffs_context(db_session, uuid.uuid4())
    assert missing.value.code == "CONFIGURATION_MISSING"
    assert ctx_missing is not None
