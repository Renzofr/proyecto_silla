# ---------------------------------------------------------------------------
#  Chair Tracker Vital — Backend (FastAPI + WebSocket + SQLite)
#  Ubuntu 24.04 usa Python 3.12; se fija la misma version para que el entorno
#  del contenedor sea identico al de la maquina de los estudiantes.
# ---------------------------------------------------------------------------
FROM python:3.12-slim

WORKDIR /app

# Las dependencias se instalan antes de copiar el codigo: asi cambiar un .py
# no invalida la cache y la reconstruccion es instantanea.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend

EXPOSE 8000

# --reload para que editar el codigo en el host reinicie el servidor solo.
CMD ["python", "-m", "uvicorn", "backend.server:app", \
     "--host", "0.0.0.0", "--port", "8000", "--reload"]
