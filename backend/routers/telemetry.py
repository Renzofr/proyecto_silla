"""
Router de telemetría — Chair Tracker Vital

WS   /ws/telemetry           canal de datos en tiempo real
POST /telemetry/simulation/start   activa el modo SIMULACIÓN
POST /telemetry/simulation/stop    detiene el modo SIMULACIÓN
POST /telemetry/simulation/reset   reinicia posición/distancia del simulador
GET  /health                       liveness simple
GET  /system/status                diagnóstico de componentes
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.models.telemetry import (
    DestinationUpdate,
    NavigationStatus,
    SystemComponentStatus,
    SystemStatus,
)
from backend.services.simulator import TelemetrySimulator
from backend.services.ws_manager import ws_manager

router = APIRouter()

# Instancia única del simulador para este proceso.
# En modo ROS2 REAL, este simulador permanece detenido y un bridge
# externo (fuera de este archivo) publicaría directamente vía ws_manager.broadcast().
_simulator = TelemetrySimulator(on_message=ws_manager.broadcast)

_last_message_at: dict[str, float] = {}
_bridge_connections: set[WebSocket] = set()


async def _tracking_broadcast(message: dict) -> None:
    _last_message_at[message["type"]] = time.time()
    await ws_manager.broadcast(message)


_simulator.on_message = _tracking_broadcast


@router.websocket("/ws/telemetry")
async def telemetry_ws(websocket: WebSocket):
    await ws_manager.connect(websocket)

    # Estado actual nada mas conectar. Sin esto, un cliente que abre la web
    # cuando el bridge ya estaba conectado no recibiria ningun mensaje
    # "connection" (solo se emiten al conectar/desconectar el bridge) y se
    # quedaria mostrando el modo por defecto, que seria falso.
    await websocket.send_json({
        "type": "connection",
        "data": {
            "state": "CONNECTED" if _bridge_connections else "DISCONNECTED",
            "mode": "ROS2_REAL" if _bridge_connections else "SIMULATION",
        },
    })

    try:
        while True:
            # El cliente no necesita enviar nada; el canal es principalmente
            # de servidor a cliente. Se mantiene el receive para detectar
            # desconexiones y permitir futuros comandos (ej. cambiar modo).
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@router.websocket("/ws/telemetry/ingest")
async def telemetry_ingest_ws(websocket: WebSocket):
    """Recibe telemetría de un bridge ROS 2 externo y la reenvía al frontend."""
    await websocket.accept()
    _bridge_connections.add(websocket)
    _simulator.stop()
    await _tracking_broadcast({
        "type": "connection",
        "data": {"state": "CONNECTED", "mode": "ROS2_REAL"},
    })
    try:
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict) or message.get("type") not in {
                "vitals", "pose", "lidar", "navigation", "alert", "connection"
            }:
                continue
            _last_message_at[message["type"]] = time.time()
            await ws_manager.broadcast(message, exclude=websocket)
    except WebSocketDisconnect:
        pass
    finally:
        _bridge_connections.discard(websocket)
        if not _bridge_connections:
            await _tracking_broadcast({
                "type": "connection",
                "data": {"state": "DISCONNECTED", "mode": "SIMULATION"},
            })


@router.post("/telemetry/simulation/start")
async def start_simulation():
    _simulator.start()
    return {"status": "SIMULACION_INICIADA"}


@router.post("/telemetry/simulation/stop")
async def stop_simulation():
    _simulator.stop()
    return {"status": "SIMULACION_DETENIDA"}


@router.post("/telemetry/simulation/reset")
async def reset_simulation():
    _simulator.reset()
    return {"status": "SIMULACION_REINICIADA"}


@router.post("/telemetry/destination")
async def set_destination(payload: DestinationUpdate):
    if _bridge_connections:
        await asyncio.gather(*(
            bridge.send_json({"type": "destination", "data": {"destination": payload.destination}})
            for bridge in tuple(_bridge_connections)
        ), return_exceptions=True)
    else:
        _simulator.set_destination(payload.destination)
    # Si el simulador o bridge está activo, broadcast inmediato del nuevo estado de navegación
    nav = NavigationStatus(
        state=_simulator.nav_state,
        current_speed=round(_simulator.speed, 2),
        average_speed=round(_simulator.get_avg_speed(), 2),
        distance_traveled=round(_simulator.distance_total, 2),
        destination=payload.destination,
    )
    if not _bridge_connections:
        await _tracking_broadcast({"type": "navigation", "data": nav.dict()})
    return {"status": "DESTINO_ACTUALIZADO", "destination": payload.destination}


@router.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat() + "Z"}


@router.get("/system/status", response_model=SystemStatus)
def system_status():
    def component(name: str, key: str, freq: float | None = 1.0) -> SystemComponentStatus:
        last = _last_message_at.get(key)
        active = last is not None and (time.time() - last) < 5
        return SystemComponentStatus(
            name=name,
            active=active,
            last_update=datetime.utcfromtimestamp(last).isoformat() + "Z" if last else None,
            frequency_hz=freq if active else None,
        )

    components = [
        component("LiDAR", "lidar"),
        component("Odometry", "pose"),
        component("Heart Rate", "vitals"),
        component("SpO2", "vitals"),
        component("Navigation", "navigation"),
    ]

    return SystemStatus(
        # Solo un bridge real cuenta como ROS conectado. El simulador interno
        # produce datos identicos pero no implica que haya ningun nodo ROS.
        ros2_connected=bool(_bridge_connections),
        simulation_active=_simulator.is_running(),
        websocket_connected=len(ws_manager.active_connections) > 0,
        components=components,
        latency_ms=35.0 if _simulator.is_running() else 0.0,
    )
