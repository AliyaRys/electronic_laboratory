"""The CHK reconciliation validator (API-04 / FT-ARR-03–11).

``validate_receipt(payload, source, capabilities) -> ReceiptValidation`` is a
pure function: it never touches the database and never commits. The source
projection (:class:`IncomingDocument`) carries the external eVSD snapshot, the
resolved classification and the CHK source-field projection; explicit marks
(``checks[CHK-ID]``) are required only for the compared fields whose source is
present — informational fields never demand a fictitious mark (FT-ARR-03).

Key decisions locked by the controller:

- the ±5% weight boundary is **inclusive**: 95/105 of a 100 kg document need no
  weight act, 94.999/105.001 do (FT-ARR-07);
- a shortage is never a return cargo: the validator never derives returned
  quantities (FT-ARR-06);
- two mismatch grounds combine by the strict rule: an inadmissible ground
  (participant/classification/manufacturer/produce date/transport kind/storage)
  forbids full and partial acceptance while the admissible grounds still
  demand their fact and reason (FT-02, FT-ARR-04/08);
- a non-arrival / zero delivery allows no decision at all: garbling or
  returning absent cargo is impossible (FT-ARR-09);
- RETURN_ALL never promises the branch act (FT-ARR-08);
- the repeat block exists only with a previous ВСЭ; without one the local ВСЭ
  is required without a fictitious selection (FT-ARR-11).

Errors are split into ``errors`` (incompleteness — a started reconciliation may
be saved and continued) and ``blocking`` (structural violations — the save
command refuses them with 422). ``ReceiptCapabilities`` is the local
conservative contract; the real external enums bind in ТЗ-11.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from backend.src.core.problems import ProblemItem
from backend.src.modules.arrivals.schemas import (
    ActItem,
    ActPreview,
    ClassificationView,
    Comparison,
    ReconciliationWrite,
    SourceSnapshot,
    Transaction,
)

__all__ = [
    "BLOCK_ORDER",
    "FIELD_REGISTRY",
    "FIELD_SPECS",
    "ActItem",
    "ActPreview",
    "IncomingDocument",
    "OTHER_REASON",
    "RETURN_REASON_CODES",
    "ReceiptCapabilities",
    "ReceiptValidation",
    "UNIT_KG",
    "GROUND_ACT",
    "GROUND_INADMISSIBLE",
    "GROUND_NONE",
    "GROUND_INPUT",
    "GROUND_READONLY",
    "normalize_payload",
    "validate_receipt",
]

UNIT_KG = "кг"

# CHK-F35: the Mercury return-reason dictionary (ФТ-10, verbatim).
RETURN_REASON_CODES: tuple[str, ...] = (
    "DEFECTIVE_GOODS",
    "PACKAGING_DAMAGE",
    "FOREIGN_MATERIAL_OR_SAFETY_VIOLATION",
    "LAB_TEST_MISMATCH",
    "PRODUCTION_VSD_ERROR",
    "CRITICAL_EXPIRY_DATE",
    "MARKING_ISSUES",
    "QUANTITY_DISCREPANCY",
    "PRODUCT_DATE_MISMATCH",
    "UNORDERED_PRODUCT",
    "WRONG_SPECIFICATION",
    "CONSIGNOR_REJECTION",
    "CONTRACT_VIOLATION",
    "OTHER_REASON",
)
OTHER_REASON = "OTHER_REASON"

Ground = Literal["none", "act", "inadmissible", "input", "readonly"]

GROUND_ACT: Ground = "act"
GROUND_INADMISSIBLE: Ground = "inadmissible"
GROUND_NONE: Ground = "none"
GROUND_INPUT: Ground = "input"
GROUND_READONLY: Ground = "readonly"

# CHK-Fxx block order (FT-ARR-03): документ → участники → транспорт →
# продукция → сопроводительные → прежняя ВСЭ → результаты → стоимость.
BLOCK_ORDER: tuple[str, ...] = (
    "документ",
    "участники",
    "транспорт",
    "продукция",
    "сопроводительные",
    "прежняя ВСЭ",
    "результаты",
    "стоимость",
)


class FieldSpec:
    """One CHK field: block, source projection key and mismatch ground."""

    __slots__ = ("field_id", "block", "key", "ground", "previous")

    def __init__(self, field_id: str, block: str, key: str, ground: Ground, previous: bool = False) -> None:
        self.field_id = field_id
        self.block = block
        self.key = key
        self.ground = ground
        self.previous = previous

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"FieldSpec({self.field_id}, {self.block}, {self.key}, {self.ground})"


FIELD_SPECS: tuple[FieldSpec, ...] = (
    # документ: READONLY из ВУ, «не заменять отсутствующее».
    FieldSpec("CHK-F01", "документ", "documentNumber", "readonly"),
    FieldSpec("CHK-F02", "документ", "issuedOn", "readonly"),
    FieldSpec("CHK-F03", "документ", "status", "readonly"),
    FieldSpec("CHK-F04", "документ", "purpose", "readonly"),
    # участники: недопустимое исправление.
    FieldSpec("CHK-F05", "участники", "senderEnterprise", "inadmissible"),
    FieldSpec("CHK-F06", "участники", "senderOwner", "inadmissible"),
    FieldSpec("CHK-F07", "участники", "receiverEnterprise", "inadmissible"),
    FieldSpec("CHK-F08", "участники", "receiverOwner", "inadmissible"),
    # транспорт.
    FieldSpec("CHK-F09", "транспорт", "transportKind", "inadmissible"),
    FieldSpec("CHK-F10", "транспорт", "vehicleNumber", "act"),
    FieldSpec("CHK-F11", "транспорт", "trailerNumber", "act"),
    FieldSpec("CHK-F12", "транспорт", "storage", "inadmissible"),
    FieldSpec("CHK-F13", "транспорт", "compartment", "input"),
    FieldSpec("CHK-F14", "транспорт", "jointCarriage", "input"),
    # продукция.
    FieldSpec("CHK-F15", "продукция", "productType", "inadmissible"),
    FieldSpec("CHK-F16", "продукция", "product", "inadmissible"),
    FieldSpec("CHK-F17", "продукция", "species", "inadmissible"),
    FieldSpec("CHK-F18", "продукция", "name", "act"),
    FieldSpec("CHK-F19", "продукция", "manufacturer", "inadmissible"),
    FieldSpec("CHK-F20", "продукция", "quantity", "act"),
    FieldSpec("CHK-F21", "продукция", "massKg", "act"),
    FieldSpec("CHK-F22", "продукция", "producedOn", "inadmissible"),
    FieldSpec("CHK-F23", "продукция", "expiresOn", "act"),
    # прежняя ВСЭ (условно: только при сведениях предыдущей ВСЭ).
    FieldSpec("CHK-F24", "прежняя ВСЭ", "previousStamp", "readonly", previous=True),
    FieldSpec("CHK-F25", "сопроводительные", "transportDocumentType", "act"),
    FieldSpec("CHK-F26", "сопроводительные", "transportDocumentNumber", "act"),
    FieldSpec("CHK-F27", "сопроводительные", "transportDocumentIssuedOn", "act"),
    FieldSpec("CHK-F28", "прежняя ВСЭ", "previousNumber", "readonly", previous=True),
    FieldSpec("CHK-F29", "прежняя ВСЭ", "previousPerformedOn", "readonly", previous=True),
    FieldSpec("CHK-F30", "прежняя ВСЭ", "previousOrganization", "readonly", previous=True),
    FieldSpec("CHK-F31", "прежняя ВСЭ", "previousResult", "readonly", previous=True),
    FieldSpec("CHK-F32", "прежняя ВСЭ", "previousConclusion", "readonly", previous=True),
    # результаты/стоимость: ввод или производные (F33 actor, F44 act).
    FieldSpec("CHK-F33", "результаты", "actor", "readonly"),
    FieldSpec("CHK-F34", "результаты", "decision", "input"),
    FieldSpec("CHK-F35", "результаты", "returnReason", "input"),
    FieldSpec("CHK-F36", "результаты", "repeatRequired", "input"),
    FieldSpec("CHK-F37", "результаты", "repeatReason", "input"),
    FieldSpec("CHK-F38", "результаты", "repeatActNumber", "input"),
    FieldSpec("CHK-F39", "результаты", "transactionPlanned", "input"),
    FieldSpec("CHK-F40", "результаты", "transactionType", "input"),
    FieldSpec("CHK-F41", "результаты", "fair", "input"),
    FieldSpec("CHK-F42", "результаты", "actual", "input"),
    FieldSpec("CHK-F43", "результаты", "reason", "input"),
    FieldSpec("CHK-F44", "стоимость", "actPreview", "readonly"),
)

FIELD_REGISTRY: dict[str, FieldSpec] = {spec.field_id: spec for spec in FIELD_SPECS}

COMPARABLE_SPECS = tuple(spec for spec in FIELD_SPECS if spec.ground in ("act", "inadmissible"))
PREVIOUS_KEYS = frozenset(
    {
        "previousStamp",
        "previousNumber",
        "previousPerformedOn",
        "previousOrganization",
        "previousResult",
        "previousConclusion",
    }
)

WEIGHT_BOUNDARY = Decimal("5")


@dataclass(frozen=True, slots=True)
class IncomingDocument:
    """The validator's source projection of one arrival.

    ``fields`` maps the CHK source keys to the values shown to the doctor;
    a missing key (or ``None``/blank) means the external document carries no
    value for the field and no comparison mark is required for it.
    """

    snapshot: SourceSnapshot
    classification: ClassificationView
    fields: dict[str, str | int | None]


@dataclass(frozen=True, slots=True)
class ReceiptCapabilities:
    """The local conservative contract (real external enums bind in ТЗ-11).

    ``external_return_allowed`` implements the matrix rule «полный возврат —
    только если допускает внешний контракт»; the local default keeps the
    RETURN_ALL route available, the real external contract narrows it later.
    """

    external_return_allowed: bool = True
    return_reason_codes: frozenset[str] = frozenset(RETURN_REASON_CODES)


class ReceiptValidation:
    """The pure result of ``validate_receipt`` (server-calculated)."""

    __slots__ = ("errors", "blocking", "allowed_decisions", "act", "route")

    def __init__(
        self,
        errors: list[ProblemItem],
        blocking: list[ProblemItem],
        allowed_decisions: list[str],
        act: ActPreview,
        route: str | None,
    ) -> None:
        self.errors = errors
        self.blocking = blocking
        self.allowed_decisions = allowed_decisions
        self.act = act
        self.route = route

    @property
    def complete(self) -> bool:
        """No incompleteness and no blocking violations."""
        return not self.errors and not self.blocking

    def all_errors(self) -> list[ProblemItem]:
        return [*self.blocking, *self.errors]


def _item(path: str, field_id: str, message: str) -> ProblemItem:
    return ProblemItem(path=path, field_id=field_id, message=message)


def _present(value: str | int | None) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True


def _blank(value: str | int | None) -> bool:
    """True when an actual value is missing/empty."""
    if value is None:
        return True
    return isinstance(value, str) and value.strip() == ""


def _decimal(value: str) -> Decimal | None:
    try:
        parsed = Decimal(value)
    except Exception:  # noqa: BLE001 - QuantitySet already validated the shape
        return None
    return parsed if parsed.is_finite() else None


def _previous_present(fields: dict[str, str | int | None]) -> bool:
    return any(_present(fields.get(key)) for key in PREVIOUS_KEYS)


def _decision_allowed(decision: str, allowed: list[str]) -> bool:
    return decision in allowed


def validate_receipt(
    payload: ReconciliationWrite,
    source: IncomingDocument,
    capabilities: ReceiptCapabilities,
) -> ReceiptValidation:
    """Validate one reconciliation payload against its external source.

    Pure: no database, no clock, no commit. Returns incompleteness errors,
    blocking violations, the decisions still allowed by the marked grounds,
    the derived act preview and the downstream route.
    """
    fields = source.fields
    errors: list[ProblemItem] = []
    blocking: list[ProblemItem] = []

    # --- explicit marks for the compared fields (FT-ARR-03) --------------------
    grounds: dict[str, Comparison] = {}
    for spec in COMPARABLE_SPECS:
        source_value = fields.get(spec.key)
        if not _present(source_value):
            continue  # informational absence never demands a fictitious mark
        mark = payload.checks.get(spec.field_id)
        if mark is None:
            errors.append(
                _item(
                    f"checks.{spec.field_id}",
                    spec.field_id,
                    "Сравнение не отмечено: подтвердите совпадение или укажите факт.",
                )
            )
            continue
        if not mark.matches:
            grounds[spec.field_id] = mark
            # Quantity/weight facts are demanded only when the derived
            # discrepancy actually crosses its rule (FT-ARR-07/08); other
            # admissible and inadmissible grounds record the fact immediately.
            if spec.field_id in ("CHK-F20", "CHK-F21"):
                continue
            if _blank(mark.actual):
                errors.append(
                    _item(f"checks.{spec.field_id}", "CHK-F42", "Для расхождения обязательно фактическое значение.")
                )
            if mark.reason is None or mark.reason.strip() == "":
                errors.append(_item(f"checks.{spec.field_id}", "CHK-F43", "Для расхождения обязательна причина."))

    # Fictitious marks on informational/readonly fields are refused.
    for key in payload.checks:
        mark_spec = FIELD_REGISTRY.get(key)
        if mark_spec is None or mark_spec.ground not in ("act", "inadmissible"):
            blocking.append(_item(f"checks.{key}", key, "Это поле не требует отметки сравнения (информационное)."))
        elif not _present(fields.get(mark_spec.key)):
            blocking.append(
                _item(f"checks.{key}", key, "Источник не содержит значения этого поля: отметка не требуется.")
            )

    # --- quantitative facts (FT-ARR-06) ----------------------------------------
    delivered, accepted, returned = payload.delivered, payload.accepted, payload.returned
    delivered_mass, accepted_mass, returned_mass = (
        _decimal(delivered.mass_kg),
        _decimal(accepted.mass_kg),
        _decimal(returned.mass_kg),
    )
    delivered_quantity, accepted_quantity, returned_quantity = (
        _decimal(delivered.quantity),
        _decimal(accepted.quantity),
        _decimal(returned.quantity),
    )
    for name, value in (
        ("delivered", (delivered_mass, delivered_quantity)),
        ("accepted", (accepted_mass, accepted_quantity)),
        ("returned", (returned_mass, returned_quantity)),
    ):
        for part in value:
            if part is not None and part < 0:
                blocking.append(_item(name, "CHK-F42", "Количество и вес не могут быть отрицательными."))
                break

    delivered_positive = (delivered_mass is not None and delivered_mass > 0) or (
        delivered_quantity is not None and delivered_quantity > 0
    )
    parts_unit_consistent = True
    if delivered_positive:
        if delivered.unit_id.strip() == "":
            parts_unit_consistent = False
            blocking.append(_item("delivered", "CHK-F20", "Укажите единицу измерения доставленной партии."))
        elif delivered.unit_id != accepted.unit_id or delivered.unit_id != returned.unit_id:
            parts_unit_consistent = False
            blocking.append(
                _item(
                    "accepted",
                    "CHK-F20",
                    "Сравнивать можно только одинаковые unit ID: доставленное, "
                    "принятое и возвращаемое должны быть в одной единице.",
                )
            )

    # --- decision availability (FT-ARR-04/09) ----------------------------------
    inadmissible = [field_id for field_id, mark in grounds.items() if FIELD_REGISTRY[field_id].ground == "inadmissible"]
    if not delivered_positive:
        allowed_decisions: list[str] = []
        if payload.decision is not None:
            blocking.append(
                _item(
                    "decision",
                    "CHK-F34",
                    "Неприбытие и нулевая доставка не допускают гашения или возврата отсутствующего груза.",
                )
            )
    else:
        if inadmissible:
            allowed_decisions = ["RETURN_ALL"] if capabilities.external_return_allowed else []
        else:
            allowed_decisions = ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"]
        if payload.decision is not None and not _decision_allowed(payload.decision, allowed_decisions):
            blocking.append(
                _item(
                    "decision",
                    "CHK-F34",
                    "Выбранное решение недопустимо при отмеченных расхождениях: выберите заново допустимый вариант.",
                )
            )

    # --- decision composition (FT-ARR-06 / DATA-02) -----------------------------
    if payload.decision is not None and delivered_positive and parts_unit_consistent:
        assert delivered_mass is not None and delivered_quantity is not None  # for mypy
        if payload.decision == "ACCEPT_ALL":
            if accepted_mass != delivered_mass or accepted_quantity != delivered_quantity:
                blocking.append(
                    _item("accepted", "CHK-F34", "Полное принятие: принимается всё доставленное, без возврата.")
                )
            if (returned_mass is not None and returned_mass != 0) or (
                returned_quantity is not None and returned_quantity != 0
            ):
                blocking.append(
                    _item(
                        "returned",
                        "CHK-F34",
                        "Полное принятие не допускает возврата; недостача не является обратным грузом.",
                    )
                )
        elif payload.decision == "PARTIAL":
            if accepted_mass is None or returned_mass is None or accepted_quantity is None or returned_quantity is None:
                blocking.append(_item("accepted", "CHK-F34", "Частичное гашение требует обеих положительных частей."))
            else:
                if accepted_mass <= 0 or returned_mass <= 0 or accepted_quantity <= 0 or returned_quantity <= 0:
                    blocking.append(
                        _item(
                            "returned",
                            "CHK-F34",
                            "Частичное гашение требует обеих положительных частей; "
                            "недостача не является обратным грузом.",
                        )
                    )
                if (
                    accepted_mass + returned_mass != delivered_mass
                    or accepted_quantity + returned_quantity != delivered_quantity
                ):
                    blocking.append(
                        _item(
                            "accepted",
                            "CHK-F34",
                            "Частичное гашение: принятое + возвращаемое = доставленное (вес и количество).",
                        )
                    )
        elif payload.decision == "RETURN_ALL":
            if (accepted_mass is not None and accepted_mass != 0) or (
                accepted_quantity is not None and accepted_quantity != 0
            ):
                blocking.append(_item("accepted", "CHK-F34", "Полный возврат: принятое должно быть равно нулю."))
            if returned_mass != delivered_mass or returned_quantity != delivered_quantity:
                blocking.append(_item("returned", "CHK-F34", "Полный возврат: возвращается вся прибывшая партия."))

    # --- weight boundary ±5% inclusive (FT-ARR-07) ------------------------------
    documentary_mass = _decimal(str(fields.get("massKg") or "0")) if _present(fields.get("massKg")) else None
    weight_act = False
    if documentary_mass is not None and documentary_mass > 0 and delivered_mass is not None and delivered_mass > 0:
        deviation = (delivered_mass - documentary_mass) / documentary_mass * Decimal(100)
        weight_act = deviation < -WEIGHT_BOUNDARY or deviation > WEIGHT_BOUNDARY
    if weight_act:
        mark = payload.checks.get("CHK-F21")
        if mark is not None and _blank(mark.actual):
            errors.append(_item("checks.CHK-F21", "CHK-F42", "Для расхождения веса обязательно фактическое значение."))
        if mark is not None and (mark.reason is None or mark.reason.strip() == ""):
            errors.append(
                _item("checks.CHK-F21", "CHK-F43", "Расхождение веса сверх допуска ±5% требует причины для акта.")
            )
        # A zero/invalid documentary mass never allows the division (checked above).
    if payload.decision == "RETURN_ALL":
        weight_act = False

    # --- quantity discrepancy (same unit only) ----------------------------------
    quantity_act = False
    documentary_quantity = fields.get("quantity")
    if (
        _present(documentary_quantity)
        and delivered_positive
        and delivered.unit_id.strip() != ""
        and fields.get("unitId") == delivered.unit_id
        and delivered_quantity is not None
        and _decimal(str(documentary_quantity)) is not None
        and delivered_quantity != _decimal(str(documentary_quantity))
        and payload.decision != "RETURN_ALL"
    ):
        quantity_act = True
        mark = payload.checks.get("CHK-F20")
        if mark is not None and _blank(mark.actual):
            errors.append(
                _item("checks.CHK-F20", "CHK-F42", "Для расхождения количества обязательно фактическое значение.")
            )
        if mark is not None and (mark.reason is None or mark.reason.strip() == ""):
            errors.append(_item("checks.CHK-F20", "CHK-F43", "Расхождение количества требует причины для акта."))

    # --- derived act items (CHK-F44, FT-ARR-08) ---------------------------------
    act_specs = ("CHK-F10", "CHK-F11", "CHK-F18", "CHK-F23", "CHK-F25", "CHK-F26", "CHK-F27")
    items: list[ActItem] = []
    for field_id in act_specs:
        mark = grounds.get(field_id)
        if mark is None or mark.actual is None or mark.reason is None:
            continue
        source_value = fields.get(FIELD_REGISTRY[field_id].key)
        items.append(
            ActItem(
                field_id=field_id,
                source=None if source_value is None else str(source_value),
                actual=mark.actual,
                reason=mark.reason,
            )
        )
    if quantity_act and "CHK-F20" in grounds and grounds["CHK-F20"].reason is not None:
        source_value = fields.get("quantity")
        items.append(
            ActItem(
                field_id="CHK-F20",
                source=None if source_value is None else str(source_value),
                actual=grounds["CHK-F20"].actual,
                reason=grounds["CHK-F20"].reason or "",
            )
        )
    if (
        weight_act
        and payload.checks.get("CHK-F21") is not None
        and (payload.checks["CHK-F21"].reason or "").strip() != ""
    ):
        items.append(
            ActItem(
                field_id="CHK-F21",
                source=None if documentary_mass is None else str(documentary_mass),
                actual=str(delivered_mass) if delivered_mass is not None else None,
                reason=payload.checks["CHK-F21"].reason or "",
            )
        )
    act_required = bool(items) and payload.decision != "RETURN_ALL"

    # --- return reason (CHK-F35, FT-ARR-10) -------------------------------------
    if payload.return_reason is not None and payload.decision == "ACCEPT_ALL":
        errors.append(_item("returnReason", "CHK-F35", "Полное принятие не требует причины возврата."))
    if payload.decision in ("PARTIAL", "RETURN_ALL"):
        if payload.return_reason is None:
            errors.append(
                _item("returnReason", "CHK-F35", "Частичное гашение и полный возврат требуют причину возврата.")
            )
        else:
            if payload.return_reason.code not in capabilities.return_reason_codes:
                blocking.append(
                    _item("returnReason.code", "CHK-F35", "Код причины возврата не входит в справочник Меркурия.")
                )
            if payload.return_reason.code == OTHER_REASON and (
                payload.return_reason.text is None or payload.return_reason.text.strip() == ""
            ):
                blocking.append(
                    _item("returnReason.text", "CHK-F35", "Для «Иной причины» обязателен текст причины возврата.")
                )

    # --- inspection inputs (CHK-F13/14) -----------------------------------------
    if payload.inspection.compartment is None:
        errors.append(_item("inspection.compartment", "CHK-F13", "Укажите состояние грузового отделения."))
    if payload.inspection.joint_carriage is None:
        errors.append(_item("inspection.jointCarriage", "CHK-F14", "Укажите совместную перевозку с другими грузами."))

    # --- decision presence (CHK-F34) --------------------------------------------
    if payload.decision is None and delivered_positive:
        errors.append(_item("decision", "CHK-F34", "Выберите решение о приёмке."))

    # --- repeat ВСЭ (CHK-F36–38, FT-ARR-11) -------------------------------------
    previous = _previous_present(fields)
    if payload.repeat is not None and not previous:
        blocking.append(
            _item(
                "repeat",
                "CHK-F36",
                "Повторная ВСЭ выбирается только при сведениях прежней ВСЭ; без неё местная ВСЭ обязательна.",
            )
        )
    elif previous and payload.repeat is None:
        errors.append(_item("repeat", "CHK-F36", "При наличии прежней ВСЭ явно выберите необходимость повторной."))
    if payload.repeat is not None and previous and payload.repeat.required:
        if payload.repeat.reason is None or payload.repeat.reason.strip() == "":
            errors.append(_item("repeat.reason", "CHK-F37", "Для повторной ВСЭ обязательно основание."))
        if payload.repeat.act_number is None or payload.repeat.act_number.strip() == "":
            errors.append(_item("repeat.act_number", "CHK-F38", "Для повторной ВСЭ обязателен № акта."))

    # --- transaction (CHK-F39/40, FT-ARR-13) ------------------------------------
    if payload.transaction.planned is None:
        errors.append(_item("transaction.planned", "CHK-F39", "Укажите, будет ли по партии произведена транзакция."))
    if payload.transaction.planned and payload.transaction.type is None:
        errors.append(_item("transaction.type", "CHK-F40", "При «Да» обязателен тип транзакции."))

    # --- route (FT-ARR-12) -------------------------------------------------------
    route: str | None = None
    if payload.decision == "RETURN_ALL":
        route = "NONE"
    elif payload.decision is not None:
        if previous and payload.repeat is not None and not payload.repeat.required:
            route = "CONCLUSION"
        else:
            route = "EXAMINATION"

    return ReceiptValidation(
        errors=errors,
        blocking=blocking,
        allowed_decisions=allowed_decisions if delivered_positive else [],
        act=ActPreview(required=act_required, items=items),
        route=route,
    )


def normalize_payload(payload: ReconciliationWrite) -> ReconciliationWrite:
    """Server-side normalization before persistence (FT-ARR-11/13).

    «Нет» по транзакции очищает тип; повторная ВСЭ без необходимости не хранит
    основание/акт. The source fields never change.
    """
    if payload.repeat is not None and not payload.repeat.required:
        payload = payload.model_copy(
            update={"repeat": payload.repeat.model_copy(update={"reason": None, "act_number": None})}
        )
    if payload.transaction.planned is not True and payload.transaction.type is not None:
        payload = payload.model_copy(
            update={"transaction": Transaction(planned=payload.transaction.planned, type=None)}
        )
    return payload
