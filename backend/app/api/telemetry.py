from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool
from app.schemas.telemetry import TelemetryIn
from app.realtime.websocket import manager
from app.services.risk import calculate_risk
from app.services.state_repository import record_telemetry
from app.services.realtime_cache import refresh_journey, cache_command

router = APIRouter(prefix="/api/telemetry", tags=["Telemetry"])


def persist(data, risk):
    command = record_telemetry(data, risk)
    refresh_journey(data["journey_id"])
    if command:
        cache_command(command)
    return command


@router.post("")
async def receive_telemetry(telemetry: TelemetryIn):
    data = telemetry.model_dump(mode="json")
    risk = calculate_risk(data)
    data.update(risk_score=risk["score"], risk_status=risk["status"], risk_reasons=risk["reasons"])
    # Ownership/activity are revalidated under a PostgreSQL row lock.
    # Commit everything before notifying clients: a restart cannot lose the command.
    automatic_command = await run_in_threadpool(persist, data, risk)
    await manager.broadcast(telemetry.journey_id, {"type": "telemetry", "data": data})
    if automatic_command:
        await manager.broadcast(telemetry.journey_id, {"type": "command", "data": automatic_command})
    return {"status": "accepted", "journey_id": telemetry.journey_id,
            "risk": risk, "automatic_command": automatic_command}
