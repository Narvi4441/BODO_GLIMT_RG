"""Prueba de integración contra broker, backend y NODE-A en ejecución."""
import asyncio
import json
import httpx
import websockets


async def main():
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000") as api:
        async with websockets.connect("ws://127.0.0.1:8000/ws") as ws:
            async def until(predicate):
                async with asyncio.timeout(15):
                    while True:
                        data = json.loads(await ws.recv())
                        if predicate(data):
                            return data
            await until(lambda s: s["mqtt_connected"] and s["telemetry"] is not None)
            print("OK NODE-A -> MQTT -> FastAPI -> WebSocket")
            for command, extra in [
                ("SET_TELEMETRY_RATE", {"interval_seconds": 0.5}),
                ("REQUEST_CHECK_IN", {}), ("EMERGENCY_MODE", {}),
                ("NORMAL_MODE", {}), ("SET_TELEMETRY_RATE", {"interval_seconds": 1}),
            ]:
                response = await api.post("/api/commands", json={"command": command, **extra})
                assert response.status_code == 202, response.text
                command_id = response.json()["command_id"]
                await until(lambda s: any(c["command_id"] == command_id and c["status"] == "EXECUTED" and c["ack"] for c in s["commands"]))
                if command == "EMERGENCY_MODE":
                    await until(lambda s: s["telemetry"]["emergency"] and s["telemetry"]["risk"]["state"] == "CRITICAL")
                elif command == "NORMAL_MODE":
                    await until(lambda s: not s["telemetry"]["emergency"])
                elif command == "SET_TELEMETRY_RATE":
                    await until(lambda s: s["telemetry"]["interval_seconds"] == extra["interval_seconds"])
                print(f"OK {command} -> MQTT -> NODE-A -> ACK")
            invalid = await api.post("/api/commands", json={"command": "SET_TELEMETRY_RATE", "interval_seconds": 0})
            assert invalid.status_code == 422
            print("OK validación de comandos")


if __name__ == "__main__":
    asyncio.run(main())
