// Research exports for the three experiments: CSV of the exact rows in the user's selection, and a research package
// (observations.csv, predictions.csv, experiment.json, datapackage.json, README.md) built entirely in the browser.
// Pure functions: the same code runs in the app and in scripts/verify-exports.mts.
import type { ParkingExperiment, TSRow } from "./data";
import { MODELS, type ModelId, parkingPredictions } from "./stats.ts";
import { makeZip } from "./zip.ts";

// ------------------------------------------------------------------ shared metadata
export const MARS_R = 3396190;                      // Mars 2000 sphere radius of the USGS Gale DEM (m)
export const CRS = {
  name: "Mars 2000 sphere, equirectangular projection (planetocentric, east longitude), metres",
  proj4: "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs",
  source: "Read from the USGS MSL Gale Merged DEM 1 m GeoTIFF used by the pipeline",
  note: "These are Mars coordinates. x_eqc_m/y_eqc_m are projected metres; lat/lon columns are Mars planetocentric degrees "
    + "(latitude = y/R, east longitude = x/R, exact for this projection with standard parallel 0). They are not Earth latitude and longitude.",
};
export const SOURCES = [
  { id: "rad_l2", title: "MSL Radiation Assessment Detector (RAD) Level 2 observation dosimetry, detector E", publisher: "NASA / SwRI (SPDF)",
    path: "https://spdf.gsfc.nasa.gov/pub/data/aaa_planetary/msl/rad/cdf/obs-l2/", role: "original dose-rate files (daily CDF v04)" },
  { id: "rems_modrdr", title: "MSL REMS MODRDR surface pressure (MSL-M-REMS-5-MODRDR-V1.0)", publisher: "NASA PDS Atmospheres Node / CAB",
    path: "https://pds-atmospheres.nmsu.edu/PDS/data/mslrem_1001/DATA/", role: "original pressure files" },
  { id: "msl_waypoints", title: "MSL localised rover waypoints", publisher: "NASA / JPL MMGIS",
    path: "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json", role: "rover positions and RMC site/drive identifiers" },
  { id: "usgs_dem", title: "Mars MSL Gale Merged DEM 1 m v3", publisher: "USGS Astrogeology (from MRO HiRISE/CTX)",
    path: "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m", role: "terrain for sky blocking and model geometry" },
  { id: "guo2021", title: "Guo et al. (2021) zenith-angle dose model data", publisher: "Zenodo", path: "https://doi.org/10.5281/zenodo.4701689", role: "published dose model" },
  { id: "guo2026", title: "Guo et al. (2026), JGR Planets: terrain shielding at Curiosity parking periods", publisher: "AGU / Wiley",
    path: "https://doi.org/10.1029/2026JE009704", role: "published periods, solar modulation, albedo range (model calibration)" },
];
export const REPO = "https://github.com/Snehal707/MarsShield";
export const RANDOM = { generator: "mulberry32 (32-bit state), one seeded stream per statistic", note:
  "The Python pipeline uses NumPy's generator, so bootstrap intervals agree with it within Monte Carlo error, not digit for digit. Point estimates agree exactly." };

export type Category = "identifier" | "observed" | "derived" | "modeled" | "coordinate" | "setting";
export type Column<R> = { name: string; type: "string" | "integer" | "number" | "boolean" | "datetime"; unit?: string; category: Category; description: string; get: (r: R) => unknown };
export type Software = { name: string; version: string; commit: string; app_url: string };
export type DatasetId = { file: string; sha256: string; generated_utc?: string; producer: string };

