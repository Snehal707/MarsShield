import type { Plan, Sky } from "./data";

// The FastAPI science service (science/marsshield/api.py). When it is not running, the app
// falls back to the precomputed scenario and site skies shipped in /data.
// Set NEXT_PUBLIC_MARSSHIELD_API="" (public static build) to disable the live service entirely: the app
// then never contacts a backend and runs on the precomputed results shipped in /data.
export const API = process.env.NEXT_PUBLIC_MARSSHIELD_API ?? "http://localhost:8765";
export const STATIC_DEMO = API === "";

async function call<T>(url: string, init: RequestInit | undefined, ms: number, what: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new Error(timeout ? `${what} did not respond within ${Math.round(ms / 1000)} s. The previous result is still shown.`
      : `${what} is unreachable. The previous result is still shown.`);
  }
  if (!r.ok) {
    let msg = `${what} returned ${r.status}`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* keep status message */ }
    throw new Error(String(msg));
  }
  return r.json();
}

export async function apiHealth(): Promise<boolean> {
  if (STATIC_DEMO) return false;
  try {
    const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function fetchRoutes(body: {
  start: [number, number];
  end: [number, number];
  stops: [number, number][];
  dwell_h: number;
  phi: number;
  alpha: number;
}): Promise<Plan> {
  return call<Plan>(`${API}/api/routes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    60000, "The route service");
}

export async function fetchSky(x: number, y: number, h: number, phi: number, alpha: number): Promise<Sky> {
  const q = new URLSearchParams({ x: String(x), y: String(y), h: String(h), phi: String(phi), alpha: String(alpha) });
  return call<Sky>(`${API}/api/sky?${q}`, undefined, 30000, "The sky service");
}

export async function fetchBreakEven(body: {
  start: [number, number]; end: [number, number]; target: [number, number]; radius_m: number; phi: number; alpha: number; duration_h?: [number, number, number] | null;
}): Promise<import("./data").BreakEven> {
  return call(`${API}/api/breakeven`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    120000, "The break-even service");
}

export async function fetchMission(body: { ids: string[]; phi: number; alpha: number; durations?: Record<string, number> }): Promise<import("./data").Mission> {
  return call(`${API}/api/mission`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    240000, "The mission service");
}
