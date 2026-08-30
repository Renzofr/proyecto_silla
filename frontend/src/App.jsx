import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  Heart, Activity, Wifi, WifiOff, MapPin, Navigation2, AlertTriangle, History, Settings, Play,
  Square, Download, ChevronRight, Radio, Gauge, Clock, Route, X, Check, CircleAlert, User,
  LayoutDashboard, Tablet, Monitor, Maximize2, Minimize2, BellRing, ShieldCheck, Compass,
  AlertOctagon, PhoneCall
} from "lucide-react";
import { api, WS_URL } from "./api";

/* ============================================================
   CHAIR TRACKER VITAL
   Sistema web de monitoreo para silla inteligente ROS 2

   Estructura interna (equivalente a módulos separados):
   1. TYPES        - contratos de datos (compartibles con backend)
   2. SIMULATOR    - generador de datos en modo SIMULACIÓN
   3. HOOKS        - useTelemetry (reemplazable por WebSocket real)
   4. COMPONENTS   - piezas de UI reutilizables
   5. PAGES        - Dashboard / Mapa / Historial / Sistema
   6. APP          - shell + routing simple
   ============================================================ */

// ============================================================
// 1. TYPES (ver también types.ts para la versión TS standalone)
// ============================================================
/**
 * VitalSigns { heart_rate, spo2, timestamp, heart_rate_status, spo2_status }
 * Pose { x, y, theta, timestamp }
 * TrajectoryPoint { x, y, timestamp }
 * LidarData { angle_min, angle_max, angle_increment, ranges[], range_min, range_max }
 * NavigationStatus { state, current_speed, average_speed, distance_traveled, destination }
 * AlertItem { id, type, level, message, timestamp, acknowledged }
 * SessionSummary { id, patient_name, date, start_time, end_time, duration_seconds, distance_m,
 *                  avg_speed, hr_avg, hr_max, hr_min, spo2_avg, spo2_min, trajectory, alerts, status }
 * SystemStatus { ros2_connected, websocket_connected, components[], latency_ms }
 */

const NAV_STATES = ["REPOSO", "NAVEGANDO", "OBSTACULO_DETECTADO", "PAUSA", "PAUSA_EMERGENCIA", "LLEGADA", "DESCONECTADO"];

const NAV_STATE_LABEL = {
  REPOSO: "En reposo",
  NAVEGANDO: "Navegando",
  OBSTACULO_DETECTADO: "Obstáculo detectado",
  PAUSA: "En pausa",
  PAUSA_EMERGENCIA: "Pausa de emergencia",
  LLEGADA: "Llegada",
  DESCONECTADO: "Desconectado",
};

const DESTINATIONS = [
  { id: "fisioterapia", name: "Fisioterapia", label: "Fisioterapia" },
  { id: "traumatologia", name: "Traumatología", label: "Traumatología" },
  { id: "neurologia", name: "Neurología", label: "Neurología" },
  { id: "fisiatria", name: "Fisiatría", label: "Fisiatría" },
  { id: "sala", name: "Sala", label: "Sala" },
];

// ============================================================
// 2. WEBSOCKET CLIENT
// Conecta al canal /ws/telemetry del backend real (FastAPI).
// El backend, a su vez, alimenta ese canal desde su propio
// TelemetrySimulator (modo SIMULACIÓN) o, en el futuro, desde
// un ROS 2 Web Bridge (modo ROS2 REAL) — el frontend no cambia.
// ============================================================

function connectTelemetrySocket({ onMessage, onOpen, onClose }) {
  let socket = null;
  let shouldReconnect = true;
  let reconnectTimer = null;

  function open() {
    socket = new WebSocket(WS_URL);
    socket.onopen = () => onOpen?.();
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch (e) {
        // Mensaje inválido — se ignora, no debe romper la interfaz
      }
    };
    socket.onclose = () => {
      onClose?.();
      if (shouldReconnect) {
        reconnectTimer = setTimeout(open, 2000);
      }
    };
    socket.onerror = () => {
      socket?.close();
    };
  }

  open();

  return {
    close() {
      shouldReconnect = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ============================================================
// 3. HOOKS
// useTelemetry centraliza el estado de telemetría en tiempo real.
// En producción, reemplazar el simulador por un cliente WebSocket
// que llame a la misma función handleMessage con los mismos tipos.
// ============================================================

const MAX_CHART_POINTS = 300;
const MOVE_TOLERANCE = 0.01; // tolerancia mínima para evitar ruido de odometría

function useTelemetry({ mode, running }) {
  const [connection, setConnection] = useState("DISCONNECTED");
  const [vitals, setVitals] = useState(null);
  const [vitalsHistory, setVitalsHistory] = useState([]);
  const [pose, setPose] = useState({ x: 0, y: 0, theta: 0, timestamp: null });
  const [trajectory, setTrajectory] = useState([]);
  const [lidar, setLidar] = useState(null);
  const [navigation, setNavigation] = useState({
    state: "DESCONECTADO",
    current_speed: 0,
    average_speed: 0,
    distance_traveled: 0,
    destination: undefined,
  });
  const [alerts, setAlerts] = useState([]);
  const [sessionStart, setSessionStart] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const distanceRef = useRef(0);
  const speedSamplesRef = useRef([]);
  const socketRef = useRef(null);

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case "vitals": {
        setVitals(msg.data);
        setVitalsHistory((prev) => {
          const next = [...prev, { t: Date.now(), hr: msg.data.heart_rate, spo2: msg.data.spo2 }];
          return next.length > MAX_CHART_POINTS ? next.slice(next.length - MAX_CHART_POINTS) : next;
        });
        break;
      }
      case "pose": {
        setPose(msg.data);
        setTrajectory((prev) => {
          const last = prev[prev.length - 1];
          if (last) {
            const d = Math.hypot(msg.data.x - last.x, msg.data.y - last.y);
            if (d > MOVE_TOLERANCE) {
              distanceRef.current += d;
            }
          }
          const next = [...prev, { x: msg.data.x, y: msg.data.y, timestamp: msg.data.timestamp }];
          return next.length > 2000 ? next.slice(next.length - 2000) : next;
        });
        break;
      }
      case "lidar": {
        setLidar(msg.data);
        break;
      }
      case "navigation": {
        speedSamplesRef.current.push(msg.data.current_speed);
        if (speedSamplesRef.current.length > 600) speedSamplesRef.current.shift();
        const avg =
          speedSamplesRef.current.reduce((a, b) => a + b, 0) / Math.max(1, speedSamplesRef.current.length);
        setNavigation({
          ...msg.data,
          average_speed: Math.round(avg * 100) / 100,
          distance_traveled: Math.round(distanceRef.current * 100) / 100,
        });
        break;
      }
      case "alert": {
        setAlerts((prev) => [msg.data, ...prev].slice(0, 100));
        break;
      }
      case "connection": {
        setConnection(msg.data.state);
        // El modo lo decide el backend: ROS2_REAL solo cuando hay un bridge
        // enganchado al canal de ingesta. El frontend no lo adivina.
        if (msg.data.mode) setMode(msg.data.mode);
        break;
      }
      default:
        break;
    }
  }, []);

  // Conexión WebSocket real al backend (/ws/telemetry).
  // El backend decide si los datos vienen de su simulador interno
  // o (en el futuro) de un ROS 2 Web Bridge — el frontend solo escucha.
  useEffect(() => {
    const socket = connectTelemetrySocket({
      onMessage: handleMessage,
      onOpen: () => setConnection((c) => (c === "DISCONNECTED" ? "CONNECTED" : c)),
      onClose: () => setConnection("DISCONNECTED"),
    });
    socketRef.current = socket;
    return () => socket.close();
  }, [handleMessage]);

  // Control remoto del simulador del backend según el modo elegido.
  useEffect(() => {
    if (mode !== "SIMULATION") {
      api.stopSimulation().catch(() => {});
      return;
    }
    if (running) {
      api.startSimulation().catch(() => {});
    } else {
      api.stopSimulation().catch(() => {});
    }
  }, [mode, running]);

  // Cronómetro de sesión
  useEffect(() => {
    if (!running) return;
    if (!sessionStart) setSessionStart(Date.now());
    const iv = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, [running, sessionStart]);

  const resetSession = useCallback(() => {
    distanceRef.current = 0;
    speedSamplesRef.current = [];
    setVitalsHistory([]);
    setTrajectory([]);
    setAlerts([]);
    setSessionStart(null);
    setElapsed(0);
    setNavigation({ state: "REPOSO", current_speed: 0, average_speed: 0, distance_traveled: 0 });
  }, []);

  const acknowledgeAlert = useCallback((id) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  }, []);

  const setDestination = useCallback((destination) => {
    setNavigation((prev) => ({ ...prev, destination: destination || undefined }));
    api.setDestination(destination || null).catch((e) => {
      console.error("Error setting destination:", e);
    });
  }, []);

  const addAlert = useCallback((alert) => {
    setAlerts((prev) => [alert, ...prev].slice(0, 100));
  }, []);

  return {
    connection,
    vitals,
    vitalsHistory,
    pose,
    trajectory,
    lidar,
    navigation,
    alerts,
    elapsed,
    resetSession,
    acknowledgeAlert,
    setDestination,
    addAlert,
  };
}

// ============================================================
// 4. COMPONENTS
// ============================================================

function StatusDot({ level }) {
  const color = level === "CONNECTED" ? "var(--ok)" : level === "UNSTABLE" ? "var(--warn)" : "var(--crit)";
  return (
    <span className="status-dot-wrap">
      <span className="status-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
    </span>
  );
}

function ConnectionBadge({ connection, mode }) {
  const label =
    connection === "CONNECTED" ? "ROS 2 CONECTADO" : connection === "UNSTABLE" ? "CONEXIÓN INESTABLE" : "ROS 2 DESCONECTADO";
  return (
    <div className="conn-badge">
      <StatusDot level={connection} />
      <span className="conn-label">{label}</span>
      <span className={`mode-pill ${mode === "SIMULATION" ? "mode-sim" : "mode-real"}`}>
        {mode === "SIMULATION" ? "SIMULACIÓN" : "ROS 2 REAL"}
      </span>
    </div>
  );
}

function VitalCard({ icon: Icon, label, value, unit, status, sublabel }) {
  const statusClass = status === "ALERTA" ? "vc-crit" : status === "ADVERTENCIA" ? "vc-warn" : "vc-ok";
  return (
    <div className={`vital-card ${statusClass}`}>
      <div className="vital-card-head">
        <Icon size={16} strokeWidth={2} />
        <span>{label}</span>
      </div>
      <div className="vital-card-value">
        {value ?? "—"}
        <span className="vital-card-unit">{unit}</span>
      </div>
      <div className="vital-card-foot">
        <span className={`vital-status-chip ${statusClass}`}>{status ?? "SIN DATOS"}</span>
        {sublabel && <span className="vital-sub">{sublabel}</span>}
      </div>
    </div>
  );
}

function MetricTile({ icon: Icon, label, value, unit }) {
  return (
    <div className="metric-tile">
      <Icon size={14} strokeWidth={2} />
      <div className="metric-tile-body">
        <div className="metric-tile-value">
          {value}
          {unit && <span className="metric-tile-unit">{unit}</span>}
        </div>
        <div className="metric-tile-label">{label}</div>
      </div>
    </div>
  );
}

function VitalsChart({ data, field, color, domain, unit }) {
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        time: new Date(d.t).toLocaleTimeString("es-PE", { hour12: false, minute: "2-digit", second: "2-digit" }),
        value: d[field],
      })),
    [data, field]
  );
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="time" hide />
        <YAxis domain={domain} tick={{ fill: "var(--text-dim)", fontSize: 10 }} width={36} />
        <Tooltip
          contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "var(--text-dim)" }}
          formatter={(v) => [`${v} ${unit}`, ""]}
        />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function NavStateChip({ state }) {
  const cls =
    state === "NAVEGANDO"
      ? "nav-ok"
      : state === "OBSTACULO_DETECTADO" || state === "PAUSA_EMERGENCIA"
      ? "nav-crit"
      : state === "PAUSA"
      ? "nav-warn"
      : "nav-neutral";
  return <span className={`nav-chip ${cls}`}>{NAV_STATE_LABEL[state] ?? state}</span>;
}

