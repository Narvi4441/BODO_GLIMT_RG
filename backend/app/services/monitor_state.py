"""Accesos temporales en RAM; nunca persiste tokens ni duplica telemetría."""
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from threading import RLock

from app.services.journey_state import get_journey


_accesses: dict[str, dict] = {}
_lock = RLock()
_lifetime = timedelta(hours=24)


def _active(access: dict, now: datetime) -> bool:
    if now >= access["created_at"] + _lifetime:
        return False
    journey = get_journey(access["journey_id"])
    return bool(journey and journey["status"] == "ACTIVE"
                and journey["user_id"] == access["user_id"])


def create_access(journey_id: str, user_id: str, tutor_id: int,
                  destination: dict | None, planned_path: list[dict]) -> str | None:
    now = datetime.now(timezone.utc)
    access = {"journey_id": journey_id, "user_id": user_id, "tutor_id": tutor_id,
              "destination": destination, "planned_path": planned_path, "created_at": now}
    with _lock:
        for key in list(_accesses):
            if not _active(_accesses[key], now):
                del _accesses[key]
        if not _active(access, now):
            return None
        token = token_urlsafe(32)
        while token in _accesses:
            token = token_urlsafe(32)
        _accesses[token] = access
        return token


def get_access(token: str) -> dict | None:
    with _lock:
        access = _accesses.get(token)
        if access is None:
            return None
        if not _active(access, datetime.now(timezone.utc)):
            del _accesses[token]
            return None
        return access.copy()
