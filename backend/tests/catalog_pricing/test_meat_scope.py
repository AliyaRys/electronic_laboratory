"""DR31: единый мясной scope справочника норм (ТЗ 2026-11-16 §11).

Ключ применимости активной нормы: ``laboratory_id + product_area_code('meat')
+ indicator_id``. Вид и состояние продукции (GUID Меркурия, наблюдаемые
subProduct партий) БОЛЬШЕ не входят в ключ и в write-контракт. Трихинеллоскопия
(F21) остаётся ОДНОЙ строкой справочника; её условная обязательность по четырём
точным GUID определяется на уровне партии в examinations (не здесь).
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.commands import UnitOfWork
from backend.src.core.database import async_session
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.models import MethodRule
from backend.src.modules.catalog_pricing.schemas import PricingRequest
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2
from backend.tests.catalog_pricing.test_pricing import PASSWORD, _seed
from backend.tests.identity.test_sessions import MemoryRedis, TestClock


def _old_rule(lab: uuid.UUID, indicator: uuid.UUID, **overrides: object) -> MethodRule:
    """A LEGACY species/state-scoped row (pre-DR31 shape)."""
    defaults: dict[str, object] = {
        "laboratory_id": lab,
        "product_species_id": uuid.uuid4(),
        "product_state_id": uuid.uuid4(),
        "indicator_id": indicator,
        "version": 1,
        "result_schema": "DECIMAL",
        "unit_id": "°C",
        "rule": {"type": "interval", "lower": "0", "upper": "6"},
        "source": {"name": "методика"},
        "active": True,
    }
    defaults.update(overrides)
    return MethodRule(**defaults)  # type: ignore[arg-type]


# --- HTTP layer -------------------------------------------------------------------


@asynccontextmanager
async def _client_for(env: SimpleNamespace):
    from backend.src.interfaces.main import app

    factory = async_sessionmaker(env.db.bind, class_=AsyncSession, expire_on_commit=False)

    async def request_session():
        async with factory() as session:
            yield session

    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="meat")
    app.dependency_overrides[async_session] = request_session
    app.dependency_overrides[get_session_transport] = lambda: transport
    app.dependency_overrides[get_authorizer] = lambda: Authorizer(InMemoryDecisionEngine())
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            token = str((await http.get("/api/v1/auth/csrf")).json()["csrf_token"])
            response = await http.post(
                "/api/v1/auth/login",
                json={"login": "chief", "password": PASSWORD},
                headers={"Origin": "http://test", "X-CSRF-Token": token},
            )
            assert response.status_code == 200, response.text
            env.csrf = response.json()["csrf_token"]
            yield http
    finally:
        for key in (async_session, get_session_transport, get_authorizer):
            app.dependency_overrides.pop(key, None)


def _csrf_headers(env: SimpleNamespace) -> dict[str, str]:
    return {"Origin": "http://test", "X-CSRF-Token": env.csrf, "Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture
async def api_env(db_session: AsyncSession) -> SimpleNamespace:
    return await _seed(db_session)


@pytest_asyncio.fixture(autouse=True)
async def _clean_seeded_dictionary(test_db_engine):
    yield
    async with test_db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM mercury_product_guid_lvl_2 WHERE source = 'test'"))


# --- scenarios --------------------------------------------------------------------


@pytest.mark.integration
async def test_context_opens_without_mercury_data_or_parties(api_env: SimpleNamespace) -> None:
    """§11-1/2: пустая БД справочника Меркурия и отсутствие партий НЕ мешают
    открыть мясной справочник: 200, полный перечень F18–F29, без species/state."""
    async with _client_for(api_env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={"laboratory_id": str(api_env.lab.id), "area": "meat"},
        )
        assert response.status_code == 200, response.text
        context = response.json()
        assert context["product_area_code"] == "meat"
        assert context["product_area_name"] == "Мясо и мясопродукты"
        assert [item["code"] for item in context["indicators"]] == [f"VSE-F{n}" for n in range(18, 30)]
        assert context["active_rules"] == []
        # ТЗ DR41-B §6.4: only the CONFIGURABLE indicators are ever «missing» —
        # F18/F19 (FIXED) and F23 (NONE) need no MethodRule at all.
        assert len(context["missing"]) == 6
        # Новый контекст больше не несёт видов/состояний продукции.
        for key in ("species_options", "states", "product_species", "product_state"):
            assert key not in context


@pytest.mark.integration
async def test_mercury_dictionary_rows_do_not_block_or_shape_context(api_env: SimpleNamespace) -> None:
    """§11-3: даже при заполненном словаре Меркурия контекст не зависит от него."""
    db = api_env.db
    db.add(
        MercuryProductGuidLvl2(
            contour="PILOT",
            guid=uuid.uuid4(),
            current_uuid=uuid.uuid4(),
            name="Свинина",
            english_name="Pig meat",
            tnved_codes="0203",
            product_type=1,
            active=True,
            is_last=True,
            external_status=100,
            requires_trichinelloscopy=True,
            source="test",
            synchronized_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
        )
    )
    await db.commit()
    async with _client_for(api_env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={"laboratory_id": str(api_env.lab.id), "area": "meat"},
        )
        assert response.status_code == 200, response.text
        context = response.json()
        assert "Свинина" not in str(context)


@pytest.mark.integration
async def test_write_contract_requires_only_code_and_rule(api_env: SimpleNamespace) -> None:
    """§11-5: create не требует от клиента species/state/UUID показателя/
    schema/unit/version/source. Неизвестный код отклоняется (§11-6)."""
    async with _client_for(api_env) as http:
        payload = {
            "laboratory_id": str(api_env.lab.id),
            "code": "VSE-F20",
            "rule": {"type": "interval", "lower": "0", "upper": "6"},
        }
        created = await http.post("/api/v1/catalogs/methods", json=payload, headers=_csrf_headers(api_env))
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["product_area_code"] == "meat"
        assert body["product_species_id"] is None
        assert body["product_state_id"] is None
        assert body["result_schema"] == "DECIMAL"
        assert body["unit_id"] == "°C"
        assert body["source"]["name"] == "Ручная настройка справочника норм"

        # Идемпотентный повтор с тем же ключом.
        key = _csrf_headers(api_env)
        key["Idempotency-Key"] = created.request.headers["idempotency-key"]
        replay = await http.post("/api/v1/catalogs/methods", json=payload, headers=key)
        assert replay.status_code in (200, 201)
        assert replay.json()["id"] == body["id"]

        unknown = await http.post(
            "/api/v1/catalogs/methods",
            json={"laboratory_id": str(api_env.lab.id), "code": "VSE-F99", "rule": {"type": "interval"}},
            headers=_csrf_headers(api_env),
        )
        assert unknown.status_code == 422

        # Технические поля старого контракта больше не принимаются.
        legacy = dict(payload, product_species_id=str(uuid.uuid4()), product_state_id=str(uuid.uuid4()))
        rejected = await http.post("/api/v1/catalogs/methods", json=legacy, headers=_csrf_headers(api_env))
        assert rejected.status_code == 422


@pytest.mark.integration
async def test_one_active_norm_per_lab_and_indicator_across_species(db_session: AsyncSession) -> None:
    """§11-4: у одного показателя не более одной активной нормы на лабораторию
    и meat; вторая активная (даже другой вид/состояние) запрещена индексом."""
    from sqlalchemy.exc import IntegrityError

    lab = uuid.uuid4()
    db_session.add(_old_rule(lab, _mandatory.TEMPERATURE_INDICATOR_ID))
    await db_session.flush()
    db_session.add(_old_rule(lab, _mandatory.TEMPERATURE_INDICATOR_ID))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.integration
async def test_single_norm_applies_to_two_parties_of_different_species(db_session: AsyncSession) -> None:
    """§11-7: одна норма применяется к двум партиям разных видов/состояний."""
    from backend.src.modules.catalog_pricing.service import _active_rule  # noqa: PLC0415

    lab = uuid.uuid4()
    db_session.add(
        _old_rule(
            lab,
            _mandatory.TEMPERATURE_INDICATOR_ID,
            result_schema="DECIMAL",
            unit_id="°C",
            rule={"type": "interval", "lower": "0", "upper": "6"},
        )
    )
    await db_session.commit()
    for _ in range(2):
        rule = await _active_rule(UnitOfWork(db_session), lab, _mandatory.TEMPERATURE_INDICATOR_ID)
        assert rule is not None
        assert rule.product_area_code == "meat"


@pytest.mark.integration
async def test_norm_is_not_shared_between_laboratories(db_session: AsyncSession) -> None:
    """§11-14: норма чужой лаборатории не применяется."""
    from backend.src.core.problems import ProblemError

    lab_a, lab_b = uuid.uuid4(), uuid.uuid4()
    db_session.add(
        _old_rule(
            lab_a,
            _mandatory.TEMPERATURE_INDICATOR_ID,
            result_schema="DECIMAL",
            unit_id="°C",
            rule={"type": "interval", "lower": "0", "upper": "6"},
        )
    )
    await db_session.commit()
    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(lab_b),
            "context": "VSE",
            "results": [
                {"indicator_id": str(_mandatory.TEMPERATURE_INDICATOR_ID), "performed": True, "value": "3"}
            ],
            "product_species_id": str(uuid.uuid4()),
            "accepted_quantity": "1",
            "accepted_unit_id": "kg",
        }
    )
    with pytest.raises(ProblemError) as priced:
        await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert priced.value.code == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_migration_merges_equivalent_and_keeps_conflicts_unresolved(test_db_url: str) -> None:
    """§11-11 (R-DR31-6): эквивалентные старые активные нормы (lab, indicator)
    объединяются в одну активную норму meat; РАЗЛИЧАЮЩИЕСЯ не выбираются
    случайно — обе уходят в аудит, новая норма остаётся «Не настроено»."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    import psycopg
    from sqlalchemy.ext.asyncio import create_async_engine

    repo_root = Path(__file__).resolve().parents[3]

    def alembic(*args: str) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ)
        env["DATABASE_URL"] = test_db_url
        return subprocess.run(  # noqa: S603
            [sys.executable, "-m", "alembic", "-c", str(repo_root / "backend" / "alembic.ini"), *args],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            text=True,
        )

    def sync_url() -> str:
        return test_db_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    lab = uuid.uuid4()
    indicator = _mandatory.TEMPERATURE_INDICATOR_ID
    downgraded = alembic("downgrade", "0018_vetis_reference_names")
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr
    try:
        rule_equal = '{"type": "interval", "lower": "0", "upper": "6"}'
        with psycopg.connect(sync_url()) as connection, connection.cursor() as cursor:
            # Эквивалентная группа: два разных вида/состояния, одинаковая норма.
            cursor.execute(
                "INSERT INTO method_rules (laboratory_id, product_species_id, product_state_id,"
                " indicator_id, version, result_schema, unit_id, rule, source, active)"
                " VALUES (%s, %s, %s, %s, 1, 'DECIMAL', '°C', %s, %s, true),"
                "        (%s, %s, %s, %s, 1, 'DECIMAL', '°C', %s, %s, true)",
                (
                    str(lab), str(uuid.uuid4()), str(uuid.uuid4()), str(indicator),
                    rule_equal, '{"name": "методика"}',
                    str(lab), str(uuid.uuid4()), str(uuid.uuid4()), str(indicator),
                    rule_equal, '{"name": "методика"}',
                ),
            )
            # Конфликтующая группа того же показателя ДРУГОЙ лаборатории.
            other = uuid.uuid4()
            cursor.execute(
                "INSERT INTO method_rules (laboratory_id, product_species_id, product_state_id,"
                " indicator_id, version, result_schema, unit_id, rule, source, active)"
                " VALUES (%s, %s, %s, %s, 1, 'DECIMAL', '°C', %s, %s, true),"
                "        (%s, %s, %s, %s, 1, 'DECIMAL', '°C', %s, %s, true)",
                (
                    str(other), str(uuid.uuid4()), str(uuid.uuid4()), str(indicator),
                    '{"type": "interval", "lower": "0", "upper": "4"}', '{"name": "методика"}',
                    str(other), str(uuid.uuid4()), str(uuid.uuid4()), str(indicator),
                    '{"type": "interval", "lower": "0", "upper": "8"}', '{"name": "методика"}',
                ),
            )
            connection.commit()

        upgraded = alembic("upgrade", "head")
        assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr

        async def inspect() -> None:
            engine = create_async_engine(test_db_url, echo=False)
            factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            try:
                async with factory() as session:
                    rows = (
                        (
                            await session.execute(
                                select(MethodRule).where(MethodRule.laboratory_id == lab).order_by(MethodRule.active)
                            )
                        )
                        .scalars()
                        .all()
                    )
                    assert len(rows) == 2  # ничего не удалено
                    active = [row for row in rows if row.active]
                    assert len(active) == 1
                    assert active[0].product_area_code == "meat"
                    assert active[0].rule == {"type": "interval", "lower": "0", "upper": "6"}
                    assert active[0].product_species_id is None
                    assert active[0].product_state_id is None

                    # Конфликтная группа: активной нормы нет — НЕ выбрана случайно.
                    other_rows = (
                        (await session.execute(select(MethodRule).where(MethodRule.laboratory_id == other)))
                        .scalars()
                        .all()
                    )
                    assert len(other_rows) == 2
                    assert not any(row.active for row in other_rows)
            finally:
                await engine.dispose()

        await inspect()
    finally:
        alembic("upgrade", "head")
