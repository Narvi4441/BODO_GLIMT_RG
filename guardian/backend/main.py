import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from .models import Ack, Command, Telemetry
from .risk import evaluate

TOPIC = "guardian/NODE-A"
logger = logging.getLogger("guardian")


class Hub:
    def __init__(self):
        self.connected = False
        self.latest = None
        self.received_at = 0.0
        self.commands = {}
        self.clients = set()
        self.mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="guardian-backend")

    def snapshot(self):
        return {"type": "snapshot", "mqtt_connected": self.connected,
                "telemetry": self.latest, "received_at": self.received_at,
                "commands": list(self.commands.values())[-30:]}

    async def broadcast(self):
        data = self.snapshot()
        async def send(ws):
            try:
                await asyncio.wait_for(ws.send_json(data), timeout=2)
            except Exception:
                self.clients.discard(ws)
        await asyncio.gather(*(send(ws) for ws in tuple(self.clients)))

    async def connection(self, connected):
        self.connected = connected
        await self.broadcast()

    async def receive(self, topic, payload):
        try:
            if topic == f"{TOPIC}/telemetry":
                telemetry = Telemetry.model_validate_json(payload)
                self.latest = {**telemetry.model_dump(), "risk": evaluate(telemetry)}
                self.received_at = time.time()
            elif topic == f"{TOPIC}/ack":
                ack = Ack.model_validate_json(payload)
                record = self.commands.get(ack.command_id)
                if record and record["command"] == ack.command:
                    record.update(status=ack.status, ack=ack.model_dump())
            await self.broadcast()
        except (ValueError, TypeError):
            logger.warning("Mensaje MQTT inválido en %s", topic)


hub = Hub()


@asynccontextmanager
async def lifespan(app):
    loop = asyncio.get_running_loop()
    def on_connect(client, userdata, flags, reason, properties):
        if not reason.is_failure:
            client.subscribe([(f"{TOPIC}/telemetry", 1), (f"{TOPIC}/ack", 1)])
        asyncio.run_coroutine_threadsafe(hub.connection(not reason.is_failure), loop)
    def on_disconnect(client, userdata, flags, reason, properties):
        asyncio.run_coroutine_threadsafe(hub.connection(False), loop)
    def on_message(client, userdata, message):
        asyncio.run_coroutine_threadsafe(hub.receive(message.topic, message.payload), loop)
    hub.mqtt.on_connect = on_connect
    hub.mqtt.on_disconnect = on_disconnect
    hub.mqtt.on_message = on_message
    hub.mqtt.connect_async("127.0.0.1", 1883, 30)
    hub.mqtt.loop_start()
    async def heartbeat():
        while True:
            await asyncio.sleep(1)
            for record in hub.commands.values():
                if record["status"] == "PENDING" and time.time() - record["sent_at"] > 8:
                    record["status"] = "TIMEOUT"
            await hub.broadcast()
    task = asyncio.create_task(heartbeat())
    yield
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    hub.mqtt.disconnect()
    await asyncio.to_thread(hub.mqtt.loop_stop)


app = FastAPI(title="GUARDIAN", lifespan=lifespan)


@app.get("/api/health")
async def health():
    return {"status": "ok", "mqtt_connected": hub.connected}


@app.post("/api/commands", status_code=202)
async def command(body: Command):
    if not hub.connected:
        raise HTTPException(503, "Broker MQTT desconectado")
    if not hub.latest or time.time() - hub.received_at > max(5, hub.latest["interval_seconds"] * 3):
        raise HTTPException(409, "NODE-A no está transmitiendo")
    command_id = str(uuid4())
    payload = {**body.model_dump(exclude_none=True), "command_id": command_id, "sent_at": time.time()}
    hub.commands[command_id] = {**payload, "status": "PENDING", "ack": None}
    result = hub.mqtt.publish(f"{TOPIC}/command", json.dumps(payload), qos=1, retain=False)
    if result.rc != mqtt.MQTT_ERR_SUCCESS:
        hub.commands.pop(command_id)
        raise HTTPException(503, "No se pudo publicar el comando")
    while len(hub.commands) > 30:
        del hub.commands[next(iter(hub.commands))]
    await hub.broadcast()
    return payload


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        await ws.send_json(hub.snapshot())
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)
