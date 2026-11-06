"""API router: mounts ``/api/v1``."""

from __future__ import annotations

from fastapi import APIRouter

from backend.src.interfaces.api.v1 import router as v1_router

router = APIRouter()
router.include_router(v1_router, prefix="/api")
