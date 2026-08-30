"""
Simulador de telemetría — Chair Tracker Vital

Genera datos coherentes de signos vitales, posición, LiDAR y estado
de navegación para probar toda la interfaz sin un ROS 2 real conectado.

Diseño: expone la misma forma de mensaje ({"type": ..., "data": ...})
que enviará en el futuro un nodo ROS 2 Web Bridge. Sustituir esta clase
por un suscriptor rclpy que reciba /scan, /odom, /tf y los tópicos de
signos vitales, y publique al mismo manager de WebSocket, sin tocar
el resto del backend ni el frontend.
"""
from __future__ import annotations

import asyncio
import math
import random
import time
from datetime import datetime
from typing import Callable, Awaitable

from backend.models.telemetry import (
    AlertItem,
    AlertLevel,
    AlertType,
    LidarData,
    NavigationState,
    NavigationStatus,
    Pose,
    VitalSigns,
    VitalStatus,
)


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class TelemetrySimulator:
    """Genera un tick de telemetría por segundo mientras está activo."""

    def __init__(self, on_message: Callable[[dict], Awaitable[None]]):
        self.on_message = on_message
        self._task: asyncio.Task | None = None
        self._running = False

        self.t = 0
        self.hr = 78.0
        self.spo2 = 98.0
        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0
        self.speed = 0.0
        self.nav_state = NavigationState.REPOSO
        self.nav_timer = 0

        self.distance_total = 0.0
        self._speed_samples: list[float] = []
        self.destination: str | None = None

    def is_running(self) -> bool:
        return self._running

    def set_destination(self, destination: str | None) -> None:
        self.destination = destination
        if destination:
            self.nav_state = NavigationState.NAVEGANDO
            self.nav_timer = 0

    def get_avg_speed(self) -> float:
        return sum(self._speed_samples) / max(1, len(self._speed_samples)) if self._speed_samples else 0.0

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    def reset(self) -> None:
        self.t = 0
        self.x = self.y = self.theta = 0.0
        self.speed = 0.0
        self.nav_state = NavigationState.REPOSO
        self.nav_timer = 0
        self.distance_total = 0.0
        self._speed_samples = []
        self.destination = None

    async def _loop(self) -> None:
        try:
            while self._running:
                await self._step()
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass

    async def _step(self) -> None:
        self.t += 1

        # --- Signos vitales (random walk acotado) ---
        self.hr = clamp(self.hr + random.uniform(-1.5, 1.5), 58, 132)
        self.spo2 = clamp(self.spo2 + random.uniform(-0.3, 0.3), 90, 100)

        hr_status = (
            VitalStatus.ALERTA
            if self.hr < 60 or self.hr > 110
            else VitalStatus.ADVERTENCIA
            if self.hr < 65 or self.hr > 100
            else VitalStatus.NORMAL
        )
        spo2_status = (
            VitalStatus.ALERTA
            if self.spo2 < 92
            else VitalStatus.ADVERTENCIA
            if self.spo2 < 95
            else VitalStatus.NORMAL
        )

        vitals = VitalSigns(
            heart_rate=round(self.hr),
            spo2=round(self.spo2, 1),
            heart_rate_status=hr_status,
            spo2_status=spo2_status,
        )
        await self.on_message({"type": "vitals", "data": vitals.dict()})

        if hr_status == VitalStatus.ALERTA:
            await self._emit_alert(
                AlertType.FC_FUERA_DE_RANGO,
                AlertLevel.ADVERTENCIA,
                f"Frecuencia cardíaca fuera del umbral configurado ({vitals.heart_rate} BPM)",
            )
        if spo2_status == VitalStatus.ALERTA:
            await self._emit_alert(
                AlertType.SPO2_BAJO,
                AlertLevel.CRITICA,
                f"SpO₂ por debajo del umbral configurado ({vitals.spo2}%)",
            )

        # --- Máquina de estados de navegación (simple) ---
        self.nav_timer -= 1
        if self.nav_timer <= 0:
            roll = random.random()
            if self.nav_state == NavigationState.REPOSO and roll > 0.4:
                self.nav_state = NavigationState.NAVEGANDO
            elif self.nav_state == NavigationState.NAVEGANDO and roll > 0.85:
                self.nav_state = NavigationState.OBSTACULO_DETECTADO
            elif self.nav_state == NavigationState.OBSTACULO_DETECTADO:
                self.nav_state = NavigationState.NAVEGANDO
            elif self.nav_state == NavigationState.NAVEGANDO and roll < 0.08:
                self.nav_state = NavigationState.PAUSA
            elif self.nav_state == NavigationState.PAUSA:
                self.nav_state = NavigationState.NAVEGANDO
            self.nav_timer = random.randint(4, 9)

        # --- Pose / trayectoria (con tolerancia de movimiento aplicada) ---
        prev_x, prev_y = self.x, self.y
        if self.nav_state == NavigationState.NAVEGANDO:
            self.speed = clamp(self.speed + random.uniform(-0.06, 0.09), 0, 1.2)
            self.theta += random.uniform(-0.12, 0.12)
            self.x += math.cos(self.theta) * self.speed * 0.3
            self.y += math.sin(self.theta) * self.speed * 0.3
        else:
            self.speed = clamp(self.speed - 0.3, 0, 1.2)
            if self.nav_state == NavigationState.OBSTACULO_DETECTADO:
                await self._emit_alert(
                    AlertType.OBSTACULO_DETECTADO,
                    AlertLevel.ADVERTENCIA,
                    "Obstáculo detectado por LiDAR a menos de 0.6 m",
                )

        MOVE_TOLERANCE = 0.01
        d = math.hypot(self.x - prev_x, self.y - prev_y)
        if d > MOVE_TOLERANCE:
            self.distance_total += d

        pose = Pose(x=self.x, y=self.y, theta=self.theta)
        await self.on_message({"type": "pose", "data": pose.dict()})

        self._speed_samples.append(self.speed)
        if len(self._speed_samples) > 600:
            self._speed_samples.pop(0)
        avg_speed = self.get_avg_speed()

        nav = NavigationStatus(
            state=self.nav_state,
            current_speed=round(self.speed, 2),
            average_speed=round(avg_speed, 2),
            distance_traveled=round(self.distance_total, 2),
            destination=self.destination,
        )
        await self.on_message({"type": "navigation", "data": nav.dict()})

        # --- LiDAR simulado (paredes + posible obstáculo) ---
        n_points = 180
        ranges = []
        for i in range(n_points):
            angle = -math.pi + (i / n_points) * 2 * math.pi
            wall = 3.2 + math.sin(angle * 2 + self.t * 0.05) * 0.6
            noise = random.uniform(-0.04, 0.04)
            is_obstacle = self.nav_state == NavigationState.OBSTACULO_DETECTADO and abs(angle) < 0.3
            ranges.append(0.5 + noise if is_obstacle else max(0.2, wall + noise))

        lidar = LidarData(
            angle_min=-math.pi,
            angle_max=math.pi,
            angle_increment=(2 * math.pi) / n_points,
            ranges=ranges,
            range_min=0.1,
            range_max=8.0,
        )
        await self.on_message({"type": "lidar", "data": lidar.dict()})

        await self.on_message({
            "type": "connection",
            "data": {"state": "CONNECTED", "mode": "SIMULATION"},
        })

    async def _emit_alert(self, type_: AlertType, level: AlertLevel, message: str) -> None:
        alert = AlertItem(type=type_, level=level, message=message)
        await self.on_message({"type": "alert", "data": alert.dict()})
