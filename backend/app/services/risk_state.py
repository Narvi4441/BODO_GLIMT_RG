"""Risk cache with durable telemetry/event fallback; no scoring rules here."""
from app.core.cache import read_json, write_json
from app.services import state_repository as repository


def get_last_risk_status(journey_id: str) -> str | None:
    if not repository.identifier(journey_id):
        return None
    key = f"guardian:journey:{journey_id}:risk"
    risk = read_json(key)
    if not risk:
        risk = repository.get_risk(journey_id)
        if risk:
            write_json(key, risk, risk["updated_at"])
    return risk["status"] if risk else None


def set_risk_status(journey_id: str, status: str):
    risk = repository.set_risk(journey_id, status)
    write_json(f"guardian:journey:{journey_id}:risk", risk, risk["updated_at"])
