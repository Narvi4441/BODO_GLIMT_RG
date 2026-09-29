from typing import Literal
from pydantic import BaseModel, Field, model_validator

CommandName = Literal["SET_TELEMETRY_RATE", "REQUEST_CHECK_IN", "EMERGENCY_MODE", "NORMAL_MODE"]


class Command(BaseModel):
    command: CommandName
    interval_seconds: float | None = Field(default=None, ge=0.5, le=10)

    @model_validator(mode="after")
    def validate_interval(self):
        if self.command == "SET_TELEMETRY_RATE" and self.interval_seconds is None:
            raise ValueError("interval_seconds es obligatorio")
        return self


class Telemetry(BaseModel):
    node_id: Literal["NODE-A"]
    timestamp: float
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    speed_kmh: float = Field(ge=0)
    acceleration_ms2: float
    battery_percent: float = Field(ge=0, le=100)
    latency_ms: float = Field(ge=0)
    route_deviation_m: float = Field(ge=0)
    emergency: bool
    interval_seconds: float = Field(ge=0.5, le=10)
    sequence: int = Field(ge=1)


class Ack(BaseModel):
    node_id: Literal["NODE-A"]
    command_id: str
    command: CommandName
    status: Literal["EXECUTED", "REJECTED"]
    message: str
    timestamp: float
