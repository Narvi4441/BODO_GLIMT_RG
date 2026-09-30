from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.api.commands import router as commands_router
from app.api.telemetry import router as telemetry_router
from app.api.journeys import router as journeys_router
from app.realtime.websocket import manager
from app.api.auth import router as auth_router
from app.core.config import Config
from fastapi.staticfiles import StaticFiles
from pathlib import Path


app = FastAPI(
    title="GUARDIAN Core",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://wallet-striking-coordinated-each.trycloudflare.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_origin_regex=r"https://.*\.trycloudflare\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(telemetry_router)
app.include_router(journeys_router)
app.include_router(commands_router)
app.include_router(auth_router)

# Mismo HTML existente, servido en el mismo origen que la API (también en móvil).
class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/ui", FrontendFiles(
    directory=Path(__file__).resolve().parents[2] / "frontend", html=True
), name="frontend")


@app.get("/")
async def root():
    return {
        "system": "GUARDIAN Core",
        "status": "online",
    }


@app.websocket("/ws/journeys/{journey_id}")
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
