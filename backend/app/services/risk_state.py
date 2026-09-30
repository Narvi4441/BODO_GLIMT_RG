journey_risk_state: dict[str, str] = {}


def get_last_risk_status(
    journey_id: str,
) -> str | None:
    return journey_risk_state.get(
        journey_id
    )


def set_risk_status(
    journey_id: str,
    status: str,
):
    journey_risk_state[journey_id] = status
