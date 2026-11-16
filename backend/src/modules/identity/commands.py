"""User administration commands: CRUD, block, reset, delete (API-02, SPEC-04).

Every command performs all of its changes (and the ``user_events`` record with
real ``changed_fields``, never passwords or hashes) inside a single transaction
that the command itself commits, exactly like ``change-password`` from I02.
Critical administrator operations lock the affected administrator rows in one
deterministic order so that concurrent deletes keep at least one empowered
administrator of the territory.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import IdempotencyRecorder, UnitOfWork
from backend.src.core.problems import ProblemError, ProblemItem, not_found, validation_error
from backend.src.modules.identity.authz import AccessSnapshot, _is_descendant
from backend.src.modules.identity.models import (
    CommandRecord,
    CommandStatus,
    DelegationGrant,
    Laboratory,
    Territory,
    User,
    UserEvent,
    UserRole,
    UserScope,
)
from backend.src.modules.identity.passwords import hash_password, validate_password
from backend.src.modules.identity.schemas import UserWrite

__all__ = [
    "PAGE_SIZE",
    "REDACTED",
    "allowed_territories",
    "delegatable_territories",
    "user_territories",
    "load_target",
    "create_user",
    "update_user",
    "set_active",
    "reset_password",
    "delete_user",
    "checked_password",
]

PAGE_SIZE = 20

# The only value a secret field ever carries in ``user_events.changed_fields``.
REDACTED = "REDACTED"


# --- Problem factories (stable codes, API-01/02) --------------------------------


def access_denied(detail: str) -> ProblemError:
    return ProblemError(status=403, code="ACCESS_DENIED", title="Access denied", detail=detail)


def duplicate_login() -> ProblemError:
    return ProblemError(status=409, code="ALREADY_EXISTS", title="Already exists", detail="Логин уже занят.")


def self_delete_forbidden() -> ProblemError:
    return ProblemError(
        status=409,
        code="SELF_DELETE_FORBIDDEN",
        title="Self delete forbidden",
        detail="Нельзя удалить собственную учётную запись.",
    )


def last_admin() -> ProblemError:
    return ProblemError(
        status=409,
        code="LAST_ADMIN",
        title="Last administrator",
        detail="Нельзя удалить последнего уполномоченного администратора области.",
    )


def user_has_references() -> ProblemError:
    return ProblemError(
        status=409,
        code="USER_HAS_REFERENCES",
        title="User has references",
        detail="Пользователь имеет связанные записи и не может быть удалён.",
    )


# --- Scope helpers ---------------------------------------------------------------


def allowed_territories(snapshot: AccessSnapshot) -> frozenset[uuid.UUID]:
    """Every territory inside the actor's delegated subtree."""
    return frozenset(
        territory
        for territory in snapshot.territory_parents
        if _is_descendant(territory, snapshot.delegated_territories, snapshot.territory_parents)
    )


def delegatable_territories(snapshot: AccessSnapshot, role: UserRole) -> frozenset[uuid.UUID]:
    """Territories where the actor may delegate exactly ``role`` (FT-ADM-01).

    A ``may_delegate=True`` grant of the ADMIN role enables delegating all four
    roles inside its subtree (O-08: any of the four roles within the delegated
    authority); a grant of a working role enables only that role. Nothing is
    ever issued above, wider than or outside the granted subtree, and an ADMIN
    role alone (``may_delegate=False`` or no grant) delegates nothing.
    """
    result: set[uuid.UUID] = set()
    for grant_role, grant_territory in snapshot.delegatable_grants:
        if grant_role != UserRole.ADMIN and grant_role != role:
            continue
        result.update(
            territory
            for territory in snapshot.territory_parents
            if _is_descendant(territory, frozenset({grant_territory}), snapshot.territory_parents)
        )
    return frozenset(result)


async def user_territories(db: AsyncSession, user_id: uuid.UUID) -> frozenset[uuid.UUID]:
    """Territories the user works in: scope laboratories plus delegated territories."""
    scope_rows = await db.execute(
        select(Laboratory.territory_id)
        .join(UserScope, UserScope.laboratory_id == Laboratory.id)
        .where(UserScope.user_id == user_id)
    )
    grant_rows = await db.execute(select(DelegationGrant.territory_id).where(DelegationGrant.target_id == user_id))
    return frozenset(scope_rows.scalars()) | frozenset(grant_rows.scalars())


