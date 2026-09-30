"""Optional command and ACK persistence; operational state remains in RAM."""
from datetime import datetime

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import get_engine


def save_command(command: dict) -> None:
    values = {
        "command_id": command["command_id"],
        "journey_id": command["journey_id"],
        "id_usuario": int(command["user_id"]),
        "action": command["action"],
        "value": command["value"],
        "status": command["status"],
        "created_at": datetime.fromisoformat(command["created_at"]),
    }
    statement = text("""
        INSERT INTO comandos
            (command_id, journey_id, id_usuario, action, value, status, message, created_at)
        VALUES
            (:command_id, :journey_id, :id_usuario, :action, :value, :status, NULL, :created_at)
    """).bindparams(bindparam("value", type_=JSONB(none_as_null=True)))
    with get_engine().begin() as connection:
        connection.execute(statement, values)
        save_command_event(connection, command["command_id"], "SENT", None)


def update_command(command: dict) -> None:
    with get_engine().begin() as connection:
        connection.execute(text("""
            UPDATE comandos SET status = :status, message = :message
            WHERE command_id = :command_id
        """), {
            "command_id": command["command_id"],
            "status": command["status"],
            "message": command["message"],
        })
        save_command_event(connection, command["command_id"], command["status"], command["message"])


def save_command_event(connection, command_id: str, status: str, message: str | None) -> None:
    connection.execute(text("""
        INSERT INTO command_eventos (command_id, status, message)
        VALUES (:command_id, :status, :message)
    """), {"command_id": command_id, "status": status, "message": message})
