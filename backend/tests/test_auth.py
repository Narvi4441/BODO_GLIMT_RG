from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import pytest
from sqlalchemy import text
from app.core.passwords import verify_password


def counts(database):
    with database.connect() as connection:
        return connection.execute(text("""
            SELECT (SELECT count(*) FROM usuarios), (SELECT count(*) FROM tutores),
                   (SELECT count(*) FROM usuarios_tutores)
        """)).one()


def test_registration_and_login(client, database, payload):
    result = client.post("/api/auth/register", json=payload)
    assert result.status_code == 201
    assert result.json()["success"] is True
    assert result.headers["cache-control"] == "no-store"
    assert counts(database) == (1, 1, 1)
    with database.connect() as connection:
        row = connection.execute(text("""
            SELECT u.password_hash, u.creado_en, t.creado_en, ut.permisos, ut.relacion
            FROM usuarios u JOIN usuarios_tutores ut USING (id_usuario)
            JOIN tutores t USING (id_tutor)
        """)).one()
    assert row[0].startswith("$argon2id$")
    assert row[0] != payload["password"] and verify_password(payload["password"], row[0])
    assert row[1] and row[2] and row[3:] == ("LECTURA_TOTAL", "Madre")
    result = client.post("/api/auth/login", json={"email": "ANA@example.com", "password": payload["password"]})
    assert result.status_code == 200
    assert result.json()["usuario"]["nombre_completo"] == "Ana Prueba"
    assert result.json()["tutores"][0]["nombre_completo"] == "Laura Prueba"
    assert "password" not in result.text and "$argon2" not in result.text


@pytest.mark.parametrize("email,password", [("ana@example.com", "incorrecta"), ("nobody@example.com", "incorrecta")])
def test_login_rejects_bad_credentials(client, payload, email, password):
    client.post("/api/auth/register", json=payload)
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 401
    assert response.json()["message"] == "Correo o contraseña incorrectos."


@pytest.mark.parametrize("field,value", [
    ("email", "ANA@example.com"), ("telefono", "(55) 1234-5678"),
    ("tutor.email", "LAURA@example.com"), ("tutor.telefono", "(55) 9876-5432")
])
def test_duplicate_fields_are_atomic(client, database, payload, field, value):
    assert client.post("/api/auth/register", json=payload).status_code == 201
    other = deepcopy(payload)
    other.update(email="other@example.com", telefono="5512345679")
    other["tutor"].update(email="another@example.com", telefono="5598765433")
    if field.startswith("tutor."):
        other["tutor"][field.split(".")[1]] = value
    else:
        other[field] = value
    response = client.post("/api/auth/register", json=other)
    assert response.status_code == 409
    assert field in response.json()["errors"]
    assert counts(database) == (1, 1, 1)


@pytest.mark.parametrize("field,value", [
    ("nombre_completo", " "), ("telefono", "123"), ("email", "mal@"),
    ("password", "corta"), ("password", "        "), ("password", "a" * 129),
    ("confirm_password", "no coincide"), ("role", "admin"), ("id_usuario", 1),
    ("tutor", {}),
])
def test_validation_does_not_insert_or_leak_password(client, database, payload, field, value):
    payload[field] = value
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 422
    assert response.json()["success"] is False
    assert "input" not in response.text and "Una clave segura" not in response.text
    assert counts(database) == (0, 0, 0)


def test_empty_request(client, database):
    assert client.post("/api/auth/register", json={}).status_code == 422
    assert counts(database) == (0, 0, 0)


@pytest.mark.parametrize("table", ["tutores", "usuarios_tutores"])
def test_database_failure_rolls_back_already_inserted_user(client, database, payload, table):
    with database.begin() as connection:
        connection.exec_driver_sql(f"ALTER TABLE {table} ADD CONSTRAINT test_reject CHECK (false)")
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 503
    assert counts(database) == (0, 0, 0)


def test_concurrent_requests_obey_unique(client, database, payload):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post("/api/auth/register", json=payload), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert counts(database) == (1, 1, 1)


def test_sql_values_are_not_executed(client, database, payload):
    payload["nombre_completo"] = "O'Brien'); DROP TABLE usuarios; --"
    assert client.post("/api/auth/register", json=payload).status_code == 201
    assert counts(database) == (1, 1, 1)


def test_existing_journey_and_telemetry(client):
    journey = client.post("/api/journeys/start", json={"user_id": "legacy-demo"}).json()
    with client.websocket_connect('/ws/journeys/' + journey["journey_id"]) as ws:
        response = client.post("/api/telemetry", json={
            "journey_id": journey["journey_id"], "user_id": "legacy-demo",
            "latitude": 19.43, "longitude": -99.13,
        })
        assert response.status_code == 200
        assert ws.receive_json()["type"] == "telemetry"
