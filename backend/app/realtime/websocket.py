from fastapi import WebSocket
import logging


class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(
        self,
        journey_id: str,
        websocket: WebSocket,
    ):
        await websocket.accept()

        if journey_id not in self.connections:
            self.connections[journey_id] = []

        self.connections[journey_id].append(websocket)

    def disconnect(
        self,
        journey_id: str,
        websocket: WebSocket,
    ):
        if journey_id not in self.connections:
            return

        if websocket in self.connections[journey_id]:
            self.connections[journey_id].remove(websocket)

        if not self.connections[journey_id]:
            del self.connections[journey_id]

    async def broadcast(
        self,
        journey_id: str,
        message: dict,
    ):
        connections = self.connections.get(
            journey_id,
            [],
        )

        dead_connections = []

        for websocket in list(connections):
            try:
                await websocket.send_json(message)
            except Exception as exc:
                logging.getLogger(__name__).warning("WebSocket delivery failed: %s", type(exc).__name__)
                dead_connections.append(websocket)

        for websocket in dead_connections:
            self.disconnect(
                journey_id,
                websocket,
            )


manager = ConnectionManager()
