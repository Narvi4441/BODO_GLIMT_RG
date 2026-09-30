"""Compatibility filename; the dataset represents infrastructure, not all cameras."""
from fastapi import APIRouter, Query
from app.services.c5_repository import nearest

router = APIRouter(prefix="/api/c5", tags=["Infraestructura C5"])


@router.get("/nearest")
def nearest_infrastructure(
    latitude: float = Query(ge=-85.05112878, le=85.05112878),
    longitude: float = Query(ge=-180, le=180),
    radius_m: float = Query(default=1000, gt=0, le=50000),
):
    return nearest(latitude, longitude, radius_m)
