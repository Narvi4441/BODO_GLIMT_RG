from datetime import datetime, timezone

from pydantic import BaseModel, Field


class TelemetryIn(BaseModel):
    journey_id: str
    user_id: str

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    accuracy: float | None = None
    speed: float | None = None
    heading: float | None = None
    battery: float | None = None

    latency_ms: float | None = None
    packet_loss: float | None = None
    network_status: str = "UNKNOWN"

    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )