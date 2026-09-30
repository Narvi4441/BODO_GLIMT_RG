"""Optional PostgreSQL copies of journeys; RAM remains the operational state."""
from datetime import datetime

from sqlalchemy import text

from app.core.database import get_engine


def save_journey(journey: dict) -> None:
    values = {
        "journey_id": journey["journey_id"],
        "id_usuario": int(journey["user_id"]),
        "status": journey["status"],
        "started_at": datetime.fromisoformat(journey["started_at"]),
        "ended_at": datetime.fromisoformat(journey["ended_at"]) if journey["ended_at"] else None,
    }
    with get_engine().begin() as connection:
        connection.execute(text("""
            INSERT INTO viajes (journey_id, id_usuario, status, started_at, ended_at)
            VALUES (:journey_id, :id_usuario, :status, :started_at, :ended_at)
        """), values)


def update_journey(journey: dict) -> None:
    values = {
        "journey_id": journey["journey_id"],
        "status": journey["status"],
        "ended_at": datetime.fromisoformat(journey["ended_at"]) if journey["ended_at"] else None,
    }
    with get_engine().begin() as connection:
        connection.execute(text("""
            UPDATE viajes SET status = :status, ended_at = :ended_at
            WHERE journey_id = :journey_id
        """), values)
