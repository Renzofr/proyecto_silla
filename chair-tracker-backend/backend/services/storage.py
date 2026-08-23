"""
Capa de persistencia — Chair Tracker Vital

SQLite vía sqlite3 estándar (sin ORM) para mantener el proyecto
fácil de leer y de portar a Postgres más adelante.

Guarda: pacientes, sesiones (con trayectoria y alertas serializadas
como JSON), de forma que una sesión pueda reconstruirse completa.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import List, Optional

from backend.models.telemetry import (
    AlertItem,
    Patient,
    SessionSummary,
    TrajectoryPoint,
)

DB_PATH = Path(__file__).resolve().parent.parent / "chair_tracker.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            patient_name TEXT NOT NULL,
            date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            distance_m REAL NOT NULL DEFAULT 0,
            avg_speed REAL NOT NULL DEFAULT 0,
            hr_avg REAL NOT NULL DEFAULT 0,
            hr_max REAL NOT NULL DEFAULT 0,
            hr_min REAL NOT NULL DEFAULT 0,
            spo2_avg REAL NOT NULL DEFAULT 0,
            spo2_min REAL NOT NULL DEFAULT 0,
            trajectory TEXT NOT NULL DEFAULT '[]',
            alerts TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'ACTIVA'
        )
        """
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------
# Pacientes
# ---------------------------------------------------------------

def create_patient(patient: Patient) -> Patient:
    conn = get_connection()
    conn.execute(
        "INSERT INTO patients (id, name, created_at) VALUES (?, ?, ?)",
        (patient.id, patient.name, patient.created_at),
    )
    conn.commit()
    conn.close()
    return patient


def list_patients() -> List[Patient]:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM patients ORDER BY created_at DESC").fetchall()
    conn.close()
    return [Patient(id=r["id"], name=r["name"], created_at=r["created_at"]) for r in rows]


# ---------------------------------------------------------------
# Sesiones
# ---------------------------------------------------------------

def _row_to_session(r: sqlite3.Row) -> SessionSummary:
    return SessionSummary(
        id=r["id"],
        patient_name=r["patient_name"],
        date=r["date"],
        start_time=r["start_time"],
        end_time=r["end_time"],
        duration_seconds=r["duration_seconds"],
        distance_m=r["distance_m"],
        avg_speed=r["avg_speed"],
        hr_avg=r["hr_avg"],
        hr_max=r["hr_max"],
        hr_min=r["hr_min"],
        spo2_avg=r["spo2_avg"],
        spo2_min=r["spo2_min"],
        trajectory=[TrajectoryPoint(**p) for p in json.loads(r["trajectory"])],
        alerts=[AlertItem(**a) for a in json.loads(r["alerts"])],
        status=r["status"],
    )


def create_session(session: SessionSummary) -> SessionSummary:
    conn = get_connection()
    conn.execute(
        """
        INSERT INTO sessions (id, patient_name, date, start_time, end_time,
            duration_seconds, distance_m, avg_speed, hr_avg, hr_max, hr_min,
            spo2_avg, spo2_min, trajectory, alerts, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session.id,
            session.patient_name,
            session.date,
            session.start_time,
            session.end_time,
            session.duration_seconds,
            session.distance_m,
            session.avg_speed,
            session.hr_avg,
            session.hr_max,
            session.hr_min,
            session.spo2_avg,
            session.spo2_min,
            json.dumps([p.dict() for p in session.trajectory]),
            json.dumps([a.dict() for a in session.alerts]),
            session.status,
        ),
    )
    conn.commit()
    conn.close()
    return session


def update_session(session: SessionSummary) -> SessionSummary:
    conn = get_connection()
    conn.execute(
        """
        UPDATE sessions SET patient_name=?, date=?, start_time=?, end_time=?,
            duration_seconds=?, distance_m=?, avg_speed=?, hr_avg=?, hr_max=?,
            hr_min=?, spo2_avg=?, spo2_min=?, trajectory=?, alerts=?, status=?
        WHERE id=?
        """,
        (
            session.patient_name,
            session.date,
            session.start_time,
            session.end_time,
            session.duration_seconds,
            session.distance_m,
            session.avg_speed,
            session.hr_avg,
            session.hr_max,
            session.hr_min,
            session.spo2_avg,
            session.spo2_min,
            json.dumps([p.dict() for p in session.trajectory]),
            json.dumps([a.dict() for a in session.alerts]),
            session.status,
            session.id,
        ),
    )
    conn.commit()
    conn.close()
    return session


def get_session(session_id: str) -> Optional[SessionSummary]:
    conn = get_connection()
    row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    return _row_to_session(row) if row else None


def list_sessions() -> List[SessionSummary]:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM sessions ORDER BY date DESC, start_time DESC").fetchall()
    conn.close()
    return [_row_to_session(r) for r in rows]