const csvCell = (v: unknown) => {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCSV<R>(cols: Column<R>[], rows: R[]): string {
  return [cols.map((c) => c.name).join(","), ...rows.map((r) => cols.map((c) => csvCell(c.get(r))).join(","))].join("\r\n") + "\r\n";
}
const schema = <R>(cols: Column<R>[]) => ({ fields: cols.map((c) => ({ name: c.name, type: c.type, ...(c.unit ? { unit: c.unit } : {}), description: c.description, "marsshield:category": c.category })) });
const lat = (y: number) => (y / MARS_R) * (180 / Math.PI);
const lon = (x: number) => (x / MARS_R) * (180 / Math.PI);
const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3.6e6;
export const siteOfRmc = (rmc: string) => Number(rmc.split("_")[0]);

const CATEGORY_TEXT = `Every column is tagged in datapackage.json ("marsshield:category"):
- **observed**: a NASA measurement aggregated by MarsShield (for example the mean of RAD Level 2 records over a stop). Not a raw NASA file value.
- **derived**: computed by MarsShield from observations (detrended anomalies, durations, background medians).
- **modeled**: an output of a model or of terrain ray tracing.
- **identifier**, **coordinate**, **setting**: keys, positions and the user's selections.`;

// ------------------------------------------------------------------ terrain experiment
export const TERRAIN_FEATURE_COLUMN: Record<string, string> = { x_p: "pressure_anomaly_Pa", m_terrain: "terrain_model_anomaly_log", g_proxy: "blocked_sky_proxy_anomaly_log" };
const MODEL_FORMULA: Record<ModelId, string> = {
  M0: "prediction = 0 (time-only baseline: the stop behaves like its neighbours in time)",
  M1: "prediction = k * pressure_anomaly_Pa (k fitted on training blocks)",
  M2: "prediction = blocked_sky_proxy_anomaly_log (no fitting)",
  M3: "prediction = terrain_model_anomaly_log (no fitting)",
  M4: "prediction = k * pressure_anomaly_Pa + terrain_model_anomaly_log (k fitted)",
  M5: "prediction = k * pressure_anomaly_Pa + blocked_sky_proxy_anomaly_log (k fitted)",
  M6: "prediction = k * pressure_anomaly_Pa + b * terrain_model_anomaly_log (k, b fitted)",
};

export const stopColumns = (pub: (r: TSRow) => boolean): Column<TSRow>[] => [
  { name: "stop_id", type: "string", category: "identifier", description: "Curiosity rover motion counter, site_drive (NASA/JPL MMGIS waypoint)", get: (r) => r.rmc },
  { name: "nav_site", type: "integer", category: "identifier", description: "Curiosity navigation site index (first part of stop_id); used to group stops in site bootstraps", get: (r) => siteOfRmc(r.rmc) },
  { name: "sol", type: "integer", unit: "sol", category: "identifier", description: "Mars solar day of the waypoint (sol 0 = landing, 2012-08-06)", get: (r) => r.sol },
  { name: "mid_sol", type: "number", unit: "sol", category: "derived", description: "Midpoint of the RAD records at this stop; orders stops in time and defines validation blocks", get: (r) => r.mid_sol },
  { name: "utc_start", type: "datetime", category: "observed", description: "UTC of the first RAD record at the stop", get: (r) => r.utc_start },
  { name: "utc_end", type: "datetime", category: "observed", description: "UTC of the last RAD record at the stop", get: (r) => r.utc_end },
  { name: "duration_h", type: "number", unit: "h", category: "derived", description: "utc_end minus utc_start", get: (r) => hours(r.utc_start, r.utc_end) },
  { name: "rad_records", type: "integer", category: "observed", description: "Number of RAD Level 2 detector-E records averaged (flagged records removed; only records with a matched REMS pressure)", get: (r) => r.n_obs },
  { name: "rad_data_sols", type: "number", unit: "sol", category: "derived", description: "Span of RAD data at the stop", get: (r) => r.data_sols },
  { name: "rad_dose_rate_uGy_per_day", type: "number", unit: "µGy/day", category: "observed", description: "Mean RAD detector-E absorbed dose rate at the stop (tissue-equivalent plastic), from NASA RAD Level 2", get: (r) => r.E_mean },
  { name: "rems_pressure_Pa", type: "number", unit: "Pa", category: "observed", description: "Mean REMS surface pressure matched to the RAD records at the stop", get: (r) => r.P_mean },
  { name: "rems_pressure_background_Pa", type: "number", unit: "Pa", category: "derived", description: "Median REMS pressure of RAD records at other stops within ±window sols", get: (r) => r.P_bg },
  { name: "pressure_anomaly_Pa", type: "number", unit: "Pa", category: "derived", description: "Stop pressure minus background, same detrending as the dose anomaly", get: (r) => r.x_p },
  { name: "observed_anomaly_log", type: "number", unit: "ln ratio", category: "derived", description: "mean ln(dose rate) at the stop minus median ln(dose rate) at other stops within ±window sols; the quantity every model predicts", get: (r) => r.y_obs },
  { name: "observed_anomaly_pct", type: "number", unit: "%", category: "derived", description: "100 * (exp(observed_anomaly_log) - 1); the app's charts show 100 * observed_anomaly_log", get: (r) => 100 * (Math.exp(r.y_obs) - 1) },
  { name: "sky_blocked_fraction", type: "number", unit: "fraction of sky", category: "modeled", description: "Blocked solid-angle fraction B from ray tracing on the USGS 1 m DEM at RAD height", get: (r) => r.B },
  { name: "terrain_model_relative_dose", type: "number", unit: "ratio to open flat ground", category: "modeled", description: "Published terrain-albedo model (Guo et al. 2021, 2026), phi = 500 MV, albedo share 0.21", get: (r) => r.rel_total },
  { name: "terrain_model_anomaly_log", type: "number", unit: "ln ratio", category: "modeled", description: "ln(terrain_model_relative_dose) detrended exactly like observed_anomaly_log", get: (r) => r.m_terrain },
  { name: "blocked_sky_proxy_anomaly_log", type: "number", unit: "ln ratio", category: "modeled", description: "ln(1 - sky_blocked_fraction) detrended exactly like observed_anomaly_log", get: (r) => r.g_proxy },
  { name: "in_published_period", type: "boolean", category: "derived", description: "Stop falls inside a Guo et al. (2026) Table 1 period (±1 sol); those data also informed the model's albedo setting", get: (r) => pub(r) },
  { name: "x_eqc_m", type: "number", unit: "m", category: "coordinate", description: "Easting, Mars 2000 sphere equirectangular (see experiment.json coordinate_reference)", get: (r) => r.x },
  { name: "y_eqc_m", type: "number", unit: "m", category: "coordinate", description: "Northing, Mars 2000 sphere equirectangular", get: (r) => r.y },
  { name: "mars_lat_deg", type: "number", unit: "degree (Mars planetocentric)", category: "coordinate", description: "Mars planetocentric latitude = y_eqc_m / R; not Earth latitude", get: (r) => lat(r.y) },
  { name: "mars_lon_east_deg", type: "number", unit: "degree east (Mars)", category: "coordinate", description: "Mars east longitude = x_eqc_m / R; not Earth longitude", get: (r) => lon(r.x) },
];

export type TerrainInput = {
  rows: TSRow[]; excluded: string[]; subset: { id: string; label: string }; model: ModelId; baseline: ModelId;
  k: number; L: number; window: number; pred: Record<string, number[]>; block: number[]; edges: number[]; coefs: Record<string, number[][]>;
  results: { rmseA: number; rmseB: number; rmseRed: number; mseRed: number; skillA: number; skillB: number;
    d: { mean: number; lo: number; hi: number }; ds: { mean: number; lo: number; hi: number; nSites: number };
    shares: { site: number; n: number; share: number }[]; slope?: { slope: number; lo: number; hi: number } | null; corr?: { r: number; lo: number; hi: number } | null; verdict: string };
  pub: (r: TSRow) => boolean;
};
type PredRow = { r: TSRow; i: number };

export function terrainPredictionColumns(t: TerrainInput): Column<PredRow>[] {
  const pa = t.pred[t.model], pb = t.pred[t.baseline], p0 = t.pred.M0;
  return [
    { name: "stop_id", type: "string", category: "identifier", description: "Joins to observations.csv", get: ({ r }) => r.rmc },
    { name: "validation_block", type: "integer", category: "setting", description: `Held-out time block (0 to ${t.k - 1}) under the selected K = ${t.k}`, get: ({ i }) => t.block[i] },
    { name: "model_id", type: "string", category: "setting", description: "Selected model (see experiment.json models)", get: () => t.model },
    { name: "model_prediction_log", type: "number", unit: "ln ratio", category: "modeled", description: "Held-out prediction of observed_anomaly_log by the selected model", get: ({ i }) => pa[i] },
    { name: "model_residual_log", type: "number", unit: "ln ratio", category: "derived", description: "observed_anomaly_log minus model_prediction_log", get: ({ r, i }) => r.y_obs - pa[i] },
    { name: "baseline_id", type: "string", category: "setting", description: "Selected baseline model", get: () => t.baseline },
    { name: "baseline_prediction_log", type: "number", unit: "ln ratio", category: "modeled", description: "Held-out prediction by the baseline", get: ({ i }) => pb[i] },
    { name: "baseline_residual_log", type: "number", unit: "ln ratio", category: "derived", description: "observed_anomaly_log minus baseline_prediction_log", get: ({ r, i }) => r.y_obs - pb[i] },
    { name: "squared_error_difference", type: "number", unit: "(ln ratio)^2", category: "derived", description: "model_residual_log^2 - baseline_residual_log^2; its mean * 1e4 is the reported dMSE in pp^2", get: ({ r, i }) => (r.y_obs - pa[i]) ** 2 - (r.y_obs - pb[i]) ** 2 },
    { name: "time_only_prediction_log", type: "number", unit: "ln ratio", category: "modeled", description: "M0 prediction (always 0); reference for skill", get: ({ i }) => p0[i] },
  ];
}

export function terrainExperiment(t: TerrainInput, sw: Software, data: DatasetId, now = new Date()) {
  const used = [...new Set([t.model, t.baseline, "M0" as ModelId])];
  return {
    schema: "marsshield-experiment/1", experiment: "terrain_signal",
    title: "Does terrain explain Curiosity's measured dose beyond time and pressure?", generated_utc: now.toISOString(),
    software: sw, dataset: data,
    selections: { model: t.model, baseline: t.baseline, subset: { ...t.subset, n_included: t.rows.length, n_excluded: t.excluded.length, excluded_stop_ids: t.excluded },
      k_time_blocks: t.k, bootstrap_block_length_stops: t.L, detrending_window_sols: t.window },
    models: Object.fromEntries(used.map((m) => [m, { label: MODELS[m].label, formula: MODEL_FORMULA[m],
      fitted_inputs: MODELS[m].fit.map((f) => TERRAIN_FEATURE_COLUMN[f as string]), fixed_offset: MODELS[m].fixed ? TERRAIN_FEATURE_COLUMN[MODELS[m].fixed as string] : null }])),
    method: {
      target: "observed_anomaly_log (see observations.csv)",
      validation: "Leave-one-time-block-out. Blocks are the K quantile intervals of mid_sol (linear interpolation, as numpy.quantile). "
        + "Training excludes the test block and every stop whose mid_sol is within ±window sols of it, because their anomalies share background data. "
        + "Fitted coefficients use least squares without intercept on training stops only.",
      block_edges_sol: t.edges,
      fitted_coefficients_by_block: Object.fromEntries(used.map((m) => [m, t.coefs[m]])),
      units: "Anomalies are natural-log ratios; the app reports them as percentage points (pp) = 100 * value. MSE differences in pp^2 = 1e4 * mean squared_error_difference.",
    },
    results: {
      n_stops: t.rows.length, n_sites: t.results.ds.nSites,
      rmse_model_pp: t.results.rmseA, rmse_baseline_pp: t.results.rmseB, rmse_reduction: t.results.rmseRed, mse_reduction: t.results.mseRed,
      skill_model_vs_time_only: t.results.skillA, skill_baseline_vs_time_only: t.results.skillB,
      dMSE_pp2_time_block_bootstrap: { ...t.results.d, resamples: 2000, seed: 7, block_length_stops: t.L },
      dMSE_pp2_site_bootstrap: { ...t.results.ds, resamples: 2000, seed: 29, cluster: "nav_site" },
      gain_share_by_site: t.results.shares.slice(0, 8),
      calibration_slope: t.results.slope ? { ...t.results.slope, resamples: 2000, seed: 17, block_length_stops: 20 } : null,
      correlation: t.results.corr ? { ...t.results.corr, resamples: 2000, seed: 3, block_length_stops: t.L } : null,
      verdict: t.results.verdict,
      verdict_rule: "Model better (worse) than baseline only if both the time-block and the site bootstrap 95 % intervals of dMSE lie below (above) zero.",
    },
    random: RANDOM, coordinate_reference: CRS, sources: SOURCES,
    interpretation: [
      "Reconstructs each stop's local dose anomaly relative to Curiosity's other stops at about the same time; it does not test absolute dose at new places.",
      "Only partly independent: the terrain model's albedo share was derived by Guo et al. (2026) from RAD data at the published parking periods, including Maria Gordon Notch (nav_site 92).",
      "The terrain signal is concentrated at a few strongly shielded stops; check gain_share_by_site and the 'No notch' and 'No extreme' subsets.",
      "Absorbed dose in RAD's plastic detector during quiet solar conditions; not an astronaut's effective dose and not a safety assessment.",
      "Sol 1812 lies in the September 2017 solar particle event; it is kept, as pre-specified.",
    ],
  };
}

function pythonTerrain(t: TerrainInput) {
  const s = MODELS[t.model];
  const fit = s.fit.map((f) => `"${TERRAIN_FEATURE_COLUMN[f as string]}"`).join(", ");
  const fixed = s.fixed ? `"${TERRAIN_FEATURE_COLUMN[s.fixed as string]}"` : "None";
  return `\`\`\`python
import numpy as np, pandas as pd
d = pd.read_csv("observations.csv").merge(pd.read_csv("predictions.csv"), on="stop_id")
rmse = lambda e: np.sqrt(np.mean(np.square(e))) * 100
print("RMSE model, baseline (pp):", rmse(d.model_residual_log), rmse(d.baseline_residual_log))
print("dMSE (pp^2):", d.squared_error_difference.mean() * 1e4)

# Recompute the held-out predictions of the selected model (${t.model}) from observations.csv alone
K, W = ${t.k}, ${t.window}
fit, fixed = [${fit}], ${fixed}
s = d.mid_sol.to_numpy(); y = d.observed_anomaly_log.to_numpy()
edges = np.quantile(s, np.linspace(0, 1, K + 1))
block = np.clip(np.searchsorted(edges, s, side="right") - 1, 0, K - 1)
off = d[fixed].to_numpy() if fixed else np.zeros(len(d))
X = d[fit].to_numpy() if fit else np.zeros((len(d), 0))
pred = np.full(len(d), np.nan)
for j in range(K):
    te = np.flatnonzero(block == j)
    if te.size == 0: continue
    lo, hi = s[te].min() - W, s[te].max() + W
    tr = np.flatnonzero((block != j) & ((s < lo) | (s > hi)))
    c = np.linalg.lstsq(X[tr], (y - off)[tr], rcond=None)[0] if fit else np.zeros(0)
    pred[te] = off[te] + X[te] @ c
print("max |difference| vs predictions.csv:", np.nanmax(np.abs(pred - d.model_prediction_log)))
print("validation blocks agree:", bool((block == d.validation_block).all()))
\`\`\``;
}

function readme(title: string, body: string, sw: Software, data: DatasetId, files: [string, string][], repro: string, limits: string[]) {
  return `# ${title}

Exported from MarsShield (${sw.app_url}), version ${sw.version}, commit ${sw.commit}. Generated in the browser, without a server.

## Files
${files.map(([f, d]) => `- \`${f}\`: ${d}`).join("\n")}

