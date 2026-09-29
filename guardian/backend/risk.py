from .models import Telemetry


def evaluate(t: Telemetry) -> dict:
    level = 0
    reasons = []
    rules = [
        (t.emergency, 3, "Modo de emergencia activado"),
        (t.route_deviation_m >= 250, 3, "Desviación de ruta ≥ 250 m"),
        (t.route_deviation_m >= 100, 2, "Desviación de ruta ≥ 100 m"),
        (abs(t.acceleration_ms2) >= 4, 2, "Aceleración brusca ≥ 4 m/s²"),
        (t.battery_percent <= 10, 2, "Batería ≤ 10%"),
        (t.route_deviation_m >= 30, 1, "Desviación de ruta ≥ 30 m"),
        (t.battery_percent <= 25, 1, "Batería ≤ 25%"),
        (t.latency_ms >= 300, 1, "Latencia simulada ≥ 300 ms"),
    ]
    for applies, severity, reason in rules:
        if applies:
            level = max(level, severity)
            reasons.append(reason)
    return {"state": ["NORMAL", "PRECAUTION", "ALERT", "CRITICAL"][level],
            "reasons": reasons or ["Telemetría dentro de parámetros"]}
