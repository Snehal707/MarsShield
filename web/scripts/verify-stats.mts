// Verifies src/lib/stats.ts against Python results in public/data (point estimates must match exactly).
import { readFileSync } from "node:fs";
import { crossValidate, parkingPredictions, siteDMSE, siteShares, MODELS, type ModelId } from "../src/lib/stats.ts";

const D = new URL("../public/data/", import.meta.url);
const js = (n: string) => JSON.parse(readFileSync(new URL(n, D), "utf8"));
let fails = 0;
const check = (name: string, a: number, b: number, tol = 1e-9) => {
  const ok = Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: js ${a.toFixed(8)} py ${b.toFixed(8)}`);
};

const ts = js("terrain_signal.json");
const ids = Object.keys(MODELS) as ModelId[];
const cv = crossValidate(ts.rows, ids, ts.k_blocks, ts.window_sols);
const y = ts.rows.map((r: { y_obs: number }) => r.y_obs);
const mse = (p: number[]) => y.reduce((s: number, v: number, i: number) => s + (v - p[i]) ** 2, 0) / y.length;
const m0 = mse(cv.pred.M0);
for (const m of ids) {
  check(`${m} skill`, 1 - mse(cv.pred[m]) / m0, ts.performance[m].skill_vs_M0);
  check(`${m} rmse_pp`, Math.sqrt(mse(cv.pred[m])) * 100, ts.performance[m].rmse_pp);
}

// gain concentration (exact) and site-cluster interval (Monte Carlo: different generator, so a tolerance)
const sh = siteShares(ts.rows, y, cv.pred.M3, cv.pred.M0);
check("site 92 share of M3 gain", sh.find((s) => s.site === 92)!.share, ts.influence.mgn_site.share);
check("largest site share", sh[0].share, ts.influence.site_shares_M3_vs_M0[0].share);
const sc = siteDMSE(ts.rows, y, cv.pred.M3, cv.pred.M0, 4000);
const [plo, phi] = ts.site_ci95_dMSE_vs_M0_pp2.M3;
check("site-bootstrap M3-M0 lower bound (MC tol 15 %)", sc.lo, plo, 0.15);
check("site-bootstrap M3-M0 upper bound (MC tol 0.3 pp2)", sc.hi, phi, 0.3 / Math.max(1, Math.abs(phi)));
check("RMSE reduction M3", 1 - Math.sqrt(mse(cv.pred.M3) / m0), ts.rmse_reduction_vs_M0.M3);

const ex = js("experiment_parking.json");
const val = js("validation.json");
const preds = parkingPredictions(ex, 0.19);
for (const p of val.pairs) {
  const j = preds.find((q) => q.pair === p.pair)!;
  check(`${p.pair} albedo(0.19)`, j.albedo, p.pred_albedo_019, 1e-6);
  check(`${p.pair} sky`, j.sky, p.pred_sky_only, 1e-9);
  check(`${p.pair} proportional`, j.proportional, p.pred_proportional, 1e-9);
  check(`${p.pair} measured`, j.measured, p.measured_ours, 1e-9);
}
console.log(fails ? `\n${fails} FAILURES` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