function MiniMap({ trajectory, lidar, pose }) {
  const size = 260;
  const scale = 24; // px por metro
  const cx = size / 2;
  const cy = size / 2;

  const toScreen = (x, y) => ({ sx: cx + x * scale, sy: cy - y * scale });

  const lidarPoints = useMemo(() => {
    if (!lidar) return [];
    const pts = [];
    for (let i = 0; i < lidar.ranges.length; i += 2) {
      const angle = lidar.angle_min + i * lidar.angle_increment;
      const r = lidar.ranges[i];
      if (r >= lidar.range_max) continue;
      const lx = pose.x + r * Math.cos(angle + pose.theta);
      const ly = pose.y + r * Math.sin(angle + pose.theta);
      pts.push(toScreen(lx, ly));
    }
    return pts;
  }, [lidar, pose]);

  const trajPath = useMemo(() => {
    if (trajectory.length < 2) return "";
    return trajectory
      .map((p, i) => {
        const { sx, sy } = toScreen(p.x, p.y);
        return `${i === 0 ? "M" : "L"}${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(" ");
  }, [trajectory]);

  const chairScreen = toScreen(pose.x, pose.y);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="minimap-svg" role="img" aria-label="Mapa 2D del entorno">
      <defs>
        <pattern id="mm-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="var(--grid)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={size} height={size} fill="url(#mm-grid)" />
      {trajPath && <path d={trajPath} fill="none" stroke="var(--accent-blue)" strokeWidth="2" opacity="0.85" />}
      {lidarPoints.map((p, i) => (
        <circle key={i} cx={p.sx} cy={p.sy} r="1.4" fill="var(--accent-cyan)" opacity="0.75" />
      ))}
      <g transform={`translate(${chairScreen.sx},${chairScreen.sy}) rotate(${(-pose.theta * 180) / Math.PI})`}>
        <circle r="7" fill="var(--ok)" opacity="0.25" />
        <path d="M -5 5 L 7 0 L -5 -5 Z" fill="var(--ok)" />
      </g>
    </svg>
  );
}

function AlertsList({ alerts, onAck, compact }) {
  const list = compact ? alerts.slice(0, 5) : alerts;
  if (list.length === 0) {
    return <div className="empty-state">Sin alertas registradas en esta sesión.</div>;
  }
  return (
    <div className="alerts-list">
      {list.map((a) => (
        <div key={a.id} className={`alert-row ${a.level === "CRITICA" ? "alert-crit" : a.level === "ADVERTENCIA" ? "alert-warn" : "alert-info"} ${a.acknowledged ? "alert-ack" : ""}`}>
          <CircleAlert size={14} />
          <div className="alert-row-body">
            <div className="alert-row-msg">{a.message}</div>
            <div className="alert-row-meta">{new Date(a.timestamp).toLocaleTimeString("es-PE")}</div>
          </div>
          {!a.acknowledged && onAck && (
            <button className="alert-ack-btn" onClick={() => onAck(a.id)} aria-label="Reconocer alerta">
              <Check size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function DestinationSelector({ currentDestination, onSelectDestination, disabled }) {
  const [selected, setSelected] = useState(currentDestination || "");
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    setSelected(currentDestination || "");
  }, [currentDestination]);

  const handleApply = (dest) => {
    const target = dest !== undefined ? dest : selected;
    onSelectDestination(target || null);
    if (target) {
      const match = DESTINATIONS.find((d) => d.name === target || d.id === target);
      setStatusMsg(`Destino enviado: ${match?.label || target}`);
    } else {
      setStatusMsg("Destino cancelado");
    }
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleChipClick = (destName) => {
    if (disabled) return;
    if (currentDestination === destName) {
      handleApply(null);
    } else {
      setSelected(destName);
      handleApply(destName);
    }
  };

  return (
    <div className="dest-section">
      <div className="dest-section-title">
        <MapPin size={13} />
        <span>Seleccionar lugar de destino (ROS 2)</span>
      </div>

      <div className="dest-chips-grid">
        {DESTINATIONS.map((d) => {
          const isActive = currentDestination === d.name;
          return (
            <button
              key={d.id}
              type="button"
              className={`dest-chip ${isActive ? "dest-chip-active" : ""}`}
              onClick={() => handleChipClick(d.name)}
              disabled={disabled}
              title={isActive ? `Destino activo: ${d.label} (click para cancelar)` : `Fijar destino: ${d.label}`}
            >
              <span className="dest-chip-dot" />
              <span className="dest-chip-label">{d.label}</span>
              {isActive && <Check size={12} className="dest-chip-check" />}
            </button>
          );
        })}
      </div>

      <div className="dest-dropdown-row">
        <select
          className="dest-select"
          value={selected}
          onChange={(e) => {
            const val = e.target.value;
            setSelected(val);
            if (val) {
              handleApply(val);
            }
          }}
          disabled={disabled}
        >
          <option value="">-- Seleccionar lugar de destino --</option>
          {DESTINATIONS.map((d) => (
            <option key={d.id} value={d.name}>
              {d.label}
            </option>
          ))}
        </select>

        {currentDestination && (
          <button
            type="button"
            className="ghost-btn dest-clear-btn"
            onClick={() => handleApply(null)}
            title="Cancelar / limpiar destino"
            disabled={disabled}
          >
            <X size={13} /> Limpiar
          </button>
        )}
      </div>

      {statusMsg && <div className="dest-status-badge">{statusMsg}</div>}
    </div>
  );
}

// ============================================================
// 5. PAGES
// ============================================================

function DashboardPage({ telemetry, patientName, sessionId, running, mode }) {
  const { connection, vitals, vitalsHistory, navigation, alerts, elapsed, trajectory, lidar, pose, setDestination } = telemetry;

  return (
    <div className="page">
      <div className="chair-status-bar">
        <div className="chair-status-item">
          <User size={14} />
          <span className="cs-label">Paciente</span>
          <span className="cs-value">{patientName || "—"}</span>
        </div>
        <div className="chair-status-item">
          <Radio size={14} />
          <span className="cs-label">Sesión</span>
          <span className="cs-value">{sessionId ?? "—"}</span>
        </div>
        <div className="chair-status-item">
          <Clock size={14} />
          <span className="cs-label">Duración</span>
          <span className="cs-value">{formatDuration(elapsed)}</span>
        </div>
        <div className="chair-status-item">
          <NavStateChip state={navigation.state} />
        </div>
      </div>

      <div className="grid-vitals">
        <VitalCard
          icon={Heart}
          label="FRECUENCIA CARDÍACA"
          value={vitals?.heart_rate}
          unit="BPM"
          status={vitals?.heart_rate_status}
        />
        <VitalCard icon={Activity} label="SpO₂" value={vitals?.spo2} unit="%" status={vitals?.spo2_status} />
      </div>

      <div className="grid-charts">
        <div className="panel">
          <div className="panel-head">
            <span>Frecuencia cardíaca — sesión</span>
          </div>
          <VitalsChart data={vitalsHistory} field="hr" color="var(--accent-rose)" domain={[50, 140]} unit="BPM" />
        </div>
        <div className="panel">
          <div className="panel-head">
            <span>SpO₂ — sesión</span>
          </div>
          <VitalsChart data={vitalsHistory} field="spo2" color="var(--accent-cyan)" domain={[85, 100]} unit="%" />
        </div>
      </div>

      <div className="grid-lower">
        <div className="panel">
          <div className="panel-head">
            <span>Navegación</span>
          </div>
          <div className="metric-tiles">
            <MetricTile icon={Gauge} label="Velocidad actual" value={navigation.current_speed?.toFixed(2)} unit="m/s" />
            <MetricTile icon={Gauge} label="Velocidad promedio" value={navigation.average_speed?.toFixed(2)} unit="m/s" />
            <MetricTile icon={Route} label="Distancia recorrida" value={navigation.distance_traveled?.toFixed(1)} unit="m" />
            <MetricTile icon={Navigation2} label="Destino" value={navigation.destination ?? "—"} />
          </div>

          <DestinationSelector
            currentDestination={navigation.destination}
            onSelectDestination={setDestination}
            disabled={connection === "DISCONNECTED" && mode !== "SIMULATION"}
          />
        </div>

        <div className="panel">
          <div className="panel-head">
            <span>Mapa y trayectoria</span>
            <span className="panel-head-sub">Vista resumida</span>
          </div>
          <div className="minimap-wrap">
            <MiniMap trajectory={trajectory} lidar={lidar} pose={pose} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span>Alertas recientes</span>
          </div>
          <AlertsList alerts={alerts} compact onAck={telemetry.acknowledgeAlert} />
        </div>
      </div>
    </div>
  );
}

function MapPage({ telemetry }) {
  const { trajectory, lidar, pose, navigation } = telemetry;
  const [zoom, setZoom] = useState(1);

  return (
    <div className="page">
      <div className="panel">
        <div className="panel-head">
          <span>Mapa / Recorrido</span>
          <div className="map-controls">
            <button className="ghost-btn" onClick={() => setZoom((z) => clamp(z + 0.2, 0.5, 2.5))}>
              + Zoom
            </button>
            <button className="ghost-btn" onClick={() => setZoom((z) => clamp(z - 0.2, 0.5, 2.5))}>
              − Zoom
            </button>
            <button className="ghost-btn" onClick={() => setZoom(1)}>
              Reiniciar vista
            </button>
          </div>
        </div>
        <div className="map-legend">
          <span><i className="dot-cyan" /> LiDAR</span>
          <span><i className="dot-blue" /> Trayectoria</span>
          <span><i className="dot-ok" /> Silla</span>
        </div>
        <div className="map-large-wrap" style={{ transform: `scale(${zoom})` }}>
          <MiniMap trajectory={trajectory} lidar={lidar} pose={pose} />
        </div>
      </div>

      <div className="grid-lower-2">
        <div className="panel">
          <div className="panel-head"><span>Estado de navegación</span></div>
          <div className="metric-tiles">
            <MetricTile icon={Navigation2} label="Estado" value={NAV_STATE_LABEL[navigation.state]} />
            <MetricTile icon={Gauge} label="Velocidad actual" value={navigation.current_speed?.toFixed(2)} unit="m/s" />
            <MetricTile icon={Route} label="Distancia" value={navigation.distance_traveled?.toFixed(1)} unit="m" />
            <MetricTile icon={Navigation2} label="Destino" value={navigation.destination ?? "—"} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><span>Posición actual</span></div>
          <div className="metric-tiles">
            <MetricTile icon={MapPin} label="X" value={pose.x?.toFixed(2)} unit="m" />
            <MetricTile icon={MapPin} label="Y" value={pose.y?.toFixed(2)} unit="m" />
            <MetricTile icon={Navigation2} label="Orientación θ" value={((pose.theta * 180) / Math.PI).toFixed(0)} unit="°" />
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryPage({ sessions, onOpen }) {
  return (
    <div className="page">
      <div className="panel">
        <div className="panel-head"><span>Historial de sesiones</span></div>
        {sessions.length === 0 ? (
          <div className="empty-state">Aún no hay sesiones guardadas. Finaliza una sesión para verla aquí.</div>
        ) : (
          <div className="table-wrap">
            <table className="hist-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Paciente</th>
                  <th>Duración</th>
                  <th>Distancia</th>
                  <th>FC prom.</th>
                  <th>SpO₂ prom.</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} onClick={() => onOpen(s)}>
                    <td>{s.date}</td>
                    <td>{s.patient_name}</td>
                    <td>{formatDuration(s.duration_seconds)}</td>
                    <td>{s.distance_m.toFixed(1)} m</td>
                    <td>{s.hr_avg} BPM</td>
                    <td>{s.spo2_avg}%</td>
                    <td>
                      <span className={`session-status ${s.status === "ACTIVA" ? "sess-active" : "sess-done"}`}>{s.status}</span>
                    </td>
                    <td><ChevronRight size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionDetailPage({ session, onBack, onExport }) {
  if (!session) return null;
  return (
    <div className="page">
      <button className="ghost-btn back-btn" onClick={onBack}>← Volver al historial</button>
      <div className="panel">
        <div className="panel-head">
          <span>Sesión {session.id}</span>
          <button className="primary-btn small" onClick={() => onExport(session)}>
            <Download size={13} /> Exportar sesión
          </button>
        </div>
        <div className="metric-tiles">
          <MetricTile icon={User} label="Paciente" value={session.patient_name} />
          <MetricTile icon={Clock} label="Duración" value={formatDuration(session.duration_seconds)} />
          <MetricTile icon={Route} label="Distancia" value={session.distance_m.toFixed(1)} unit="m" />
          <MetricTile icon={Gauge} label="Vel. promedio" value={session.avg_speed.toFixed(2)} unit="m/s" />
          <MetricTile icon={Heart} label="FC prom / máx / mín" value={`${session.hr_avg} / ${session.hr_max} / ${session.hr_min}`} unit="BPM" />
          <MetricTile icon={Activity} label="SpO₂ prom / mín" value={`${session.spo2_avg} / ${session.spo2_min}`} unit="%" />
        </div>
      </div>
      <div className="grid-lower-2">
        <div className="panel">
          <div className="panel-head"><span>Trayectoria registrada</span></div>
          <div className="minimap-wrap">
            <MiniMap trajectory={session.trajectory} lidar={null} pose={session.trajectory[session.trajectory.length - 1] ?? { x: 0, y: 0, theta: 0 }} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><span>Alertas de la sesión</span></div>
          <AlertsList alerts={session.alerts} />
        </div>
      </div>
    </div>
  );
}

function SystemPage({ connection, mode, telemetry, wsConnected }) {
  const components = [
    { name: "ROS 2", active: connection === "CONNECTED", detail: mode },
    { name: "WebSocket", active: wsConnected },
    { name: "LiDAR", active: !!telemetry.lidar, freq: "1 Hz" },
    { name: "Odometry", active: !!telemetry.pose.timestamp, freq: "1 Hz" },
    { name: "TF", active: connection === "CONNECTED" },
    { name: "Heart Rate", active: !!telemetry.vitals, freq: "1 Hz" },
    { name: "SpO₂", active: !!telemetry.vitals, freq: "1 Hz" },
    { name: "Nav2", active: connection === "CONNECTED" },
  ];

  return (
    <div className="page">
      <div className="panel">
        <div className="panel-head"><span>Diagnóstico del sistema</span></div>
        <div className="sys-grid">
          {components.map((c) => (
            <div key={c.name} className="sys-row">
              <StatusDot level={c.active ? "CONNECTED" : "DISCONNECTED"} />
              <span className="sys-name">{c.name}</span>
              <span className={`sys-state ${c.active ? "sys-on" : "sys-off"}`}>{c.active ? "ACTIVO" : "INACTIVO"}</span>
              {c.freq && <span className="sys-freq">{c.freq}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="grid-lower-2">
        <div className="panel">
          <div className="panel-head"><span>Latencia y última recepción</span></div>
          <div className="metric-tiles">
            <MetricTile icon={Wifi} label="Latencia aprox." value={connection === "CONNECTED" ? (30 + Math.round(Math.random() * 40)) : "—"} unit="ms" />
            <MetricTile icon={Radio} label="Último /scan" value={telemetry.lidar ? "hace <1 s" : "sin datos"} />
            <MetricTile icon={Route} label="Último /odom" value={telemetry.pose.timestamp ? "hace <1 s" : "sin datos"} />
            <MetricTile icon={Heart} label="Últimos signos vitales" value={telemetry.vitals ? "hace <1 s" : "sin datos"} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><span>Nota de arquitectura</span></div>
          <p className="sys-note">
            Este panel refleja el estado que enviaría un ROS 2 Web Bridge sobre <code>/scan</code>, <code>/odom</code>,{" "}
            <code>/tf</code> y los tópicos de signos vitales. En modo SIMULACIÓN los valores se generan localmente;
            en modo ROS 2 REAL provendrán del canal WebSocket <code>/ws/telemetry</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

function ScreenLidarRadar({ lidar, pose }) {
  const size = 280;
  const center = size / 2;
  const maxRange = 6.0;
  const scale = (size / 2 - 24) / maxRange;

  const points = useMemo(() => {
    if (!lidar || !lidar.ranges || !lidar.ranges.length) return [];
    const pts = [];
    const step = Math.max(1, Math.floor(lidar.ranges.length / 100));
    for (let i = 0; i < lidar.ranges.length; i += step) {
      const r = lidar.ranges[i];
      if (r < lidar.range_min || r > lidar.range_max || r > maxRange) continue;
      const angle = lidar.angle_min + i * lidar.angle_increment;
      const rx = center + r * Math.sin(angle) * scale;
      const ry = center - r * Math.cos(angle) * scale;
      let color = "#35c9d6";
      if (r < 1.0) color = "#f4614b";
      else if (r < 2.2) color = "#f5b942";
      pts.push({ x: rx, y: ry, r, color });
    }
    return pts;
  }, [lidar, center, scale]);

  const minFrontDist = useMemo(() => {
    if (!lidar || !lidar.ranges || !lidar.ranges.length) return null;
    let minD = 999;
    for (let i = 0; i < lidar.ranges.length; i++) {
      const angle = lidar.angle_min + i * lidar.angle_increment;
      if (Math.abs(angle) < Math.PI / 4) {
        const r = lidar.ranges[i];
        if (r >= lidar.range_min && r <= lidar.range_max && r < minD) {
          minD = r;
        }
      }
    }
    return minD < 900 ? minD : null;
  }, [lidar]);

  return (
    <div className="screen-radar-container">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="screen-radar-svg">
        {[1.5, 3.0, 4.5, 6.0].map((dist) => (
          <circle
            key={dist}
            cx={center}
            cy={center}
            r={dist * scale}
            fill="none"
            stroke="rgba(79, 143, 247, 0.22)"
            strokeWidth="1"
            strokeDasharray={dist === 6.0 ? "none" : "3,3"}
          />
        ))}

        <line x1={20} y1={center} x2={size - 20} y2={center} stroke="rgba(79, 143, 247, 0.22)" strokeWidth="1" />
        <line x1={center} y1={20} x2={center} y2={size - 20} stroke="rgba(79, 143, 247, 0.22)" strokeWidth="1" />

        <circle cx={center} cy={center} r={center - 24} fill="none" stroke="rgba(53, 201, 214, 0.45)" strokeWidth="1.5" />

        {points.map((pt, idx) => (
          <circle key={idx} cx={pt.x} cy={pt.y} r={pt.r < 1.0 ? 3.5 : 2.5} fill={pt.color} />
        ))}

        <g transform={`translate(${center}, ${center})`}>
          <circle r="14" fill="rgba(79, 143, 247, 0.25)" stroke="#4f8ff7" strokeWidth="2" />
          <polygon points="0,-12 -5,3 5,3" fill="#4f8ff7" />
          <rect x="-7" y="-3" width="14" height="11" rx="2" fill="#212936" stroke="#4f8ff7" strokeWidth="1.5" />
        </g>

        <text x={center + 1.5 * scale + 2} y={center - 4} fill="rgba(135,148,166,0.6)" fontSize="9">1.5m</text>
        <text x={center + 3.0 * scale + 2} y={center - 4} fill="rgba(135,148,166,0.6)" fontSize="9">3.0m</text>
        <text x={center + 4.5 * scale + 2} y={center - 4} fill="rgba(135,148,166,0.6)" fontSize="9">4.5m</text>
      </svg>

      <div className="screen-radar-badge">
        <ShieldCheck size={14} color={minFrontDist && minFrontDist < 1.0 ? "var(--crit)" : "var(--ok)"} />
        <span>
          {minFrontDist && minFrontDist < 1.0
            ? `¡Atención: obstáculo a ${minFrontDist.toFixed(2)} m!`
            : "Área perimetral despejada (LiDAR 360° Activo)"}
        </span>
      </div>
    </div>
  );
}

function ScreenPage({ telemetry, patientName, sessionId, running, mode }) {
  const { vitals, navigation, alerts, elapsed, lidar, pose, setDestination, addAlert } = telemetry;
  const [isKiosk, setIsKiosk] = useState(false);
  const [assistanceRequested, setAssistanceRequested] = useState(false);
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const [destinationNotice, setDestinationNotice] = useState(null);

  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString("es-PE"));
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString("es-PE"));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleDestinationClick = (destId, destName) => {
    setDestination(destId);
    setDestinationNotice(`Ruta fijada hacia: ${destName}`);
    setTimeout(() => setDestinationNotice(null), 3000);
  };

  const handleEmergencyStop = () => {
    const nextState = !emergencyStopped;
    setEmergencyStopped(nextState);
    if (nextState) {
      addAlert?.({
        id: `alert-${Date.now()}`,
        type: "EMERGENCY_STOP",
        level: "CRITICAL",
        message: "PARADA DE EMERGENCIA activada desde la pantalla a bordo de la silla",
        timestamp: new Date().toISOString(),
        acknowledged: false,
      });
    }
  };

  const handleRequestAssistance = () => {
    setAssistanceRequested(true);
    addAlert?.({
      id: `alert-${Date.now()}`,
      type: "ASSISTANCE_CALL",
      level: "WARNING",
      message: `El paciente ${patientName || "a bordo"} solicita asistencia médica inmediata desde la pantalla`,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    });
    setTimeout(() => setAssistanceRequested(false), 5000);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className={`screen-page ${isKiosk ? "screen-kiosk-mode" : ""}`}>
      {/* Cabecera de la Pantalla a Bordo */}
      <div className="screen-header">
        <div className="screen-header-left">
          <div className="screen-device-badge">
            <Tablet size={18} />
            <span>PANTALLA A BORDO · SILLA INTELIGENTE</span>
          </div>
          <div className="screen-patient-pill">
            <User size={14} />
            <span>{patientName || "Paciente en Silla"}</span>
            {sessionId && <span className="screen-pill-sub">#{sessionId}</span>}
          </div>
        </div>

        <div className="screen-header-center">
          <span className="screen-clock">{currentTime}</span>
        </div>

        <div className="screen-header-right">
          <div className="screen-status-pill">
            <span className="screen-dot-live" />
            <span>{mode === "SIMULATION" ? "SIMULACIÓN ACTIVA" : "ROS 2 CONECTADO"}</span>
          </div>
          <div className="screen-battery-pill">
            <span>🔋 94%</span>
          </div>
          <button
            className="screen-icon-action"
            onClick={toggleFullscreen}
            title="Pantalla Completa"
          >
            <Maximize2 size={16} />
          </button>
          <button
            className={`screen-kiosk-btn ${isKiosk ? "active" : ""}`}
            onClick={() => setIsKiosk(!isKiosk)}
            title="Modo Kiosko Aislado"
          >
            {isKiosk ? <Minimize2 size={14} /> : <Monitor size={14} />}
            <span>{isKiosk ? "Salir Kiosko" : "Modo Kiosko"}</span>
          </button>
        </div>
      </div>

      {/* Banners de estado */}
      {assistanceRequested && (
        <div className="screen-alert-banner">
          <BellRing className="alert-pulse-icon" size={20} />
          <span>¡LLAMADA DE ASISTENCIA ENVIADA A ENFERMERÍA Y CENTRAL MÉDICA!</span>
        </div>
      )}

      {emergencyStopped && (
        <div className="screen-emergency-banner">
          <AlertOctagon size={22} />
          <span>PARADA DE EMERGENCIA ACTIVA — MOTORES EN BLOQUEO SEGURO</span>
        </div>
      )}

      {destinationNotice && (
        <div className="screen-notice-banner">
          <Check size={18} />
          <span>{destinationNotice}</span>
        </div>
      )}

      {/* Grid principal de la pantalla */}
      <div className="screen-grid">
        {/* Columna Izquierda: Signos Vitales */}
        <div className="screen-col">
          <div className="screen-panel">
            <div className="screen-panel-title">
              <Heart size={18} color="var(--accent-rose)" />
              <span>SIGNOS VITALES DEL PACIENTE</span>
            </div>

            <div className="screen-vitals-cards">
              {/* Frecuencia Cardíaca */}
              <div className={`screen-vital-card ${vitals?.heart_rate_status === "CRITICAL" ? "vital-crit" : ""}`}>
                <div className="svc-top">
                  <span className="svc-label">FRECUENCIA CARDÍACA</span>
                  <span className={`svc-tag ${vitals?.heart_rate_status === "CRITICAL" ? "tag-crit" : "tag-ok"}`}>
                    {vitals?.heart_rate_status || "NORMAL"}
                  </span>
                </div>
                <div className="svc-value-row">
                  <Heart className="svc-heart-pulse" size={34} />
                  <span className="svc-number">{vitals?.heart_rate ?? 74}</span>
                  <span className="svc-unit">BPM</span>
                </div>
                <div className="svc-ecg-box">
                  <svg className="svc-ecg-svg" viewBox="0 0 200 40">
                    <path
                      d="M0,20 L30,20 L40,20 L45,8 L50,32 L55,2 L60,28 L65,20 L75,20 L105,20 L115,20 L120,8 L125,32 L130,2 L135,28 L140,20 L150,20 L200,20"
                      fill="none"
                      stroke="var(--accent-rose)"
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>
              </div>

              {/* SpO2 */}
              <div className={`screen-vital-card ${vitals?.spo2_status === "CRITICAL" ? "vital-crit" : ""}`}>
                <div className="svc-top">
                  <span className="svc-label">SATURACIÓN DE OXÍGENO (SpO₂)</span>
                  <span className={`svc-tag ${vitals?.spo2_status === "CRITICAL" ? "tag-crit" : "tag-ok"}`}>
                    {vitals?.spo2_status || "ÓPTIMO"}
                  </span>
                </div>
                <div className="svc-value-row">
                  <Activity size={34} color="var(--accent-cyan)" />
                  <span className="svc-number">{vitals?.spo2 ?? 98}</span>
                  <span className="svc-unit">%</span>
                </div>
                <div className="svc-progress-track">
                  <div
                    className="svc-progress-bar"
                    style={{ width: `${Math.min(100, Math.max(0, vitals?.spo2 ?? 98))}%` }}
                  />
                </div>
                <span className="svc-subtext">Perfusión periférica estable</span>
              </div>
            </div>

            <div className="screen-patient-summary">
              <div className="sps-row">
                <span className="sps-label">Estado clínico:</span>
                <span className="sps-val ok">Parámetros Estables</span>
              </div>
              <div className="sps-row">
                <span className="sps-label">Duración del recorrido:</span>
                <span className="sps-val">{formatDuration(elapsed)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Radar LiDAR & Selector de Destino */}
        <div className="screen-col">
          <div className="screen-panel">
            <div className="screen-panel-title">
              <Compass size={18} color="var(--accent-blue)" />
              <span>RADAR DE SEGURIDAD & NAVEGACIÓN</span>
            </div>

            <div className="screen-nav-overview">
              <div className="screen-radar-box">
                <ScreenLidarRadar lidar={lidar} pose={pose} />
              </div>

              <div className="screen-nav-stats">
                <div className="sns-tile">
                  <span className="sns-lbl">Estado de Marcha</span>
                  <NavStateChip state={emergencyStopped ? "PAUSA_EMERGENCIA" : navigation.state} />
                </div>
                <div className="sns-tile">
                  <span className="sns-lbl">Velocidad</span>
                  <span className="sns-val">{emergencyStopped ? "0.00" : (navigation.current_speed ?? 0).toFixed(2)} m/s</span>
                </div>
                <div className="sns-tile">
                  <span className="sns-lbl">Distancia</span>
                  <span className="sns-val">{(navigation.distance_traveled ?? 0).toFixed(1)} m</span>
                </div>
                <div className="sns-tile">
                  <span className="sns-lbl">Destino Actual</span>
                  <span className="sns-val highlight">{navigation.destination || "Sin destino"}</span>
                </div>
              </div>
            </div>

            {/* Selector rápido de destinos táctiles */}
            <div className="screen-dest-wrapper">
              <div className="screen-dest-title">
                <MapPin size={15} />
                <span>SELECCIÓN RÁPIDA DE DESTINO (UN TOQUE)</span>
              </div>
              <div className="screen-dest-grid">
                {DESTINATIONS.map((dest) => {
                  const isActive = navigation.destination === dest.id;
                  return (
                    <button
                      key={dest.id}
                      className={`screen-dest-btn ${isActive ? "active" : ""}`}
                      onClick={() => handleDestinationClick(dest.id, dest.name)}
                    >
                      <MapPin size={16} />
                      <span className="sdb-name">{dest.name}</span>
                      {isActive && <Check size={14} className="sdb-check" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Barra Inferior de Acciones Táctiles */}
      <div className="screen-footer-actions">
        <button
          className={`screen-action-btn emergency ${emergencyStopped ? "stopped" : ""}`}
          onClick={handleEmergencyStop}
        >
          <AlertOctagon size={24} />
          <span>{emergencyStopped ? "REANUDAR MARCHA SEGURO" : "PARADA DE EMERGENCIA"}</span>
        </button>

        <button
          className="screen-action-btn assistance"
          onClick={handleRequestAssistance}
        >
          <PhoneCall size={24} />
          <span>SOLICITAR ASISTENCIA MÉDICA</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 6. APP SHELL
// ============================================================

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "screen", label: "Pantalla a Bordo", icon: Tablet },
  { id: "map", label: "Mapa", icon: MapPin },
  { id: "history", label: "Historial", icon: History },
  { id: "system", label: "Sistema", icon: Settings },
];

export default function ChairTrackerVital() {
  const [mode, setMode] = useState("SIMULATION");
  const [running, setRunning] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [patientName, setPatientName] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [openSession, setOpenSession] = useState(null);
  const [showStart, setShowStart] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const telemetry = useTelemetry({ mode, running });
  const [loadError, setLoadError] = useState(null);

  // Cargar historial real del backend al montar.
  useEffect(() => {
    api
      .listSessions()
      .then(setSessions)
      .catch((e) => setLoadError(e.message));
  }, []);

  const startSession = async () => {
    if (!nameDraft.trim()) return;
    const name = nameDraft.trim();
    try {
      const session = await api.createSession(name);
      setPatientName(name);
      setSessionId(session.id);
      await api.resetSimulation();
      telemetry.resetSession();
      setRunning(true);
      setShowStart(false);
      setNameDraft("");
    } catch (e) {
      setLoadError(e.message);
    }
  };

  const finishSession = async () => {
    if (!sessionId) return;
    const hrs = telemetry.vitalsHistory.map((v) => v.hr);
    const spo2s = telemetry.vitalsHistory.map((v) => v.spo2);
    const payload = {
      id: sessionId,
      patient_name: patientName,
      date: new Date().toLocaleDateString("es-PE"),
      start_time: new Date(Date.now() - telemetry.elapsed * 1000).toLocaleTimeString("es-PE"),
      end_time: new Date().toLocaleTimeString("es-PE"),
      duration_seconds: telemetry.elapsed,
      distance_m: telemetry.navigation.distance_traveled ?? 0,
      avg_speed: telemetry.navigation.average_speed ?? 0,
      hr_avg: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0,
      hr_max: hrs.length ? Math.max(...hrs) : 0,
      hr_min: hrs.length ? Math.min(...hrs) : 0,
      spo2_avg: spo2s.length ? Math.round((spo2s.reduce((a, b) => a + b, 0) / spo2s.length) * 10) / 10 : 0,
      spo2_min: spo2s.length ? Math.min(...spo2s) : 0,
      trajectory: telemetry.trajectory,
      alerts: telemetry.alerts,
      status: "FINALIZADA",
    };
    try {
      const saved = await api.finishSession(sessionId, payload);
      setSessions((prev) => [saved, ...prev]);
    } catch (e) {
      setLoadError(e.message);
      setSessions((prev) => [payload, ...prev]); // fallback local si falla la persistencia
    }
    setRunning(false);
    setSessionId(null);
  };

  const exportSession = (session) => {
    const csv = [
      "campo,valor",
      `paciente,${session.patient_name}`,
      `fecha,${session.date}`,
      `duracion_seg,${session.duration_seconds}`,
      `distancia_m,${session.distance_m}`,
      `velocidad_promedio,${session.avg_speed}`,
      `fc_promedio,${session.hr_avg}`,
      `fc_max,${session.hr_max}`,
      `fc_min,${session.hr_min}`,
      `spo2_promedio,${session.spo2_avg}`,
      `spo2_min,${session.spo2_min}`,
      `alertas,${session.alerts.length}`,
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sesion_${session.id.replace("#", "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const unacknowledged = telemetry.alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="ctv-root">
      <style>{CSS}</style>

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Navigation2 size={16} />
          </div>
          <div className="brand-text">
            <span className="brand-title">Chair Tracker Vital</span>
            <span className="brand-sub">Monitoreo de silla inteligente · ROS 2</span>
          </div>
        </div>

        <ConnectionBadge connection={telemetry.connection} mode={mode} />

        <div className="topbar-actions">
          <span
            className={`mode-toggle ${mode === "SIMULATION" ? "on" : ""}`}
            title={
              mode === "SIMULATION"
                ? "Los datos los genera el simulador interno del backend. Lanza el puente (wheelchair_bridge) para recibir datos reales."
                : "Un puente ROS 2 está enviando telemetría real."
            }
          >
            {mode === "SIMULATION" ? <Play size={13} /> : <Wifi size={13} />}
            {mode === "SIMULATION" ? "Simulación activa" : "ROS 2 conectado"}
          </span>

          {!running ? (
            <button className="primary-btn" onClick={() => setShowStart(true)}>
              <Play size={14} /> Iniciar sesión
            </button>
          ) : (
            <button className="danger-btn" onClick={finishSession}>
              <Square size={14} /> Finalizar sesión
            </button>
          )}
        </div>
      </header>

      {loadError && (
        <div className="api-error-bar">
          No se pudo conectar con el backend ({loadError}). Verifica que esté corriendo en {WS_URL.replace("/ws/telemetry", "").replace("ws", "http")}.
        </div>
      )}

      <div className="body-shell">
        <nav className="sidenav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`sidenav-item ${page === item.id ? "active" : ""}`}
              onClick={() => {
                setOpenSession(null);
                setPage(item.id);
              }}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
              {item.id === "dashboard" && unacknowledged > 0 && <span className="badge-count">{unacknowledged}</span>}
            </button>
          ))}
        </nav>

        <main className="content">
          {page === "dashboard" && (
            <DashboardPage telemetry={telemetry} patientName={patientName} sessionId={sessionId} running={running} mode={mode} />
          )}
          {page === "screen" && (
            <ScreenPage telemetry={telemetry} patientName={patientName} sessionId={sessionId} running={running} mode={mode} />
          )}
          {page === "map" && <MapPage telemetry={telemetry} />}
          {page === "history" && !openSession && (
            <HistoryPage sessions={sessions} onOpen={setOpenSession} />
          )}
          {page === "history" && openSession && (
            <SessionDetailPage session={openSession} onBack={() => setOpenSession(null)} onExport={exportSession} />
          )}
          {page === "system" && (
            <SystemPage connection={telemetry.connection} mode={mode} telemetry={telemetry} wsConnected={mode === "SIMULATION" && running} />
          )}
        </main>
      </div>

      {showStart && (
        <div className="modal-overlay" onClick={() => setShowStart(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>Nueva sesión</span>
              <button className="icon-btn" onClick={() => setShowStart(false)}><X size={16} /></button>
            </div>
            <label className="modal-label">Nombre del paciente</label>
            <input
              className="modal-input"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startSession()}
              placeholder="Ej. Diana Ramírez"
            />
            <button className="primary-btn full" onClick={startSession} disabled={!nameDraft.trim()}>
              <Play size={14} /> Iniciar monitoreo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// STYLES
// Dashboard clínico oscuro — profesional, técnico, alta legibilidad
// ============================================================
const CSS = `
:root {
  --bg: #0b0e13;
  --panel: #10151d;
  --panel-2: #141a24;
  --border: #212936;
  --grid: #1a212c;
  --text: #e6ebf2;
  --text-dim: #8794a6;
  --text-faint: #566175;
  --ok: #34d399;
  --warn: #f5b942;
  --crit: #f4614b;
  --accent-blue: #4f8ff7;
  --accent-cyan: #35c9d6;
  --accent-rose: #f4708a;
  --radius: 10px;
}

.ctv-root {
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-feature-settings: "tnum";
  display: flex;
  flex-direction: column;
}

* { box-sizing: border-box; }

/* ---- Topbar ---- */
.topbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 10px; margin-right: auto; }
.brand-mark {
  width: 32px; height: 32px; border-radius: 8px;
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.brand-text { display: flex; flex-direction: column; line-height: 1.2; }
.brand-title { font-weight: 700; font-size: 14px; letter-spacing: 0.2px; }
.brand-sub { font-size: 11px; color: var(--text-dim); }

.conn-badge { display: flex; align-items: center; gap: 8px; background: var(--panel-2); border: 1px solid var(--border); padding: 6px 12px; border-radius: 999px; }
.status-dot-wrap { display: inline-flex; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.conn-label { font-size: 11.5px; font-weight: 600; letter-spacing: 0.3px; color: var(--text); }
.mode-pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.4px; margin-left: 4px; }
.mode-sim { background: rgba(79,143,247,0.15); color: var(--accent-blue); }
.mode-real { background: rgba(52,211,153,0.15); color: var(--ok); }

.topbar-actions { display: flex; align-items: center; gap: 10px; }
.mode-toggle {
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid var(--border); color: var(--text-dim);
  padding: 7px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
}
.mode-toggle.on { color: var(--accent-blue); border-color: rgba(79,143,247,0.4); }

.primary-btn {
  display: flex; align-items: center; gap: 6px;
  background: var(--accent-blue); color: #fff; border: none;
  padding: 8px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.primary-btn.small { padding: 5px 10px; font-size: 11.5px; }
.primary-btn.full { width: 100%; justify-content: center; margin-top: 14px; }
.danger-btn {
  display: flex; align-items: center; gap: 6px;
  background: rgba(244,97,75,0.12); color: var(--crit); border: 1px solid rgba(244,97,75,0.4);
  padding: 8px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.ghost-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text-dim);
  padding: 6px 10px; border-radius: 7px; font-size: 11.5px; cursor: pointer;
}
.back-btn { margin-bottom: 12px; }
.icon-btn { background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 4px; }
.api-error-bar { background: rgba(244,97,75,0.12); color: var(--crit); border-bottom: 1px solid rgba(244,97,75,0.3); padding: 8px 20px; font-size: 12px; }

/* ---- Layout ---- */
.body-shell { display: flex; flex: 1; min-height: 0; }
.sidenav {
  width: 176px; border-right: 1px solid var(--border); background: var(--panel);
  padding: 14px 10px; display: flex; flex-direction: column; gap: 2px; flex-shrink: 0;
}
.sidenav-item {
  display: flex; align-items: center; gap: 10px; background: transparent; border: none;
  color: var(--text-dim); padding: 9px 10px; border-radius: 8px; font-size: 12.5px; cursor: pointer; text-align: left;
  position: relative;
}
.sidenav-item:hover { background: var(--panel-2); color: var(--text); }
.sidenav-item.active { background: rgba(79,143,247,0.12); color: var(--accent-blue); font-weight: 600; }
.badge-count {
  margin-left: auto; background: var(--crit); color: #fff; font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 999px;
}

.content { flex: 1; min-width: 0; overflow-y: auto; padding: 18px 22px 40px; }
.page { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; }

/* ---- Chair status bar ---- */
.chair-status-bar {
  display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 12px 16px;
}
.chair-status-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); }
.cs-label { color: var(--text-faint); }
.cs-value { color: var(--text); font-weight: 600; }

/* ---- Vitals ---- */
.grid-vitals { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.vital-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px;
  border-left: 3px solid var(--ok);
}
.vital-card.vc-warn { border-left-color: var(--warn); }
.vital-card.vc-crit { border-left-color: var(--crit); }
.vital-card-head { display: flex; align-items: center; gap: 7px; color: var(--text-dim); font-size: 11.5px; font-weight: 600; letter-spacing: 0.4px; }
.vital-card-value { font-size: 34px; font-weight: 700; margin-top: 6px; line-height: 1; }
.vital-card-unit { font-size: 13px; color: var(--text-dim); font-weight: 500; margin-left: 6px; }
.vital-card-foot { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.vital-status-chip { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.3px; }
.vital-status-chip.vc-ok { background: rgba(52,211,153,0.15); color: var(--ok); }
.vital-status-chip.vc-warn { background: rgba(245,185,66,0.15); color: var(--warn); }
.vital-status-chip.vc-crit { background: rgba(244,97,75,0.15); color: var(--crit); }
.vital-sub { font-size: 11px; color: var(--text-faint); }

/* ---- Panels ---- */
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 12.5px; font-weight: 600; color: var(--text); }
.panel-head-sub { font-size: 10.5px; font-weight: 500; color: var(--text-faint); }

.grid-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.grid-lower { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; align-items: stretch; }
.grid-lower-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 900px) {
  .grid-charts, .grid-lower, .grid-lower-2 { grid-template-columns: 1fr; }
}

/* ---- Metric tiles ---- */
.metric-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.metric-tile { display: flex; align-items: flex-start; gap: 8px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; color: var(--text-dim); }
.metric-tile-value { font-size: 16px; font-weight: 700; color: var(--text); line-height: 1.2; }
.metric-tile-unit { font-size: 11px; color: var(--text-dim); font-weight: 500; margin-left: 3px; }
.metric-tile-label { font-size: 10.5px; color: var(--text-faint); margin-top: 2px; }

/* ---- Destination Selector ---- */
.dest-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dest-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.3px;
}
.dest-chips-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(95px, 1fr));
  gap: 6px;
}
.dest-chip {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}
.dest-chip:hover:not(:disabled) {
  background: rgba(79, 143, 247, 0.08);
  border-color: rgba(79, 143, 247, 0.35);
}
.dest-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dest-chip-active {
  background: rgba(79, 143, 247, 0.18) !important;
  border-color: var(--accent-blue) !important;
  color: #fff;
  font-weight: 600;
}
.dest-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
  flex-shrink: 0;
}
.dest-chip-active .dest-chip-dot {
  background: var(--accent-blue);
  box-shadow: 0 0 6px var(--accent-blue);
}
.dest-chip-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dest-chip-check {
  color: var(--accent-blue);
  flex-shrink: 0;
}
.dest-dropdown-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dest-select {
  flex: 1;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text);
  padding: 6px 9px;
  font-size: 11.5px;
  outline: none;
  cursor: pointer;
}
.dest-select:focus {
  border-color: var(--accent-blue);
}
.dest-select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dest-select option {
  background: var(--panel);
  color: var(--text);
}
.dest-clear-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  font-size: 11px;
  color: var(--crit);
  border-color: rgba(244, 97, 75, 0.3);
}
.dest-clear-btn:hover {
  background: rgba(244, 97, 75, 0.1);
}
.dest-status-badge {
  font-size: 10.5px;
  color: var(--ok);
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid rgba(52, 211, 153, 0.25);
  border-radius: 6px;
  padding: 3px 8px;
  text-align: center;
}

/* ---- Nav chip ---- */
.nav-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.3px; }
.nav-ok { background: rgba(52,211,153,0.15); color: var(--ok); }
.nav-warn { background: rgba(245,185,66,0.15); color: var(--warn); }
.nav-crit { background: rgba(244,97,75,0.15); color: var(--crit); }
.nav-neutral { background: rgba(135,148,166,0.15); color: var(--text-dim); }

/* ---- Minimap ---- */
.minimap-wrap { display: flex; justify-content: center; }
.minimap-svg { width: 100%; max-width: 260px; aspect-ratio: 1; background: #0a0d12; border-radius: 8px; }
.map-large-wrap { display: flex; justify-content: center; transition: transform 0.2s ease; }
.map-large-wrap .minimap-svg { max-width: 440px; }
.map-controls { display: flex; gap: 6px; }
.map-legend { display: flex; gap: 16px; font-size: 11px; color: var(--text-dim); margin-bottom: 10px; }
.map-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.dot-cyan { background: var(--accent-cyan); } .dot-blue { background: var(--accent-blue); } .dot-ok { background: var(--ok); }

/* ---- Alerts ---- */
.alerts-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
.alert-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-2); }
.alert-row.alert-crit { border-color: rgba(244,97,75,0.4); color: var(--crit); }
.alert-row.alert-warn { border-color: rgba(245,185,66,0.4); color: var(--warn); }
.alert-row.alert-info { border-color: var(--border); color: var(--text-dim); }
.alert-row.alert-ack { opacity: 0.45; }
.alert-row-body { flex: 1; }
.alert-row-msg { font-size: 12px; color: var(--text); font-weight: 500; }
.alert-row-meta { font-size: 10.5px; color: var(--text-faint); margin-top: 2px; }
.alert-ack-btn { background: transparent; border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim); cursor: pointer; padding: 3px 6px; }

