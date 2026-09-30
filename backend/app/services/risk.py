from collections import deque
from datetime import datetime, timezone
from math import isfinite
from statistics import median
from threading import RLock
from time import monotonic


# Estado operativo acotado en RAM. No altera el payload ni persiste muestras.
_motion: dict[str, dict] = {}
_motion_lock = RLock()


def _state(journey_id: str) -> dict:
    now = monotonic()
    for key in list(_motion):
        if now - _motion[key]["seen"] > 86400:
            del _motion[key]
    state = _motion.setdefault(journey_id, {
        "samples": deque(maxlen=6), "last": None, "fast": 0,
        "walking": False, "incident": False, "confirmed": 0,
        "recovery": [], "panic": False, "seen": now,
    })
    state["seen"] = now
    return state


def mark_panic(journey_id: str) -> bool:
    with _motion_lock:
        state = _state(journey_id)
        if state["panic"]:
            return False
        state["panic"] = True
        return True


def panic_active(journey_id: str) -> bool:
    with _motion_lock:
        return bool(_motion.get(journey_id, {}).get("panic"))


def _speed_incident(data: dict) -> bool:
    journey_id = data.get("journey_id")
    if not journey_id:
        return False
    with _motion_lock:
        state = _state(journey_id)
        speed, accuracy = data.get("speed"), data.get("accuracy")
        try:
            timestamp = datetime.fromisoformat(str(data["timestamp"]).replace("Z", "+00:00")).timestamp()
            age = datetime.now(timezone.utc).timestamp() - timestamp
            valid = (type(speed) in (int, float) and isfinite(speed) and speed >= 0
                     and type(accuracy) in (int, float) and isfinite(accuracy) and 0 <= accuracy <= 50
                     and -5 <= age <= 60)
        except (KeyError, ValueError, TypeError, OverflowError):
            valid = False
        if not valid:
            state["fast"] = 0
            state["walking"] = False
            state["samples"].clear()
            state["recovery"].clear()
            return state["incident"]
        # Reenvíos offline/duplicados no cuentan como muestras consecutivas nuevas.
        if state["last"] is not None and timestamp <= state["last"]:
            return state["incident"]
        if state["last"] is not None and timestamp - state["last"] > 15:
            state["samples"].clear()
            state["fast"] = 0
            state["walking"] = False
            state["recovery"].clear()
        state["last"] = timestamp
        recent = [(t, v) for t, v in state["samples"] if timestamp - t <= 30]
        if speed >= 5:
            if state["fast"] == 0:
                state["walking"] = len(recent) >= 3 and median(v for _, v in recent) <= 2.5
            state["fast"] += 1
            state["recovery"].clear()
            if state["walking"] and state["fast"] >= 2 and not state["incident"]:
                state["incident"] = True
                state["confirmed"] = timestamp
        else:
            state["fast"] = 0
            state["walking"] = False
            if speed <= 2.5:
                state["recovery"].append(timestamp)
                state["recovery"] = state["recovery"][-6:]
                if (state["incident"] and timestamp - state["confirmed"] >= 30
                        and len(state["recovery"]) >= 3
                        and timestamp - state["recovery"][0] >= 15):
                    state["incident"] = False
            else:
                state["recovery"].clear()
        state["samples"].append((timestamp, speed))
        return state["incident"]


def calculate_risk(data: dict) -> dict:
    score = 0
    reasons = []

    route_deviation = data.get("route_deviation_m") or 0
    latency = data.get("latency_ms") or 0
    packet_loss = data.get("packet_loss") or 0
    accuracy = data.get("accuracy") or 0
    network_status = data.get("network_status", "UNKNOWN")

    if route_deviation > 40:
        reasons.append("Route deviation over 40 meters")

    if route_deviation > 100:
        score += 20
        reasons.append("Route deviation detected")

    if route_deviation > 300:
        score += 20
        reasons.append("Significant route deviation")

    if latency > 500:
        score += 10
        reasons.append("High network latency")

    if packet_loss > 20:
        score += 15
        reasons.append("High packet loss")

    if accuracy > 100:
        score += 10
        reasons.append("Low GPS accuracy")

    if network_status in {"DEGRADED", "OFFLINE"}:
        score += 15
        reasons.append("Network degraded")

    score = min(score, 100)

    if route_deviation > 300:
        score = max(score, 75)
    elif route_deviation > 100:
        score = max(score, 50)
    elif route_deviation > 40:
        score = max(score, 25)

    if _speed_incident(data):
        score = max(score, 75)
        reasons.insert(0, "SUDDEN_SPEED_INCREASE")
    if panic_active(data.get("journey_id", "")):
        score = max(score, 75)
        reasons.insert(0, "USER_REQUESTED_HELP")

    if score < 25:
        status = "NORMAL"
    elif score < 50:
        status = "PRECAUTION"
    elif score < 75:
        status = "ALERT"
    else:
        status = "CRITICAL"

    return {
        "score": score,
        "status": status,
        "reasons": reasons,
    }
