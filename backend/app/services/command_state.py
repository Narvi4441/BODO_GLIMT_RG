from datetime import datetime, timezone
from uuid import uuid4


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

    return command
