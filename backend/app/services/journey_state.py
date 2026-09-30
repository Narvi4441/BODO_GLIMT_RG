"""Public journey API, backed by PostgreSQL and disposable Redis snapshots."""
from datetime import datetime, timezone
from app.core.cache import read_json, public_snapshot
from app.core.config import Config
from app.services import state_repository as repository
from app.services.realtime_cache import refresh_journey


def start_journey(user_id: str) -> dict:
    journey = repository.start(user_id)
    return refresh_journey(journey["journey_id"])


def stop_journey(journey_id: str) -> dict | None:
    journey = repository.stop(journey_id)
    return refresh_journey(journey_id) if journey else None


def get_journey(journey_id: str):
    if not repository.identifier(journey_id):
        return None
    cached = read_json(f"guardian:journey:{journey_id}:state")
    if cached:
        last = cached.get("last_telemetry_at")
        stale_online = cached.get("online") and (not last or
            (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds()
            > Config.TELEMETRY_OFFLINE_TIMEOUT_SECONDS)
        if not stale_online:
            return public_snapshot(cached)
    return refresh_journey(journey_id)
