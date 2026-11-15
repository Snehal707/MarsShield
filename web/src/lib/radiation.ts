// Three-region GCR dose model in the browser: the published Zhang et al. (2022) surface tables at Mars Climate Database
// pressures (web/public/data/regions/radiation.json, built by science/marsshield/regional_dose.py). Same interpolation as
// Python: linear in surface pressure between published nodes, no extrapolation, solar modulation only at published nodes.
import { BASE } from "./data.ts";

export type Quantity = "effective" | "water" | "doseEq";
export type Eval = { pressure_pa: number; column_gcm2: number; at_grid_edge: boolean; effective_mSv_yr: Record<string, number>;
  water_absorbed_mGy_yr_580MV: number; dose_equivalent_mSv_yr_580MV: number };
export type Site = { id: string; name: string; region: string; lat: number; lon: number; pressure_source: string; baseline: Eval;
  season_low: Eval & { ls: number }; season_high: Eval & { ls: number }; mcd_query_url: string;
  pressure_assumption_band?: { rel: number; low: Eval; high: Eval; kind: string; note: string } };
export type Radiation = {
  model: { name: string; doi: string; data_doi: string; data_md5: string; gcr: string; pressures_pa: number[]; column_gcm2_published: number[];
    phi_nodes_MV: number[]; interpolation: string; not_rad_e: string };
  tables: { effective_mSv_yr: Record<string, number[]>; water_absorbed_mGy_yr_580MV: { pressures_pa: number[]; values: number[] };
    dose_equivalent_mSv_yr_580MV: { pressures_pa: number[]; values: number[] }; water_HHe_mGy_yr_580MV: { pressures_pa: number[]; values: number[] } };
  sites: Site[];
  uncertainty: { mc_noise_rel: Record<string, number>; mc_noise_note: string; terms: { term: string; kind: string; value: string; source: string }[] };
  validation: { reproduction: { what: string; pressures_pa: number[]; integrated_mGy_yr: number[]; published_mGy_yr: number[]; rel_diff: number[] };
    rad_pressure_slope: { model_water_total_uGy_day_Pa: number; model_water_HHe_uGy_day_Pa: number; rad_observed: { value: number; sigma: number; unit: string; quantity: string; source: string }; verdict: string; kind: string };
    pressure_checks: { meda_vs_mcd_jezero_pct: number; zhang_olympus_82pa_vs_mcd_summit_annual: number }; levels: Record<string, string> };
  hydrostatic: Record<string, { ref_site: string; ref_pressure_pa: number; ref_elev_m: number; scale_height_m: number; season_low_factor: number; season_high_factor: number; note: string }>;
  gale_rad_measured: { quantity: string; unit: string; n_stops: number; median: number; range: [number, number]; period: [string, string]; source: string; note: string };
  sol_days: number; blockers: string[];
};

let cache: Promise<Radiation> | null = null;
export function loadRadiation(): Promise<Radiation> {
  cache ??= fetch(`${BASE}/data/regions/radiation.json`).then((r) => { if (!r.ok) throw new Error(`radiation.json: HTTP ${r.status}`); return r.json(); });
  return cache;
}

export const QUANTITIES: Record<Quantity, { label: string; unit: string; short: string; phiFixed: number | null; desc: string }> = {
  effective: { label: "Effective dose", unit: "mSv/yr", short: "Effective dose", phiFixed: null, desc: "ICRP-103 whole-body effective dose (Dobynde et al. 2021 coefficients); a protection quantity, not a measured one" },
  doseEq: { label: "Dose equivalent", unit: "mSv/yr", short: "Dose equivalent", phiFixed: 580, desc: "ICRP-60 quality-factor-weighted dose in a 15 cm-radius water sphere; published at 580 MV only" },
  water: { label: "Absorbed dose, water", unit: "mGy/yr", short: "Absorbed dose", phiFixed: 580, desc: "Energy deposited per mass in a 15 cm-radius water sphere; published at 580 MV only. Not RAD-E plastic dose" },
};

/** Linear in pressure between published nodes; outside the grid -> edge value and a flag (never extrapolated). */
export function interpP(nodes: number[], vals: number[], p: number) {
  const edge = p < nodes[0] || p > nodes[nodes.length - 1];
  const q = Math.min(Math.max(p, nodes[0]), nodes[nodes.length - 1]);
  let i = 0; while (i < nodes.length - 2 && q > nodes[i + 1]) i++;
  const t = (q - nodes[i]) / (nodes[i + 1] - nodes[i]);
  return { v: vals[i] * (1 - t) + vals[i + 1] * t, edge };
}
export function rateAt(R: Radiation, q: Quantity, phi: number, p: number) {
  if (q === "effective") return interpP(R.model.pressures_pa, R.tables.effective_mSv_yr[String(phi)], p);
  const t = q === "water" ? R.tables.water_absorbed_mGy_yr_580MV : R.tables.dose_equivalent_mSv_yr_580MV;
  return interpP(t.pressures_pa, t.values, p);
}
export const PA_TO_GCM2 = 1 / 37.1;
/** Cumulative dose over a mission of `sols` (rates are per Earth year; 1 sol = 1.0275 Earth days). */
export const cumulative = (R: Radiation, ratePerYr: number, sols: number) => ratePerYr * (sols * R.sol_days) / 365.25;
/** Exploratory hydrostatic pressure at elevation z within a region, scaled to a season. */
export function pressureAt(R: Radiation, region: string, z: number, season: "mean" | "low" | "high" = "mean") {
  const h = R.hydrostatic[region];
  if (!h) return NaN;
  const f = season === "low" ? h.season_low_factor : season === "high" ? h.season_high_factor : 1;
  return h.ref_pressure_pa * f * Math.exp(-(z - h.ref_elev_m) / h.scale_height_m);
}
export const sitePressure = (s: Site, season: "mean" | "low" | "high") => (season === "low" ? s.season_low : season === "high" ? s.season_high : s.baseline).pressure_pa;
export const noiseFor = (R: Radiation, q: Quantity, phi: number) => R.uncertainty.mc_noise_rel[String(q === "effective" ? phi : 700)];