Column definitions, units and types are in \`datapackage.json\` (Frictionless Data Package); the selections, model definitions,
random seeds and results are in \`experiment.json\`.

## Processed data, not NASA's original files
These tables are MarsShield's processed dataset (\`${data.file}\`, SHA-256 ${data.sha256}${data.generated_utc ? `, generated ${data.generated_utc}` : ""},
produced by \`${data.producer}\` in ${REPO}). Values labelled *observed* are aggregates of NASA measurements, not raw file values.
The original archives are:
${SOURCES.map((s) => `- ${s.title} (${s.publisher}): ${s.path}`).join("\n")}

${CATEGORY_TEXT}

${body}

## Coordinates
${CRS.name}. PROJ: \`${CRS.proj4}\`. ${CRS.note}

## Reproduce
${repro}

The full pipeline (RAD and REMS reduction, ray tracing, dose model) is Python: \`python -m marsshield.pipeline\` in ${REPO}.

## Limitations
${limits.map((l) => `- ${l}`).join("\n")}
`;
}

function datapackage(name: string, title: string, sw: Software, now: Date, resources: { name: string; path: string; description: string; schema: unknown }[]) {
  return {
    profile: "tabular-data-package", name, title, version: sw.version, created: now.toISOString(),
    homepage: sw.app_url, "marsshield:commit": sw.commit,
    sources: SOURCES.map((s) => ({ title: s.title, path: s.path })),
    resources: resources.map((r) => ({ profile: "tabular-data-resource", name: r.name, path: r.path, format: "csv", mediatype: "text/csv", encoding: "utf-8", description: r.description, schema: r.schema })),
  };
}