async def load_target(db: AsyncSession, user_id: uuid.UUID, *, lock: bool = False) -> User | None:
    statement = select(User).where(User.id == user_id)
    if lock:
        statement = statement.with_for_update()
    return (await db.execute(statement)).scalar_one_or_none()


# --- Validation ------------------------------------------------------------------


def checked_password(password: str | None, confirmation: str | None) -> str:
    """Validate a password/confirmation pair and return the verified secret."""
    errors: list[ProblemItem] = []
    if not password:
        errors.append(ProblemItem(path="password", message="Пароль обязателен."))
    elif password != (confirmation or ""):
        errors.append(ProblemItem(path="confirmation", message="Пароли не совпадают."))
    else:
        try:
            validate_password(password)
        except ValueError as exc:
            errors.append(ProblemItem(path="password", message=str(exc)))
    if errors:
        raise validation_error(errors)
    assert password is not None
    return password


async def _resolve_scopes(
    db: AsyncSession,
    role: UserRole,
    scopes: list[tuple[uuid.UUID, uuid.UUID | None]],
    allowed: frozenset[uuid.UUID],
    *,
    allow_empty: bool = False,
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Validate laboratory assignments against the delegable territory (FT-ADM-01)."""
    if not scopes and not allow_empty:
        raise validation_error([ProblemItem(path="scopes", message="Назначьте хотя бы одну область.")])
    if role == UserRole.ANALYST and len(scopes) != 1:
        raise validation_error([ProblemItem(path="scopes", message="Аналитику назначается ровно одна лаборатория.")])
    # DR34 §7.4: the HEAD of the laboratory is appointed for exactly one
    # laboratory; a laboratory switcher never appears in his working screen.
    # An update may still detach all scopes (allow_empty), as before.
    if role == UserRole.HEAD and len(scopes) > 1:
        raise validation_error([ProblemItem(path="scopes", message="Заведующему назначается ровно одна лаборатория.")])
    laboratory_ids = [laboratory_id for laboratory_id, _ in scopes]
    rows = await db.execute(select(Laboratory).where(Laboratory.id.in_(laboratory_ids)))
    laboratories = {item.id: item for item in rows.scalars()}
    errors: list[ProblemItem] = []
    pairs: list[tuple[uuid.UUID, uuid.UUID]] = []
    for index, (laboratory_id, product_scope_id) in enumerate(scopes):
        laboratory = laboratories.get(laboratory_id)
        if laboratory is None:
            errors.append(ProblemItem(path=f"scopes.{index}.laboratory_id", message="Лаборатория не найдена."))
            continue
        if laboratory.territory_id not in allowed:
            raise access_denied("Назначение вне делегированной области управления.")
        # A missing product means the whole laboratory (HEAD/ANALYST semantics);
        # the composite primary key requires a non-NULL third column.
        pairs.append((laboratory.id, product_scope_id or laboratory.id))
    if errors:
        raise validation_error(errors)
    return pairs


def _event(
    db: AsyncSession, *, target_id: uuid.UUID, actor_id: uuid.UUID, action: str, changed_fields: dict[str, object]
) -> None:
    db.add(UserEvent(target_user_id=target_id, actor_id=actor_id, action=action, changed_fields=changed_fields))


def _scope_fields(pairs: list[tuple[uuid.UUID, uuid.UUID]]) -> list[dict[str, str]]:
    return [
        {"laboratory_id": str(laboratory_id), "product_scope_id": str(product_scope_id)}
        for laboratory_id, product_scope_id in pairs
    ]


async def _current_scope_pairs(db: AsyncSession, user_id: uuid.UUID) -> set[tuple[uuid.UUID, uuid.UUID]]:
    rows = await db.execute(select(UserScope).where(UserScope.user_id == user_id))
    return {(item.laboratory_id, item.product_scope_id) for item in rows.scalars()}


# --- Commands --------------------------------------------------------------------


async def create_user(
    db: AsyncSession, *, actor_id: uuid.UUID, snapshot: AccessSnapshot, payload: UserWrite, record: CommandRecord | None
) -> User:
    """Create a user of a delegable role inside the delegated area (API-02, FT-ADM-01).

    The ADMIN target is no longer rejected unconditionally: an empowered
    administrator may create a further administrator with a ``DelegationGrant``
    inside his own ``may_delegate=True`` subtree (O-08). User + scope/grant +
    history are written in one transaction; a refused intent leaves no partial
    records, and history never carries a password or hash.
    """
    password = checked_password(payload.password, payload.confirmation)
    login = payload.login.strip()
    if not login:
        raise validation_error([ProblemItem(path="login", message="Логин не может быть пустым.")])
    grant_territory: tuple[uuid.UUID, str] | None = None
    if payload.role == UserRole.ADMIN:
        # An administrator is created with a delegation grant, never with
        # working scopes; the target territory must be delegable by the actor.
        if payload.territory_id is None:
            raise validation_error([ProblemItem(path="territory_id", message="Выберите территорию назначения.")])
        if payload.scopes:
            raise validation_error(
                [ProblemItem(path="scopes", message="Администратору не назначаются рабочие области.")]
            )
        territory = (
            await db.execute(select(Territory).where(Territory.id == payload.territory_id))
        ).scalar_one_or_none()
        if territory is None or territory.id not in delegatable_territories(snapshot, UserRole.ADMIN):
            raise access_denied("Назначение вне делегированных полномочий.")
        grant_territory = (territory.id, territory.name)
        pairs: list[tuple[uuid.UUID, uuid.UUID]] = []
    else:
        pairs = await _resolve_scopes(
            db,
            payload.role,
            [(item.laboratory_id, item.product_scope_id) for item in payload.scopes],
            delegatable_territories(snapshot, payload.role),
        )
    existing = (await db.execute(select(User).where(User.login == login))).scalar_one_or_none()
    if existing is not None:
        raise duplicate_login()

    user = User(
        login=login,
        full_name=payload.full_name.strip(),
        email=payload.email.strip(),
        position=payload.position,
        role=payload.role,
        password_hash=hash_password(password),
        active=True,
    )
    db.add(user)
    recorder = IdempotencyRecorder()
    uow = UnitOfWork(db)
    try:
        await db.flush()
        if grant_territory is not None:
            db.add(
                DelegationGrant(
                    grantor_id=actor_id,
                    target_id=user.id,
                    role=UserRole.ADMIN,
                    territory_id=grant_territory[0],
                    may_delegate=True,
                )
            )
        else:
            db.add_all(
                UserScope(user_id=user.id, laboratory_id=laboratory_id, product_scope_id=product)
                for laboratory_id, product in pairs
            )
        changed_fields: dict[str, object] = {
            "login": login,
            "full_name": user.full_name,
            "email": user.email,
            "role": payload.role.value,
        }
        # A safe area description rides in the history; never a password/hash.
        if grant_territory is not None:
            changed_fields["territory"] = {"territory_id": str(grant_territory[0]), "name": grant_territory[1]}
        else:
            changed_fields["scopes"] = _scope_fields(pairs)
        _event(
            db,
            target_id=user.id,
            actor_id=actor_id,
            action="create",
            changed_fields=changed_fields,
        )
        if record is not None and record.status != CommandStatus.SUCCESS:
            await recorder.complete(uow, record, user.id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise duplicate_login() from None
    return user


async def update_user(
    db: AsyncSession, *, actor_id: uuid.UUID, snapshot: AccessSnapshot, target: User, payload: UserWrite
) -> User:
    """Update profile/assignment fields with real ``changed_fields`` (API-02)."""
    if payload.password is not None or payload.confirmation is not None:
        raise validation_error([ProblemItem(path="password", message="Пароль задаётся отдельными операциями.")])
    if payload.role == UserRole.ADMIN:
        raise access_denied("Роль администратора выдаётся делегированием, а не изменением учётной записи.")
    login = payload.login.strip()
    if not login:
        raise validation_error([ProblemItem(path="login", message="Логин не может быть пустым.")])
    pairs = await _resolve_scopes(
        db,
        payload.role,
        [(item.laboratory_id, item.product_scope_id) for item in payload.scopes],
        allowed_territories(snapshot),
        allow_empty=True,
    )
    current_scopes = await _current_scope_pairs(db, target.id)
    new_scopes = set(pairs)
    if target.id == actor_id and (payload.role.value != target.role or new_scopes != current_scopes):
        raise access_denied("Собственную роль и назначения изменить нельзя.")

    if login != target.login:
        duplicate = (
            await db.execute(select(User).where(User.login == login, User.id != target.id))
        ).scalar_one_or_none()
        if duplicate is not None:
            raise duplicate_login()

    values: dict[str, object] = {
        "login": login,
        "full_name": payload.full_name.strip(),
        "email": payload.email.strip(),
        "position": payload.position,
        "role": payload.role.value,
    }
    changes: dict[str, object] = {}
    for field, wanted in values.items():
        if getattr(target, field) != wanted:
            changes[field] = wanted
    if new_scopes != current_scopes:
        changes["scopes"] = _scope_fields(pairs)
    if not changes:
        return target

    for field, wanted in values.items():
        setattr(target, field, wanted)
    if new_scopes != current_scopes:
        await db.execute(delete(UserScope).where(UserScope.user_id == target.id))
        db.add_all(
            UserScope(user_id=target.id, laboratory_id=laboratory_id, product_scope_id=product)
            for laboratory_id, product in pairs
        )
    target.rev += 1
    _event(db, target_id=target.id, actor_id=actor_id, action="update", changed_fields=changes)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise duplicate_login() from None
    return target


async def set_active(db: AsyncSession, *, actor_id: uuid.UUID, target: User, active: bool) -> User:
    """Block/unblock (API-02); idempotent repeats create no event."""
    if target.id == actor_id and not active:
        raise access_denied("Собственную учётную запись заблокировать нельзя.")
    if target.active == active:
        return target
    target.active = active
    target.rev += 1
    _event(
        db,
        target_id=target.id,
        actor_id=actor_id,
        action="block" if not active else "unblock",
        changed_fields={"active": active},
    )
    await db.commit()
    return target


async def reset_password(
    db: AsyncSession, *, actor_id: uuid.UUID, target: User, password: str | None, confirmation: str | None
) -> None:
    """Administrator reset: active/scopes untouched, history redacted (API-02)."""
    secret = checked_password(password, confirmation)
    target.password_hash = hash_password(secret)
    target.rev += 1
    _event(
        db, target_id=target.id, actor_id=actor_id, action="reset-password", changed_fields={"password_hash": REDACTED}
    )
    await db.commit()


async def delete_user(
    db: AsyncSession, *, actor_id: uuid.UUID, target_id: uuid.UUID, record: CommandRecord | None
) -> None:
    """Physical delete of an unlinked user; linked/self/last-admin refuse (API-02)."""
    if target_id == actor_id:
        raise self_delete_forbidden()
    target = await load_target(db, target_id)
    if target is None:
        raise not_found()

    if target.role == UserRole.ADMIN:
        territory_rows = await db.execute(
            select(DelegationGrant.territory_id).where(DelegationGrant.target_id == target.id)
        )
        territories = list(territory_rows.scalars())
        grants: list[tuple[uuid.UUID, uuid.UUID]] = []
        if territories:
            peer_rows = await db.execute(
                select(DelegationGrant.target_id, DelegationGrant.territory_id).where(
                    DelegationGrant.territory_id.in_(territories)
                )
            )
            grants = [(peer_id, territory_id) for peer_id, territory_id in peer_rows.all()]
        # Lock every affected administrator row in one deterministic order so two
        # concurrent deletes of the last administrators serialize safely.
        peer_state: dict[uuid.UUID, bool] = {}
        for peer_id in sorted({peer for peer, _ in grants} | {target.id}):
            peer = (await db.execute(select(User).where(User.id == peer_id).with_for_update())).scalar_one_or_none()
            peer_state[peer_id] = peer is not None and peer.active and peer.role == UserRole.ADMIN
        # DATA-01: EVERY territory the target administers must keep at least one
        # other empowered administrator; colleagues pooled across territories do
        # not protect a territory whose only administrator is being deleted.
        grants_by_territory: dict[uuid.UUID, set[uuid.UUID]] = {}
        for peer_id, territory_id in grants:
            grants_by_territory.setdefault(territory_id, set()).add(peer_id)
        for peers in grants_by_territory.values():
            others = [peer for peer in peers if peer_state.get(peer) and peer != target.id]
            if not others:
                raise last_admin()
        # The deleted administrator loses their own empowerment with the account.
        await db.execute(delete(DelegationGrant).where(DelegationGrant.target_id == target.id))
    else:
        locked = (await db.execute(select(User).where(User.id == target.id).with_for_update())).scalar_one_or_none()
        if locked is None:
            raise not_found()

    # The subject's own lifecycle log goes with the account (its FK is
    # RESTRICT); records authored by the user keep RESTRICTING the delete.
    await db.execute(delete(UserEvent).where(UserEvent.target_user_id == target.id))
    await db.delete(target)
    recorder = IdempotencyRecorder()
    uow = UnitOfWork(db)
    try:
        if record is not None and record.status != CommandStatus.SUCCESS:
            await recorder.complete(uow, record, target.id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise user_has_references() from None
