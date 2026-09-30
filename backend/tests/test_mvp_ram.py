"""The MVP journey flow must work without a configured database."""
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core import database
from app.main import app
from app.services import state_repository
from app.services.command_state import commands
from app.services.journey_state import active_journeys
from app.services.risk_state import journey_risk_state


def test_journey_flow_without_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(Config, "SQLALCHEMY_DATABASE_URI", "")

    def forbidden_database():
        raise AssertionError("MVP flow attempted to access PostgreSQL")

    monkeypatch.setattr(database, "get_engine", forbidden_database)
    monkeypatch.setattr(state_repository, "get_engine", forbidden_database)
    journey_id = None
    try:
        with TestClient(app) as client:
            assert client.get("/").status_code == 200
            started = client.post("/api/journeys/start", json={"user_id": "123"})
            assert started.status_code == 200
            journey_id = started.json()["journey_id"]
            url = f"/api/journeys/{journey_id}"
            assert client.get(url).json()["status"] == "ACTIVE"
            payload = dict(journey_id=journey_id, user_id="123",
                           latitude=19.4326, longitude=-99.1332)
            # A pending command must replay at connection without querying SQL.
            created = client.post("/api/commands", json={
                "journey_id": journey_id, "user_id": "123",
                "action": "REQUEST_CHECK_IN"})
            assert created.status_code == 200
            command_id = created.json()["command_id"]
            with client.websocket_connect(f"/ws/journeys/{journey_id}") as ws:
                assert ws.receive_json()["data"]["command_id"] == command_id
                response = client.post("/api/telemetry", json=payload)
                assert response.status_code == 200
                assert response.json()["status"] == "accepted"
                assert ws.receive_json()["type"] == "telemetry"
                for status in ("RECEIVED", "EXECUTING", "EXECUTED"):
                    ack = client.post(f"/api/commands/{command_id}/ack",
                                      json={"status": status, "message": "OK"})
                    assert ack.status_code == 200
                    assert ack.json()["status"] == status
                    assert ws.receive_json()["type"] == "command_ack"
                # Preserve risk transitions and suppress repeated automatic commands.
                risky = {**payload, "accuracy": 150, "latency_ms": 600,
                         "network_status": "DEGRADED"}
                response = client.post("/api/telemetry", json=risky).json()
                assert response["risk"]["status"] == "PRECAUTION"
                assert response["automatic_command"]["action"] == "SET_TELEMETRY_RATE"
                assert ws.receive_json()["type"] == "telemetry"
                assert ws.receive_json()["type"] == "command"
                assert client.post("/api/telemetry", json=risky).json()["automatic_command"] is None
                assert ws.receive_json()["type"] == "telemetry"
                normal = client.post("/api/telemetry", json=payload).json()
                assert normal["automatic_command"]["value"] == 5
                assert ws.receive_json()["type"] == "telemetry"
                assert ws.receive_json()["type"] == "command"
            assert client.post("/api/telemetry", json={**payload, "user_id": "other"}).status_code == 403
            stopped = client.post(url + "/stop")
            assert stopped.status_code == 200
            assert stopped.json()["status"] == "COMPLETED"
            assert client.get(url).json()["status"] == "COMPLETED"
            assert client.post("/api/telemetry", json=payload).status_code == 409
    finally:
        if journey_id:
            active_journeys.pop(journey_id, None)
            journey_risk_state.pop(journey_id, None)
            for key, command in list(commands.items()):
                if command["journey_id"] == journey_id:
                    commands.pop(key)
