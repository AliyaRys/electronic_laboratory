"""local mirror of Mercury product dictionary level 2

Revision ID: 0005_mercury_product_lvl2
Revises: 0004_catalog_pricing
Create Date: 2026-11-07

Seeds the complete 28-row ``productType=1`` response supplied by the owner
from the VetIS pilot contour. Runtime screens resolve incoming VSD product GUIDs
locally; they do not call ProductService for every read.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_mercury_product_lvl2"
down_revision: str | Sequence[str] | None = "0004_catalog_pricing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TRICHINELLOSCOPY_GUIDS = {
    "57a674fd-ca2b-c523-6853-72d27b4ae32c",  # свинина
    "64930556-cbb2-13db-bcdc-572eb188e45e",  # конина
    "40dd45d4-75aa-b984-4fdb-291f84afad03",  # субпродукты и жиры свиные
    "16d9f824-a5f3-6837-3073-e54c4ed5d74d",  # субпродукты и жиры конские
}

_PRODUCTS = (
    (
        "362aa885-9b9f-ae95-05d0-f9570f4fbdc6",
        "b1253a77-0585-291f-57a4-53319e897866",
        "говядина",
        "beef",
        "0201, 0202, 0206, 0210",
        100,
    ),
    (
        "57a674fd-ca2b-c523-6853-72d27b4ae32c",
        "b48f2d1f-d1d6-67cb-db17-0d9b39ae84cb",
        "свинина",
        "pork",
        "0203, 0206, 0210",
        100,
    ),
    ("74269863-8169-ca83-e48e-37fc80e8c0a9", "79d12da1-485f-faf1-6a02-621e091c1df4", "баранина", "mutton", "0204", 100),
    (
        "13581a3b-c7c0-915e-62eb-fa9fc897573b",
        "3d327bce-e7cb-0c80-f352-1c7073bbb54d",
        "козлятина",
        "goat meat",
        "0204",
        100,
    ),
    (
        "64930556-cbb2-13db-bcdc-572eb188e45e",
        "0b224d30-26b7-9aaa-8c8e-36dc88961677",
        "конина",
        "horse meat",
        "0205, 0210",
        100,
    ),
    (
        "f97d8683-89d2-d7f7-5015-cdeaab4be98f",
        "269a19f9-951a-8815-da94-267a4a9e5868",
        "субпродукты и жиры говяжьи",
        "beef offal and fats",
        "0206, 1502",
        100,
    ),
    (
        "40dd45d4-75aa-b984-4fdb-291f84afad03",
        "5dc408c5-f6ef-a791-d8be-3c7010f74186",
        "субпродукты и жиры свиные",
        "pork offal and fats",
        "0206, 0209",
        100,
    ),
    (
        "16d9f824-a5f3-6837-3073-e54c4ed5d74d",
        "74a87928-efde-1478-6d6d-8c73831c37b1",
        "субпродукты и жиры конские",
        "horse offal and fat",
        "0206",
        100,
    ),
    (
        "0afdd23b-6fbb-ce96-669f-b0922b9efb85",
        "d50706c7-f521-12d7-3ffd-a62f13fa1023",
        "субпродукты мелкого рогатого скота",
        "sheep and goat offal",
        "0206",
        100,
    ),
    (
        "337f79dc-4376-6e33-dabe-d5447913b97d",
        "e42c2a82-2624-eeeb-9193-8187a888d276",
        "мясо птицы",
        "poultry meat",
        "0207",
        100,
    ),
    (
        "ce9828e8-1b07-f094-8eb9-8b450994153d",
        "12706ba0-4776-92a4-f53d-f214d1ec5353",
        "мясо кролика",
        "rabbit meat",
        "0208",
        100,
    ),
    (
        "ae99803f-c580-5b1d-80ce-a5139f74d71c",
        "17533ef4-5342-72e1-b12c-5e8b49e57d56",
        "мясо диких животных, рептилий и др.",
        "wild game meat, reptile meat",
        "0208",
        100,
    ),
    (
        "527a0f5a-e880-e3ca-d41f-65aa63cc6313",
        "7f1aa4d4-72f2-a353-468e-b42f0a82dee1",
        "мясо морских животных",
        "marine animal meat",
        "0208, 1504",
        100,
    ),
    (
        "eab73d6b-b24d-5164-1c45-f9a39c2db9c7",
        "72de288a-bbfb-fc65-5b37-f1583de44fc4",
        "мясо кенгуру",
        "kangaroo meat",
        "0208",
        100,
    ),
    (
        "d7a44d7a-1863-dbff-2581-c03fae1ab447",
        "c52bec0e-eed3-813d-3528-f8b1e0f9dd1a",
        "субпродукты и жиры птицы",
        "poultry offal and fats",
        "0207, 0209, 1501, 0210",
        100,
    ),
    (
        "207e346e-5a62-4396-b696-d154ad3bded9",
        "80b293a4-176d-4ad1-af02-90e50a1c8943",
        "мясо диких птиц",
        "game bird meat",
        "0208",
        100,
    ),
    (
        "e84f3cb2-0fd9-403e-8abf-9a2c7f1aa71f",
        "c97b30c6-bdd0-4c55-8e59-943fd3b26a41",
        "буйволятина",
        "buffalo meat",
        "0202",
        100,
    ),
    ("1e648587-4cb3-4369-8d1b-bbd200506164", "27da6fe9-1779-4211-ad4e-1d4766acaa3b", "мясо нутрий", None, "0208", 100),
    (
        "bd1bb8ca-6e18-4062-8e7c-32b95b1b1354",
        "44ae2587-2e2a-40ac-ace2-99fb33676158",
        "неподконтрольная продукция",
        None,
        ".",
        100,
    ),
    (
        "cbd9f7c4-4033-75e2-d187-ee21a2a10246",
        "522a14ff-1081-ecf7-fb52-0cd9c52c1205",
        "мясо китов",
        "whale meat",
        "0208",
        260,
    ),
    (
        "e302358c-258a-93a4-3eb5-4385b30ff1d2",
        "77cd0a62-442c-d99f-d9ca-82d012c7cea6",
        "мясо рептилий",
        "reptile meat",
        "0208",
        260,
    ),
    (
        "62160578-dc4d-1934-b6bc-5dfa7a2ad4d1",
        "5d841744-8050-2a4e-ddaf-401ce4e61859",
        "прочее мясо",
        "other types of meat",
        "0208",
        260,
    ),
    (
        "9351133c-b114-9cb1-3cdd-84a89c1b9138",
        "888a7c0b-35fc-5f4b-076a-5bb0a5b283a7",
        "свинина и субпродукты свиные",
        "pork and pork offal",
        "0210",
        260,
    ),
    (
        "39157e2a-457a-f275-4bdb-c927f640be01",
        "3ce58f7e-ea2a-26e0-9843-9ead1fc0fdc8",
        "субпродукты овец и коз",
        "sheep and goat offal",
        "0210",
        260,
    ),
    (
        "2482379d-fd70-d125-cd74-030244f62d28",
        "198307b1-c315-5835-ad24-f240e9bf63da",
        "мясо и пищевые субпродукты, соленые, в рассоле, сушеные, копченые",
        "meat and offal for human consumption, salted, pickled, dried, smoked",
        "0210",
        260,
    ),
    (
        "ada4ca0a-1698-27c2-fbb6-64c158b74677",
        "41fa496a-4256-350c-c8f0-663215f96bed",
        "телятина",
        "veal",
        "0202, 0201",
        260,
    ),
    ("2f055312-2167-4716-bb95-d541ca9cb54a", "5d725588-0a8e-4c12-80e4-92976c966730", "Тест", None, "00000", 100),
    (
        "15a3d1e7-36d7-4749-b27f-568de76f612e",
        "639880ba-2812-49ef-94c4-c082ee255c6f",
        "мясо верблюда1",
        None,
        "0208",
        200,
    ),
)


def upgrade() -> None:
    table = op.create_table(
        "mercury_product_guid_lvl_2",
        sa.Column("contour", sa.String(16), primary_key=True),
        sa.Column("guid", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("current_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("english_name", sa.String(255), nullable=True),
        sa.Column("tnved_codes", sa.String(255), nullable=False),
        sa.Column("product_type", sa.SmallInteger(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("is_last", sa.Boolean(), nullable=False),
        sa.Column("external_status", sa.Integer(), nullable=False),
        sa.Column("requires_trichinelloscopy", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("source", sa.String(128), nullable=False),
        sa.Column(
            "synchronized_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")
        ),
        sa.UniqueConstraint("contour", "current_uuid", name="uq_mercury_product_lvl2_contour_uuid"),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="mercury_product_lvl2_contour_valid"),
        sa.CheckConstraint("product_type BETWEEN 1 AND 8", name="mercury_product_lvl2_type_valid"),
    )
    op.create_index("ix_mercury_product_lvl2_name", "mercury_product_guid_lvl_2", ["contour", "name"])

    op.bulk_insert(
        table,
        [
            {
                "contour": "PILOT",
                "guid": guid,
                "current_uuid": current_uuid,
                "name": name,
                "english_name": english_name,
                "tnved_codes": tnved_codes,
                "product_type": 1,
                "active": True,
                "is_last": True,
                "external_status": status,
                "requires_trichinelloscopy": guid in _TRICHINELLOSCOPY_GUIDS,
                "source": "GetProductByTypeList pilot 2026-11-07",
            }
            for guid, current_uuid, name, english_name, tnved_codes, status in _PRODUCTS
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_mercury_product_lvl2_name", table_name="mercury_product_guid_lvl_2")
    op.drop_table("mercury_product_guid_lvl_2")
