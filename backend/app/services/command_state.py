from datetime import datetime, timezone
from uuid import uuid4
import logging

from app.services.command_repository import save_command, update_command

logger = logging.getLogger(__name__)


commands: dict[str, dict] = {}


def create_command(
    journey_id: str,
    user_id: str,
    action: str,
    value=None,
):
    command_id = str(uuid4())

    command = {
        "command_id": command_id,
        "journey_id": journey_id,
        "user_id": user_id,
        "action": action,
        "value": value,
        "status": "SENT",
        "created_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }

    commands[command_id] = command

    try:
        save_command(command.copy())
    except Exception as error:
        logger.warning("save_command command_id=%s error=%s", command_id, type(error).__name__)

    return command


def get_command(command_id: str):
    return commands.get(command_id)


def update_command_status(
    command_id: str,
    status: str,
    message: str | None = None,
):
    command = commands.get(command_id)

    if not command:
        return None

    command["status"] = status
    command["message"] = message

    try:
        update_command(command.copy())
    except Exception as error:
        logger.warning("update_command command_id=%s error=%s", command_id, type(error).__name__)

    return command
