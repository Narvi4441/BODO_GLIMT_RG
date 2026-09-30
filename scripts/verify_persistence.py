"""Real HTTP/WebSocket + PostgreSQL + Redis checks. Never generates GPS/sensor data.

Requires a migrated, isolated database ending in _test and dedicated Redis.
Optional --telemetry-file is a JSON array exported from the actual phone.
"""
import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import httpx
from websockets.sync.client import connect
from sqlalchemy import text
from sqlalchemy.engine import make_url
from app.core.config import Config
from app.core.database import get_engine
from app.core.cache import get_redis
from app.schemas.telemetry import TelemetryIn
from app.services.risk import calculate_risk
from app.services.c5_repository import rebuild_cache, nearest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=58000)
    parser.add_argument("--telemetry-file", type=Path)
    parser.add_argument("--user-id", help="Existing account ID or actual device identity")
    parser.add_argument("--clear-c5-cache", action="store_true", help="Delete guardian:c5:* only on the dedicated test Redis")
    args = parser.parse_args()
    if not (make_url(Config.SQLALCHEMY_DATABASE_URI).database or "").endswith("_test"):
        parser.error("DATABASE_URL must point to an isolated database ending in _test")
    client_redis = get_redis()
    client_redis.ping()
    engine = get_engine()
    report = []
    process = None
    logs = ROOT / ".tools/persistence-backend.log"
    logs.parent.mkdir(exist_ok=True)
    log = logs.open("a", encoding="utf-8")
    http = httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=30)
    # An actual workstation identity, not a fabricated account/person.
    user = args.user_id or "device-" + hashlib.sha256(platform.node().encode()).hexdigest()[:32]

    def passed(name):
        report.append({"check": name, "result": "PASS"})
        print("PASS", name, flush=True)

    def query(sql, values=None):
        with engine.connect() as c:
            return c.execute(text(sql), values or {}).scalar()

    def launch():
        process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(args.port)],
            cwd=ROOT / "backend", stdout=log, stderr=log, env=os.environ.copy(),
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError(f"Backend exited. See {logs}")
            try:
                if http.get("/").status_code == 200:
                    return process
            except httpx.TransportError:
                time.sleep(0.1)
        process.terminate()
        process.wait(timeout=10)
        raise RuntimeError("Backend did not become ready")

    try:
        process = launch()
        response = http.post("/api/journeys/start", json={"user_id": user})
        response.raise_for_status()
        journey = response.json()["journey_id"]
        values = {"id": journey}
        assert query("SELECT estado FROM viajes WHERE journey_id=:id", values) == "ACTIVE"
        assert json.loads(client_redis.get(f"guardian:journey:{journey}:state"))["status"] == "ACTIVE"
        passed("Journey start: HTTP + PostgreSQL + Redis")
        with connect(f"ws://127.0.0.1:{args.port}/ws/journeys/{journey}") as ws:
            if args.telemetry_file:
                packets = json.loads(args.telemetry_file.read_text(encoding="utf-8-sig"))
                if not isinstance(packets, list) or not packets:
                    raise ValueError("The capture must be a nonempty JSON array of actual phone packets")
                observed_risks = set()
                for captured in packets:
                    # Only rebind journey/user; never manufacture coordinates or sensor values.
                    packet = TelemetryIn.model_validate({**captured, "journey_id": journey, "user_id": user}).model_dump(mode="json")
                    response = http.post("/api/telemetry", json=packet)
                    response.raise_for_status()
                    expected = calculate_risk(packet)
                    assert response.json()["risk"] == expected
                    observed_risks.add(expected["status"])
                    assert json.loads(ws.recv(timeout=10))["type"] == "telemetry"
                    if response.json()["automatic_command"]:
                        assert json.loads(ws.recv(timeout=10))["type"] == "command"
                assert query("SELECT count(*) FROM telemetria WHERE journey_id=:id", values) == len(packets)
                assert json.loads(client_redis.get(f"guardian:journey:{journey}:risk"))["status"] == expected["status"]
                newest = max(packets, key=lambda packet: packet["timestamp"])
                location = json.loads(client_redis.get(f"guardian:journey:{journey}:location"))
                assert location["latitude"] == newest["latitude"] and location["longitude"] == newest["longitude"]
                passed("Actual captured telemetry: PostgreSQL, Redis location/risk, WebSocket")
                if len(observed_risks) > 1:
                    passed("Risk transition observed in actual capture")
                else:
                    report.append({"check": "Risk transition", "result": "NOT TESTED: capture has one risk level"})
            else:
                report.append({"check": "Telemetry, risk transitions, alerts, online timeout", "result": "NOT TESTED: no actual phone capture supplied"})
            response = http.post("/api/commands", json={"journey_id": journey, "user_id": user, "action": "SET_TELEMETRY_RATE", "value": 5})
            response.raise_for_status()
            command = response.json()
            message = json.loads(ws.recv(timeout=10))
            assert message["data"]["command_id"] == command["command_id"]
            cid = {"id": command["command_id"]}
            assert query("SELECT status FROM comandos WHERE command_id=:id", cid) == "SENT"
            assert json.loads(client_redis.get(f"guardian:command:{command['command_id']}"))["status"] == "SENT"
            passed("Command SENT: PostgreSQL + Redis + actual WebSocket")
            interval = None
            for status in ("RECEIVED", "EXECUTING", "EXECUTED"):
                if status == "EXECUTING":
                    interval = int(command["value"])
                response = http.post(f"/api/commands/{command['command_id']}/ack", json={"status": status, "message": "Persistence verification client"})
                response.raise_for_status()
                assert json.loads(ws.recv(timeout=10))["data"]["status"] == status
                assert query("SELECT status FROM comandos WHERE command_id=:id", cid) == status
                assert json.loads(client_redis.get(f"guardian:command:{command['command_id']}"))["status"] == status
                passed(f"ACK {status}: PostgreSQL + Redis + WebSocket")
            assert interval == 5
            assert query("SELECT count(*) FROM eventos_viaje WHERE journey_id=:id AND event_type='COMMAND_ACK' AND payload->>'command_id'=:command", {**values, "command": command["command_id"]}) == 3
            response = http.post(f"/api/commands/{command['command_id']}/ack", json={"status": "EXECUTED"})
            response.raise_for_status()
            assert query("SELECT count(*) FROM eventos_viaje WHERE journey_id=:id AND event_type='COMMAND_ACK' AND payload->>'command_id'=:command", {**values, "command": command["command_id"]}) == 3
            assert http.post(f"/api/commands/{command['command_id']}/ack", json={"status": "RECEIVED"}).status_code == 409
            passed("ACK retries idempotent; stale ACK rejected")
        pending = http.post("/api/commands", json={"journey_id": journey, "user_id": user,
            "action": "SET_TELEMETRY_RATE", "value": 5})
        pending.raise_for_status()
        pending_id = pending.json()["command_id"]
        process.terminate()
        process.wait(timeout=10)
        process = launch()
        with connect(f"ws://127.0.0.1:{args.port}/ws/journeys/{journey}") as ws:
            # A real capture can also have generated pending automatic commands.
            for _ in range(query("SELECT count(*) FROM comandos WHERE journey_id=:id AND status IN ('SENT','RECEIVED','EXECUTING')", values)):
                replayed = json.loads(ws.recv(timeout=10))
                if replayed["data"]["command_id"] == pending_id:
                    break
            else:
                raise AssertionError("Pending command missing after restart")
        passed("Active journey survives restart; pending command replayed on WebSocket reconnect")
        response = http.post(f"/api/journeys/{journey}/stop")
        response.raise_for_status()
        assert response.json()["status"] == "COMPLETED"
        assert query("SELECT fin_viaje IS NOT NULL FROM viajes WHERE journey_id=:id", values)
        passed("Stop persisted with completion event")
        process.terminate()
        process.wait(timeout=10)
        keys = list(client_redis.scan_iter(match=f"guardian:journey:{journey}:*"))
        keys += [f"guardian:command:{command['command_id']}"]
        if keys:
            client_redis.delete(*keys)
        process = launch()
        assert http.get(f"/api/journeys/{journey}").json()["status"] == "COMPLETED"
        assert client_redis.exists(f"guardian:journey:{journey}:state")
        from app.services.command_state import get_command
        assert get_command(command["command_id"])["status"] == "EXECUTED"
        assert client_redis.exists(f"guardian:command:{command['command_id']}")
        passed("Backend process restarted + cache cleared: journey/command recovered from PostgreSQL")
        for module in ("journey_state", "command_state", "risk_state"):
            source = (ROOT / f"backend/app/services/{module}.py").read_text(encoding="utf-8")
            assert "= {}" not in source
        passed("No process-local business state dictionaries")
        with engine.connect() as c:
            infrastructure = c.execute(text("SELECT * FROM infraestructura_c5 ORDER BY id LIMIT 1")).mappings().first()
            total = c.execute(text("SELECT count(*) FROM infraestructura_c5")).scalar_one()
        if infrastructure:
            assert client_redis.zcard("guardian:c5:geo") == total
            response = http.get("/api/c5/nearest", params={"latitude": infrastructure["latitude"], "longitude": infrastructure["longitude"]})
            response.raise_for_status()
            result = response.json()
            assert result["encontrado"] and result["distancia_metros"] < 1
            assert result["metadata"]["source"] == infrastructure["source"]
            passed(f"Official C5 PostgreSQL/Redis: {total} records; nearest at source coordinate within 1 m")
            if args.clear_c5_cache:
                keys = list(client_redis.scan_iter(match="guardian:c5:*"))
                if keys:
                    client_redis.delete(*keys)
                assert client_redis.zcard("guardian:c5:geo") == 0
                assert rebuild_cache() == total
                assert client_redis.zcard("guardian:c5:geo") == total
                assert nearest(infrastructure["latitude"], infrastructure["longitude"])["encontrado"]
                passed("Only test C5 cache cleared; all official records rebuilt from PostgreSQL")
        else:
            report.append({"check": "C5", "result": "NOT TESTED: no official file imported"})
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        http.close()
        log.close()
        (ROOT / ".tools/persistence-results.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
