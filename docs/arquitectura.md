# Chair Tracker Vital

Sistema web de monitoreo para silla de ruedas inteligente basada en
**ROS 2 + LiDAR + sensores de signos vitales**.

La aplicación es principalmente de **monitoreo y visualización**. No
sustituye a Nav2 y no controla `/cmd_vel`. Solo **recibe, visualiza,
registra y analiza** los datos que produce la silla.

---

## Arquitectura

```
ROS 2
 ├── /scan            (sensor_msgs/msg/LaserScan)
 ├── /odom             (nav_msgs/msg/Odometry)
 ├── /tf, /tf_static
 ├── /cmd_vel          (no se toca desde la web)
 ├── frecuencia cardíaca
 └── SpO2
        │
        ▼
 wheelchair_bridge  (repo wheelchair-ros)
        │
        ▼
   WebSocket  ──────────────────────►  Backend (FastAPI)
                                            │
                                            ├── REST API  (sesiones, pacientes, historial)
                                            └── WS /ws/telemetry (tiempo real)
                                                    │
                                                    ▼
                                            Frontend React
                                             ├── Dashboard
                                             ├── Mapa / LiDAR / Trayectoria
                                             ├── Signos vitales + gráficas
                                             ├── Alertas
                                             └── Historial + exportación
```

### Modo SIMULACIÓN vs modo ROS 2 REAL

- El backend trae un **simulador interno** (`backend/services/simulator.py`)
  que genera telemetría coherente (signos vitales, pose, LiDAR, navegación)
  y la publica por el mismo canal WebSocket que usaría un ROS 2 Web Bridge
  real.
- Para conectar una silla ROS 2 real está el paquete `wheelchair_bridge`
  (repositorio [wheelchair-ros](https://github.com/Renzofr/wheelchair-ros)):
  un nodo `rclpy` que se suscribe a `/scan` y `/odom`, transforma cada
  mensaje al formato JSON (`{"type": "...", "data": {...}}`) y lo envía al
  WebSocket de ingesta `/api/ws/telemetry/ingest` — **sin modificar el
  frontend**. Al conectarse, el backend detiene el simulador interno solo.
- El frontend nunca debe inventar datos: si el WebSocket se desconecta,
  el estado de conexión pasa a `DESCONECTADO` y dejan de actualizarse
  los valores en vivo.

---

## Backend (FastAPI)

### Requisitos
- Python 3.10+

### Instalación y ejecución

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # En Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

La API queda disponible en `http://localhost:8000/api` y la
documentación interactiva (Swagger) en `http://localhost:8000/docs`.

### Endpoints principales

**REST**
| Método | Ruta                              | Descripción                      |
|--------|-----------------------------------|-----------------------------------|
| POST   | `/api/sessions`                   | Crear sesión (paciente + inicio) |
| GET    | `/api/sessions`                   | Listar historial                 |
| GET    | `/api/sessions/{id}`              | Detalle de una sesión            |
| POST   | `/api/sessions/{id}/finish`       | Finalizar sesión con estadísticas|
| GET    | `/api/patients`                   | Listar pacientes                 |
| POST   | `/api/patients`                   | Registrar paciente               |
| POST   | `/api/telemetry/simulation/start` | Iniciar simulador                |
| POST   | `/api/telemetry/simulation/stop`  | Detener simulador                |
| POST   | `/api/telemetry/destination`      | Establecer destino de navegación |
| GET    | `/api/system/status`              | Diagnóstico de componentes       |
| GET    | `/api/health`                     | Liveness check                   |

**WebSocket**
- `ws://localhost:8000/api/ws/telemetry` — canal de telemetría en tiempo real.
  Mensajes con forma `{"type": "vitals"|"pose"|"lidar"|"navigation"|"alert"|"connection", "data": {...}}`.

### Persistencia
SQLite (`backend/chair_tracker.db`, se crea automáticamente). Guarda
pacientes y sesiones completas (incluyendo trayectoria y alertas como
JSON), de forma que cualquier sesión pueda reconstruirse íntegramente
desde el historial.

---

## Frontend (React + Vite)

### Requisitos
- Node.js 18+

### Instalación y ejecución

```bash
cd frontend
npm install
cp .env.example .env      # ajustar VITE_API_BASE_URL si el backend no está en localhost:8000
npm run dev
```

Abre `http://localhost:5173`.

### Estructura
- `src/App.jsx` — dashboard completo (páginas: Dashboard, Pantalla a Bordo, Mapa, Historial, Sistema).
  - **Pantalla a Bordo**: Modo táctil para la tablet montada en la silla con HUD de signos vitales (FC con ECG animado, SpO2), radar de seguridad LiDAR perimetral, selector rápido de destino (1 toque), botón de parada de emergencia, llamada de asistencia y modo kiosko a pantalla completa.
- `src/api.js` — cliente REST + configuración del WebSocket.
- Diseño: dashboard clínico oscuro, profesional y técnico, con soporte táctil de alta visibilidad para la tablet física de la silla.

---

## Flujo de uso

1. Click en **Iniciar sesión** → se pide el nombre del paciente → se crea la sesión en el backend.
2. El backend activa su simulador (modo SIMULACIÓN) y empieza a publicar telemetría por WebSocket.
3. El dashboard muestra en vivo: FC, SpO2, mapa/LiDAR, trayectoria, navegación y alertas.
4. Click en **Finalizar sesión** → se calculan estadísticas finales y se guardan en el backend.
5. **Historial** → lista todas las sesiones guardadas, cada una se puede abrir para ver el detalle completo.
6. **Exportar sesión** → descarga un CSV con las estadísticas de la sesión.
7. **Sistema** → diagnóstico de todos los componentes (ROS2, WebSocket, LiDAR, Odometry, TF, HR, SpO2, Nav2).

---

## Próximos pasos hacia ROS 2 real

1. **Sensor real de signos vitales.** Hoy no existe ningún tópico ROS que
   publique frecuencia cardíaca ni SpO₂: el puente los genera con los mismos
   umbrales que el simulador. Cuando exista el hardware, suscribirse a su
   tópico y lanzar el puente con `simulate_vitals:=false`.
2. Añadir exportación a PDF (actualmente solo CSV) con gráfica de signos vitales
   e imagen del recorrido.
3. Añadir autenticación básica si se despliega en un entorno clínico real.

Ya resuelto: el puente (`wheelchair_bridge`) y la conmutación automática de
modo, que el backend decide según haya o no un puente conectado.
