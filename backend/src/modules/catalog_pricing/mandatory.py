"""The ФТ-owned mandatory research identifiers (FT VSE-03–05, INPUT-02).

The catalog can never disable these indicators: mandatory-ness is owned by the
functional requirements, not by a catalog flag. Local UUIDs are derived from
the stable field ids VSE-F18..21 in the restored FT source. The three universal
indicators belong to pricing readiness. VSE-F21 is exported separately because
E01 applies it conditionally to exact pig/horse product-species ids; it must not
be represented as two different research indicators or required for all meat.

The empty registry is a configuration failure, not a silent no-op:
``ensure_mandatory_registry_configured`` is called at application wiring and
refuses to start the pricing module without the mandatory set.
"""

from __future__ import annotations

from uuid import UUID, uuid5

__all__ = [
    "MANDATORY_NAMESPACE",
    "ORGANOLEPTIC_INDICATOR_ID",
    "IDENTIFICATION_INDICATOR_ID",
    "TEMPERATURE_INDICATOR_ID",
    "TRICHINELLA_INDICATOR_ID",
    "MANDATORY_INDICATOR_IDS",
    "ensure_mandatory_registry_configured",
]

# A fixed implementation namespace; every local id is UUID5 of the stable
# field id from ФТ v2.0/10-field-catalog.md.
MANDATORY_NAMESPACE = UUID("7e21a0f6-4b1a-4e8d-9c2f-0a5b3d7e1c44")


def _ft_id(name: str) -> UUID:
    return uuid5(MANDATORY_NAMESPACE, f"elab-vse://field/{name}")


ORGANOLEPTIC_INDICATOR_ID = _ft_id("VSE-F18")
IDENTIFICATION_INDICATOR_ID = _ft_id("VSE-F19")
TEMPERATURE_INDICATOR_ID = _ft_id("VSE-F20")
TRICHINELLA_INDICATOR_ID = _ft_id("VSE-F21")

# Universally mandatory for every local meat examination. Conditional
# trichinelloscopy is enforced by E01 after resolving exact product species.
MANDATORY_INDICATOR_IDS: frozenset[UUID] = frozenset(
    {ORGANOLEPTIC_INDICATOR_ID, IDENTIFICATION_INDICATOR_ID, TEMPERATURE_INDICATOR_ID}
)


def ensure_mandatory_registry_configured() -> None:
    """Fail loud at startup if the ФТ mandatory set is empty."""
    if not MANDATORY_INDICATOR_IDS:
        raise RuntimeError(
            "Пустой реестр обязательных показателей ФТ: модуль pricing не может "
            "гарантировать «каталог не может выключить обязательность исследования»."
        )
