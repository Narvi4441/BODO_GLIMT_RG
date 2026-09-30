from math import isfinite
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError

from app.api.auth import AuthRoute, me
from app.api.routes import Coordinates
from app.core.database import DatabaseNotConfigured, get_engine
from app.services.auth_repository import find_tutors
from app.services.journey_state import get_journey
from app.services.monitor_state import get_or_create_access, get_access
from app.services.risk_state import get_last_risk_status
from app.services.telemetry_repository import get_latest_telemetry
from app.services.telegram_service import TelegramDeliveryError, send_monitor_link


class MonitorRoute(AuthRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            # El router ya extrajo path_params. Ocultar la capacidad en el access log
            # de Uvicorn, sin cambiar el token que recibe el endpoint.
            if "token" in request.path_params:
                request.scope["path"] = "/api/monitor/[redacted]"
                request.scope["raw_path"] = b"/api/monitor/[redacted]"
                request.scope["query_string"] = b""
            try:
                response = await original(request)
            except HTTPException as error:
                response = JSONResponse(status_code=error.status_code,
                                        content={"detail": error.detail}, headers=error.headers)
            except (SQLAlchemyError, DatabaseNotConfigured):
                response = JSONResponse(status_code=503,
                                        content={"detail": "No se pudo consultar el seguimiento."})
            response.headers["Cache-Control"] = "no-store, private"
            response.headers["Referrer-Policy"] = "no-referrer"
            return response
        return handler


router = APIRouter(prefix="/api/monitor", tags=["Monitor"], route_class=MonitorRoute)


class Destination(Coordinates):
    name: str = Field(max_length=500)
    address: str = Field(max_length=1000)


class AccessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    journey_id: str = Field(min_length=1, max_length=36)
    tutor_id: int = Field(strict=True, gt=0)
    destination: Destination | None = None
    planned_path: list[Coordinates] = Field(default_factory=list, max_length=25000)


class TelegramRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    journey_id: str = Field(min_length=1, max_length=36)
    tutor_id: int = Field(strict=True, gt=0)


@router.get("/contacts")
def contacts(user: dict = Depends(me)):
    with get_engine().connect() as connection:
        tutors = find_tutors(connection, user["id_usuario"])
    return [{key: row[key] for key in ("id_tutor", "nombre_completo", "relacion")} for row in tutors]


def _validated_access(journey_id: str, tutor_id: int, user: dict,
                      destination: dict | None = None, planned_path: list[dict] | None = None) -> str:
    journey = get_journey(journey_id)
    if not journey or journey["status"] != "ACTIVE":
        raise HTTPException(410, "Seguimiento no disponible")
    user_id = str(user["id_usuario"])
    if journey["user_id"] != user_id:
        raise HTTPException(403, "No puedes compartir este recorrido.")
    with get_engine().connect() as connection:
        tutors = find_tutors(connection, user["id_usuario"])
    if not any(row["id_tutor"] == tutor_id for row in tutors):
        raise HTTPException(403, "La persona de confianza no está vinculada a tu cuenta.")
    token = get_or_create_access(journey_id, user_id, tutor_id, destination, planned_path)
    if token is None:
        raise HTTPException(410, "Seguimiento no disponible")
    return token


@router.post("/access")
def access(request: AccessRequest, user: dict = Depends(me)):
    token = _validated_access(request.journey_id, request.tutor_id, user,
                              request.destination.model_dump(mode="json") if request.destination else None,
                              [point.model_dump(mode="json") for point in request.planned_path])
    return {"token": token}


@router.post("/send-telegram")
def send_telegram(request: TelegramRequest, user: dict = Depends(me)):
    token = _validated_access(request.journey_id, request.tutor_id, user)
    current_access = get_access(token)
    if current_access is None:
        raise HTTPException(410, "Seguimiento no disponible")
    frontend_url = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
    if not frontend_url:
        raise HTTPException(502, "No se pudo enviar el enlace por Telegram.")
    monitor_url = frontend_url + "/?monitor=" + token
    destination = current_access["destination"]
    try:
        send_monitor_link(monitor_url=monitor_url,
                          destination=destination.get("name") if destination else None)
    except TelegramDeliveryError:
        raise HTTPException(502, "No se pudo enviar el enlace por Telegram.") from None
    return {"ok": True, "sent": True, "monitor_url": monitor_url}


@router.get("/{token}")
def monitor(token: str):
    access = get_access(token)
    if access is None:
        raise HTTPException(410, "Seguimiento no disponible")
    latest = get_latest_telemetry(access["journey_id"])
    payload = latest["payload"] if latest and isinstance(latest["payload"], dict) else {}
    # Un cierre durante la consulta SQL tampoco debe devolver la última ubicación.
    if get_access(token) is None:
        raise HTTPException(410, "Seguimiento no disponible")
    lat, lng = payload.get("latitude"), payload.get("longitude")
    position = None
    if (isinstance(lat, (int, float)) and isinstance(lng, (int, float))
            and isfinite(lat) and isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        position = {"lat": lat, "lng": lng}
    return {
        "journey_id": access["journey_id"],
        "destination": access["destination"],
        "planned_path": access["planned_path"],
        "current_position": position,
        "risk_score": latest["risk_score"] if latest else None,
        "risk_status": latest["risk_status"] if latest else get_last_risk_status(access["journey_id"]),
        "route_deviation_m": payload.get("route_deviation_m"),
        "network_status": payload.get("network_status"),
        "updated_at": payload.get("timestamp") or (latest["received_at"] if latest else None),
    }
