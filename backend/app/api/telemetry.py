from fastapi import APIRouter

from app.schemas.telemetry import TelemetryIn
from app.realtime.websocket import manager


router = APIRouter(
    prefix="/api/telemetry",
    tags=["Telemetry"]
)


@router.post("")
async def receive_telemetry(
    telemetry: TelemetryIn
):
    # Convertimos los datos recibidos
    data = telemetry.model_dump(
        mode="json"
    )

    # Los enviamos en tiempo real por WebSocket
    await manager.broadcast(
        telemetry.journey_id,
        {
            "type": "telemetry",
            "data": data
        }
    )

    # Confirmamos al dispositivo que recibimos la telemetría
    return {
        "status": "accepted",
        "journey_id": telemetry.journey_id
    }