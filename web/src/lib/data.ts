// Data loading and shared types for MarsShield. All files are produced by the Python pipeline
// (science/marsshield/pipeline.py) into web/public/data.

export type Meta = {
  shape: [number, number];
  res: number;
  x0: number;
  y0: number;
  zmin: number;
  zmax: number;
  h_obs: number;
  phi: number;
  alpha: number;
  n_az: number;
  hillshade_res: number;
  hillshade_shape: [number, number];
  hillshade_x0: number;
  hillshade_y0: number;
  crs: string;
  sources: Source[];
};

export type Source = { id: string; kind: string; title: string; org: string; url: string; used: string };

export type Grids = {
  height: Float32Array;
  relSky: Float32Array;
  B: Float32Array;
  slope: Float32Array;
};

export type Period = {
  id: string;
  site: string;
  kind: "parking" | "background";
  x: number;
  y: number;
  sols: [number, number];
  utc: [string, string];
  rad_E_mean: number;
  rad_E_sem: number;
  rad_n: number;
  pub: { D_RAD: number; decrease: number | null; phi: number; ROS: number; D_sky: number };
  model: { B: number; D_sky: number };
};

export type Target = { name: string; description: string; x: number; y: number; z: number; rmc: string; sol: number };

export type Stop = {
  x: number;
  y: number;
  z: number;
  sol: number;
  rmc: string;
  sol_a: number;
  sol_b: number;
  n_obs: number;
  E_mean?: number;
  E_sem?: number;
  utc_start?: string;
  utc_end?: string;
  data_sols?: number;
  anomaly_obs?: number | null;
  anomaly_model?: number | null;
  B: number;
  rel_total_model: number;
};

export type Observations = {
  stops: Stop[];
  anomaly_stats: {
    n: number;
    pearson_r: number;
    pearson_r_95ci?: [number, number];
    slope_obs_on_model: number;
    rmse_pp: number;
    obs_anomaly_std_pp: number;
    model_anomaly_std_pp: number;
    window_sols: number;
    min_sols: number;
  };
  daily: { sol: number; E: number; n: number }[];
};

export type Sky = {
  x: number;
  y: number;
  h_obs: number;
  z_ground: number;
  az: number[];
  elev: number[];
  dist: number[];
  ros: number[];
  zenith_dose_full: number[];
  zenith_dose_vis: number[];
  B: number;
  phi: number;
  alpha: number;
  dose: {
    D_sky: number;
    D_sky_fullsky: number;
    D_albedo_FT: number;
    D_total: number;
    D_total_flat: number;
    rel_total: number;
    rel_sky: number;
    B: number;
  };
};

export type Route = {
  objective: string;
  label: string;
  feasible: boolean;
  distance_m: number;
  horizontal_m: number;
  time_h: number;
  ascent_m: number;
  descent_m: number;
  max_slope_deg: number;
  mean_slope_deg: number;
  mean_rel_rate: number;
  min_rel_rate: number;
  frac_time_shielded: number;
  dose_uGy: number;
  dose_if_open_flat_uGy: number;
  dwell_dose_uGy: number;
  total_dose_uGy: number;
  dose_band_alpha_uGy: [number, number];
  dose_band_phi_uGy: [number, number];
  vs_baseline?: { distance_pct: number; time_pct: number; dose_pct: number };
  profile: { s_m: number[]; z: number[]; rel_rate: number[] };
  xy: [number, number][];
};

