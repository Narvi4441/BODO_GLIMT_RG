from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.api.auth import AuthRoute, me
from app.core.config import Config
from app.services.Google_maps_service import GoogleMapsIntegration


class Coordinates(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(strict=True, ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(strict=True, ge=-180, le=180, allow_inf_nan=False)


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: Coordinates
    destination: Coordinates


router = APIRouter(prefix="/api/routes", tags=["Routes"], route_class=AuthRoute)


@router.post("/plan")
def plan(request: RouteRequest, user: dict = Depends(me)):
    try:
        return GoogleMapsIntegration(Config.GOOGLE_API_KEY).plan_route(
            request.origin.model_dump(mode="json"),
            request.destination.model_dump(mode="json"),
        )
    except Exception:
        raise HTTPException(502, "No fue posible calcular la ruta.") from None
