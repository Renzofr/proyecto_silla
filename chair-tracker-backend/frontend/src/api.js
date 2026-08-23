// ============================================================
// Cliente REST — Chair Tracker Vital
// Todas las llamadas HTTP al backend viven aquí.
// Cambia API_BASE_URL según dónde despliegues el backend.
// ============================================================

export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "http://localhost:8000/api";
export const WS_URL = API_BASE_URL.replace(/^http/, "ws") + "/ws/telemetry";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Error ${res.status} en ${path}: ${text}`);
  }
  return res.json();
}

export const api = {
  health: () => request("/health"),
  systemStatus: () => request("/system/status"),

  createPatient: (name) => request("/patients", { method: "POST", body: JSON.stringify({ name }) }),
  listPatients: () => request("/patients"),

  createSession: (patient_name) =>
    request("/sessions", { method: "POST", body: JSON.stringify({ patient_name }) }),
  listSessions: () => request("/sessions"),
  getSession: (id) => request(`/sessions/${id}`),
  finishSession: (id, payload) =>
    request(`/sessions/${id}/finish`, { method: "POST", body: JSON.stringify(payload) }),

  startSimulation: () => request("/telemetry/simulation/start", { method: "POST" }),
  stopSimulation: () => request("/telemetry/simulation/stop", { method: "POST" }),
  resetSimulation: () => request("/telemetry/simulation/reset", { method: "POST" }),
  setDestination: (destination) =>
    request("/telemetry/destination", { method: "POST", body: JSON.stringify({ destination }) }),
};