export type Plan = {
  start: [number, number];
  end: [number, number];
  stops: [number, number][];
  dwell_h: number;
  phi: number;
  alpha: number;
  D_flat_uGy_d: number;
  routes: Route[];
  assumptions: { suit_factor: number; max_slope_deg: number; h_obs_m: number; grid_m: number; n_az_map: number };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Validation = any;

// GitHub Pages serves the app under a sub-path; NEXT_PUBLIC_BASE_PATH is set at build time there.
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const base = `${BASE}/data`;

async function f32(name: string): Promise<Float32Array> {
  const r = await fetch(`${base}/${name}`);
  if (!r.ok) throw new Error(`Missing ${name}. Run the science pipeline to export web data.`);
  return new Float32Array(await r.arrayBuffer());
}

async function json<T>(name: string): Promise<T> {
  const r = await fetch(`${base}/${name}`);
  if (!r.ok) throw new Error(`Missing ${name}. Run the science pipeline to export web data.`);
  return r.json();
}

export type Dataset = {
  meta: Meta;
  grids: Grids;
  periods: Period[];
  targets: Target[];
  skies: Record<string, Sky>;
  scenario: { multi: Plan; direct: Plan };
  observations: Observations;
  validation: Validation;
  audit: Validation;
  scienceTargets: ScienceTarget[];
  mission: Mission;
  ortho: OrthoMeta | null;
  flat: FlatDose;
  parking: ParkingExperiment;
  skiesTargets: Record<string, Sky>;
  terrainSignal: TerrainSignal | null;
  breakeven: Record<string, BreakEven>;
};

export async function loadDataset(): Promise<Dataset> {
  const [meta, height, relSky, B, slope, sites, skies, scenario, observations, validation, audit, breakeven, scienceTargets, mission, ortho, flat, parking, skiesTargets, terrainSignal] = await Promise.all([
    json<Meta>("meta.json"),
    f32("height.f32"),
    f32("rel_sky.f32"),
    f32("B.f32"),
    f32("slope.f32"),
    json<{ periods: Period[]; targets: Target[] }>("sites.json"),
    json<Record<string, Sky>>("skies.json"),
    json<{ multi: Plan; direct: Plan }>("scenario.json"),
    json<Observations>("observations.json"),
    json<Validation>("validation.json"),
    json<Validation>("audit.json"),
    json<Record<string, BreakEven>>("breakeven.json"),
    json<ScienceTarget[]>("science_targets.json"),
    json<Mission>("mission.json"),
    json<OrthoMeta>("ortho.json").catch(() => null),
    json<FlatDose>("flat_dose.json"),
    json<ParkingExperiment>("experiment_parking.json"),
    json<Record<string, Sky>>("skies_targets.json"),
    json<TerrainSignal>("terrain_signal.json").catch(() => null),
  ]);
  return {
    meta,
    grids: { height, relSky, B, slope },
    periods: sites.periods,
    targets: sites.targets,
    skies,
    scenario,
    observations,
    validation,
    audit,
    breakeven,
    scienceTargets,
    mission,
    ortho,
    flat,
    parking,
    skiesTargets,
    terrainSignal,
  };
}

// --- geometry helpers ------------------------------------------------------------------
// Scene frame: origin at the walk-area centre, +X east, +Z south, +Y up, metres.
export function centre(meta: Meta) {
  const [ny, nx] = meta.shape;
  return { cx: meta.x0 + ((nx - 1) * meta.res) / 2, cy: meta.y0 - ((ny - 1) * meta.res) / 2 };
}

export function mapToScene(meta: Meta, x: number, y: number) {
  const { cx, cy } = centre(meta);
  return { sx: x - cx, sz: -(y - cy) };
}

export function sceneToMap(meta: Meta, sx: number, sz: number) {
  const { cx, cy } = centre(meta);
  return { x: sx + cx, y: cy - sz };
}

export function sampleGrid(meta: Meta, g: Float32Array, x: number, y: number): number {
  const [ny, nx] = meta.shape;
  const c = (x - meta.x0) / meta.res;
  const r = (meta.y0 - y) / meta.res;
  if (r < 0 || c < 0 || r > ny - 1 || c > nx - 1) return NaN;
  const i = Math.min(Math.floor(r), ny - 2);
  const j = Math.min(Math.floor(c), nx - 2);
  const fr = r - i;
  const fc = c - j;
  const v = (a: number, b: number) => g[a * nx + b];
  return (v(i, j) * (1 - fc) + v(i, j + 1) * fc) * (1 - fr) + (v(i + 1, j) * (1 - fc) + v(i + 1, j + 1) * fc) * fr;
}

// Same formula as science/marsshield/planner.rel_total_from
export function relTotal(relSky: number, B: number, alpha: number) {
  const a = alpha / (1 - alpha);
  return (relSky + (1 + B) * a) / (1 + a);
}

export const fmt = {
  pct: (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)} %`,
  pctAbs: (v: number, d = 1) => `${(v * 100).toFixed(d)} %`,
  m: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v.toFixed(0)} m`),
  h: (v: number) => {
    const hh = Math.floor(v);
    const mm = Math.round((v - hh) * 60);
    return hh > 0 ? `${hh} h ${mm.toString().padStart(2, "0")} min` : `${mm} min`;
  },
  uGy: (v: number) => `${v.toFixed(v < 10 ? 2 : 1)} µGy`,
};

