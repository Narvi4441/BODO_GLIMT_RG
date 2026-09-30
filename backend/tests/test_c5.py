"""C5 contract and read-only checks against the existing Redis; never seed data."""
import math
import sys

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import RedisError
from sqlalchemy.engine import Engine

from app.main import app
from app.realtime.c5_service import GEO_KEY, METADATA_PREFIX, coordinate, get_c5_redis

# Actual hash excerpt supplied by the user, not a fabricated Redis catalogue.
REPORTED_HASH = {
    "id": "CAM-08705", "direccion": "N/A", "esquina": "C. ESTADO DE SINALOA",
    "colonia": "PROVIDENCIA", "alcaldia": "GUSTAVO A. MADERO", "poste": "9m",
    "boton": "SIN BOTON", "altavoz": "CON ALTAVOZ", "lat": "19.483051", "lon": "-99.073564",
}


def forbid_postgresql(*args, **kwargs):
    raise AssertionError("C5 must never open a PostgreSQL connection")


def test_coordinate_aliases_from_user_supplied_hash():
    original = REPORTED_HASH.copy()
    assert coordinate(original, ("latitude", "lat"), None, 90) == 19.483051
    assert coordinate(original, ("longitude", "lon"), None, 180) == -99.073564
    assert original == REPORTED_HASH


def test_endpoint_independent_of_postgresql(monkeypatch):
    monkeypatch.setattr(Engine, "connect", forbid_postgresql)
    assert "app.services.c5_repository" not in sys.modules
    with TestClient(app) as client:
        response = client.get("/api/c5/nearest", params={
            "latitude": REPORTED_HASH["lat"], "longitude": REPORTED_HASH["lon"], "limit": 5,
        })
    # An unavailable real Redis is reported honestly, never replaced by invented results.
    if response.status_code == 503:
        assert response.json()["detail"] == "Redis C5 no disponible. Verifica C5_REDIS_URL."
    else:
        assert response.status_code == 200
        assert isinstance(response.json()["results"], list)


@pytest.mark.parametrize("field,value", [("latitude", 90), ("longitude", 181),
                                        ("radius_m", 0), ("limit", 0), ("limit", 101)])
def test_invalid_query_does_not_access_storage(monkeypatch, field, value):
    monkeypatch.setattr(Engine, "connect", forbid_postgresql)
    params = {"latitude": REPORTED_HASH["lat"], "longitude": REPORTED_HASH["lon"]}
    params[field] = value
    with TestClient(app) as client:
        assert client.get("/api/c5/nearest", params=params).status_code == 422


def test_existing_c5_catalogue_metadata_sort_and_distance(monkeypatch):
    monkeypatch.setattr(Engine, "connect", forbid_postgresql)
    redis = get_c5_redis()
    try:
        redis.ping()
        count = redis.zcard(GEO_KEY)
        if not count:
            pytest.skip("Existing C5 GEOSET is empty; no records are created by this test")
        member = next(redis.zscan_iter(GEO_KEY, match="CAM-*", count=100), None)
        if member is None:
            pytest.skip("Existing C5 GEOSET has no CAM-* IDs")
        identity = member[0]
        metadata = redis.hgetall(f"{METADATA_PREFIX}{identity}")
        position = redis.geopos(GEO_KEY, identity)[0]
    except RedisError as exc:
        pytest.skip(f"Existing C5 Redis unavailable: {type(exc).__name__}")

    assert metadata, "Existing GEO member has no metadata hash"
    lon, lat = position
    with TestClient(app) as client:
        response = client.get("/api/c5/nearest", params={"latitude": lat, "longitude": lon,
                                                       "radius_m": 1000, "limit": 5})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["encontrado"]
    results = data["results"]
    assert 1 <= len(results) <= 5
    distances = [row["distance_m"] for row in results]
    assert distances == sorted(distances)
    assert distances[0] < 1
    for result in results:
        key = result["id"]
        assert key.startswith("CAM-")
        original = redis.hgetall(f"{METADATA_PREFIX}{key}")
        for field in ("direccion", "esquina", "colonia", "alcaldia", "poste", "boton", "altavoz", "lat", "lon"):
            if field in original:
                assert result[field] == original[field]
        target_lon, target_lat = redis.geopos(GEO_KEY, key)[0]
        a = (math.sin(math.radians(target_lat-lat)/2)**2
             + math.cos(math.radians(lat))*math.cos(math.radians(target_lat))
             * math.sin(math.radians(target_lon-lon)/2)**2)
        expected = 6371000 * 2 * math.asin(math.sqrt(min(1, a)))
        # Redis uses a slightly different spherical Earth radius; allow 0.1% / 1 m.
        assert math.isclose(result["distance_m"], expected, rel_tol=0.001, abs_tol=1)
        assert result["distance_m"] <= 1000
    assert data["metadata"] == redis.hgetall(f"{METADATA_PREFIX}{data['id_poste']}")
