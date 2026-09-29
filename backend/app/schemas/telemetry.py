from datetime import datetime, timezone

from pydantic import BaseModel, Field


class TelemetryIn(BaseModel):
    journey_id: str
    user_id: str

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    accuracy: float | None = Field(default=None, ge=0)
    speed: float | None = Field(default=None, ge=0)
    heading: float | None = Field(default=None, ge=0, le=360)
    battery: float | None = Field(default=None, ge=0, le=100)

    latency_ms: float | None = Field(default=None, ge=0)
    packet_loss: float | None = Field(default=None, ge=0, le=100)

    network_status: str = "UNKNOWN"

    route_deviation_m: float | None = Field(
        default=None,
        ge=0,
    )

    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )