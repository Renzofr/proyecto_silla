# wheelchair-web

Aplicación web de monitorización para una silla de ruedas autónoma: signos
vitales, mapa, trayectoria y navegación en tiempo real.

**Backend** FastAPI + WebSocket + SQLite · **Frontend** React + Vite

Funciona de dos formas:

- **Sola**, con un simulador interno que genera telemetría coherente. No
  necesita ROS ni Gazebo.
- **Conectada a la silla**, recibiendo datos reales de ROS 2 a través del
  paquete `wheelchair_bridge`.

---

## Índice

- [Los dos repositorios](#los-dos-repositorios)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Lanzar](#lanzar)
- [El puente con ROS](#el-puente-con-ros)
- [Solución de problemas](#solución-de-problemas)
- [Documentación adicional](#documentación-adicional)

---

## Los dos repositorios

| Repositorio | Contenido |
|---|---|
| [`Renzofr/wheelchair-web`](https://github.com/Renzofr/wheelchair-web) | **Este repo.** Backend FastAPI + frontend React |
| [`Renzofr/wheelchair-ros`](https://github.com/Renzofr/wheelchair-ros) | Paquetes ROS 2: robot, navegación, arranque y el puente |

```
wheelchair-web/
├── backend/            API FastAPI + WebSocket + SQLite
├── frontend/           Interfaz React + Vite
├── docker/             docker-compose.yml y Dockerfiles
└── docs/               Arquitectura, endpoints y modelo de datos
```

> **La parte de ROS no se documenta aquí.** Crear el workspace, clonar los
> paquetes, instalar dependencias y compilar con `colcon` está explicado en el
> **[README de `wheelchair-ros`](https://github.com/Renzofr/wheelchair-ros)**,
> que además cubre la instalación por Docker. Este README asume que, si vas a
> usar la silla, ya seguiste esos pasos.

---

## Requisitos

Para la web sola, basta con **una** de estas dos opciones:

| Opción | Requisitos |
|---|---|
| **Ubuntu 24.04 nativo** | Python 3.10+ y Node.js 18+ |
| **Docker** *(alternativa)* | Docker con `docker compose` v2 |

Para el sistema completo, además: ROS 2 Jazzy y Gazebo Harmonic, con el
workspace ya montado según el repo de ROS.

Con Docker no hace falta instalar nada de eso: lo traen las imágenes.

---

## Instalación

### 1. Clonar

```bash
git clone git@github.com:Renzofr/wheelchair-web.git ~/wheelchair-web
cd ~/wheelchair-web
```

Todas las rutas de este README asumen `~/wheelchair-web`.

### 2. Elegir cómo instalar

<details open>
<summary><b>En Ubuntu 24.04</b></summary>

**Backend:**

```bash
cd ~/wheelchair-web
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt
```

**Frontend:**

```bash
cd ~/wheelchair-web/frontend
npm install
cp .env.example .env
```

Ajusta `VITE_API_BASE_URL` en `.env` solo si el backend no corre en
`localhost:8000`.

> El `venv` **no se versiona**: cada máquina crea el suyo. Un entorno virtual
> lleva rutas absolutas y depende de la versión exacta de Python, así que uno
> copiado de otra máquina falla con `No module named uvicorn`. Si te ocurre,
> bórralo y repite este bloque.

</details>

<details>
<summary><b>Con Docker (alternativa) — no instala nada en el sistema</b></summary>

No hay paso de instalación: la primera vez que levantes el stack, Docker
construye las imágenes solo.

Salta directo a [Lanzar](#lanzar).

| Servicio | Imagen base | Puerto |
|---|---|---|
| `backend` | `python:3.12-slim` | 8000 |
| `frontend` | `node:20-slim` | 5173 |

</details>

---

## Lanzar

Dos entornos posibles. Elige uno y sigue solo ese bloque: dentro de cada uno
está tanto la web sola como el sistema completo.

Docker es la alternativa: sirve si no quieres instalar Python, Node, ROS ni
Gazebo en tu máquina, o si necesitas que el entorno sea idéntico en varios
equipos.

<details open>
<summary><b>🐧 Con Ubuntu 24.04 nativo</b></summary>

Requiere haber hecho la [instalación nativa](#instalación). Para el sistema
completo, además ROS 2 Jazzy y Gazebo Harmonic, con el workspace ya compilado
según el [repo de ROS](https://github.com/Renzofr/wheelchair-ros).

#### Solo la web

**Terminal 1 — Backend**

```bash
cd ~/wheelchair-web
source backend/venv/bin/activate
python -m uvicorn backend.server:app --reload --port 8000
```

**Terminal 2 — Frontend**

```bash
cd ~/wheelchair-web/frontend
npm run dev
```

#### Sistema completo

Las dos terminales anteriores, más estas dos:

**Terminal 3 — La simulación**

```bash
cd ~/wheel_ws
source /opt/ros/jazzy/setup.bash
source install/setup.bash
ros2 launch wheelchair_bringup simulation.launch.py
```

**Terminal 4 — El puente**

```bash
cd ~/wheel_ws
source /opt/ros/jazzy/setup.bash
source install/setup.bash
ros2 run wheelchair_bridge telemetry_bridge
```

> Si ya tienes otro workspace cargado desde el `.bashrc` y ves conflictos,
> añade `unset COLCON_PREFIX_PATH AMENT_PREFIX_PATH` antes de los `source`.

</details>

<details>
<summary><b>🐳 Con Docker (alternativa)</b></summary>

No necesitas Python, Node, ROS ni Gazebo instalados: todo va en contenedores.

#### Solo la web

```bash
cd ~/wheelchair-web/docker
docker compose up --build
```

Detener con `Ctrl+C` y después `docker compose down`.

El código está montado en vivo: editar un `.py` reinicia uvicorn y editar un
`.jsx` recarga el navegador. Solo hay que repetir el `--build` si cambias
`requirements.txt` o `package.json`.

> Los comandos se ejecutan **desde `docker/`**, que es donde vive el
> `docker-compose.yml`. El contexto de build es la raíz del repositorio, así
> que las imágenes sí ven `backend/` y `frontend/`.

#### Sistema completo

Necesitas también el repositorio
[`wheelchair-ros`](https://github.com/Renzofr/wheelchair-ros) clonado: trae su
propio contenedor con Jazzy y Gazebo ya instalados.

**Terminal 1 — La web**

```bash
cd ~/wheelchair-web/docker
docker compose up
```

**Terminal 2 — La simulación**

```bash
cd ~/wheel_ws/src/wheelchair_ros/docker
docker compose up -d
docker exec -it wheelchair_ros bash
```

Ya dentro del contenedor, la primera vez hay que compilar:

```bash
colcon build --symlink-install
source install/setup.bash
ros2 launch wheelchair_bringup simulation.launch.py
```

**Terminal 3 — El puente**

```bash
docker exec -it wheelchair_ros bash
source install/setup.bash
ros2 run wheelchair_bridge telemetry_bridge
```

> El contenedor de ROS usa `network_mode: host`, así que alcanza el backend en
> `localhost:8000` sin configurar nada. Los `build/`, `install/` y `log/` viven
> en volúmenes de Docker: no ensucian tu disco y sobreviven a los reinicios.

Para detener todo:

```bash
cd ~/wheelchair-web/docker               && docker compose down
cd ~/wheel_ws/src/wheelchair_ros/docker  && docker compose down
```

</details>

### Una vez arriba

| | |
|---|---|
| **Interfaz** | http://localhost:5173 → pulsar **Iniciar sesión** |
| API | http://localhost:8000/api |
| Swagger | http://localhost:8000/docs |

Sin el puente, la web muestra telemetría del **simulador interno** del
backend. En cuanto el puente conecta, el backend apaga ese simulador y los
datos pasan a ser los reales de Gazebo: elige un destino y la meta viaja hasta
Nav2.

> Lanza siempre **la web primero**. Si el puente arranca antes que el backend,
> se queda reintentando hasta encontrarlo.

---

## El puente con ROS

`wheelchair_bridge` traduce los tópicos de ROS al formato del backend, y
devuelve a Nav2 los destinos elegidos en la web.

```
Gazebo / robot real                 wheelchair_bridge              backend
  /scan  (LaserScan)  ────────────►  lidar      ───┐
  /odom  (Odometry)   ────────────►  pose       ───┼──ws──►  /api/ws/telemetry/ingest
                                     navigation ───┤                    │
                                     vitals     ───┘                    ▼
                                                                 /api/ws/telemetry
                                                                        │
                                                                        ▼
  Nav2  ◄──── habitaciones.yaml ◄──── destination  ◄──ws──────────  frontend
```

Si el puente se cae, reconecta solo con reintentos crecientes (1 s, 2 s, 4 s…
hasta 30 s) y el estado de la web vuelve a `DESCONECTADO`.

> ⚠️ **Los signos vitales son simulados.** El robot no tiene sensor de
> frecuencia cardíaca ni de SpO₂, y no existe ningún tópico ROS que los
> publique. El puente los genera con los mismos umbrales que el simulador del
> backend (FC: alerta <60 o >110; SpO₂: alerta <92) para que la interfaz
> funcione completa. **La posición, el LiDAR y la navegación sí son reales.**

<details>
<summary><b>Parámetros del puente</b></summary>

```bash
ros2 run wheelchair_bridge telemetry_bridge --ros-args \
  -p backend_url:=ws://192.168.1.50:8000/api/ws/telemetry/ingest \
  -p lidar_rate_hz:=2.0
```

| Parámetro | Defecto | Para qué |
|---|---|---|
| `backend_url` | `ws://localhost:8000/api/ws/telemetry/ingest` | Si el backend está en otra máquina |
| `habitaciones_file` | el de `wheelchair_bringup` | Usar otro fichero de destinos |
| `simulate_vitals` | `true` | Poner en `false` cuando exista el sensor |
| `lidar_rate_hz` | `5.0` | Bajarlo si la red va justa: son 360 valores por mensaje |
| `pose_rate_hz` | `10.0` | Frecuencia de la posición |
| `vitals_rate_hz` | `1.0` | Frecuencia de los signos vitales |
| `arrival_hold_s` | `3.0` | Cuánto se muestra `LLEGADA` antes de volver a `REPOSO` |

</details>

<details>
<summary><b>El contrato, por si lo quieres extender</b></summary>

El backend expone un WebSocket bidireccional en
`ws://localhost:8000/api/ws/telemetry/ingest`:

- **Entrante** (puente → backend): `{"type": "...", "data": {...}}`, donde
  `type` es uno de `vitals`, `pose`, `lidar`, `navigation`, `alert`,
  `connection`. Los tipos están definidos en
  [`backend/models/telemetry.py`](backend/models/telemetry.py).
- **Saliente** (backend → puente):
  `{"type": "destination", "data": {"destination": "..."}}`.

Los destinos que ofrece la interfaz están en `DESTINATIONS`
([`frontend/src/App.jsx`](frontend/src/App.jsx)) y deben coincidir con las
claves de `habitaciones.yaml`, que vive en el paquete `wheelchair_bringup`.

</details>

---

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `address already in use` al levantar Docker | Los puertos 8000 o 5173 están ocupados. Cierra el `uvicorn` o el `npm run dev` que tengas a mano. |
| El frontend no recibe datos | Comprobar que responde http://localhost:8000/api/health y revisar `VITE_API_BASE_URL` en `frontend/.env`. |
| `ModuleNotFoundError: uvicorn` | El `venv` es de otra máquina o de otra versión de Python. Bórralo y rehaz la instalación nativa. |
| La web sigue en `DESCONECTADO` con el puente lanzado | El puente no alcanza el backend. Mira sus logs: reintenta cada pocos segundos e imprime el motivo. |
| Los datos parecen inventados | Es el simulador interno. Solo se apaga cuando un puente conecta al `ingest`. |
| `ModuleNotFoundError: websockets` en el puente | `sudo apt install python3-websockets` |

Los problemas de la parte ROS (Gazebo, Nav2, TF, RViz) están en el
[repo de ROS](https://github.com/Renzofr/wheelchair-ros).

---

## Puertos

| Servicio | Puerto |
|---|---|
| Backend (FastAPI) | `8000` |
| Frontend (Vite) | `5173` |

---

## Documentación adicional

| Documento | Dónde | Contenido |
|---|---|---|
| [`docs/arquitectura.md`](docs/arquitectura.md) | Este repo | Endpoints REST/WS, modelo de datos, flujo de sesiones |
| `README.md` | [`wheelchair-ros`](https://github.com/Renzofr/wheelchair-ros) | Los cuatro paquetes, workspace, instalación y uso |
| `docs/SETUP.md` | [`wheelchair-ros`](https://github.com/Renzofr/wheelchair-ros) | Frames TF, plugins de Gazebo, odometría, diagnóstico |
