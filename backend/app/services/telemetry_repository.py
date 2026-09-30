"""Best-effort telemetry persistence after the HTTP response is sent."""
import logging

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import get_engine

logger = logging.getLogger(__name__)


def get_latest_telemetry(journey_id: str) -> dict | None:
    """Solo lectura, limitada al Journey autorizado por Monitor."""
    with get_engine().connect() as connection:
        row = connection.execute(text("""
            SELECT payload, risk_score, risk_status, received_at
            FROM telemetria
            WHERE journey_id = :journey_id
            ORDER BY (payload->>'timestamp')::timestamptz DESC NULLS LAST,
                     received_at DESC, id_telemetria DESC
            LIMIT 1
        """), {"journey_id": journey_id}).mappings().first()
    return dict(row) if row else None


def save_telemetry(payload: dict) -> None:
    try:
        statement = text("""
            INSERT INTO telemetria (journey_id, payload, risk_score, risk_status)
            VALUES (:journey_id, :payload, :risk_score, :risk_status)
        """).bindparams(bindparam("payload", type_=JSONB))
        with get_engine().begin() as connection:
            connection.execute(statement, {
                "journey_id": payload["journey_id"],
                "payload": payload,
                "risk_score": payload["risk_score"],
                "risk_status": payload["risk_status"],
            })
    except Exception as error:
        # Discard only this optional write; never retry or modify operational state.
        logger.warning("Telemetry persistence failed: %s", type(error).__name__)
