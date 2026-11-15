// Verifies the research exports: rows follow the selection, predictions and residuals match the experiment statistics
// (and the Python results), the ZIP is valid, and the metadata carries units, provenance and reproducibility details.
// Run: node scripts/verify-exports.mts [outdir]   (writes the sample packages to outdir for the Python reproduction check)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { crossValidate, dMSE, MODELS, parkingPredictions, parkingVerdict, rmse, siteDMSE, siteShares, type ModelId } from "../src/lib/stats.ts";
import { disagreePackage, parkingCSV, parkingPackage, packageZip, terrainCSV, terrainPackage, type TerrainInput } from "../src/lib/exports.ts";
import { readZip } from "../src/lib/zip.ts";

const D = new URL("../public/data/", import.meta.url);
const raw = (n: string) => readFileSync(new URL(n, D));
const js = (n: string) => JSON.parse(raw(n).toString("utf8"));
const ts = js("terrain_signal.json"), ex = js("experiment_parking.json"), val = js("validation.json");
const sha = (n: string) => createHash("sha256").update(raw(n)).digest("hex");
const sw = { name: "MarsShield", version: "test", commit: "test", app_url: "https://marsshield.vercel.app/" };
const NOW = new Date("2026-11-15T00:00:00Z");
const out = process.argv[2];
let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (!cond) fails++; console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`); };
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const parseCSV = (s: string) => { const [h, ...r] = s.trim().split("\r\n"); const cols = h.split(","); return r.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v]))); };
const pub = (r: { mid_sol: number }) => Object.values(ex.periods).some((p: any) => r.mid_sol >= p.sols[0] - 1 && r.mid_sol <= p.sols[1] + 1);

function terrain(model: ModelId, baseline: ModelId, subset: "all" | "nomgn" | "nopub", k: number, L: number): TerrainInput {
  const all = ts.rows as any[];
  const rows = subset === "nomgn" ? all.filter((r) => !r.rmc.startsWith("92_")) : subset === "nopub" ? all.filter((r) => !pub(r)) : all;
  const cv = crossValidate(rows, [model, baseline, "M0"], k, ts.window_sols);
  const y = rows.map((r) => r.y_obs);
  const m0 = y.reduce((s: number, v: number, i: number) => s + (v - cv.pred.M0[i]) ** 2, 0) / y.length;
  const sk = (m: string) => 1 - y.reduce((s: number, v: number, i: number) => s + (v - cv.pred[m][i]) ** 2, 0) / y.length / m0;
  const rA = rmse(y.map((v: number, i: number) => v - cv.pred[model][i])) * 100, rB = rmse(y.map((v: number, i: number) => v - cv.pred[baseline][i])) * 100;
  return { rows, excluded: all.filter((r) => !rows.includes(r)).map((r) => r.rmc), subset: { id: subset, label: subset }, model, baseline, k, L, window: ts.window_sols,
    pred: cv.pred, block: cv.block, edges: cv.edges, coefs: cv.coefs, pub,
    results: { rmseA: rA, rmseB: rB, rmseRed: 1 - rA / rB, mseRed: 1 - (rA / rB) ** 2, skillA: sk(model), skillB: sk(baseline),
      d: dMSE(y, cv.pred[model], cv.pred[baseline], L), ds: siteDMSE(rows, y, cv.pred[model], cv.pred[baseline]), shares: siteShares(rows, y, cv.pred[model], cv.pred[baseline]),
      slope: null, corr: null, verdict: "test" } };
}
const data = (f: string) => ({ file: `data/${f}`, sha256: sha(f), generated_utc: ts.generated_utc, producer: "science/marsshield/terrain_signal.py" });

// 1. default selection reproduces the published Python numbers
{
  const t = terrain("M3", "M0", "all", 8, 20), p = terrainPackage(t, sw, data("terrain_signal.json"), NOW);
  const obs = parseCSV(p.observations), pr = parseCSV(p.predictions);
  ok("default: 322 observation rows and 322 prediction rows", obs.length === 322 && pr.length === 322);
  const rm = Math.sqrt(pr.reduce((s, r) => s + (+r.model_residual_log) ** 2, 0) / pr.length) * 100;
  ok("default: RMSE from predictions.csv = Python terrain model RMSE", near(rm, ts.performance.M3.rmse_pp, 1e-9), `${rm} vs ${ts.performance.M3.rmse_pp}`);
  ok("default: RMSE reduction = Python value", near(t.results.rmseRed, ts.rmse_reduction_vs_M0.M3, 1e-9));
  const dm = pr.reduce((s, r) => s + +r.squared_error_difference, 0) / pr.length * 1e4;
  ok("default: mean squared_error_difference = experiment dMSE", near(dm, (p.experiment as any).results.dMSE_pp2_time_block_bootstrap.mean, 1e-9));
  ok("default: CSV blocks equal Python blocks at K = 8", pr.every((r, i) => +r.validation_block === ts.rows[i].block));
  ok("default: residual = observed - prediction", obs.every((o, i) => near(+o.observed_anomaly_log - +pr[i].model_prediction_log, +pr[i].model_residual_log, 1e-12)));
  const dp = p.datapackage as any;
  ok("datapackage: field names equal CSV headers", ["observations", "predictions"].every((n, j) => dp.resources[j].schema.fields.map((f: any) => f.name).join(",") === (j ? p.predictions : p.observations).split("\r\n")[0]));
  ok("datapackage: every field has a description and a category", dp.resources.every((r: any) => r.schema.fields.every((f: any) => f.description && f["marsshield:category"])));
  ok("datapackage: measured dose is 'observed' with unit µGy/day", dp.resources[0].schema.fields.some((f: any) => f.name === "rad_dose_rate_uGy_per_day" && f.unit === "µGy/day" && f["marsshield:category"] === "observed"));
  ok("datapackage: predictions are 'modeled'", dp.resources[1].schema.fields.find((f: any) => f.name === "model_prediction_log")["marsshield:category"] === "modeled");
  const e = p.experiment as any;
  ok("experiment.json: seeds, generator, sources, CRS, dataset hash", e.results.dMSE_pp2_time_block_bootstrap.seed === 7 && e.results.dMSE_pp2_site_bootstrap.seed === 29 && e.random.generator.includes("mulberry32")
    && e.sources.length >= 6 && e.coordinate_reference.proj4.includes("+R=3396190") && /^[0-9a-f]{64}$/.test(e.dataset.sha256));
  ok("experiment.json: model definitions and block edges present", e.models.M3.formula && e.method.block_edges_sol.length === 9);
  ok("coordinates: Mars lat/lon within Gale Crater, labelled as Mars", obs.every((o) => +o.mars_lat_deg > -5.5 && +o.mars_lat_deg < -4 && +o.mars_lon_east_deg > 137 && +o.mars_lon_east_deg < 138)
    && !p.observations.split("\r\n")[0].match(/(^|,)(lat|lon|latitude|longitude)(,|$)/));
  ok("README: links NASA archives and says processed, not raw", p.readme.includes("spdf.gsfc.nasa.gov") && p.readme.includes("pds-atmospheres") && p.readme.includes("not raw file values"));
  const z = readZip(packageZip(p, NOW));
  ok("ZIP: five files, CRCs valid", z.map((f) => f.name).sort().join(",") === "README.md,datapackage.json,experiment.json,observations.csv,predictions.csv" && z.every((f) => f.crcOk));
  ok("ZIP: contents identical to the package", z.find((f) => f.name === "observations.csv")!.text === p.observations && JSON.parse(z.find((f) => f.name === "experiment.json")!.text).results.rmse_model_pp === e.results.rmse_model_pp);
  const one = parseCSV(terrainCSV(t));
  ok("single CSV: 322 rows with observations and predictions joined", one.length === 322 && "rad_dose_rate_uGy_per_day" in one[0] && "model_prediction_log" in one[0]);
  if (out) { mkdirSync(`${out}/terrain_default`, { recursive: true }); for (const f of z) writeFileSync(`${out}/terrain_default/${f.name}`, f.text); }
}
// 2. filtering out Maria Gordon Notch
{
  const t = terrain("M3", "M0", "nomgn", 8, 20), p = terrainPackage(t, sw, data("terrain_signal.json"), NOW);
  const obs = parseCSV(p.observations);
  ok("no notch: 316 rows, none from nav_site 92", obs.length === 316 && obs.every((o) => o.nav_site !== "92"));
  const v = ts.robustness.find((r: any) => r.variant.startsWith("excluding site 92 ("));
  ok("no notch: RMSE reduction = Python robustness variant", near(t.results.rmseRed, v.rmse_reduction.M3, 1e-9), `${t.results.rmseRed} vs ${v.rmse_reduction.M3}`);
  ok("no notch: 6 excluded stop ids recorded", (p.experiment as any).selections.subset.excluded_stop_ids.length === 6);
}
// 3. switching models and validation settings
{
  const t = terrain("M2", "M3", "nopub", 6, 40), p = terrainPackage(t, sw, data("terrain_signal.json"), NOW);
  const pr = parseCSV(p.predictions);
  ok("switch: 295 rows (published periods removed)", pr.length === 295);
  ok("switch: model/baseline columns follow the selection", pr.every((r) => r.model_id === "M2" && r.baseline_id === "M3"));
  ok("switch: blocks follow K = 6", new Set(pr.map((r) => r.validation_block)).size === 6);
  const rm = Math.sqrt(pr.reduce((s, r) => s + (+r.model_residual_log) ** 2, 0) / pr.length) * 100;
  ok("switch: RMSE from CSV = in-app statistic", near(rm, t.results.rmseA, 1e-12));
  ok("switch: bootstrap block length recorded", (p.experiment as any).selections.bootstrap_block_length_stops === 40);
  const t1 = terrain("M4", "M1", "all", 8, 20), p1 = terrainPackage(t1, sw, data("terrain_signal.json"), NOW);
  const py = ts.performance.M4.rmse_pp, rm1 = Math.sqrt(parseCSV(p1.predictions).reduce((s, r) => s + (+r.model_residual_log) ** 2, 0) / 322) * 100;
  ok("fitted model M4: RMSE from CSV = Python", near(rm1, py, 1e-9), `${rm1} vs ${py}`);
  ok("fitted model M4: per-block coefficients exported", (p1.experiment as any).method.fitted_coefficients_by_block.M4.length === 8);
  if (out) { mkdirSync(`${out}/terrain_m4`, { recursive: true }); for (const f of readZip(packageZip(p1, NOW))) writeFileSync(`${out}/terrain_m4/${f.name}`, f.text); }
}
// 4. parking periods
{
  const rows = parkingPredictions(ex, 0.19), v = parkingVerdict(rows), p = parkingPackage({ ex, alpha: 0.19, p6alt: false, rows, verdict: v }, sw, { file: "data/experiment_parking.json", sha256: sha("experiment_parking.json"), producer: "science/marsshield/pipeline.py" }, NOW);
  const pr = parseCSV(p.predictions), ob = parseCSV(p.observations);
  ok("parking: 8 pairs, 15 distinct periods (BG45 listed once, serving P4 and P5)", pr.length === 8 && ob.length === 15 && new Set(ob.map((o) => o.period_id)).size === 15 && ob.find((o) => o.period_id === "BG45")!.pairs === "P4/BG45;P5/BG45");
  const a8 = js("audit.json").A3_eight_pairs["P6_19.4pct_table1"];
  const mae = pr.reduce((s, r) => s + Math.abs(+r.physical_model_error), 0) / 8 * 100;
  ok("parking: physical-model MAE from CSV = Python audit", near(mae, a8.pred_albedo_019.mae_pp, 1e-6), `${mae} vs ${a8.pred_albedo_019.mae_pp}`);
  ok("parking: measured change = validation.json", pr.every((r) => near(+r.measured_change, val.pairs.find((q: any) => q.pair === r.pair).measured_ours, 1e-9)));
  const alt = parkingPredictions(ex, 0.22, true), pa = parseCSV(parkingCSV({ ex, alpha: 0.22, p6alt: true, rows: alt, verdict: parkingVerdict(alt) }));
  ok("parking: selections respected (albedo 0.22, P6 = -17 %)", pa.every((r) => r.albedo_share === "0.22") && near(+pa.find((r) => r.pair.startsWith("P6"))!.measured_change, -0.17, 1e-12));
  if (out) { mkdirSync(`${out}/parking`, { recursive: true }); for (const f of readZip(packageZip(p, NOW))) writeFileSync(`${out}/parking/${f.name}`, f.text); }
}
// 5. disagreement
{
  const ranked = [...ts.rows].sort((p: any, q: any) => Math.abs(q.m_terrain - q.g_proxy) - Math.abs(p.m_terrain - p.g_proxy));
  const top = ranked.slice(0, 20);
  const stops = top.filter((r: any) => Math.abs(r.y_obs - r.m_terrain) < Math.abs(r.y_obs - r.g_proxy)).length;
  const p = disagreePackage({ top, n: 20, pub, result: { d: 0, lo: -1, hi: 1, stops, sites: new Set(top.map((r: any) => r.rmc.split("_")[0])).size, perSite: 6 } }, sw, data("terrain_signal.json"), NOW);
  const pr = parseCSV(p.predictions);
  ok("disagreement: 20 selected stops, ranked 1-20", pr.length === 20 && pr[0].disagreement_rank === "1" && pr[19].disagreement_rank === "20");
  const py = ts.disagreement_test.results.find((r: any) => r.top === 20);
  ok("disagreement: stops where physical is closer = Python (14)", pr.filter((r) => r.closer_model === "physical").length === py.stops_model_closer);
  const d = (Math.sqrt(pr.reduce((s, r) => s + (+r.physical_model_error_log) ** 2, 0) / 20) - Math.sqrt(pr.reduce((s, r) => s + (+r.proxy_error_log) ** 2, 0) / 20)) * 100;
  ok("disagreement: RMSE difference from CSV = Python", near(d, py.dRMSE_pp, 1e-9), `${d} vs ${py.dRMSE_pp}`);
  if (out) { mkdirSync(`${out}/disagree`, { recursive: true }); for (const f of readZip(packageZip(p, NOW))) writeFileSync(`${out}/disagree/${f.name}`, f.text); }
}
void MODELS;
console.log(fails ? `\n${fails} FAILURES` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
