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

from dataclasses import dataclass
from uuid import UUID, uuid5

__all__ = [
    "MANDATORY_NAMESPACE",
    "ORGANOLEPTIC_INDICATOR_ID",
    "IDENTIFICATION_INDICATOR_ID",
    "TEMPERATURE_INDICATOR_ID",
    "TRICHINELLA_INDICATOR_ID",
    "LUMINESCENT_INDICATOR_ID",
    "BACTERIOSCOPY_INDICATOR_ID",
    "MICROSCOPY_INDICATOR_ID",
    "PH_INDICATOR_ID",
    "COOKING_INDICATOR_ID",
    "COPPER_INDICATOR_ID",
    "PEROXIDASE_INDICATOR_ID",
    "DOSIMETRY_INDICATOR_ID",
    "MANDATORY_INDICATOR_IDS",
    "CatalogIndicatorDef",
    "CATALOG_INDICATORS",
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

# Optional FT researches (VSE-F22..F29). They are not mandatory, but their
# local ids are still owned by the functional requirements; the 5-вет report
# rows 167–171 are keyed by exactly these stable ids (ФТ 09).
LUMINESCENT_INDICATOR_ID = _ft_id("VSE-F22")
BACTERIOSCOPY_INDICATOR_ID = _ft_id("VSE-F23")
MICROSCOPY_INDICATOR_ID = _ft_id("VSE-F24")
PH_INDICATOR_ID = _ft_id("VSE-F25")
COOKING_INDICATOR_ID = _ft_id("VSE-F26")
COPPER_INDICATOR_ID = _ft_id("VSE-F27")
PEROXIDASE_INDICATOR_ID = _ft_id("VSE-F28")
DOSIMETRY_INDICATOR_ID = _ft_id("VSE-F29")

# Universally mandatory for every local meat examination. Conditional
# trichinelloscopy is enforced by E01 after resolving exact product species.
MANDATORY_INDICATOR_IDS: frozenset[UUID] = frozenset(
    {ORGANOLEPTIC_INDICATOR_ID, IDENTIFICATION_INDICATOR_ID, TEMPERATURE_INDICATOR_ID}
)


@dataclass(frozen=True, slots=True)
class CatalogIndicatorDef:
    """One canonical ФТ indicator of the methods catalog (VSE-F18–F29).

    The single backend source of stable ids, Russian names, result schemas and
    units; the frontend registry mirrors it and nothing else may re-define the
    list. ``options`` are the accepted enum values of the methodology; the
    accepted-as-normal marking stays on the norm row, never here.
    """

    id: UUID
    code: str
    name: str
    result_schema: str
    unit: str | None
    mandatory: bool
    conditional: bool = False
    options: tuple[str, ...] | None = None


_MATCH_OPTIONS = ("Соответствует", "Не соответствует")
_REACTION_OPTIONS = ("Отрицательная", "Положительная")
_COOKING_OPTIONS = (
    "Бульон прозрачный, аромат специфический",
    "Бульон мутный",
    "Бульон с хлопьями",
    "Бульон с осадком",
    "Нехарактерный / неприятный запах",
    "Иное (указать)",
)

CATALOG_INDICATORS: tuple[CatalogIndicatorDef, ...] = (
    CatalogIndicatorDef(
        id=ORGANOLEPTIC_INDICATOR_ID,
        code="VSE-F18",
        name="Органолептическое исследование",
        result_schema="ENUM",
        unit=None,
        mandatory=True,
        options=_MATCH_OPTIONS,
    ),
    CatalogIndicatorDef(
        id=IDENTIFICATION_INDICATOR_ID,
        code="VSE-F19",
        name="Идентификация продукции",
        result_schema="ENUM",
        unit=None,
        mandatory=True,
        options=_MATCH_OPTIONS,
    ),
    CatalogIndicatorDef(
        id=TEMPERATURE_INDICATOR_ID,
        code="VSE-F20",
        name="Температура в толще мышц",
        result_schema="DECIMAL",
        unit="°C",
        mandatory=True,
    ),
    CatalogIndicatorDef(
        id=TRICHINELLA_INDICATOR_ID,
        code="VSE-F21",
        name="Трихинеллоскопия",
        result_schema="BOOLEAN_MATCH",
        unit=None,
        mandatory=False,
        conditional=True,
    ),
    CatalogIndicatorDef(
        id=LUMINESCENT_INDICATOR_ID,
        code="VSE-F22",
        name="Люминесцентный анализ",
        result_schema="ENUM",
        unit=None,
        mandatory=False,
        options=_MATCH_OPTIONS,
    ),
    CatalogIndicatorDef(
        id=BACTERIOSCOPY_INDICATOR_ID,
        code="VSE-F23",
        name="Бактериоскопия",
        result_schema="TEXT",
        unit=None,
        mandatory=False,
    ),
    CatalogIndicatorDef(
        id=MICROSCOPY_INDICATOR_ID,
        code="VSE-F24",
        name="Микроскопия",
        result_schema="INTEGER_NONNEGATIVE",
        unit=None,
        mandatory=False,
    ),
    CatalogIndicatorDef(
        id=PH_INDICATOR_ID,
        code="VSE-F25",
        name="pH",
        result_schema="DECIMAL",
        unit=None,
        mandatory=False,
    ),
    CatalogIndicatorDef(
        id=COOKING_INDICATOR_ID,
        code="VSE-F26",
        name="Проба варки",
        result_schema="ENUM",
        unit=None,
        mandatory=False,
        options=_COOKING_OPTIONS,
    ),
    CatalogIndicatorDef(
        id=COPPER_INDICATOR_ID,
        code="VSE-F27",
        name="Реакция с сернокислой медью",
        result_schema="ENUM",
        unit=None,
        mandatory=False,
        options=_REACTION_OPTIONS,
    ),
    CatalogIndicatorDef(
        id=PEROXIDASE_INDICATOR_ID,
        code="VSE-F28",
        name="Пероксидаза",
        result_schema="ENUM",
        unit=None,
        mandatory=False,
        options=_REACTION_OPTIONS,
    ),
    CatalogIndicatorDef(
        id=DOSIMETRY_INDICATOR_ID,
        code="VSE-F29",
        name="Дозометрическое исследование",
        result_schema="DOSIMETRY_PAIR",
        unit="мкЗв/ч",
        mandatory=False,
    ),
)

# VSE-F30 «Инвазионные болезни» and VSE-F31 «Незаразные болезни» are the party
# dictionaries of ФТ 10, never method-rule norms; they are deliberately absent
# from CATALOG_INDICATORS.


def ensure_mandatory_registry_configured() -> None:
    """Fail loud at startup if the ФТ mandatory set is empty."""
    if not MANDATORY_INDICATOR_IDS:
        raise RuntimeError(
            "Пустой реестр обязательных показателей ФТ: модуль pricing не может "
            "гарантировать «каталог не может выключить обязательность исследования»."
        )
