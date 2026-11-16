"""ТЗ DR20 §5/§9: the typed production/expiry dates (vd:GoodsDate) of the batch.

The TYPE of the source value survives the normalizer end-to-end: a single
date keeps ``secondDate`` strictly absent (never a copy), an interval keeps
both dates, an informal value keeps the source text and never becomes an
invented calendar date. ``dt:hour`` is stored separately for source/audit and
NEVER shifts the calendar day by a timezone (§2). An invalid date combination
produces a controlled normalization diagnostic without breaking the import of
the remaining ВСД requisites. The live VetIS write is never called here.
"""

from __future__ import annotations

from backend.src.modules.integrations.vetis.normalizer import (
    normalize_snapshot,
    parse_vet_document_list,
)

DOC_UUID = "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac"


def _xml(production: str, expiry: str) -> str:
    """An anonymized transport eVSD with the given date XML fragments."""
    return f"""
<vd:vetDocument xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
                xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
                xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">
  <bs:uuid>{DOC_UUID}</bs:uuid>
  <vd:vetDType>TRANSPORT</vd:vetDType>
  <vd:vetDStatus>CONFIRMED</vd:vetDStatus>
  <vd:issueDate>2026-11-12</vd:issueDate>
  <vd:certifiedConsignment>
    <vd:consignor><dt:enterprise><bs:guid>aa367f30-9701-4c8e-b468-1fbf820d4184</bs:guid><dt:name>Отправитель</dt:name></dt:enterprise></vd:consignor>
    <vd:consignee><dt:enterprise><bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid><dt:name>Получатель</dt:name></dt:enterprise></vd:consignee>
    <vd:transportInfo><vd:transportNumber><vd:vehicleNumber>А123ВВ116</vd:vehicleNumber></vd:transportNumber></vd:transportInfo>
    <vd:batch>
      <vd:productType>1</vd:productType>
      <vd:product><bs:guid>362aa885-9b9f-ae95-05d0-f9570f4fbdc6</bs:guid><dt:name>Говядина</dt:name></vd:product>
      <vd:volume>500.0</vd:volume>
      <vd:unit><bs:guid>21ed96c9-337b-4a27-8761-c6e6ad3c9f5b</bs:guid><dt:name>кг</dt:name></vd:unit>
      {production}
      {expiry}
    </vd:batch>
  </vd:certifiedConsignment>
</vd:vetDocument>
"""


def _wrap(source: str) -> str:
    return f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{source}</w>'


def _snapshot(production: str, expiry: str):
    entries = parse_vet_document_list(_wrap(_xml(production, expiry)))
    assert len(entries) == 1
    return normalize_snapshot(entries[0])


SINGLE_PRODUCTION = """
<vd:dateOfProduction>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>3</dt:day><dt:hour>0</dt:hour></vd:firstDate>
</vd:dateOfProduction>
"""
SINGLE_EXPIRY = """
<vd:expiryDate>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>10</dt:day><dt:hour>0</dt:hour></vd:firstDate>
</vd:expiryDate>
"""


# --- §9-1: a single production date ------------------------------------------------


def test_single_production_date_is_one_date_with_strictly_null_second() -> None:
    batch = _snapshot(SINGLE_PRODUCTION, "").vd_document.batch
    goods = batch.date_of_production
    assert goods is not None
    assert goods.first_date == "2026-11-03"
    # §5.1: a single date keeps secondDate strictly null — never a copy.
    assert goods.second_date is None
    assert goods.informal_date is None
    assert batch.expiry_date is None


# --- §9-2: a single expiry date ----------------------------------------------------


def test_single_expiry_date_is_one_date_with_strictly_null_second() -> None:
    batch = _snapshot("", SINGLE_EXPIRY).vd_document.batch
    goods = batch.expiry_date
    assert goods is not None
    assert goods.first_date == "2026-11-10"
    assert goods.second_date is None
    assert batch.date_of_production is None


# --- §9-3: the interval keeps the second date --------------------------------------


def test_interval_keeps_both_dates_without_loss() -> None:
    production = """
<vd:dateOfProduction>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>3</dt:day><dt:hour>0</dt:hour></vd:firstDate>
  <vd:secondDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>5</dt:day><dt:hour>0</dt:hour></vd:secondDate>
</vd:dateOfProduction>
"""
    expiry = """
<vd:expiryDate>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>10</dt:day><dt:hour>0</dt:hour></vd:firstDate>
  <vd:secondDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>16</dt:day><dt:hour>0</dt:hour></vd:secondDate>
</vd:expiryDate>
"""
    batch = _snapshot(production, expiry).vd_document.batch
    assert batch.date_of_production is not None
    assert batch.date_of_production.first_date == "2026-11-03"
    assert batch.date_of_production.second_date == "2026-11-05"
    assert batch.expiry_date is not None
    assert batch.expiry_date.first_date == "2026-11-10"
    assert batch.expiry_date.second_date == "2026-11-16"


# --- §9-4: informal never becomes an invented calendar date ------------------------


def test_informal_date_keeps_the_source_text_without_a_calendar_date() -> None:
    production = "<vd:dateOfProduction><vd:informalDate>начало ноября 2026</vd:informalDate></vd:dateOfProduction>"
    batch = _snapshot(production, "").vd_document.batch
    goods = batch.date_of_production
    assert goods is not None
    assert goods.informal_date == "начало ноября 2026"
    assert goods.first_date is None
    assert goods.second_date is None


# --- §9-5: hour/timezone never shifts the calendar day -----------------------------


def test_hour_is_stored_separately_and_never_shifts_the_calendar_day() -> None:
    production = """
<vd:dateOfProduction>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>3</dt:day><dt:hour>23</dt:hour></vd:firstDate>
</vd:dateOfProduction>
"""
    batch = _snapshot(production, "").vd_document.batch
    goods = batch.date_of_production
    assert goods is not None
    # The calendar day survives exactly as the source year/month/day said.
    assert goods.first_date == "2026-11-03"
    # The hour is kept separately for source/audit — never added to the date.
    assert goods.first_date_hour == 23


# --- §5.2: the invalid combination is a controlled diagnostic, not a blocker -------


def test_invalid_calendar_combination_is_a_controlled_diagnostic() -> None:
    production = """
<vd:dateOfProduction>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>2</dt:month><dt:day>30</dt:day><dt:hour>0</dt:hour></vd:firstDate>
</vd:dateOfProduction>
"""
    entry = parse_vet_document_list(_wrap(_xml(production, "")))[0]
    # The controlled diagnostic names the field and the raw value...
    assert entry.date_problems == [
        {"field": "dateOfProduction", "part": "firstDate", "value": "2026-02-30"}
    ]
    # ...the structure is never fabricated, and the import of the remaining
    # requisites continues.
    batch = normalize_snapshot(entry).vd_document.batch
    assert batch.date_of_production is None
    assert batch.product.name == "Говядина"
    assert str(batch.volume) == "500.0"


def test_absent_date_nodes_stay_absent() -> None:
    batch = _snapshot("", "").vd_document.batch
    assert batch.date_of_production is None
    assert batch.expiry_date is None
