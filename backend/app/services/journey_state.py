from datetime import datetime, timezone
from uuid import uuid4


active_journeys: dict[str, dict] = {}


def start_journey(user_id: str) -> dict:
    journey_id = str(uuid4())

    journey = {
        "journey_id": journey_id,
        "user_id": user_id,
        "status": "ACTIVE",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "ended_at": None,
    }

    active_journeys[journey_id] = journey

    return journey


def stop_journey(journey_id: str) -> dict | None:
    journey = active_journeys.get(journey_id)

    if not journey:
        return None

    journey["status"] = "COMPLETED"
    journey["ended_at"] = datetime.now(timezone.utc).isoformat()

    return journey


def get_journey(journey_id: str):
    return active_journeys.get(journey_id)
