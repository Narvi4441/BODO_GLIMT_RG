from pydantic import BaseModel


class CommandRequest(BaseModel):
    journey_id: str
    user_id: str
    action: str
    value: str | int | float | None = None


class CommandAckRequest(BaseModel):
    status: str
    message: str | None = None