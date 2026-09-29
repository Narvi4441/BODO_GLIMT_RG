from pydantic import BaseModel


class StartJourneyRequest(BaseModel):
    user_id: str