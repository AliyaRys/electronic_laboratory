"""Изоляция отказа: застрявшая RUNNING-операция блокирует весь конвейер sync.

Живой инцидент 2026-11-16: ошибка внутри импорта страницы прерывает SQL-
транзакцию, после чего ``_fail_operation`` в той же сессии падает с
``InFailedSQLTransaction`` — операция остаётся RUNNING навсегда. Тесты здесь
доказывают, что пометка FAILED гарантированно пишется из свежей транзакции.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from backend.src.modules.identity.models import OutboxEntry
from backend.src.modules.integrations.vetis import sync
from backend.src.modules.integrations.vetis.models import VetisOperationState
from backend.tests.vetis.test_read_contract import FakeTransport, doc, page
from backend.tests.vetis.test_sync import make_adapter, op_row


async def test_aborted_transaction_still_marks_failed(
    sync_env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    """SQL-отказ внутри импорта не должен оставлять операцию в RUNNING.

    Симуляция живого случая: upsert выполняет реально падающий SQL, транзакция
    прерывается, и последующий UPDATE в ``_fail_operation`` в этой же сессии
    обязан упасть — пока ``run_sync`` не переведёт пометку FAILED в свежую
    транзакцию.
    """
    env = sync_env
    evsd = uuid.uuid4()

    async def aborted_upsert(uow, document):  # noqa: ANN001
        await uow.execute(select(text("no_such_column")).where(text("1 = 1")))
        return False

    monkeypatch.setattr(sync, "upsert_incoming", aborted_upsert)

    accepted = await sync.start_sync(env.db, actor_id=uuid.uuid4(), laboratory_id=env.lab.id)
    await env.db.commit()
    operation_id = accepted.operation_id

    await sync.run_sync(
        accepted.operation_id,
        adapter=make_adapter(env, FakeTransport([page(1, 0, [doc(evsd, "1")])])),
        session_factory=env.factory,
    )

    operation = await op_row(env, operation_id)
    assert operation.state == VetisOperationState.FAILED
    assert operation.problem_code == "VETIS_IMPORT_FAILED"
    assert operation.problem_detail is not None and "ProgrammingError" in operation.problem_detail
    rows = (
        (await env.db.execute(select(OutboxEntry).where(OutboxEntry.operation_id == operation_id)))
        .scalars()
        .all()
    )
    assert all(row.delivered_at is not None for row in rows)
