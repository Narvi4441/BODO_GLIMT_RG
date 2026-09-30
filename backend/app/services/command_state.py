"""Compatible command functions without process-local business state."""
from app.core.cache import read_json, public_snapshot
from app.services import state_repository as repository
from app.services.realtime_cache import cache_command


def create_command(journey_id: str, user_id: str, action: str, value=None):
    return cache_command(repository.create_command(journey_id, user_id, action, value))


def get_command(command_id: str):
    if not repository.identifier(command_id):
        return None
    cached = read_json(f"guardian:command:{command_id}")
    if cached:
        return public_snapshot(cached)
    return cache_command(repository.get_command(command_id))


def update_command_status(command_id: str, status: str, message: str | None = None):
    return cache_command(repository.update_command(command_id, status, message))
