"""Accesos temporales en RAM; nunca persiste tokens ni duplica telemetría."""
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from threading import RLock
from time import monotonic

from app.services.journey_state import get_journey


_accesses: dict[str, dict] = {}
_lock = RLock()
_lifetime = timedelta(hours=24)
_critical: dict[str, dict] = {}


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


def get_or_create_access(journey_id: str, user_id: str, tutor_id: int,
                         destination: dict | None = None,
                         planned_path: list[dict] | None = None) -> str | None:
    with _lock:
        now = datetime.now(timezone.utc)
        for token in list(_accesses):
            access = _accesses[token]
            if not _active(access, now):
                del _accesses[token]
                continue
            if (access["journey_id"], access["user_id"], access["tutor_id"]) == (journey_id, user_id, tutor_id):
                # Actualizar el plan compartido no renueva la vigencia del enlace.
                if destination is not None:
                    access["destination"] = destination
                if planned_path is not None:
                    access["planned_path"] = planned_path
                return token
        return create_access(journey_id, user_id, tutor_id, destination, planned_path or [])


def get_access(token: str) -> dict | None:
    with _lock:
        access = _accesses.get(token)
        if access is None:
            return None
        if not _active(access, datetime.now(timezone.utc)):
            del _accesses[token]
            return None
        return access.copy()


def journey_access(journey_id: str, user_id: str) -> tuple[str, dict] | None:
    with _lock:
        for token in reversed(list(_accesses)):
            access = get_access(token)
            if access and access["journey_id"] == journey_id and access["user_id"] == user_id:
                return token, access
    return None


def remember_name(token: str, name: str | None):
    with _lock:
        if token in _accesses and name:
            _accesses[token]["user_name"] = name


def critical_transition(journey_id: str, status: str, reason: str = "") -> bool:
    """Reservar una alerta antes de cualquier await/envío; no reintentar por tick."""
    with _lock:
        for key in list(_critical):
            journey = get_journey(key)
            if not journey or journey["status"] != "ACTIVE":
                del _critical[key]
        previous = _critical.get(journey_id, {})
        armed = previous.get("armed", True)
        stable_since = previous.get("stable_since")
        stable_samples = previous.get("stable_samples", 0)
        if status != "CRITICAL":
            stable_since = stable_since if stable_since is not None else monotonic()
            stable_samples += 1
            if stable_samples >= 3 and monotonic() - stable_since >= 15:
                armed = True
        else:
            stable_since, stable_samples = None, 0
        changed = status == "CRITICAL" and armed
        _critical[journey_id] = {
            "status": status, "lastCriticalReason": reason if changed else previous.get("lastCriticalReason"),
            "lastCriticalAlertAt": datetime.now(timezone.utc) if changed else previous.get("lastCriticalAlertAt"),
            "armed": False if changed else armed, "stable_since": stable_since, "stable_samples": stable_samples,
        }
        return changed
