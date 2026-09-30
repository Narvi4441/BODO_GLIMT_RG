"""Disposable Redis snapshots. A failed cache must never undo a PostgreSQL commit."""
import json
import logging
from functools import lru_cache

from redis import Redis
from redis.exceptions import RedisError
from redis.backoff import NoBackoff
from redis.retry import Retry
from app.core.config import Config

logger = logging.getLogger(__name__)
CACHE_SECONDS = 30


@lru_cache(maxsize=1)
def get_redis():
    return Redis.from_url(Config.REDIS_URL, decode_responses=True,
                          socket_connect_timeout=1, socket_timeout=1,
                          retry_on_timeout=False, retry=Retry(NoBackoff(), 0))


def read_json(key):
    try:
        value = get_redis().get(key)
        decoded = json.loads(value) if value else None
        if decoded is not None and not isinstance(decoded, dict):
            raise ValueError("Invalid cache snapshot")
        return decoded
    except (RedisError, ValueError, TypeError) as exc:
        logger.warning("Redis cache read failed (%s); using PostgreSQL", type(exc).__name__)
        return None


def write_json(key, value, version):
    # Compare versions atomically: a delayed worker cannot overwrite a newer snapshot.
    # Fixed-width UTC ISO timestamps sort chronologically.
    snapshot = {**value, "_cache_version": version}
    try:
        get_redis().eval("""
          local old = redis.call('GET', KEYS[1])
          if old then
            local ok, decoded = pcall(cjson.decode, old)
            if ok and decoded['_cache_version'] and decoded['_cache_version'] > ARGV[2] then
              return 0
            end
          end
          redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
          return 1
        """, 1, key, json.dumps(snapshot, ensure_ascii=False), version, CACHE_SECONDS)
        return True
    except RedisError as exc:
        logger.warning("Redis cache write failed (%s); PostgreSQL commit preserved", type(exc).__name__)
        return False


def public_snapshot(value):
    return {k: v for k, v in value.items() if not k.startswith('_cache_')}