export function terrainPackage(t: TerrainInput, sw: Software, data: DatasetId, now = new Date()) {
  const obsCols = stopColumns(t.pub), predCols = terrainPredictionColumns(t);
  const preds = t.rows.map((r, i) => ({ r, i }));
  const exp = terrainExperiment(t, sw, data, now);
  const files: [string, string][] = [
    ["observations.csv", `${t.rows.length} Curiosity stops in the selection: identifiers, times, NASA-derived measurements, detrended anomalies, terrain predictors, coordinates`],
    ["predictions.csv", `held-out predictions and residuals of ${t.model} and ${t.baseline}, validation block of each stop`],
    ["experiment.json", "selections, model definitions, method, fitted coefficients, seeds, results, sources, limitations"],
    ["datapackage.json", "machine-readable schema of both CSV files"], ["README.md", "this file"]];
  const body = `## Experiment
${exp.title}
- Model: ${t.model} (${MODELS[t.model].label}); baseline: ${t.baseline} (${MODELS[t.baseline].label}).
- Stops: ${t.subset.label} (${t.rows.length} included, ${t.excluded.length} excluded).
- Validation: ${t.k} held-out time blocks, ±${t.window}-sol buffer; bootstrap block length ${t.L} stops.
- Result: typical error ${t.results.rmseA.toFixed(3)} vs ${t.results.rmseB.toFixed(3)} pp (${(t.results.rmseRed * 100).toFixed(2)} % lower RMSE). Verdict: ${t.results.verdict}.`;
  const md = readme("MarsShield research package: terrain experiment", body, sw, data, files,
    `The point results (RMSE, dMSE) follow directly from predictions.csv; the held-out predictions can be rebuilt from observations.csv:\n\n${pythonTerrain(t)}\n\nBootstrap intervals: see experiment.json (generator, seeds, resamples).`,
    exp.interpretation);
  const dp = datapackage("marsshield-terrain-experiment", exp.title, sw, now, [
    { name: "observations", path: "observations.csv", description: "One row per Curiosity stop in the selection", schema: { ...schema(obsCols), primaryKey: "stop_id" } },
    { name: "predictions", path: "predictions.csv", description: "Held-out predictions for the selected model and baseline", schema: { ...schema(predCols), primaryKey: "stop_id", foreignKeys: [{ fields: "stop_id", reference: { resource: "observations", fields: "stop_id" } }] } },
  ]);
  return { observations: toCSV(obsCols, t.rows), predictions: toCSV(predCols, preds), experiment: exp, datapackage: dp, readme: md };
}

