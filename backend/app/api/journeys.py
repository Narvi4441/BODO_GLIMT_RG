from fastapi import APIRouter, HTTPException

from app.schemas.journey import StartJourneyRequest
from app.services.journey_state import (
    start_journey,
    stop_journey,
    get_journey,
)


router = APIRouter(
    prefix="/api/journeys",
    tags=["Journeys"],
)


@router.post("/start")
def start(request: StartJourneyRequest):
    return start_journey(request.user_id)


@router.post("/{journey_id}/stop")
def stop(journey_id: str):
    journey = stop_journey(journey_id)

    if not journey:
        raise HTTPException(
            status_code=404,
            detail="Journey not found",
        )

    return journey


@router.get("/{journey_id}")
def status(journey_id: str):
    journey = get_journey(journey_id)

    if not journey:
        raise HTTPException(
            status_code=404,
            detail="Journey not found",
        )

    return journey