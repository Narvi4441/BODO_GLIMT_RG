from fastapi import APIRouter, HTTPException
import logging

from app.schemas.journey import StartJourneyRequest
from app.services.journey_repository import save_journey, update_journey
from app.services.journey_state import (
    start_journey,
    stop_journey,
    get_journey,
)


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/journeys",
    tags=["Journeys"],
)


@router.post("/start")
def start(request: StartJourneyRequest):
    journey = start_journey(request.user_id)
    try:
        save_journey(journey)
    except Exception as error:
        # Persistence is optional; keep the operational journey in RAM.
        logger.warning("Journey persistence failed on start: %s", type(error).__name__)
    return journey


@router.post("/{journey_id}/stop")
def stop(journey_id: str):
    journey = stop_journey(journey_id)

    if not journey:
        raise HTTPException(
            status_code=404,
            detail="Journey not found",
        )

    try:
        update_journey(journey)
    except Exception as error:
        logger.warning("Journey persistence failed on stop: %s", type(error).__name__)
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