/** Single CSV: observations joined with the selected model's predictions (what "Download data as CSV" gives). */
export function terrainCSV(t: TerrainInput) {
  const o = stopColumns(t.pub), p = terrainPredictionColumns(t).filter((c) => c.name !== "stop_id");
  const cols: Column<PredRow>[] = [...o.map((c) => ({ ...c, get: (q: PredRow) => c.get(q.r) })), ...p];
  return toCSV(cols, t.rows.map((r, i) => ({ r, i })));
}

// ------------------------------------------------------------------ parking experiment
type PRow = ReturnType<typeof parkingPredictions>[number];
export type ParkingInput = { ex: ParkingExperiment; alpha: number; p6alt: boolean; rows: PRow[];
  verdict: { summary: { model: string; mae: number; rmse: number; wins: number }[]; dRMSE: { mean: number; lo: number; hi: number }; verdict: string; clusters: number } };

type PeriodRow = { id: string; role: "parking" | "background"; pair: string; p: ParkingExperiment["periods"][string] };
const periodColumns: Column<PeriodRow>[] = [
  { name: "period_id", type: "string", category: "identifier", description: "Guo et al. (2026) Table 1 period", get: (q) => q.id },
  { name: "role", type: "string", category: "identifier", description: "parking (beside terrain) or background (nearby reference)", get: (q) => q.role },
  { name: "pairs", type: "string", category: "identifier", description: "Parking/background pair(s) this period belongs to, separated by ';' (BG45 serves P4 and P5)", get: (q) => q.pair },
  { name: "site", type: "string", category: "identifier", description: "Location name", get: (q) => q.p.site },
  { name: "sol_start", type: "number", unit: "sol", category: "observed", description: "Start of the period", get: (q) => q.p.sols[0] },
  { name: "sol_end", type: "number", unit: "sol", category: "observed", description: "End of the period", get: (q) => q.p.sols[1] },
  { name: "utc_start", type: "datetime", category: "observed", description: "UTC start", get: (q) => q.p.utc[0] },
  { name: "utc_end", type: "datetime", category: "observed", description: "UTC end", get: (q) => q.p.utc[1] },
  { name: "rad_records", type: "integer", category: "observed", description: "RAD Level 2 detector-E records averaged", get: (q) => q.p.n_obs },
  { name: "rad_dose_rate_uGy_per_day", type: "number", unit: "µGy/day", category: "observed", description: "Mean RAD detector-E dose rate from NASA RAD L2 (MarsShield reduction)", get: (q) => q.p.D_RAD_ours },
  { name: "rad_dose_rate_sem_uGy_per_day", type: "number", unit: "µGy/day", category: "derived", description: "Standard error of that mean", get: (q) => q.p.D_RAD_sem },
  { name: "published_dose_rate_uGy_per_day", type: "number", unit: "µGy/day", category: "observed", description: "Value in Guo et al. (2026) Table 1, for comparison", get: (q) => q.p.D_RAD_pub },
  { name: "solar_modulation_phi_MV", type: "number", unit: "MV", category: "setting", description: "Solar modulation potential from Guo et al. (2026) (TGO Liulin-MO); model input", get: (q) => q.p.phi },
  { name: "sky_blocked_fraction", type: "number", unit: "fraction of sky", category: "modeled", description: "B from MarsShield ray tracing on the 1 m DEM", get: (q) => q.p.B },
  { name: "sky_dose_uGy_per_day", type: "number", unit: "µGy/day", category: "modeled", description: "Dose from the open sky (zenith-angle model, Guo et al. 2021)", get: (q) => q.p.D_sky },
  { name: "flat_sky_dose_uGy_per_day", type: "number", unit: "µGy/day", category: "modeled", description: "Sky dose on open flat ground (Dfs)", get: (q) => q.p.Dfs },
  { name: "x_eqc_m", type: "number", unit: "m", category: "coordinate", description: "Easting, Mars 2000 sphere equirectangular", get: (q) => q.p.x },
  { name: "y_eqc_m", type: "number", unit: "m", category: "coordinate", description: "Northing, Mars 2000 sphere equirectangular", get: (q) => q.p.y },
  { name: "mars_lat_deg", type: "number", unit: "degree (Mars planetocentric)", category: "coordinate", description: "Mars latitude; not Earth latitude", get: (q) => lat(q.p.y) },
  { name: "mars_lon_east_deg", type: "number", unit: "degree east (Mars)", category: "coordinate", description: "Mars east longitude; not Earth longitude", get: (q) => lon(q.p.x) },
];
const closest = (r: PRow) => (["albedo", "sky", "proportional"] as const).reduce((a, m) => (Math.abs(r[m] - r.measured) < Math.abs(r[a] - r.measured) ? m : a), "albedo" as "albedo" | "sky" | "proportional");
const parkingPredColumns = (t: ParkingInput): Column<PRow>[] => [
  { name: "pair", type: "string", category: "identifier", description: "Parking/background pair", get: (r) => r.pair },
  { name: "site", type: "string", category: "identifier", description: "Location", get: (r) => r.site },
  { name: "measured_change", type: "number", unit: "fraction", category: "derived", description: t.p6alt ? "Dose rate parking / background - 1 from NASA RAD L2; for P6 the paper's Section 4 value (-0.17) as selected" : "Dose rate parking / background - 1, from NASA RAD L2", get: (r) => r.measured },
  { name: "physical_model_change", type: "number", unit: "fraction", category: "modeled", description: `Sky + terrain albedo model, albedo share ${t.alpha}`, get: (r) => r.albedo },
  { name: "sky_only_change", type: "number", unit: "fraction", category: "modeled", description: "Sky shielding only", get: (r) => r.sky },
  { name: "proportional_rule_change", type: "number", unit: "fraction", category: "modeled", description: "(1 - B_parking) / (1 - B_background) - 1", get: (r) => r.proportional },
  { name: "physical_model_error", type: "number", unit: "fraction", category: "derived", description: "physical_model_change - measured_change", get: (r) => r.albedo - r.measured },
  { name: "sky_only_error", type: "number", unit: "fraction", category: "derived", description: "sky_only_change - measured_change", get: (r) => r.sky - r.measured },
  { name: "proportional_rule_error", type: "number", unit: "fraction", category: "derived", description: "proportional_rule_change - measured_change", get: (r) => r.proportional - r.measured },
  { name: "closest_model", type: "string", category: "derived", description: "Model with the smallest absolute error for this pair", get: (r) => closest(r) },
  { name: "blocked_fraction_difference", type: "number", unit: "fraction of sky", category: "modeled", description: "B_parking - B_background", get: (r) => r.dB },
];
// each period once; a background shared by two parking periods (BG45 for P4 and P5) lists both pairs
const periodRows = (t: ParkingInput): PeriodRow[] => {
  const out = new Map<string, PeriodRow>();
  for (const { parking: P, background: G } of t.ex.pairs) {
    const pair = `${P}/${G}`;
    if (!out.has(P)) out.set(P, { id: P, role: "parking", pair, p: t.ex.periods[P] });
    const g = out.get(G);
    if (g) g.pair += `;${pair}`; else out.set(G, { id: G, role: "background", pair, p: t.ex.periods[G] });
  }
  return [...out.values()];
};

