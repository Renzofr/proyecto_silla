"""
Modelos de datos — Chair Tracker Vital

Consistentes con /frontend/src/types.ts.
Estos modelos representan la telemetría que hoy genera el simulador
y que en el futuro publicará un ROS 2 Web Bridge sobre el canal
WebSocket /ws/telemetry.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


# ---------------------------------------------------------------
# Enums
# ---------------------------------------------------------------

class ConnectionState(str, Enum):
    CONNECTED = "CONNECTED"
    UNSTABLE = "UNSTABLE"
    DISCONNECTED = "DISCONNECTED"


class SystemMode(str, Enum):
    SIMULATION = "SIMULATION"
    ROS2_REAL = "ROS2_REAL"


class NavigationState(str, Enum):
    REPOSO = "REPOSO"
    NAVEGANDO = "NAVEGANDO"
    OBSTACULO_DETECTADO = "OBSTACULO_DETECTADO"
    PAUSA = "PAUSA"
    PAUSA_EMERGENCIA = "PAUSA_EMERGENCIA"
    LLEGADA = "LLEGADA"
    DESCONECTADO = "DESCONECTADO"


class VitalStatus(str, Enum):
    NORMAL = "NORMAL"
    ADVERTENCIA = "ADVERTENCIA"
    ALERTA = "ALERTA"


class AlertLevel(str, Enum):
    INFO = "INFO"
    ADVERTENCIA = "ADVERTENCIA"
    CRITICA = "CRITICA"


class AlertType(str, Enum):
    FC_FUERA_DE_RANGO = "FC_FUERA_DE_RANGO"
    SPO2_BAJO = "SPO2_BAJO"
    CONEXION_PERDIDA = "CONEXION_PERDIDA"
    LIDAR_SIN_DATOS = "LIDAR_SIN_DATOS"
    ODOMETRIA_SIN_DATOS = "ODOMETRIA_SIN_DATOS"
    NAVEGACION_DETENIDA = "NAVEGACION_DETENIDA"
    OBSTACULO_DETECTADO = "OBSTACULO_DETECTADO"


class SessionStatus(str, Enum):
    ACTIVA = "ACTIVA"
    FINALIZADA = "FINALIZADA"


# ---------------------------------------------------------------
# Telemetría en tiempo real (payloads de WebSocket)
# ---------------------------------------------------------------

class VitalSigns(BaseModel):
    heart_rate: float
    spo2: float
    timestamp: str = Field(default_factory=now_iso)
    heart_rate_status: VitalStatus
    spo2_status: VitalStatus


class Pose(BaseModel):
    x: float
    y: float
    theta: float
    timestamp: str = Field(default_factory=now_iso)


class TrajectoryPoint(BaseModel):
    x: float
    y: float
    timestamp: str = Field(default_factory=now_iso)


class LidarData(BaseModel):
    """Corresponde a sensor_msgs/msg/LaserScan."""
    angle_min: float
    angle_max: float
    angle_increment: float
    ranges: List[float]
    range_min: float
    range_max: float
    timestamp: str = Field(default_factory=now_iso)


class NavigationStatus(BaseModel):
    state: NavigationState
    current_speed: float
    average_speed: float
    distance_traveled: float
    destination: Optional[str] = None


class DestinationUpdate(BaseModel):
    destination: Optional[str] = None


class AlertItem(BaseModel):
    id: str = Field(default_factory=lambda: new_id("al"))
    type: AlertType
    level: AlertLevel
    message: str
    timestamp: str = Field(default_factory=now_iso)
    acknowledged: bool = False


# Discriminated-union-like envelope for WebSocket messages.
class WebSocketMessage(BaseModel):
    type: Literal["vitals", "pose", "lidar", "navigation", "alert", "connection"]
    data: dict


# ---------------------------------------------------------------
# Pacientes
# ---------------------------------------------------------------

class PatientCreate(BaseModel):
    name: str


class Patient(BaseModel):
    id: str = Field(default_factory=lambda: new_id("pat"))
    name: str
    created_at: str = Field(default_factory=now_iso)


# ---------------------------------------------------------------
# Sesiones
# ---------------------------------------------------------------

class SessionCreate(BaseModel):
    patient_name: str


class SessionSummary(BaseModel):
    id: str = Field(default_factory=lambda: new_id("sess"))
    patient_name: str
    date: str
    start_time: str
    end_time: Optional[str] = None
    duration_seconds: int = 0
    distance_m: float = 0.0
    avg_speed: float = 0.0
    hr_avg: float = 0.0
    hr_max: float = 0.0
    hr_min: float = 0.0
    spo2_avg: float = 0.0
    spo2_min: float = 0.0
    trajectory: List[TrajectoryPoint] = []
    alerts: List[AlertItem] = []
    status: SessionStatus = SessionStatus.ACTIVA


# ---------------------------------------------------------------
# Sistema
# ---------------------------------------------------------------

class SystemComponentStatus(BaseModel):
    name: str
    active: bool
    last_update: Optional[str] = None
    frequency_hz: Optional[float] = None


class SystemStatus(BaseModel):
    ros2_connected: bool
    websocket_connected: bool
    components: List[SystemComponentStatus]
    latency_ms: float
