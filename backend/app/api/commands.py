from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter, HTTPException

from app.schemas.command import (
    CommandRequest,
    CommandAckRequest,
)

from app.services.command_state import (
    create_command,
    update_command_status,
)

from app.services.journey_state import get_journey
from app.realtime.websocket import manager


router = APIRouter(
    prefix="/api/commands",
    tags=["Commands"],
)


@router.post("")
async def send_command(
    request: CommandRequest,
):
    journey = await run_in_threadpool(get_journey, request.journey_id)

    if not journey:
        raise HTTPException(
            status_code=404,
            detail="Journey not found",
        )

    if journey["status"] != "ACTIVE":
        raise HTTPException(
            status_code=409,
            detail="Journey is not active",
        )

    if journey["user_id"] != request.user_id:
        raise HTTPException(
            status_code=403,
            detail="User does not own this journey",
        )

    command = await run_in_threadpool(create_command,
        journey_id=request.journey_id,
        user_id=request.user_id,
        action=request.action,
        value=request.value,
    )

    await manager.broadcast(
        request.journey_id,
        {
            "type": "command",
            "data": command,
        },
    )

    return command


@router.post("/{command_id}/ack")
async def command_ack(
    command_id: str,
    ack: CommandAckRequest,
):
    allowed_status = {
        "RECEIVED",
        "EXECUTING",
        "EXECUTED",
        "FAILED",
    }

    if ack.status not in allowed_status:
        raise HTTPException(
            status_code=400,
            detail="Invalid ACK status",
        )

    command = await run_in_threadpool(update_command_status,
        command_id=command_id,
        status=ack.status,
        message=ack.message,
    )

    if not command:
        raise HTTPException(
            status_code=404,
            detail="Command not found",
        )

    await manager.broadcast(
        command["journey_id"],
        {
            "type": "command_ack",
            "data": command,
        },
    )

    return command