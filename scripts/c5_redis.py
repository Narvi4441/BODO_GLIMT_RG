"""Inspect the existing C5 Redis without imports, deletions or writes.

The original loader/field mapping is preserved in Git commit a2fbac3.
It used DB 5, acompanamiento:cdmx:c5 and meta:camara:{id}.
This entry point no longer runs either loader: the existing catalogue is reused.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from redis.exceptions import RedisError
from app.realtime.c5_service import GeoC5Service, get_c5_redis, GEO_KEY


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latitude", type=float)
    parser.add_argument("--longitude", type=float)
    parser.add_argument("--radius-m", type=float, default=1000)
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    if (args.latitude is None) != (args.longitude is None):
        parser.error("Proporciona latitude y longitude juntas")
    try:
        client = get_c5_redis()
        print(json.dumps({"geo_key": GEO_KEY, "db": client.connection_pool.connection_kwargs.get("db", 0),
                          "elementos": client.zcard(GEO_KEY)}, ensure_ascii=False))
        if args.latitude is not None:
            result = GeoC5Service().localizar_infraestructura_cercana(
                args.latitude, args.longitude, args.radius_m, args.limit)
            print(json.dumps(result, ensure_ascii=False, indent=2))
    except (RedisError, ValueError) as exc:
        print(f"Consulta C5 no disponible: {type(exc).__name__}. Verifica C5_REDIS_URL.", file=sys.stderr)
        raise SystemExit(1)

if __name__ == "__main__":
    main()
