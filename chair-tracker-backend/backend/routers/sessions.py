"""
Router REST — sesiones y pacientes.

POST   /sessions             crear sesión (paciente + inicio)
GET    /sessions             listar historial
GET    /sessions/{id}        detalle de una sesión
POST   /sessions/{id}/start  marcar inicio (ya activa desde creación; idempotente)
POST   /sessions/{id}/finish finalizar sesión con estadísticas finales
GET    /patients             listar pacientes
POST   /patients             registrar paciente
"""
from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, HTTPException

from backend.models.telemetry import (
    Patient,
    PatientCreate,
    SessionCreate,
    SessionStatus,
    SessionSummary,
)
from backend.services import storage

router = APIRouter()


@router.post("/sessions", response_model=SessionSummary)
def create_session(payload: SessionCreate):
    now = datetime.utcnow()
    session = SessionSummary(
        patient_name=payload.patient_name,
        date=now.strftime("%d/%m/%Y"),
        start_time=now.strftime("%H:%M:%S"),
        status=SessionStatus.ACTIVA,
    )
    storage.create_session(session)
    return session


@router.get("/sessions", response_model=List[SessionSummary])
def get_sessions():
    return storage.list_sessions()


@router.get("/sessions/{session_id}", response_model=SessionSummary)
def get_session(session_id: str):
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    return session


@router.post("/sessions/{session_id}/start", response_model=SessionSummary)
def start_session(session_id: str):
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    session.status = SessionStatus.ACTIVA
    storage.update_session(session)
    return session


class FinishSessionPayload(SessionSummary):
    """Acepta las estadísticas finales calculadas por el frontend
    (duración, distancia, trayectoria, alertas, promedios) para persistirlas."""
    pass


@router.post("/sessions/{session_id}/finish", response_model=SessionSummary)
def finish_session(session_id: str, payload: FinishSessionPayload):
    existing = storage.get_session(session_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    payload.id = session_id
    payload.status = SessionStatus.FINALIZADA
    if not payload.end_time:
        payload.end_time = datetime.utcnow().strftime("%H:%M:%S")
    storage.update_session(payload)
    return payload


@router.get("/patients", response_model=List[Patient])
def get_patients():
    return storage.list_patients()


@router.post("/patients", response_model=Patient)
def create_patient(payload: PatientCreate):
    patient = Patient(name=payload.name)
    storage.create_patient(patient)
    return patient
