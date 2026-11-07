"""The ФТ-owned mandatory research set (FT VSE-03–05, INPUT-02).

The catalog can never disable these indicators: mandatory-ness is owned by the
functional requirements, not by a catalog flag. The concrete identifiers are
deterministic ``uuid5`` values derived from stable FT names (meat MVP); they
are the exact ids the rule/pricing tests treat as mandatory. When the official
Mercury/indicator id binding is published, only this module changes.

The empty registry is a configuration failure, not a silent no-op:
``ensure_mandatory_registry_configured`` is called at application wiring and
refuses to start the pricing module without the mandatory set.
"""

from __future__ import annotations

from uuid import UUID, uuid5

__all__ = [
    "MANDATORY_NAMESPACE",
    "TRICHINELLOSIS_PIG",
    "TRICHINELLOSIS_HORSE",
    "MANDATORY_INDICATOR_IDS",
    "ensure_mandatory_registry_configured",
]

# A fixed implementation namespace; every mandatory id is uuid5 of a stable
# FT name, so the identifiers are reproducible and documented.
MANDATORY_NAMESPACE = UUID("7e21a0f6-4b1a-4e8d-9c2f-0a5b3d7e1c44")


def _ft_id(name: str) -> UUID:
    return uuid5(MANDATORY_NAMESPACE, f"elab-vse://mandatory/{name}")


# Trichinelloscopy of pig and horse meat is explicitly mandatory for the meat
# MVP (INPUT-02: «Трихинеллоскопия свинины/конины определяется exact IDs»).
TRICHINELLOSIS_PIG = _ft_id("trichinellosis.pig")
TRICHINELLOSIS_HORSE = _ft_id("trichinellosis.horse")

MANDATORY_INDICATOR_IDS: frozenset[UUID] = frozenset({TRICHINELLOSIS_PIG, TRICHINELLOSIS_HORSE})


def ensure_mandatory_registry_configured() -> None:
    """Fail loud at startup if the ФТ mandatory set is empty."""
    if not MANDATORY_INDICATOR_IDS:
        raise RuntimeError(
            "Пустой реестр обязательных показателей ФТ: модуль pricing не может "
            "гарантировать «каталог не может выключить обязательность исследования»."
        )
