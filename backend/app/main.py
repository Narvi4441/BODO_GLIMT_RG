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
import logging
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy.exc import SQLAlchemyError
from app.core.database import DatabaseNotConfigured
from app.services.state_repository import StateError, pending_commands
from app.services.journey_state import get_journey
from app.api.c5_cameras import router as c5_router


app = FastAPI(
    title="GUARDIAN Core",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://bodo-glimt-rg.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(telemetry_router)
app.include_router(journeys_router)
app.include_router(commands_router)
app.include_router(auth_router)
app.include_router(c5_router)


@app.exception_handler(StateError)
async def state_error(request, exc):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(SQLAlchemyError)
@app.exception_handler(DatabaseNotConfigured)
async def database_error(request, exc):
    logging.getLogger(__name__).error("PostgreSQL operation failed: %s", type(exc).__name__)
    return JSONResponse(status_code=503, content={"detail": "PostgreSQL unavailable or migration required"})

# Mismo HTML existente, servido en el mismo origen que la API (también en móvil).
class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response



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
    try:
        journey = await run_in_threadpool(get_journey, journey_id)
    except (SQLAlchemyError, DatabaseNotConfigured):
        logging.getLogger(__name__).error("PostgreSQL unavailable during WebSocket handshake")
        await websocket.close(code=1013)
        return
    if not journey:
        await websocket.close(code=1008)
        return
    await manager.connect(
        journey_id,
        websocket,
    )

    try:
        if journey["status"] == "ACTIVE":
            for command in await run_in_threadpool(pending_commands, journey_id):
                await websocket.send_json({"type": "command", "data": command})
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        logging.getLogger(__name__).info("Journey WebSocket disconnected: %s", journey_id)
    finally:
        manager.disconnect(
            journey_id,
            websocket,
        )
