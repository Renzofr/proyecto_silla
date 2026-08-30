"""
Gestor de conexiones WebSocket — Chair Tracker Vital

Centraliza el broadcast de telemetría a todos los clientes conectados
en /ws/telemetry. Un futuro ROS 2 Web Bridge publicaría mensajes aquí
mismo (vía broadcast()) en lugar de usar el simulador.
"""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict, exclude: Optional[WebSocket] = None) -> None:
        payload = json.dumps(message)
        stale: List[WebSocket] = []
        for connection in self.active_connections:
            if connection is exclude:
                continue
            try:
                await connection.send_text(payload)
            except Exception:
                stale.append(connection)
        for s in stale:
            self.disconnect(s)


ws_manager = WebSocketManager()
