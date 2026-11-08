"""API v1 router assembly."""

from __future__ import annotations

from fastapi import APIRouter

from backend.src.modules.arrivals.router import router as arrivals_router
from backend.src.modules.catalog_pricing.mandatory import ensure_mandatory_registry_configured
from backend.src.modules.catalog_pricing.router import router as catalog_router
from backend.src.modules.documents.router import router as documents_router
from backend.src.modules.examinations.router import router as examinations_router
from backend.src.modules.identity.router import router as identity_router
from backend.src.modules.reporting.router import router as reporting_router
from backend.src.modules.samples.router import router as samples_router

# Fail loud before the app accepts traffic if the ФТ mandatory research set is
# not configured (finding 2 of the C01 review).
ensure_mandatory_registry_configured()

router = APIRouter(prefix="/v1")
router.include_router(identity_router)
router.include_router(arrivals_router)
router.include_router(catalog_router)
router.include_router(samples_router)
router.include_router(examinations_router)
router.include_router(documents_router)
router.include_router(reporting_router)
