"""O03 load scenarios (OPS-03, Global Constraints) — isolated, never production.

Full contract profile (``FULL_PROFILE``) matches the Global Constraints of
ТЗ 09: 30 minutes, 80/20 read/write, 100 concurrent users, 100 laboratories,
500 users, 5000 new arrivals per day, 100 000 report sources per laboratory
half-year, on an 8 vCPU / 32 GiB / 500 GiB SSD host, with p95 read ≤2 s, p95
local save ≤3 s, errors <1%, 5-vet report calculation ≤60 s and a 100k-source
payload ≤32 MiB (OPS03).

``--short`` runs a scaled-down, minutes-not-30 variant against a real local
stack (a disposable Docker PostgreSQL 18.6, a disposable Redis and uvicorn):
it migrates the schema, seeds isolated fixtures, starts the app, logs in over
HTTP and measures a real 80/20 read/write mix with correctness and scope
leakage checks. The full profile is documented and remains planned-not-run
until the operator executes it (see ``docs/operations/capacity.md``).

Example (reproducible command, from the repository root):

    uv run python tests/load/local-scenarios.py --short \
        --database-url postgresql+asyncpg://postgres:postgres@127.0.0.1:5499/vse \
        --redis-url redis://127.0.0.1:6399/0

Fixtures live only in the disposable databases this runner creates; it refuses
to run against anything that looks like production (``ENVIRONMENT=production``
is rejected explicitly).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import subprocess
import sys
import time
import uuid
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]

# Standalone script: make the repository importable (backend/src, backend/tests).
sys.path.insert(0, str(ROOT))

PAYLOAD_BUDGET_BYTES = 32 * 1024 * 1024
REPORT_CALC_MAX_SECONDS = 60.0

FULL_PROFILE: dict[str, Any] = {
    "duration_s": 30 * 60,
    "read_share": 0.8,
    "concurrency": 100,
    "laboratories": 100,
    "users": 500,
    "arrivals_per_day": 5000,
    "report_sources_per_lab_halfyear": 100_000,
    "host": {"vcpu": 8, "gib": 32, "disk": "500GiB SSD"},
    "p95_read_page_s": 2.0,
    "p95_local_save_s": 3.0,
    "max_error_share": 0.01,
    "report_calc_max_s": REPORT_CALC_MAX_SECONDS,
    "payload_budget_bytes": PAYLOAD_BUDGET_BYTES,
}

# Scaled-down runnable derivative: minutes, small concurrency, one laboratory.
SHORT_PROFILE: dict[str, Any] = {
    "duration_s": 120,
    "read_share": 0.8,
    "concurrency": 8,
    "laboratories": 1,
    "parties": 150,
    "host": {"vcpu": 8, "gib": 32, "disk": "500GiB SSD"},
    "p95_read_page_s": 2.0,
    "p95_local_save_s": 3.0,
    "max_error_share": 0.01,
}

DEFAULT_DATABASE_URL = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5499/vse"
DEFAULT_REDIS_URL = "redis://127.0.0.1:6399/0"
DEFAULT_PORT = 8321
LOAD_LOGIN = "loadvet"
LOAD_PASSWORD = "Load-Vet-Pass-2026"
TEST_ORIGIN = f"http://127.0.0.1:{DEFAULT_PORT}"


def payload_budget_bytes() -> int:
    """OPS03: the unsaved payload budget in bytes."""
    return PAYLOAD_BUDGET_BYTES


def compact_report_sources(count: int) -> list[dict[str, str | int]]:
    """The compact projection of report sources (UUID/rev/contributions only).

    Deliberately carries no full examination protocol text — that is what keeps
    the 100k payload inside the 32 MiB budget.
    """
    return [
        {
            "u": uuid.UUID(int=index).hex,
            "r": 1 + index % 5,
            "m": f"{index % 500}.{index % 1000:03d}000",
            "q": f"{1 + index % 20}",
        }
        for index in range(count)
    ]


def projection_payload_size(count: int = 100_000) -> int:
    """Serialize the compact projection and return its size in bytes."""
    payload = json.dumps(
        {"type": "5-VET-III", "sources": compact_report_sources(count)},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return len(payload.encode("utf-8"))


def assert_payload_budget(count: int = 100_000, budget: int = PAYLOAD_BUDGET_BYTES) -> int:
    size = projection_payload_size(count)
    if size > budget:
        raise AssertionError(f"payload {size} B превышает бюджет {budget} B (OPS03)")
    return size


def percentile(values: list[float], share: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(share * (len(ordered) - 1))))
    return ordered[index]


# --- isolated seeding (disposable databases only) --------------------------------


def _configure_environment(database_url: str, redis_url: str) -> None:
    os.environ["ENVIRONMENT"] = "development"
    os.environ["SESSION_COOKIE_SECURE"] = "false"
    os.environ["DATABASE_URL"] = database_url
    os.environ["REDIS_URL"] = redis_url


def run_migrations(database_url: str) -> None:
    """``alembic upgrade head`` against the disposable database."""
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ROOT / "backend" / "alembic.ini"), "upgrade", "head"],
        capture_output=True,
        text=True,
        check=False,
        cwd=ROOT,
        env={**os.environ, "DATABASE_URL": database_url},
    )
    if result.returncode != 0:
        raise RuntimeError(f"миграция не удалась:\n{result.stdout}\n{result.stderr}")


async def seed(database_url: str, parties: int) -> dict[str, str]:
    """Create the isolated territory/laboratory/VET+scope and arrivals fixtures."""
    # Imports happen after the environment is configured.
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from backend.src.core.database import dispose_engine
    from backend.src.modules.arrivals import commands
    from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
    from backend.src.modules.identity.passwords import hash_password
    from backend.src.modules.identity.policies import install_default_policies
    from backend.tests.arrivals.test_import_and_queues import document

    engine = create_async_engine(database_url)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with factory() as session:
            # The database is disposable by contract; clear leftovers of a
            # previous short run so reseeding stays reproducible.
            from sqlalchemy import text

            await session.execute(
                text(
                    "TRUNCATE parties, incoming_documents, hidden_incoming, receipt_confirmations,"
                    " reconciliations, technical_events, command_records, outbox, casbin_rule,"
                    " user_events, delegation_grants, user_scopes, users, laboratories, territories"
                    " RESTART IDENTITY CASCADE"
                )
            )
            await session.flush()
            territory = Territory(name="Республика Татарстан")
            session.add(territory)
            await session.flush()
            own = Laboratory(
                territory_id=territory.id, name="Нагрузочная лаборатория", address="ул. Тестовая, 1", organization="ГБУ"
            )
            foreign = Laboratory(
                territory_id=territory.id, name="Чужая лаборатория", address="ул. Тестовая, 2", organization="ГБУ"
            )
            session.add_all([own, foreign])
            await session.flush()
            vet = User(
                login=LOAD_LOGIN,
                full_name="Нагрузочный ветеринарный врач",
                email="load@example.test",
                password_hash=hash_password(LOAD_PASSWORD),
                role=UserRole.VET,
                active=True,
            )
            session.add(vet)
            await session.flush()
            session.add(UserScope(user_id=vet.id, laboratory_id=own.id, product_scope_id=uuid.uuid4()))
            await install_default_policies(session)
            party_ids = []
            for index in range(parties):
                party = await commands.upsert_incoming(
                    session, document(uuid.uuid4(), own.id, issue_number=f"LOAD-{index:06d}")
                )
                party_ids.append(str(party.id))
            foreign_party = await commands.upsert_incoming(
                session, document(uuid.uuid4(), foreign.id, issue_number="FOREIGN-000001")
            )
            await session.commit()
            return {
                "laboratory_id": str(own.id),
                "foreign_laboratory_id": str(foreign.id),
                "party_ids": party_ids,
                "foreign_party_id": str(foreign_party.id),
            }
    finally:
        await dispose_engine()
        await engine.dispose()


# --- the runnable short scenario -------------------------------------------------


class _Stopwatch:
    def __init__(self) -> None:
        self.latencies: dict[str, list[float]] = {}
        self.statuses: Counter[str] = Counter()
        self.failure_codes: Counter[str] = Counter()

    def record(self, kind: str, seconds: float, ok: bool) -> None:
        self.latencies.setdefault(kind, []).append(seconds)
        self.statuses[(kind, "ok" if ok else "error")] += 1

    def note_failure(self, kind: str, code: str) -> None:
        self.failure_codes[f"{kind}:{code}"] += 1

    def summary(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for kind, values in self.latencies.items():
            ok_count = self.statuses[(kind, "ok")]
            error_count = self.statuses[(kind, "error")]
            out[kind] = {
                "count": len(values),
                "p50_s": round(percentile(values, 0.50), 4),
                "p95_s": round(percentile(values, 0.95), 4),
                "max_s": round(max(values), 4) if values else 0.0,
                "mean_s": round(statistics.fmean(values), 4) if values else 0.0,
                "errors": error_count,
                "error_share": round(error_count / len(values), 5) if values else 0.0,
                "_ok": ok_count,
            }
            out[kind].pop("_ok")
        return out


def spawn_app(port: int, database_url: str, redis_url: str) -> subprocess.Popen[bytes]:
    """Start uvicorn for the real local stack."""
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.src.interfaces.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=ROOT,
        env={
            **os.environ,
            "ENVIRONMENT": "development",
            "SESSION_COOKIE_SECURE": "false",
            "DATABASE_URL": database_url,
            "REDIS_URL": redis_url,
        },
    )


async def wait_ready(client: Any, attempts: int = 60) -> None:
    for _ in range(attempts):
        try:
            response = await client.get("/api/v1/health/ready")
            if response.status_code == 200:
                return
        except Exception:
            pass
        await asyncio.sleep(1.0)
    raise RuntimeError("приложение не поднялось за отведённое время")


async def login(client: Any, base_url: str) -> str:
    csrf = await client.get("/api/v1/auth/csrf")
    csrf.raise_for_status()
    response = await client.post(
        "/api/v1/auth/login",
        json={"login": LOAD_LOGIN, "password": LOAD_PASSWORD},
        headers={"origin": base_url, "x-csrf-token": client.cookies.get("vse_csrf", "")},
    )
    response.raise_for_status()
    return response.json()["csrf_token"]


def reconciliation_payload(unit_id: str) -> dict[str, Any]:
    """A valid ACCEPT_ALL baseline matching the seeded source document."""
    return {
        "checks": {"CHK-F05": {"matches": True}, "CHK-F07": {"matches": True}},
        "delivered": {"mass_kg": "120.0", "quantity": "4", "unit_id": unit_id},
        "accepted": {"mass_kg": "120.0", "quantity": "4", "unit_id": unit_id},
        "returned": {"mass_kg": "0", "quantity": "0", "unit_id": unit_id},
        "decision": "ACCEPT_ALL",
        "transaction": {"planned": False, "type": None},
        "fair": False,
        "services": [],
    }


async def preflight_checks(client: Any, state: dict[str, Any], csrf_token: str) -> None:
    """Correctness and scope-leakage checks before the load mix."""
    base = client.base_url
    headers = {"x-csrf-token": csrf_token, "origin": str(base)}

    listed = await client.get(
        "/api/v1/arrivals", params={"laboratory_id": state["laboratory_id"], "queue": "EXPECTED", "page_size": 100}
    )
    listed.raise_for_status()
    page = listed.json()
    assert page["total"] == len(state["party_ids"]), "список прибытий не совпал с засеянным объёмом"

    party_id = state["party_ids"][0]
    detail = await client.get(f"/api/v1/arrivals/{party_id}/reconciliation")
    detail.raise_for_status()

    # Scope leakage: another laboratory is refused before any data is read.
    foreign = await client.get("/api/v1/arrivals", params={"laboratory_id": state["foreign_laboratory_id"]})
    assert foreign.status_code == 403, f"чужая лаборатория не отклонена: {foreign.status_code}"
    foreign_detail = await client.get(f"/api/v1/arrivals/{state['foreign_party_id']}/reconciliation")
    assert foreign_detail.status_code in (403, 404), "чужая партия не отклонена"

    # The integration stays honestly disabled.
    sync = await client.post(
        "/api/v1/arrivals/sync",
        json={"laboratory_id": state["laboratory_id"]},
        headers=headers,
    )
    assert sync.status_code == 503, "отключённый ВетИС должен отвечать 503"
    assert sync.json()["code"] == "INTEGRATION_NOT_CONFIGURED"

    # Payload budget (OPS03) is asserted as part of every run.
    size = assert_payload_budget()
    print(f"проверка бюджета payload: 100000 источников = {size} B <= 32 MiB", flush=True)


async def load_mix(client: Any, state: dict[str, Any], csrf_token: str, args: argparse.Namespace) -> _Stopwatch:
    """The 80/20 read/write mix with per-request latency capture."""
    stopwatch = _Stopwatch()
    deadline = time.monotonic() + args.duration
    offset = 0
    queue: asyncio.Queue[int | None] = asyncio.Queue()
    for _ in range(args.concurrency):
        queue.put_nowait(0)
    counters: Counter[str] = Counter()
    lock = asyncio.Lock()

    async def worker(worker_index: int) -> None:
        nonlocal offset
        headers = {"x-csrf-token": csrf_token, "origin": str(client.base_url)}
        while time.monotonic() < deadline:
            async with lock:
                offset += 1
                tick = offset
            is_read = (tick % 10) < 8  # 80/20 read/write
            try:
                if is_read:
                    kind = ("read_page", "read_detail", "read_me")[tick % 3]
                    if kind == "read_page":
                        page = 1 + (tick // 3) % max(1, len(state["party_ids"]) // 100)
                        started = time.perf_counter()
                        response = await client.get(
                            "/api/v1/arrivals",
                            params={"laboratory_id": state["laboratory_id"], "queue": "EXPECTED", "page": page},
                        )
                        stopwatch.record(kind, time.perf_counter() - started, response.status_code == 200)
                    elif kind == "read_detail":
                        party_id = state["party_ids"][tick % len(state["party_ids"])]
                        started = time.perf_counter()
                        response = await client.get(f"/api/v1/arrivals/{party_id}/reconciliation")
                        stopwatch.record(kind, time.perf_counter() - started, response.status_code == 200)
                    else:
                        started = time.perf_counter()
                        response = await client.get("/api/v1/me")
                        stopwatch.record(kind, time.perf_counter() - started, response.status_code == 200)
                else:
                    party_id = state["party_ids"][(tick + worker_index) % len(state["party_ids"])]
                    started = time.perf_counter()
                    detail = await client.get(f"/api/v1/arrivals/{party_id}/reconciliation")
                    etag = detail.headers.get("etag", "")
                    put_headers = {
                        **headers,
                        "if-match": etag,
                        "idempotency-key": str(uuid.uuid4()),
                    }
                    response = await client.put(
                        f"/api/v1/arrivals/{party_id}/reconciliation",
                        json=reconciliation_payload(unit_id=_UNIT_KG),
                        headers=put_headers,
                    )
                    if response.status_code == 409 and response.json().get("code") == "REVISION_CONFLICT":
                        # Legitimate optimistic-lock collision between concurrent
                        # writers: re-read the current revision and retry once.
                        fresh = await client.get(f"/api/v1/arrivals/{party_id}/reconciliation")
                        response = await client.put(
                            f"/api/v1/arrivals/{party_id}/reconciliation",
                            json=reconciliation_payload(unit_id=_UNIT_KG),
                            headers={
                                **put_headers,
                                "if-match": fresh.headers.get("etag", ""),
                                "idempotency-key": str(uuid.uuid4()),
                            },
                        )
                    ok = response.status_code == 200
                    if ok:
                        body = response.json()
                        # Correctness: the saved OPEN view carries the saved id
                        # and the saved composition (revision only moves on the
                        # external confirmation, so the ETag may be unchanged).
                        ok = bool(body.get("id")) and body.get("delivered", {}).get("mass_kg") == "120.0"
                    if not ok:
                        try:
                            stopwatch.note_failure("write_save", str(response.json().get("code", response.status_code)))
                        except Exception:  # noqa: BLE001
                            stopwatch.note_failure("write_save", str(response.status_code))
                    stopwatch.record("write_save", time.perf_counter() - started, ok)
                counters["requests"] += 1
            except Exception:  # noqa: BLE001 - load mix keeps measuring through errors
                counters["exceptions"] += 1

    tasks = [asyncio.create_task(worker(index)) for index in range(args.concurrency)]
    await asyncio.gather(*tasks)
    return stopwatch


_UNIT_KG = "aaaaaaaa-1111-4111-8111-111111111111"


def judge(summary: dict[str, Any]) -> list[str]:
    """Compare the honest numbers with the Global Constraints targets."""
    problems: list[str] = []
    for kind, name in (("read_page", "p95 чтения страниц"), ("write_save", "p95 локального сохранения")):
        stats = summary.get(kind)
        if not stats or stats["count"] == 0:
            problems.append(f"{name}: нет измерений")
            continue
        limit = FULL_PROFILE["p95_read_page_s"] if kind == "read_page" else FULL_PROFILE["p95_local_save_s"]
        if stats["p95_s"] > limit:
            problems.append(f"{name} {stats['p95_s']} с > {limit} с")
        if stats["error_share"] > FULL_PROFILE["max_error_share"]:
            problems.append(f"{kind}: доля ошибок {stats['error_share']} > {FULL_PROFILE['max_error_share']}")
    return problems


async def run_short(args: argparse.Namespace) -> int:
    if os.environ.get("ENVIRONMENT") == "production":
        raise SystemExit("нагрузочный сценарий запрещён против production")
    # A stale SSL_CERT_FILE breaks even loopback HTTP clients; drop it if invalid.
    cert_file = os.environ.get("SSL_CERT_FILE")
    if cert_file and not Path(cert_file).exists():
        os.environ.pop("SSL_CERT_FILE", None)
        os.environ.pop("SSL_CERT_DIR", None)
    _configure_environment(args.database_url, args.redis_url)

    import httpx

    base_url = f"http://127.0.0.1:{args.port}"

    print("миграции disposable-базы...", flush=True)
    run_migrations(args.database_url)
    print("засев изолированных fixtures...", flush=True)
    state = await seed(args.database_url, args.parties)

    app = None
    try:
        print("запуск uvicorn...", flush=True)
        app = spawn_app(args.port, args.database_url, args.redis_url)
        limits = httpx.Limits(max_connections=args.concurrency * 2, max_keepalive_connections=args.concurrency)
        async with httpx.AsyncClient(base_url=base_url, limits=limits, timeout=30.0) as client:
            await wait_ready(client)
            print("логин...", flush=True)
            csrf_token = await login(client, base_url)
            await preflight_checks(client, state, csrf_token)
            print(f"нагрузка: {args.duration} с, {args.concurrency} одновременных, 80/20 read/write...", flush=True)
            stopwatch = await load_mix(client, state, csrf_token, args)
        summary = stopwatch.summary()
        if stopwatch.failure_codes:
            summary["_failure_codes"] = dict(stopwatch.failure_codes)
        problems = judge(summary)
        result = {
            "mode": "short",
            "profile": {key: SHORT_PROFILE[key] for key in ("duration_s", "concurrency", "read_share")},
            "full_profile": "documented-not-run (docs/operations/capacity.md)",
            "started_at": datetime.now(UTC).isoformat(),
            "payload_100k_bytes": projection_payload_size(100_000),
            "operations": summary,
            "constraint_violations": problems,
        }
        if args.json_out:
            Path(args.json_out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
        if problems:
            print("ОГРАНИЧЕНИЯ НАРУШЕНЫ", file=sys.stderr, flush=True)
            return 2
        return 0
    finally:
        if app is not None:
            app.terminate()
            try:
                app.wait(timeout=15)
            except subprocess.TimeoutExpired:
                app.kill()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="O03 локальные нагрузочные сценарии (изолированно).")
    parser.add_argument("--short", action="store_true", help="масштабированный короткий прогон (минуты)")
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--redis-url", default=DEFAULT_REDIS_URL)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--duration", type=int, default=SHORT_PROFILE["duration_s"])
    parser.add_argument("--concurrency", type=int, default=SHORT_PROFILE["concurrency"])
    parser.add_argument("--parties", type=int, default=SHORT_PROFILE["parties"])
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args(argv)
    if not args.short:
        print(
            "Полный профиль (30 мин / 100 одновременных / 100 лабораторий) не запускается этой командой:\n"
            "он документирован в docs/operations/capacity.md и остаётся planned-not-run.\n"
            f"Контракт полного профиля: {json.dumps(FULL_PROFILE, ensure_ascii=False)}\n"
            "Для короткого прогона добавьте --short.",
            file=sys.stderr,
        )
        return 3
    return asyncio.run(run_short(args))


if __name__ == "__main__":
    raise SystemExit(main())
