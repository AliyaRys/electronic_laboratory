"""Application entrypoint (uvicorn target)."""

from __future__ import annotations

from backend.src.infrastructure.app_factory import create_application
from backend.src.interfaces.api import router

app = create_application(router=router)

__all__ = ["app"]