// Validated categorical slots (dark mode, fixed order; see dataviz palette check in docs/METHODS.md).
// Routes are also distinguished by dash pattern and always direct-labelled in the table.
export const ROUTE_ORDER = ["low_dose", "shortest", "fastest", "shelter", "gentle"] as const;
export const ROUTE_COLORS: Record<string, string> = {
  low_dose: "#3987e5",
  shortest: "#d95926",
  fastest: "#199e70",
  shelter: "#c98500",
  gentle: "#d55181",
};
export const ROUTE_DASH: Record<string, [number, number] | null> = {
  low_dose: null,
  shortest: [14, 8],
  fastest: null,
  shelter: [4, 6],
  gentle: [22, 6],
};

// ---- Radiation Break-Even Explorer (science/marsshield/breakeven.py) ----
export type NearestRad = {
  distance_m: number; sol: number; rmc: string; utc_start?: string; utc_end?: string;
  E_mean_uGy_d: number; E_sem?: number; n_obs: number; local_anomaly?: number | null; data_sols?: number;
} | null;

export type BEOption = {
  keys: string[]; labels: string[]; x: number; y: number; dist_from_target_m: number; slope_deg: number;
  rel_rate: number; B: number; walk_dose_uGy: number; stop_rate_uGy_h: number; distance_m: number; time_h: number;
  walk_dose_path_uGy: number; xy: [number, number][]; total_uGy: number[]; nearest_rad: NearestRad;
  preferred_dwell_h: [number, number] | null;
  flags: string[];
};

export type BEBreak = {
  less_walking: string; more_sheltered: string; t_h: number; extra_walk_dose_uGy: number; rate_saving_uGy_h: number;
  extra_distance_m: number; extra_time_min: number; t_h_alpha_band: (number | null)[];
  rate_difference_pp: number; resolvability: Resolvability; t_h_model_error_band: [number, number | null];
};

export type BreakEven = {
  start: [number, number]; end: [number, number]; target: [number, number]; radius_m: number; phi: number; alpha: number;
  D_flat_uGy_d: number; dwell_h: number[]; envelope_uGy: number[]; preferred_named_by_dwell: string[];
  options: BEOption[]; breaks: BEBreak[]; max_gap_named_vs_exact_uGy: number; n_candidates: number;
  model_error: { mae_pp: number; rmse_pp: number; n: number; source: string };
  sensitivity: { case: string; t_h_A_to_C?: number | null; rate_difference_pp?: number; resolvability?: Resolvability; error?: string }[];
  recommendation: Recommendation | null;
  assumptions: { stop_max_slope_deg: number; objective: string; h_obs_m: number; suit_factor: number; max_slope_deg: number; phi_independent: string; not_modeled?: string };
};

export const OPTION_COLORS: Record<string, string> = { A: "#3987e5", B: "#d95926", C: "#199e70" };


export type Resolvability = "resolved" | "marginal" | "unresolved";
export type Recommendation = {
  duration_h: [number, number, number]; status: "recommended" | "conditional" | "unresolved" | "stay"; text: string;
  preferred_nominal: string; preferred_low: string; preferred_high: string; baseline: string; resolvability_vs_target: Resolvability | null;
};

