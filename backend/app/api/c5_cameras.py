"""C5 queries read only the original Redis index; PostgreSQL is not involved."""
import logging
from fastapi import APIRouter, HTTPException, Query
from redis.exceptions import RedisError
from app.realtime.c5_service import GeoC5Service

router = APIRouter(prefix="/api/c5", tags=["Infraestructura C5"])


@router.get("/nearest")
def nearest_infrastructure(
    latitude: float = Query(ge=-85.05112878, le=85.05112878),
    longitude: float = Query(ge=-180, le=180),
    radius_m: float = Query(default=1000, gt=0, le=50000),
    limit: int = Query(default=10, ge=1, le=100),
):
    try:
        return GeoC5Service().localizar_infraestructura_cercana(latitude, longitude, radius_m, limit)
    except RedisError as exc:
        logging.getLogger(__name__).warning("C5 Redis query failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Redis C5 no disponible. Verifica C5_REDIS_URL.") from None