export function parkingPackage(t: ParkingInput, sw: Software, data: DatasetId, now = new Date()) {
  const pc = parkingPredColumns(t);
  const a = t.alpha;
  const exp = {
    schema: "marsshield-experiment/1", experiment: "parking_periods", title: "Physical model or simple rule at Curiosity's eight parking periods?",
    generated_utc: now.toISOString(), software: sw, dataset: data,
    selections: { albedo_share: a, p6_measured_value: t.p6alt ? "Guo et al. (2026) Section 4: -17 %" : "NASA RAD L2 / Table 1: -19.4 %" },
    models: {
      physical: { label: "Sky + terrain albedo (Guo et al. 2021, 2026)", formula: "D = D_sky + (1 + B) * a * Dfs with a = albedo_share / (1 - albedo_share); change = D_parking / D_background - 1" },
      sky_only: { label: "Sky shielding only", formula: "change = D_sky_parking / D_sky_background - 1" },
      proportional: { label: "Proportional rule", formula: "change = (1 - B_parking) / (1 - B_background) - 1" },
    },
    results: { pairs: t.rows.length, summary_pp: t.verdict.summary, dRMSE_physical_minus_rule_pp: { ...t.verdict.dRMSE, resamples: 4000, seed: 13, cluster: "site" },
      verdict: t.verdict.verdict, sites: t.verdict.clusters },
    random: RANDOM, coordinate_reference: CRS, sources: SOURCES,
    interpretation: [
      "Retrospective: the albedo share range was derived by Guo et al. (2026) from these same periods, so this is not an independent test.",
      "Eight periods at five sites; site-level resampling cannot rank the models.",
      "MarsShield's terrain geometry does not reproduce the published blocked sky at P6 and P8 (narrow canyons).",
      "Absorbed dose in a plastic detector during quiet solar conditions; not effective dose.",
    ],
  };
  const files: [string, string][] = [["observations.csv", "15 periods (8 parking, 7 background; BG45 serves P4 and P5): times, RAD dose rates, published values, model inputs, coordinates"],
    ["predictions.csv", "8 pairs: measured change, three model predictions, errors"], ["experiment.json", "selections, formulas, seeds, results"],
    ["datapackage.json", "schema"], ["README.md", "this file"]];
  const repro = `\`\`\`python
import numpy as np, pandas as pd
p = pd.read_csv("predictions.csv")
for m in ["physical_model", "sky_only", "proportional_rule"]:
    e = p[m + "_error"] * 100
    print(m, "MAE", e.abs().mean(), "RMSE", np.sqrt((e ** 2).mean()))
# recompute the physical model from observations.csv
o = pd.read_csv("observations.csv").set_index("period_id"); a = ${a} / (1 - ${a})
D = o.sky_dose_uGy_per_day + (1 + o.sky_blocked_fraction) * a * o.flat_sky_dose_uGy_per_day
for pair in p.pair:
    P, G = pair.split("/"); print(pair, D[P] / D[G] - 1)
\`\`\``;
  const body = `## Experiment\n${exp.title}\n- Albedo share ${a}; P6 measured value: ${exp.selections.p6_measured_value}.\n- Verdict: ${t.verdict.verdict}.`;
  const dp = datapackage("marsshield-parking-experiment", exp.title, sw, now, [
    { name: "observations", path: "observations.csv", description: "Parking and background periods", schema: { ...schema(periodColumns), primaryKey: "period_id" } },
    { name: "predictions", path: "predictions.csv", description: "Model predictions per pair", schema: { ...schema(pc), primaryKey: "pair" } }]);
  return { observations: toCSV(periodColumns, periodRows(t)), predictions: toCSV(pc, t.rows), experiment: exp, datapackage: dp,
    readme: readme("MarsShield research package: parking periods", body, sw, data, files, repro, exp.interpretation) };
}
export function parkingCSV(t: ParkingInput) {
  const pc = parkingPredColumns(t);
  const byPair = new Map(t.ex.pairs.map(({ parking: P, background: G }) => [`${P}/${G}`, { p: t.ex.periods[P] }]));
  const bg = new Map(t.ex.pairs.map(({ parking: P, background: G }) => [`${P}/${G}`, { p: t.ex.periods[G] }]));
  const cols: Column<PRow>[] = [...pc,
    { name: "parking_dose_rate_uGy_per_day", type: "number", unit: "µGy/day", category: "observed", description: "RAD L2 mean, parking period", get: (r) => byPair.get(r.pair)?.p.D_RAD_ours },
    { name: "background_dose_rate_uGy_per_day", type: "number", unit: "µGy/day", category: "observed", description: "RAD L2 mean, background period", get: (r) => bg.get(r.pair)?.p.D_RAD_ours },
    { name: "parking_sky_blocked_fraction", type: "number", unit: "fraction of sky", category: "modeled", description: "B at the parking position", get: (r) => byPair.get(r.pair)?.p.B },
    { name: "x_eqc_m", type: "number", unit: "m", category: "coordinate", description: "Parking easting, Mars 2000 sphere equirectangular", get: (r) => r.x },
    { name: "y_eqc_m", type: "number", unit: "m", category: "coordinate", description: "Parking northing", get: (r) => r.y },
    { name: "albedo_share", type: "number", category: "setting", description: "Selected albedo share", get: () => t.alpha }];
  return toCSV(cols, t.rows);
}

