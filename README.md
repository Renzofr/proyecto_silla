# Proyecto Silla

Sistema de monitorización y navegación para una silla de ruedas con React,
FastAPI, ROS 2 Jazzy y Gazebo Harmonic.

## Clonar el repositorio desde Ubuntu

Desde una terminal, crear la carpeta de proyectos, clonar el repositorio por
SSH y entrar en la carpeta del proyecto:

```bash
mkdir -p ~/Proyecto_silla
cd ~/Proyecto_silla
git clone git@github.com:Renzofr/proyecto_silla.git .
```

Para comprobar que el repositorio se clonó correctamente:

```bash
pwd
git status
```

## Estructura

- `chair-tracker-backend/`: backend FastAPI y frontend React.
- `wheel_ws/`: workspace ROS 2 con Gazebo, Nav2 y el puente ROS-Web.

## Opción rápida: aplicación web simulada

Esta opción no necesita Gazebo ni ROS 2. El backend genera telemetría
simulada para probar la interfaz.

### Terminal 1: backend

```bash
cd /home/renzofr/Proyecto_silla/chair-tracker-backend
source backend/venv/bin/activate
python -m uvicorn backend.server:app --reload --port 8000
```

### Terminal 2: frontend

```bash
cd /home/renzofr/Proyecto_silla/chair-tracker-backend/frontend
npm install
npm run dev
```

Abrir http://localhost:5173 y pulsar **Iniciar sesión**.

## Opción completa: ROS 2 + Gazebo + aplicación web

Requisitos: Ubuntu 24.04, ROS 2 Jazzy, Gazebo Harmonic y Node.js 18 o
posterior.

### Preparación inicial

Ejecutar una vez:

```bash
cd /home/renzofr/Proyecto_silla/wheel_ws
source /opt/ros/jazzy/setup.bash
rosdep install --from-paths src --ignore-src -r -y
colcon build --symlink-install
```

Si el paquete `websockets` no está instalado en el entorno del backend:

```bash
cd /home/renzofr/Proyecto_silla/chair-tracker-backend
source backend/venv/bin/activate
pip install -r backend/requirements.txt
```

### Terminal 1: backend

```bash
cd /home/renzofr/Proyecto_silla/chair-tracker-backend
source backend/venv/bin/activate
python -m uvicorn backend.server:app --reload --port 8000
```

### Terminal 2: frontend

```bash
cd /home/renzofr/Proyecto_silla/chair-tracker-backend/frontend
npm install
npm run dev
```

### Terminal 3: Gazebo

```bash
cd /home/renzofr/Proyecto_silla/wheel_ws
unset COLCON_PREFIX_PATH AMENT_PREFIX_PATH
source /opt/ros/jazzy/setup.bash
source install/setup.bash
ros2 launch silla_ruedas gazebo.launch.py rviz:=true
```

### Terminal 4: Nav2

```bash
cd /home/renzofr/Proyecto_silla/wheel_ws
unset COLCON_PREFIX_PATH AMENT_PREFIX_PATH
source /opt/ros/jazzy/setup.bash
source install/setup.bash
ros2 launch silla_ruedas nav2.launch.py
```

### Terminal 5: puente ROS-Web

```bash
cd /home/renzofr/Proyecto_silla/wheel_ws
unset COLCON_PREFIX_PATH AMENT_PREFIX_PATH
source /opt/ros/jazzy/setup.bash
source install/setup.bash
export PYTHONPATH=/home/renzofr/Proyecto_silla/chair-tracker-backend/backend/venv/lib/python3.12/site-packages:$PYTHONPATH
ros2 run silla_ruedas telemetry_bridge
```

Ahora abrir http://localhost:5173. Al elegir un destino, el bridge carga las
coordenadas desde [config/habitaciones.yaml](wheel_ws/src/Silla_ruedas/config/habitaciones.yaml)
y envía la meta a Nav2.

## Crear un mapa con SLAM

Con Gazebo activo, sustituir Nav2 por estas terminales:

```bash
# Terminal adicional
cd /home/renzofr/Proyecto_silla/wheel_ws
source /opt/ros/jazzy/setup.bash
source install/setup.bash
ros2 launch silla_ruedas slam.launch.py
```

En otra terminal, mover la silla:

```bash
ros2 run teleop_twist_keyboard teleop_twist_keyboard
```

Guardar el mapa:

```bash
ros2 run nav2_map_server map_saver_cli \
	-f /home/renzofr/Proyecto_silla/wheel_ws/src/Silla_ruedas/maps/mi_mapa
```

## Coordenadas de destinos

Editar [config/habitaciones.yaml](wheel_ws/src/Silla_ruedas/config/habitaciones.yaml)
con los campos `x`, `y`, `qz` y `qw`. Después recompilar:

```bash
cd /home/renzofr/Proyecto_silla/wheel_ws
source /opt/ros/jazzy/setup.bash
colcon build --symlink-install --packages-select silla_ruedas
```

El backend y el frontend deben estar activos antes de iniciar el bridge. El
puerto del backend es `8000` y el del frontend es `5173`.
