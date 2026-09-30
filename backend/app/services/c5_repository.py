"""ARCHIVED C5 experiment; not imported by the API/runtime.

Retained as reference only. Active C5 lives in app.realtime.c5_service and reads
acompanamiento:cdmx:c5 / meta:camara:* directly. Do not run this rebuild/import flow.
"""
import json
import logging
from uuid import uuid4
from sqlalchemy import text
from redis.exceptions import RedisError
from app.core.database import get_engine
from app.core.cache import get_redis

logger = logging.getLogger(__name__)
GEO_KEY = "guardian:c5:geo"
READY_KEY = "guardian:c5:version"
IMPORT_LOCK = 714052  # Serializes C5 imports/rebuilds across workers.


def version(connection):
    row = connection.execute(text("SELECT count(*) AS count,max(updated_at) AS updated FROM infraestructura_c5")).mappings().one()
    return json.dumps([row["count"], row["updated"].isoformat() if row["updated"] else None])


def rebuild_cache():
    """Publish GEO only after all committed records were indexed; never FLUSHDB."""
    temporary = f"{GEO_KEY}:build:{uuid4()}"
    client = get_redis()
    count = 0
    try:
        with get_engine().begin() as connection:
            connection.execute(text("SELECT pg_advisory_xact_lock(:lock)"), {"lock": IMPORT_LOCK})
            current_version = version(connection)
            rows = connection.execute(text("SELECT * FROM infraestructura_c5 ORDER BY id")).mappings()
            pipe = client.pipeline(transaction=False)
            for row in rows:
                metadata = dict(row)
                metadata.pop("location", None)
                metadata["created_at"] = metadata["created_at"].isoformat()
                metadata["updated_at"] = metadata["updated_at"].isoformat()
                pipe.geoadd(temporary, (row["longitude"], row["latitude"], row["id"]))
                pipe.expire(temporary, 600)
                pipe.hset(f"guardian:c5:meta:{row['id']}", mapping={"data": json.dumps(metadata, ensure_ascii=False)})
                count += 1
                if count % 500 == 0:
                    pipe.execute()
            pipe.execute()
            publish = client.pipeline(transaction=True)
            if count:
                publish.rename(temporary, GEO_KEY)
                publish.persist(GEO_KEY)
            else:
                publish.delete(GEO_KEY)
            publish.set(READY_KEY, current_version)
            publish.execute()
        return count
    except RedisError as exc:
        logger.warning("C5 Redis rebuild failed (%s); infrastructure remains in PostgreSQL", type(exc).__name__)
        raise


def nearest(latitude, longitude, radius_m=1000):
    try:
        client = get_redis()
        with get_engine().connect() as connection:
            current_version = version(connection)
            expected_count = json.loads(current_version)[0]
        if client.get(READY_KEY) != current_version or client.zcard(GEO_KEY) != expected_count:
            rebuild_cache()
        hits = client.geosearch(GEO_KEY, longitude=longitude, latitude=latitude,
                               radius=radius_m, unit="m", sort="ASC", count=1, withdist=True)
        if hits:
            key, distance = hits[0]
            raw = client.hget(f"guardian:c5:meta:{key}", "data")
            if raw:
                return {"encontrado": True, "id_poste": key, "distancia_metros": round(distance, 2),
                        "metadata": json.loads(raw)}
            # An evicted hash is also reconstructable.
            rebuild_cache()
        elif expected_count == 0:
            return {"encontrado": False, "mensaje": "No hay infraestructura C5 importada"}
        else:
            return {"encontrado": False, "mensaje": "Sin infraestructura en el radio"}
    except (RedisError, ValueError, TypeError) as exc:
        logger.warning("C5 lookup using PostgreSQL fallback (%s)", type(exc).__name__)
    with get_engine().connect() as connection:
        row = connection.execute(text("""SELECT * FROM (
          SELECT id,source,direccion,esquina,colonia,alcaldia,poste,boton,altavoz,
            latitude,longitude,metadata,created_at,updated_at,
            6371000 * acos(least(1.0,greatest(-1.0,
              sin(radians(:lat))*sin(radians(latitude))+
              cos(radians(:lat))*cos(radians(latitude))*cos(radians(longitude-:lon))))) AS distance
          FROM infraestructura_c5
        ) nearby WHERE distance<=:radius ORDER BY distance,id LIMIT 1"""),
        {"lat": latitude, "lon": longitude, "radius": radius_m}).mappings().first()
        if not row:
            return {"encontrado": False, "mensaje": "Sin infraestructura en el radio"}
        metadata = dict(row)
        distance = metadata.pop("distance")
        for field in ("created_at", "updated_at"):
            metadata[field] = metadata[field].isoformat()
        return {"encontrado": True, "id_poste": row["id"], "distancia_metros": round(distance, 2), "metadata": metadata}