// ------------------------------------------------------------------ disagreement experiment
export type DisagreeInput = { top: TSRow[]; n: number; pub: (r: TSRow) => boolean;
  result: { d: number; lo: number; hi: number; stops: number; sites: number; perSite: number };
  calibration?: unknown };
type DRow = { r: TSRow; rank: number };
const disagreeColumns: Column<DRow>[] = [
  { name: "stop_id", type: "string", category: "identifier", description: "Joins to observations.csv", get: (q) => q.r.rmc },
  { name: "disagreement_rank", type: "integer", category: "derived", description: "1 = largest |terrain_model_anomaly_log - blocked_sky_proxy_anomaly_log|; chosen from model values only", get: (q) => q.rank },
  { name: "disagreement_log", type: "number", unit: "ln ratio", category: "modeled", description: "terrain_model_anomaly_log - blocked_sky_proxy_anomaly_log", get: (q) => q.r.m_terrain - q.r.g_proxy },
  { name: "observed_anomaly_log", type: "number", unit: "ln ratio", category: "derived", description: "As in observations.csv", get: (q) => q.r.y_obs },
  { name: "physical_model_error_log", type: "number", unit: "ln ratio", category: "derived", description: "observed_anomaly_log - terrain_model_anomaly_log", get: (q) => q.r.y_obs - q.r.m_terrain },
  { name: "proxy_error_log", type: "number", unit: "ln ratio", category: "derived", description: "observed_anomaly_log - blocked_sky_proxy_anomaly_log", get: (q) => q.r.y_obs - q.r.g_proxy },
  { name: "closer_model", type: "string", category: "derived", description: "Model with the smaller absolute error at this stop", get: (q) => (Math.abs(q.r.y_obs - q.r.m_terrain) < Math.abs(q.r.y_obs - q.r.g_proxy) ? "physical" : "proxy") },
];
export function disagreePackage(t: DisagreeInput, sw: Software, data: DatasetId, now = new Date()) {
  const obsCols = stopColumns(t.pub), rows = t.top.map((r, i) => ({ r, rank: i + 1 }));
  const exp = {
    schema: "marsshield-experiment/1", experiment: "model_disagreement", title: "Where the physical model and the blocked-sky rule disagree most",
    generated_utc: now.toISOString(), software: sw, dataset: data,
    selections: { n_stops: t.n, selection_rule: "Top N stops by |terrain_model_anomaly_log - blocked_sky_proxy_anomaly_log|, from model values only, before comparing with RAD" },
    results: { stops_physical_closer: t.result.stops, sites: t.result.sites, sites_physical_closer: t.result.perSite,
      dRMSE_physical_minus_proxy_pp: { mean: t.result.d, lo: t.result.lo, hi: t.result.hi, resamples: 3000, seed: 29, cluster: "nav_site" },
      verdict: t.result.hi < 0 ? "favours the physical model" : t.result.lo > 0 ? "favours the rule" : "cannot distinguish" },
    calibration_all_322_stops: { values: t.calibration ?? null, provenance: "Precomputed by science/marsshield/terrain_signal.py (site-cluster bootstrap, 4000 resamples); not recomputed in the browser" },
    random: RANDOM, coordinate_reference: CRS, sources: SOURCES,
    interpretation: ["Stops at one navigation site share terrain and days; judge by sites, not stop counts.",
      "Calibration slopes describe all 322 stops, not only the selected ones.", "Absorbed dose in a plastic detector; not effective dose."],
  };
  const files: [string, string][] = [["observations.csv", `${t.n} selected stops, same columns as the terrain experiment`], ["predictions.csv", "rank, disagreement, both models' errors"],
    ["experiment.json", "selection rule, results, seeds"], ["datapackage.json", "schema"], ["README.md", "this file"]];
  const repro = `\`\`\`python
import numpy as np, pandas as pd
p = pd.read_csv("predictions.csv")
rmse = lambda e: np.sqrt(np.mean(np.square(e))) * 100
print("stops where physical is closer:", (p.closer_model == "physical").sum())
print("RMSE physical - proxy (pp):", rmse(p.physical_model_error_log) - rmse(p.proxy_error_log))
\`\`\``;
  const dp = datapackage("marsshield-disagreement-experiment", exp.title, sw, now, [
    { name: "observations", path: "observations.csv", description: "Selected stops", schema: { ...schema(obsCols), primaryKey: "stop_id" } },
    { name: "predictions", path: "predictions.csv", description: "Model errors at the selected stops", schema: { ...schema(disagreeColumns), primaryKey: "stop_id" } }]);
  return { observations: toCSV(obsCols, t.top), predictions: toCSV(disagreeColumns, rows), experiment: exp, datapackage: dp,
    readme: readme("MarsShield research package: model disagreement", `## Experiment\n${exp.title}\n- ${t.n} stops, ${t.result.sites} sites. Verdict: ${exp.results.verdict}.`, sw, data, files, repro, exp.interpretation) };
}
export function disagreeCSV(t: DisagreeInput) {
  const o = stopColumns(t.pub), p = disagreeColumns.filter((c) => c.name !== "stop_id" && c.name !== "observed_anomaly_log");
  return toCSV([...o.map((c) => ({ ...c, get: (q: DRow) => c.get(q.r) })), ...p], t.top.map((r, i) => ({ r, rank: i + 1 })));
}

// ------------------------------------------------------------------ zip
export function packageZip(p: { observations: string; predictions: string; experiment: unknown; datapackage: unknown; readme: string }, now = new Date()) {
  return makeZip([
    { name: "README.md", data: p.readme }, { name: "observations.csv", data: p.observations }, { name: "predictions.csv", data: p.predictions },
    { name: "experiment.json", data: JSON.stringify(p.experiment, null, 2) }, { name: "datapackage.json", data: JSON.stringify(p.datapackage, null, 2) }], now);
}
