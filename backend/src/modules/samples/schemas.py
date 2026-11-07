"""API-06 sample selection and collection view contracts (strict DTOs)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from backend.src.modules.arrivals.schemas import DecimalString

__all__ = [
    "NewSample",
    "ReuseSample",
    "EditSample",
    "SampleSelection",
    "CollectionView",
    "DisposalWrite",
    "DisposalView",
]


class StrictModel(BaseModel):
    """Every write DTO forbids extras and accepts the camelCase wire names."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class NewSample(StrictModel):
    """An explicit, actually performed physical selection with its own date
    and a positive weight (FT-SMP-01/03). It never deletes or replaces earlier
    collections."""

    mode: Literal["NEW"]
    collected_on: date
    mass_kg: DecimalString


class ReuseSample(StrictModel):
    """The card links an existing physical fact of the same party without any
    new weight (FT-SMP-03). Only a not-disposed collection of the same party is
    reusable."""

    mode: Literal["REUSE"]
    collection_id: uuid.UUID


class EditSample(StrictModel):
    """A correction of the same not-disposed fact through an allowed card
    edit: the balance changes only by the difference (FT-SMP-04). The
    ``expected_revision`` is the If-Match of the collection itself."""

    mode: Literal["EDIT"]
    collection_id: uuid.UUID
    expected_revision: int
    collected_on: date
    mass_kg: DecimalString


SampleSelection = Annotated[NewSample | ReuseSample | EditSample, Field(discriminator="mode")]


class CollectionView(BaseModel):
    """API-06 ``CollectionView``: one available physical collection fact."""

    model_config = ConfigDict(extra="forbid")

    id: str
    party_id: str
    laboratory_id: str
    product_species_id: str
    classification_snapshot: dict[str, object]
    collected_on: date
    mass_kg: str
    collected_by: str
    created_at: datetime
    disposal_id: str | None
    revision: int


class DisposalWrite(StrictModel):
    """API-06 ``DisposalWrite``: one full disposal of a laboratory/species
    balance (FT-SMP-06/07). The weight is never editable: ``expected_mass_kg``
    only guards the shown confirmation dialog — the server always recomputes
    the actual mass from every active collection. ``external_vsd_number`` is a
    manually entered fact (the eVSD issued in Mercury); it is never treated as
    an API-confirmed value."""

    laboratory_id: uuid.UUID
    product_species_id: uuid.UUID
    disposed_on: date
    external_vsd_number: str
    expected_mass_kg: DecimalString


class DisposalView(BaseModel):
    """API-06 ``DisposalView``: the immutable full-disposal fact."""

    model_config = ConfigDict(extra="forbid")

    id: str
    laboratory_id: str
    product_species_id: str
    disposed_on: date
    mass_kg: str
    external_vsd_number: str
    actor_id: str
    recorded_at: datetime