export type SourceRef = { cite: string; url: string };
export type ScienceTarget = {
  id: string; name: string; curiosity_target: string; sols: [number, number]; unit: string; activity: string;
  activity_label: string; objective: string; objective_quote: string; look_for: string; curiosity_found: string;
  sources: SourceRef[]; rad_period: string | null; x: number; y: number; z: number;
  waypoint: { rmc: string; sol: number; occupancy_sols: number };
  duration_h: [number, number, number]; work_radius_m: number; assumption_note: string;
  measured_rad: { sol: number; utc_start?: string; utc_end?: string; E_mean_uGy_d: number; E_sem?: number; n_obs: number; local_anomaly?: number | null; data_sols?: number } | null;
};

export type MissionStop = {
  target: string; decision: Recommendation; used_option: string[]; used_xy: [number, number]; used_flags: string[]; breakeven: BreakEven;
};
export type Mission = {
  ids: string[]; phi: number; alpha: number; D_flat_uGy_d: number; durations_h: Record<string, number>;
  stops: MissionStop[]; plan: Plan; endpoints: { target: string; xy: [number, number]; moved_m: number }[];
  totals: {
    walk_uGy: number; stationary_uGy: number; total_uGy: number; walk_time_h: number; stationary_time_h: number; eva_hours: number;
    distance_m: number; total_if_all_at_targets_uGy: number; saving_vs_targets_uGy: number; open_flat_same_hours_uGy: number;
  };
  context: {
    model_error_pp: { mae_pp: number; rmse_pp: number };
    fraction_of_one_sol_on_open_ground: number;
    curiosity_surface_mean_uGy_d: { value: number; plus_minus: number; cite: string; url: string };
    curiosity_cruise_mean_uGy_d: { value: number; plus_minus: number; cite: string; url: string };
  };
};

export type OrthoMeta = { x0: number; y0: number; res: number; shape: [number, number]; source: string; product: string };

export const RESOLVE_LABEL: Record<Resolvability, string> = {
  resolved: "Resolved", marginal: "Marginal", unresolved: "Unresolved",
};

export type FlatDose = { phi: number[]; Dfs: number[]; note: string };
export function dFlat(flat: FlatDose, phi: number, alpha: number) {
  const i = Math.max(0, Math.min(flat.phi.length - 2, Math.floor((phi - flat.phi[0]) / (flat.phi[1] - flat.phi[0]))));
  const w = (phi - flat.phi[i]) / (flat.phi[i + 1] - flat.phi[i]);
  return (flat.Dfs[i] * (1 - w) + flat.Dfs[i + 1] * w) / (1 - alpha);
}

export type ParkingPeriod = { site: string; sols: [number, number]; phi: number; B: number; D_sky: number; Dfs: number;
  D_RAD_ours: number; D_RAD_sem: number; D_RAD_pub: number; utc: [string, string]; n_obs: number; x: number; y: number };
export type ParkingExperiment = { periods: Record<string, ParkingPeriod>; pairs: { parking: string; background: string }[];
  alpha_prior: number; alpha_range: [number, number]; p6_alternative: { section4_decrease: number; table1_decrease: number };
  audit: { cells_checked: number; mismatches: number }; provenance: string };

export type TSRow = { rmc: string; sol: number; mid_sol: number; x: number; y: number; n_obs: number; data_sols: number;
  utc_start: string; utc_end: string; E_mean: number; P_mean: number; P_bg: number; y_obs: number; x_p: number;
  m_terrain: number; g_proxy: number; rel_total: number; B: number; block: number };
export type TerrainSignal = { rows: TSRow[]; window_sols: number; k_blocks: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  performance: Record<string, any>; mse_differences: Record<string, any>; correlations: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pressure_coefficient: any; meta: any; predictor_spread_pp: Record<string, number>;
  rmse_reduction_vs_M0?: Record<string, number>; site_ci95_dMSE_vs_M0_pp2?: Record<string, [number, number]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  influence?: any; evaluation_overlap?: { status: string; albedo_parameter: string; model_error_threshold: string; own_choices: string; n_in_published_periods: number } };
