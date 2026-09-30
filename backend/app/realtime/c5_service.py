"""Read-only access to the original C5 GEOSET and metadata hashes (Redis DB 5)."""
import math
from functools import lru_cache

from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import ResponseError
from redis.retry import Retry
from app.core.config import Config

GEO_KEY = "acompanamiento:cdmx:c5"
METADATA_PREFIX = "meta:camara:"


@lru_cache(maxsize=1)
def get_c5_redis():
    return Redis.from_url(Config.C5_REDIS_URL, decode_responses=True,
                          socket_connect_timeout=2, socket_timeout=2,
                          retry=Retry(NoBackoff(), 0))


def coordinate(metadata, names, fallback, bound):
    for name in names:
        try:
            value = float(metadata[name])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(value) and -bound <= value <= bound:
            return value
    # WITHCOORD reads the actual GEOSET position; never manufacture a coordinate.
    return fallback


class GeoC5Service:
    def __init__(self):
        self.r = get_c5_redis()
        self.geo_key = GEO_KEY

    def localizar_infraestructura_cercana(self, lat_usuario, lon_usuario, radio_metros=1000, limite=1):
        if not (-85.05112878 <= lat_usuario <= 85.05112878 and -180 <= lon_usuario <= 180):
            raise ValueError("Coordenadas fuera del rango de Redis GEO")
        if not math.isfinite(radio_metros) or radio_metros <= 0 or not 1 <= limite <= 100:
            raise ValueError("Radio o límite C5 inválido")
        try:
            hits = self.r.geosearch(self.geo_key, longitude=lon_usuario, latitude=lat_usuario,
                                   radius=radio_metros, unit="m", sort="ASC", count=limite,
                                   withdist=True, withcoord=True)
        except ResponseError as exc:
            # The original MotorTelemetria used GEORADIUS; retain older Redis support.
            if "unknown command" not in str(exc).lower() or "geosearch" not in str(exc).lower():
                raise
            hits = self.r.georadius(self.geo_key, lon_usuario, lat_usuario, radio_metros,
                                   unit="m", sort="ASC", count=limite, withdist=True, withcoord=True)
        if not hits:
            return {"encontrado": False, "results": [], "mensaje": "Sin infraestructura en el radio"}

        # Non-transactional pipeline contains HGETALL only; no cache rebuild/writes.
        pipe = self.r.pipeline(transaction=False)
        for identity, _, _ in hits:
            pipe.hgetall(f"{METADATA_PREFIX}{identity}")
        metadata_rows = pipe.execute()
        results = []
        for (identity, distance, (lon, lat)), metadata in zip(hits, metadata_rows):
            results.append({**metadata, "id": identity, "distance_m": round(distance, 4),
                            "latitude": coordinate(metadata, ("latitude", "lat", "latitud"), lat, 90),
                            "longitude": coordinate(metadata, ("longitude", "lon", "longitud"), lon, 180)})
        # Keep the previous nearest-result contract used by MotorTelemetria,
        # and expose every requested result, preserving metadata without NULL fillers.
        first = results[0]
        return {"encontrado": True, "results": results, "id_poste": first["id"],
                "distancia_metros": first["distance_m"], "metadata": metadata_rows[0]}
