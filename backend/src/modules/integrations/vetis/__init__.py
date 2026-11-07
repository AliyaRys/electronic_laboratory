"""VetIS boundary: external identifiers stay outside the domain modules."""

from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2, VetisContour

__all__ = ["MercuryProductGuidLvl2", "VetisContour"]
