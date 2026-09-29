from fastapi import APIRouter, HTTPException

from app.schemas.telemetry import TelemetryIn
from app.realtime.websocket import manager
from app.services.journey_state import get_journey

router = APIRouter(
    prefix="/api/telemetry",
    tags=["Telemetry"]
)


@router.post("")
async def receive_telemetry(
    telemetry: TelemetryIn
):
    journey = get_journey(
        telemetry.journey_id
    )

    if not journey:
        raise HTTPException(
            status_code=404,
            detail="Journey not found"
        )

    if journey["status"] != "ACTIVE":
        raise HTTPException(
            status_code=409,
            detail="Journey is not active"
        )

    if journey["user_id"] != telemetry.user_id:
        raise HTTPException(
            status_code=403,
            detail="User does not own this journey"
        )

    data = telemetry.model_dump(
        mode="json"
    )

    await manager.broadcast(
        telemetry.journey_id,
        {
            "type": "telemetry",
            "data": data
        }
    )

    return {
        "status": "accepted",
        "journey_id": telemetry.journey_id
    }