def calculate_risk(data: dict) -> dict:
    score = 0
    reasons = []

    route_deviation = data.get("route_deviation_m") or 0
    latency = data.get("latency_ms") or 0
    packet_loss = data.get("packet_loss") or 0
    accuracy = data.get("accuracy") or 0
    network_status = data.get("network_status", "UNKNOWN")

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