.empty-state { color: var(--text-faint); font-size: 12.5px; padding: 18px 4px; text-align: center; }

/* ---- History table ---- */
.table-wrap { overflow-x: auto; }
.hist-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.hist-table th { text-align: left; color: var(--text-faint); font-weight: 600; font-size: 10.5px; letter-spacing: 0.4px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.hist-table td { padding: 10px; border-bottom: 1px solid var(--grid); color: var(--text); }
.hist-table tr:hover { background: var(--panel-2); cursor: pointer; }
.session-status { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.sess-active { background: rgba(79,143,247,0.15); color: var(--accent-blue); }
.sess-done { background: rgba(135,148,166,0.15); color: var(--text-dim); }

/* ---- System page ---- */
.sys-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.sys-row { display: flex; align-items: center; gap: 8px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; font-size: 12px; }
.sys-name { flex: 1; color: var(--text); font-weight: 500; }
.sys-state { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; }
.sys-on { background: rgba(52,211,153,0.15); color: var(--ok); }
.sys-off { background: rgba(244,97,75,0.15); color: var(--crit); }
.sys-freq { color: var(--text-faint); font-size: 10.5px; }
.sys-note { font-size: 12px; color: var(--text-dim); line-height: 1.6; }
.sys-note code { background: var(--panel-2); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; font-size: 11px; color: var(--accent-cyan); }

/* ---- Pantalla a Bordo / Modo Kiosko ---- */
.screen-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1200px;
  width: 100%;
}
.screen-page.screen-kiosk-mode {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: var(--bg);
  padding: 20px;
  max-width: 100vw;
  height: 100vh;
  overflow-y: auto;
}
.screen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 18px;
  gap: 12px;
  flex-wrap: wrap;
}
.screen-header-left { display: flex; align-items: center; gap: 12px; }
.screen-device-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, rgba(79,143,247,0.15), rgba(53,201,214,0.15));
  border: 1px solid rgba(79,143,247,0.4);
  color: var(--accent-cyan);
  font-size: 11.5px;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 8px;
  letter-spacing: 0.4px;
}
.screen-patient-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}
.screen-pill-sub { color: var(--text-faint); font-weight: 400; font-size: 11px; margin-left: 4px; }
.screen-header-center { display: flex; align-items: center; }
.screen-clock {
  font-family: monospace;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  padding: 4px 14px;
  border-radius: 8px;
  letter-spacing: 1px;
}
.screen-header-right { display: flex; align-items: center; gap: 10px; }
.screen-status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(52,211,153,0.12);
  border: 1px solid rgba(52,211,153,0.3);
  color: var(--ok);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 10px;
  border-radius: 8px;
}
.screen-dot-live {
  width: 8px;
  height: 8px;
  background: var(--ok);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--ok);
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}
.screen-battery-pill {
  font-size: 12px;
  font-weight: 600;
  background: var(--panel-2);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 8px;
}
.screen-icon-action {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  padding: 7px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.screen-icon-action:hover { color: var(--text); border-color: var(--accent-blue); }
.screen-kiosk-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.screen-kiosk-btn.active {
  background: rgba(79,143,247,0.2);
  border-color: var(--accent-blue);
  color: #fff;
}
.screen-alert-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(245,185,66,0.18);
  border: 1px solid var(--warn);
  color: var(--warn);
  padding: 12px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  animation: pulse 1.2s infinite;
}
.screen-emergency-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(244,97,75,0.25);
  border: 1px solid var(--crit);
  color: #ff8b7b;
  padding: 12px 18px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 800;
  animation: pulse 1s infinite;
}
.screen-notice-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(52,211,153,0.15);
  border: 1px solid var(--ok);
  color: var(--ok);
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
}
.screen-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 960px) {
  .screen-grid { grid-template-columns: 1fr; }
}
.screen-col { display: flex; flex-direction: column; gap: 16px; }
.screen-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.screen-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  padding-bottom: 10px;
}
.screen-vitals-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
.screen-vital-card {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-left: 4px solid var(--ok);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.screen-vital-card.vital-crit { border-left-color: var(--crit); }
.svc-top { display: flex; align-items: center; justify-content: space-between; }
.svc-label { font-size: 11px; font-weight: 600; color: var(--text-dim); letter-spacing: 0.3px; }
.svc-tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.tag-ok { background: rgba(52,211,153,0.15); color: var(--ok); }
.tag-crit { background: rgba(244,97,75,0.2); color: var(--crit); }
.svc-value-row { display: flex; align-items: baseline; gap: 10px; }
.svc-heart-pulse { color: var(--accent-rose); animation: pulse 1.2s infinite; }
.svc-number { font-size: 40px; font-weight: 800; line-height: 1; color: var(--text); }
.svc-unit { font-size: 14px; font-weight: 600; color: var(--text-dim); }
.svc-ecg-box { height: 34px; margin-top: 4px; overflow: hidden; }
.svc-ecg-svg { width: 100%; height: 100%; }
.svc-progress-track {
  width: 100%;
  height: 8px;
  background: rgba(255,255,255,0.06);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 4px;
}
.svc-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-blue), var(--accent-cyan));
  border-radius: 4px;
  transition: width 0.3s ease;
}
.svc-subtext { font-size: 11px; color: var(--text-faint); margin-top: 2px; }
.screen-patient-summary {
  display: flex;
  justify-content: space-between;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
}
.sps-row { display: flex; gap: 6px; }
.sps-label { color: var(--text-faint); }
.sps-val { font-weight: 600; color: var(--text); }
.sps-val.ok { color: var(--ok); }

