"""API v1 router assembly."""

from __future__ import annotations

from fastapi import APIRouter

from backend.src.modules.identity.router import router as identity_router

router = APIRouter(prefix="/v1")
router.include_router(identity_router)
