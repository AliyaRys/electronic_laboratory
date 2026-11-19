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
    "MEAT_AREA_CODE",
    "MEAT_AREA_NAME",
    "MANUAL_SOURCE_NAME",
    "INDICATOR_BY_CODE",
    "INDICATOR_BY_ID",
    "indicator_by_code",
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
    # ТЗ DR41-B §6.4: how the verdict of one performed result comes about.
    # FIXED — the accepted variants are fixed by the FT methodology; NONE —
    # the research has no norm at all (free text); CONFIGURABLE — the
    # interval bounds are configured in the norm catalog.
    evaluation_mode: str = "CONFIGURABLE"
    # For FIXED indicators: the wire value → evaluation status mapping (the
    # legacy Russian labels of the pre-registry rows are accepted too) and
    # the applied-rule criterion text of the snapshot.
    fixed_values: dict[str, str] | None = None
    fixed_criterion: str | None = None


_MATCH_OPTIONS = ("Соответствует", "Не соответствует")
_REACTION_OPTIONS = ("Отрицательная", "Положительная")
_TRICHINELLA_OPTIONS = ("Не обнаружено", "Обнаружено")

# ТЗ DR53 Task 6: trichinelloscopy is a FIXED BOOLEAN_MATCH indicator —
# ``true`` = «Не обнаружено» = IN_NORM, ``false`` = «Обнаружено» = DEVIATION.
# The wire keeps boolean/string-compatible values; no Russian label is stored.
_TRICHINELLA_FIXED = {
    "true": "IN_NORM",
    True: "IN_NORM",
    "Не обнаружено": "IN_NORM",
    "false": "DEVIATION",
    False: "DEVIATION",
    "Обнаружено": "DEVIATION",
}

# ТЗ DR41-B §6.1: the fixed qualitative rules live in this registry, never in
# catalog rows and never in the methodist's input. The mapping accepts both
# the enum wire codes of the form and the legacy Russian labels, so old saved
# data keeps evaluating.
_MATCH_FIXED = {
    "MATCH": "IN_NORM",
    "Соответствует": "IN_NORM",
    "MISMATCH": "DEVIATION",
    "Не соответствует": "DEVIATION",
    # The legacy BOOLEAN_MATCH rows stored a bool result.
    True: "IN_NORM",
    False: "DEVIATION",
}
_COPPER_FIXED = {
    "NEGATIVE": "IN_NORM",
    "Отрицательная": "IN_NORM",
    "POSITIVE": "DEVIATION",
    "Положительная": "DEVIATION",
    True: "DEVIATION",
    False: "IN_NORM",
}
_PEROXIDASE_FIXED = {
    "POSITIVE": "IN_NORM",
    "Положительная": "IN_NORM",
    "NEGATIVE": "DEVIATION",
    "Отрицательная": "DEVIATION",
    True: "IN_NORM",
    False: "DEVIATION",
}
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
        evaluation_mode="FIXED",
        fixed_values=_MATCH_FIXED,
        fixed_criterion="норма: Соответствует",
    ),
    CatalogIndicatorDef(
        id=IDENTIFICATION_INDICATOR_ID,
        code="VSE-F19",
        name="Идентификация продукции",
        result_schema="ENUM",
        unit=None,
        mandatory=True,
        options=_MATCH_OPTIONS,
        evaluation_mode="FIXED",
        fixed_values=_MATCH_FIXED,
        fixed_criterion="норма: Соответствует",
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
        options=_TRICHINELLA_OPTIONS,
        evaluation_mode="FIXED",
        fixed_values=_TRICHINELLA_FIXED,
        fixed_criterion="норма: Не обнаружено",
    ),
    CatalogIndicatorDef(
        id=LUMINESCENT_INDICATOR_ID,
        code="VSE-F22",
        name="Люминесцентный анализ",
        result_schema="ENUM",
        unit=None,
        mandatory=False,
        options=_MATCH_OPTIONS,
        evaluation_mode="FIXED",
        fixed_values=_MATCH_FIXED,
        fixed_criterion="норма: Соответствует",
    ),
    CatalogIndicatorDef(
        id=BACTERIOSCOPY_INDICATOR_ID,
        code="VSE-F23",
        name="Бактериоскопия",
        result_schema="TEXT",
        unit=None,
        mandatory=False,
        evaluation_mode="NONE",
    ),
    CatalogIndicatorDef(
        id=MICROSCOPY_INDICATOR_ID,
        code="VSE-F24",
        name="Микроскопия",
        # ТЗ DR42 §5.1: the FT field accepts fractional counts, so the canonical
        # schema is a nonnegative decimal; old INTEGER snapshots keep reading.
        # ТЗ DR54 Task 5: the owner decision — there is NO universal norm for
        # microscopy; the result stays a numeric fact (the nonnegative check
        # remains in examinations validation), the research stays available and
        # tariffed, but it is not a configurable norm and receives no norm
        # evaluation.
        result_schema="DECIMAL",
        unit=None,
        mandatory=False,
        evaluation_mode="NONE",
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
        evaluation_mode="FIXED",
        fixed_values=_COPPER_FIXED,
        fixed_criterion="норма: Отрицательная",
    ),
    CatalogIndicatorDef(
        id=PEROXIDASE_INDICATOR_ID,
        code="VSE-F28",
        name="Пероксидаза",
        result_schema="ENUM",
        unit=None,
        mandatory=False,
        options=_REACTION_OPTIONS,
        evaluation_mode="FIXED",
        fixed_values=_PEROXIDASE_FIXED,
        fixed_criterion="норма: Положительная",
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


# The single supported product area of the methods catalog (DR31 §4): the
# stable category code of «Мясо и мясопродукты» (Mercury productType = 1).
MEAT_AREA_CODE = "meat"
MEAT_AREA_NAME = "Мясо и мясопродукты"

MANUAL_SOURCE_NAME = "Ручная настройка справочника норм"

# Stable code → canonical definition; the write contract is keyed by code
# (VSE-F18–F29) and every technical field is resolved from this registry.
INDICATOR_BY_CODE: dict[str, CatalogIndicatorDef] = {item.code: item for item in CATALOG_INDICATORS}

# Stable id → canonical definition; the evaluation path is keyed by the
# indicator id of the performed result.
INDICATOR_BY_ID: dict[UUID, CatalogIndicatorDef] = {item.id: item for item in CATALOG_INDICATORS}


def indicator_by_code(code: str) -> CatalogIndicatorDef:
    """Resolve a stable VSE-F code against the canonical registry.

    An unknown code raises ``LookupError``: no arbitrary indicator may ever be
    created from a client-supplied identifier (ТЗ DR31 §8.4).
    """
    try:
        return INDICATOR_BY_CODE[code]
    except KeyError:
        raise LookupError(f"Неизвестный код исследования: {code}") from None


def ensure_mandatory_registry_configured() -> None:
    """Fail loud at startup if the ФТ mandatory set is empty."""
    if not MANDATORY_INDICATOR_IDS:
        raise RuntimeError(
            "Пустой реестр обязательных показателей ФТ: модуль pricing не может "
            "гарантировать «каталог не может выключить обязательность исследования»."
        )
