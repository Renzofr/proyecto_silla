"""
Chair Tracker Vital — Backend

FastAPI + WebSocket + SQLite.

Ejecutar:
    uvicorn backend.server:app --reload --port 8000

Endpoints REST bajo /api, WebSocket en /api/ws/telemetry.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import sessions, telemetry
from backend.services.storage import init_db

app = FastAPI(
    title="Chair Tracker Vital API",
    description="Backend de monitoreo para silla de ruedas inteligente ROS 2",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ajustar en producción al dominio del frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(sessions.router, prefix="/api", tags=["sessions"])
app.include_router(telemetry.router, prefix="/api", tags=["telemetry"])


@app.get("/")
def root():
    return {"service": "Chair Tracker Vital API", "status": "running"}