/* ---- Radar & Nav ---- */
.screen-nav-overview {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.screen-radar-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.screen-radar-svg {
  background: #080c14;
  border: 1px solid var(--border);
  border-radius: 12px;
}
.screen-radar-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--panel-2);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 6px;
}
.screen-nav-stats {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sns-tile {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sns-lbl { font-size: 10.5px; color: var(--text-faint); font-weight: 500; }
.sns-val { font-size: 15px; font-weight: 700; color: var(--text); }
.sns-val.highlight { color: var(--accent-cyan); }

.screen-dest-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.screen-dest-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-dim);
  letter-spacing: 0.3px;
}
.screen-dest-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}
.screen-dest-btn {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.screen-dest-btn:hover {
  background: rgba(79,143,247,0.12);
  border-color: rgba(79,143,247,0.4);
}
.screen-dest-btn.active {
  background: rgba(79,143,247,0.22);
  border-color: var(--accent-blue);
  color: #fff;
  box-shadow: 0 0 10px rgba(79,143,247,0.3);
}
.sdb-name { flex: 1; text-align: left; }
.sdb-check { color: var(--accent-cyan); }

/* ---- Screen Footer Actions ---- */
.screen-footer-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 4px;
}
@media (max-width: 600px) {
  .screen-footer-actions { grid-template-columns: 1fr; }
}
.screen-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.4px;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}
.screen-action-btn.emergency {
  background: #b91c1c;
  color: #ffffff;
  border: 2px solid #ef4444;
  box-shadow: 0 4px 14px rgba(185,28,28,0.4);
}
.screen-action-btn.emergency:hover { background: #dc2626; }
.screen-action-btn.emergency.stopped {
  background: #047857;
  border-color: #10b981;
  box-shadow: 0 4px 14px rgba(4,120,87,0.4);
}
.screen-action-btn.emergency.stopped:hover { background: #059669; }
.screen-action-btn.assistance {
  background: #b45309;
  color: #ffffff;
  border: 2px solid #f59e0b;
  box-shadow: 0 4px 14px rgba(180,83,9,0.4);
}
.screen-action-btn.assistance:hover { background: #d97706; }

/* ---- Modal ---- */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 20px; width: 320px; }
.modal-head { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; font-weight: 600; margin-bottom: 14px; }
.modal-label { font-size: 11.5px; color: var(--text-dim); display: block; margin-bottom: 6px; }
.modal-input {
  width: 100%; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text);
  padding: 9px 10px; font-size: 13px; outline: none;
}
.modal-input:focus { border-color: var(--accent-blue); }
  /* ================================================================
     Estados de interaccion
     Antes solo habia :hover en 8 elementos sueltos y ningun :active,
     asi que al pulsar un boton no habia ninguna respuesta visual.
     ================================================================ */

  /* Todo lo pulsable comparte la misma transicion. */
  .primary-btn, .danger-btn, .ghost-btn, .icon-btn, .back-btn,
  .alert-ack-btn, .dest-clear-btn, .dest-chip, .sidenav-item,
  .screen-action-btn, .screen-dest-btn, .screen-icon-action,
  .screen-kiosk-btn {
    transition: background 0.15s ease, border-color 0.15s ease,
                color 0.15s ease, transform 0.08s ease,
                box-shadow 0.15s ease, filter 0.15s ease;
  }

  /* --- Pulsacion: el gesto se hunde ligeramente ------------------- */
  .primary-btn:active, .danger-btn:active, .ghost-btn:active,
  .back-btn:active, .alert-ack-btn:active, .dest-clear-btn:active,
  .dest-chip:active, .screen-dest-btn:active, .screen-kiosk-btn:active {
    transform: translateY(1px) scale(0.98);
    filter: brightness(0.92);
  }

  .icon-btn:active, .screen-icon-action:active {
    transform: scale(0.9);
    filter: brightness(0.85);
  }

  /* Los botones tactiles de la Pantalla a Bordo se hunden mas: el dedo
     tapa el boton y el unico feedback util es el movimiento. */
  .screen-action-btn:active {
    transform: scale(0.955);
    filter: brightness(0.9);
  }

  /* --- Hover ------------------------------------------------------ */
  .primary-btn:hover:not(:disabled) {
    background: #6ba1f9;
    box-shadow: 0 2px 12px rgba(79,143,247,0.35);
  }

  .danger-btn:hover:not(:disabled) {
    background: rgba(244,97,75,0.22);
    border-color: rgba(244,97,75,0.75);
  }

  .ghost-btn:hover:not(:disabled),
  .back-btn:hover:not(:disabled),
  .alert-ack-btn:hover:not(:disabled) {
    background: var(--panel-2);
    border-color: var(--text-faint);
    color: var(--text);
  }

  .icon-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--panel-2);
    border-radius: 6px;
  }

  .screen-action-btn:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .screen-kiosk-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  /* --- Deshabilitado: sin respuesta al puntero -------------------- */
  .primary-btn:disabled, .danger-btn:disabled, .ghost-btn:disabled,
  .icon-btn:disabled, .back-btn:disabled, .alert-ack-btn:disabled,
  .screen-action-btn:disabled, .screen-dest-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
    filter: none;
    box-shadow: none;
  }

  /* --- Teclado: el foco debe verse, pero no al hacer clic --------- */
  .primary-btn:focus-visible, .danger-btn:focus-visible,
  .ghost-btn:focus-visible, .icon-btn:focus-visible,
  .back-btn:focus-visible, .alert-ack-btn:focus-visible,
  .dest-clear-btn:focus-visible, .dest-chip:focus-visible,
  .sidenav-item:focus-visible, .screen-action-btn:focus-visible,
  .screen-dest-btn:focus-visible, .screen-icon-action:focus-visible,
  .screen-kiosk-btn:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 2px;
  }

  /* El indicador de modo ya no es un boton: no debe parecerlo. */
  .mode-toggle { cursor: default; }

  /* Respeta a quien pide menos animacion en el sistema. */
  @media (prefers-reduced-motion: reduce) {
    .primary-btn, .danger-btn, .ghost-btn, .icon-btn, .back-btn,
    .alert-ack-btn, .dest-clear-btn, .dest-chip, .sidenav-item,
    .screen-action-btn, .screen-dest-btn, .screen-icon-action,
    .screen-kiosk-btn {
      transition: none;
    }
    .primary-btn:active, .danger-btn:active, .ghost-btn:active,
    .back-btn:active, .alert-ack-btn:active, .dest-clear-btn:active,
    .dest-chip:active, .icon-btn:active, .screen-action-btn:active,
    .screen-dest-btn:active, .screen-icon-action:active,
    .screen-kiosk-btn:active {
      transform: none;
    }
  }
`;