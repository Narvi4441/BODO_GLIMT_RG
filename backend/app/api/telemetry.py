from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.schemas.telemetry import TelemetryIn
from app.realtime.websocket import manager

from app.services.journey_state import get_journey
from app.services.risk import calculate_risk

from app.services.risk_state import (
    get_last_risk_status,
    set_risk_status,
)

from app.services.command_state import create_command
from app.services.telemetry_repository import save_telemetry


router = APIRouter(
    prefix="/api/telemetry",
    tags=["Telemetry"],
)


@router.post("")
async def receive_telemetry(
    telemetry: TelemetryIn,
    background_tasks: BackgroundTasks,
):
    # 1. Validar que el viaje exista
    journey = get_journey(
        telemetry.journey_id
    )

    if not journey:
        raise HTTPException(
            status_code=404,
            detail="Journey not found",
        )

    # 2. Validar que siga activo
    if journey["status"] != "ACTIVE":
        raise HTTPException(
            status_code=409,
            detail="Journey is not active",
        )

    # 3. Validar que corresponda al usuario
    if journey["user_id"] != telemetry.user_id:
        raise HTTPException(
            status_code=403,
            detail="User does not own this journey",
        )

    # 4. Convertir telemetría
    data = telemetry.model_dump(
        mode="json"
    )

    # 5. Calcular riesgo
    risk = calculate_risk(data)

    data["risk_score"] = risk["score"]
    data["risk_status"] = risk["status"]
    data["risk_reasons"] = risk["reasons"]

    background_tasks.add_task(save_telemetry, data.copy())

    # 6. Mandar telemetría por WebSocket
    await manager.broadcast(
        telemetry.journey_id,
        {
            "type": "telemetry",
            "data": data,
        },
    )

    # 7. Revisar el estado de riesgo anterior
    previous_status = get_last_risk_status(
        telemetry.journey_id
    )

    current_status = risk["status"]

    automatic_command = None

    # 8. Solo actuar si el nivel cambió
    if previous_status != current_status:

        if current_status == "PRECAUTION":
            automatic_command = create_command(
                journey_id=telemetry.journey_id,
                user_id=telemetry.user_id,
                action="SET_TELEMETRY_RATE",
                value=1,
            )

        elif current_status == "ALERT":
            automatic_command = create_command(
                journey_id=telemetry.journey_id,
                user_id=telemetry.user_id,
                action="REQUEST_CHECK_IN",
                value=None,
            )

        elif current_status == "CRITICAL":
            automatic_command = create_command(
                journey_id=telemetry.journey_id,
                user_id=telemetry.user_id,
                action="EMERGENCY_MODE",
                value=None,
            )

        elif (
            current_status == "NORMAL"
            and previous_status is not None
            and previous_status != "NORMAL"
        ):
            automatic_command = create_command(
                journey_id=telemetry.journey_id,
                user_id=telemetry.user_id,
                action="SET_TELEMETRY_RATE",
                value=5,
            )

    # 9. Si se generó teleproceso automático,
    # mandarlo al dispositivo
    if automatic_command:
        await manager.broadcast(
            telemetry.journey_id,
            {
                "type": "command",
                "data": automatic_command,
            },
        )

    # 10. Guardar nuevo estado de riesgo
    set_risk_status(
        telemetry.journey_id,
        current_status,
    )

    # 11. Respuesta
    return {
        "status": "accepted",
        "journey_id": telemetry.journey_id,
        "risk": risk,
        "automatic_command": automatic_command,
    }
