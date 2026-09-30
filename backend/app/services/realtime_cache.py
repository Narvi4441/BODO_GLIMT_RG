"""Rebuildable snapshots derived exclusively from committed PostgreSQL rows."""
import logging
from redis.exceptions import RedisError
from app.core.cache import get_redis, write_json, CACHE_SECONDS
from app.services import state_repository as repository

logger = logging.getLogger(__name__)


def cache_command(command):
    if command:
        write_json(f"guardian:command:{command['command_id']}", command, command["updated_at"])
        # A cache failure never prevents the API from returning the committed ACK.
        cache_pending(command["journey_id"])
    return command


def cache_pending(journey_id):
    commands = repository.pending_commands(journey_id)
    try:
        key = f"guardian:journey:{journey_id}:pending_commands"
        pipe = get_redis().pipeline(transaction=True)
        pipe.delete(key)
        if commands:
            pipe.sadd(key, *[command["command_id"] for command in commands])
            pipe.expire(key, CACHE_SECONDS)
        pipe.execute()
    except RedisError as exc:
        logger.warning("Redis pending cache unavailable (%s); commands remain in PostgreSQL", type(exc).__name__)
    return commands


def refresh_journey(journey_id):
    journey = repository.get_journey(journey_id)
    if not journey:
        return None
    prefix = f"guardian:journey:{journey_id}"
    write_json(f"{prefix}:state", journey, journey["updated_at"])
    risk = repository.get_risk(journey_id)
    if risk:
        write_json(f"{prefix}:risk", risk, risk["updated_at"])
    location = repository.latest_location(journey_id)
    if location:
        # Order GPS locations by acquisition time, not by delayed offline arrival.
        write_json(f"{prefix}:location", location, location["timestamp"])
    # Individual command snapshots rebuild through get_command; do not rewrite
    # every outstanding command on each GPS packet (especially during an outage).
    cache_pending(journey_id)
    return journey
