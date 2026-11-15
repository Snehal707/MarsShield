// The browser's three-region dose interpolation must reproduce the Python export (science/marsshield/regional_dose.py).
// Run: node --experimental-strip-types scripts/verify-radiation.mts
import { readFileSync } from "node:fs";
import { cumulative, interpP, rateAt, type Radiation } from "../src/lib/radiation.ts";

const R: Radiation = JSON.parse(readFileSync(new URL("../public/data/regions/radiation.json", import.meta.url), "utf8"));
let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };

for (const s of R.sites) for (const [lab, e] of [["mean", s.baseline], ["low", s.season_low], ["high", s.season_high]] as const) {
  for (const phi of R.model.phi_nodes_MV) {
    const v = rateAt(R, "effective", phi, e.pressure_pa).v;
    ok(Math.abs(v - e.effective_mSv_yr[String(phi)]) < 0.006, `${s.id} ${lab} effective ${phi} MV: js ${v.toFixed(3)} py ${e.effective_mSv_yr[String(phi)]}`);
  }
  const w = rateAt(R, "water", 580, e.pressure_pa).v, q = rateAt(R, "doseEq", 580, e.pressure_pa).v;
  ok(Math.abs(w - e.water_absorbed_mGy_yr_580MV) < 0.006, `${s.id} ${lab} water: js ${w.toFixed(3)} py ${e.water_absorbed_mGy_yr_580MV}`);
  ok(Math.abs(q - e.dose_equivalent_mSv_yr_580MV) < 0.06, `${s.id} ${lab} dose equivalent: js ${q.toFixed(2)} py ${e.dose_equivalent_mSv_yr_580MV}`);
  ok(rateAt(R, "effective", 700, e.pressure_pa).edge === e.at_grid_edge, `${s.id} ${lab} grid-edge flag matches`);
}
const nodes = R.model.pressures_pa, vals = R.tables.effective_mSv_yr["700"];
ok(nodes.every((p, i) => interpP(nodes, vals, p).v === vals[i]), "interpolation returns every published node exactly");
ok(interpP(nodes, vals, 10).edge && interpP(nodes, vals, 10).v === vals[0], "no extrapolation below 82 Pa");
ok(Math.abs(cumulative(R, 170, 100) - 47.82) < 0.01, "100 sols at 170 mSv/yr = 47.82 mSv (1 sol = 1.0275 d)");
console.log(fails ? `\n${fails} CHECKS FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
