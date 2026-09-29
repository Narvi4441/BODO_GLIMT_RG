from fastapi import WebSocket, WebSocketDisconnect

from app.realtime.websocket import manager

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
)

from fastapi.middleware.cors import CORSMiddleware

from app.api.telemetry import router as telemetry_router
from app.realtime.websocket import manager


app = FastAPI(
    title="GUARDIAN Core",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(
    telemetry_router
)


@app.get("/")
async def root():
    return {
        "system": "GUARDIAN Core",
        "status": "online",
    }


@app.websocket(
    "/ws/journeys/{journey_id}"
)
async def journey_websocket(
    websocket: WebSocket,
    journey_id: str,
):
    await manager.connect(
        journey_id,
        websocket,
    )

    try:
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        manager.disconnect(
            journey_id,
            websocket,
        )
        
        
@app.websocket("/ws/journeys/{journey_id}")
async def journey_websocket(
    websocket: WebSocket,
    journey_id: str
):
    await manager.connect(
        journey_id,
        websocket
    )

    try:
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        manager.disconnect(
            journey_id,
            websocket
        )