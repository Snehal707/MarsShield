// Regional manifests (Mars overview, Jezero, Olympus Mons). Each region is a small set of static files described by
// web/public/data/regions/<id>/manifest.json and fetched only when the region is opened.
import { BASE } from "./data";

export type Status = "validated" | "exploratory" | "unavailable";
export type Capability = { name: string; status: Status; detail: string; area?: "terrain" | "atmosphere" | "radiation" };
export type GridSpec = { file: string; w: number; h: number; dtype: "int16le" | "uint8"; scale: number; offset?: number; nodata: number;
  x0?: number; y0?: number; dx?: number; dy?: number; source_res_m?: number; cell_deg?: number; note?: string; unit?: string; codes?: string[]; exploratory?: boolean };
export type Layer = { id: string; name: string; kind: "drape" | "image"; file: string; px: [number, number]; bytes: number; note?: string; exploratory?: boolean;
  ramp?: { lo: string; hi: string; stops: number[][] }; legend?: { id: string; name: string; desc: string; color: number[]; polygons: number }[] };
export type Landmark = { name: string; kind: string; x: number; y: number; note: string; unit?: string; lon?: number; lat?: number };
export type RegionSummary = { id: string; name: string; kind: "gale" | "global" | "regional"; summary: string;
  frame: { type: string; lon: [number, number]; lat: [number, number]; lon_c?: number; lat_c?: number; note?: string }; capabilities: Capability[]; manifest?: string; bytes?: number };
export type RegionIndex = { generated_utc: string; status_definitions: Record<Status, string>; regions: RegionSummary[] };
export type Manifest = RegionSummary & {
  grid: GridSpec; aux?: Record<string, GridSpec>; layers: Layer[]; elevation_range_m: [number, number]; landmarks?: Landmark[];
  profiles?: { name: string; a: [number, number]; b: [number, number] }[];
  traverse?: { name: string; sol_range: [number, number]; n_waypoints: number; xy: [number, number][]; waypoints: [number, number, number | null, number][]; source: string };
  context?: { file: string; lon: [number, number]; lat: [number, number]; note: string; px: [number, number] };
  checks?: { name: string; note: string; [k: string]: unknown }[];
  sources: { name: string; url: string; producer: string; role: string }[]; generated_utc: string;
};
export type Grid = GridSpec & { data: Float32Array };
export type Region = { m: Manifest; elev: Grid; aux: Record<string, Grid> };

const url = (id: string, f: string) => `${BASE}/data/regions/${id}/${f}`;
export async function loadIndex(): Promise<RegionIndex> {
  const r = await fetch(`${BASE}/data/regions/index.json`);
  if (!r.ok) throw new Error(`Region index: HTTP ${r.status}`);
  return r.json();
}
async function loadGrid(id: string, g: GridSpec): Promise<Grid> {
  const buf = await (await fetch(url(id, g.file))).arrayBuffer();
  const src = g.dtype === "int16le" ? new Int16Array(buf) : new Uint8Array(buf);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] === g.nodata ? NaN : src[i] * g.scale + (g.offset ?? 0);
  return { ...g, data: out };
}
const cache = new Map<string, Promise<Region>>();
export function loadRegion(id: string): Promise<Region> {
  if (!cache.has(id)) cache.set(id, (async () => {
    const m: Manifest = await (await fetch(url(id, "manifest.json"))).json();
    const [elev, ...aux] = await Promise.all([loadGrid(id, m.grid), ...Object.entries(m.aux ?? {}).map(([, g]) => (g.dtype ? loadGrid(id, { ...g, scale: g.scale ?? 1, nodata: g.nodata ?? -1 }) : null))]);
    const auxOut: Record<string, Grid> = {};
    Object.keys(m.aux ?? {}).forEach((k, i) => { if (aux[i]) auxOut[k] = aux[i] as Grid; });
    return { m, elev, aux: auxOut };
  })());
  return cache.get(id)!;
}
export const layerUrl = (id: string, f: string) => url(id, f);

/** Bilinear sample of a regional grid at local metres (x east, y north); NaN outside. */
export function sampleLocal(g: Grid, ref: GridSpec, x: number, y: number) {
  const c = (x - ref.x0!) / ref.dx! - 0.5, r = (ref.y0! - y) / ref.dy! - 0.5;
  const gw = g.w, gh = g.h, fx = c * (gw / ref.w), fy = r * (gh / ref.h);
  if (fx < 0 || fy < 0 || fx > gw - 1 || fy > gh - 1) return NaN;
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, i1 = Math.min(i + 1, gw - 1), j1 = Math.min(j + 1, gh - 1);
  const d = g.data;
  return d[j * gw + i] * (1 - u) * (1 - v) + d[j * gw + i1] * u * (1 - v) + d[j1 * gw + i] * (1 - u) * v + d[j1 * gw + i1] * u * v;
}
/** Nearest-cell value (categorical grids such as geologic units). */
export function nearestLocal(g: Grid, ref: GridSpec, x: number, y: number) {
  const c = Math.round((x - ref.x0!) / ref.dx! - 0.5), r = Math.round((ref.y0! - y) / ref.dy! - 0.5);
  if (c < 0 || r < 0 || c >= g.w || r >= g.h) return NaN;
  return g.data[r * g.w + c];
}

/** Elevation along a straight line, sampled at the grid spacing. */
export function profileLine(reg: Region, a: [number, number], b: [number, number]) {
  const g = reg.elev, L = Math.hypot(b[0] - a[0], b[1] - a[1]), step = Math.min(g.dx!, g.dy!);
  const n = Math.max(2, Math.ceil(L / step) + 1), d: number[] = [], z: number[] = [];
  for (let k = 0; k < n; k++) { const t = k / (n - 1); d.push(t * L); z.push(sampleLocal(g, g, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))); }
  return { d, z, step, L };
}
/** Steepest and mean absolute slope along a profile, over one grid spacing. */
export function profileSlope(p: { d: number[]; z: number[] }) {
  let max = 0, sum = 0, n = 0;
  for (let k = 1; k < p.d.length; k++) {
    const dz = p.z[k] - p.z[k - 1], dd = p.d[k] - p.d[k - 1];
    if (!Number.isFinite(dz) || dd <= 0) continue;
    const s = Math.atan(Math.abs(dz) / dd) * 180 / Math.PI; max = Math.max(max, s); sum += s; n++;
  }
  return { max, mean: n ? sum / n : NaN };
}
/** Global overview grid: lon/lat to elevation (nearest 0.5 degree cell). */
export function sampleGlobal(g: Grid, lon: number, lat: number) {
  const c = Math.floor(((lon + 180) / 360) * g.w), r = Math.floor(((90 - lat) / 180) * g.h);
  if (c < 0 || r < 0 || c >= g.w || r >= g.h) return NaN;
  return g.data[r * g.w + c];
}
