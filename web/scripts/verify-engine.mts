// Verifies the browser engine (src/lib/engine.ts) against the Python pipeline outputs in public/data.
// Run: node scripts/verify-engine.mts   (Node >= 22.18, native TypeScript type stripping)
import { readFileSync } from "node:fs";
import { Engine, breakEven, SUIT_FACTOR, type Objective } from "../src/lib/engine.ts";

const D = new URL("../public/data/", import.meta.url);
const f32 = (n: string) => { const b = readFileSync(new URL(n, D)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const js = (n: string) => JSON.parse(readFileSync(new URL(n, D), "utf8"));
const meta = js("meta.json");
const grids = { height: f32("height.f32"), relSky: f32("rel_sky.f32"), B: f32("B.f32"), slope: f32("slope.f32") };
let failures = 0;
const check = (name: string, a: number, b: number, rel = 1e-6) => {
  const ok = Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: js ${a.toFixed(6)} py ${b.toFixed(6)}`);
};

// 1. routes: scenario.direct (two-point plan) for every objective
const sc = js("scenario.json").direct;
const eng = new Engine({ meta, ...grids, alpha: sc.alpha, suit: SUIT_FACTOR });
for (const r of sc.routes) {
  if (!r.feasible) continue;
  const t0 = performance.now();
  const p = eng.path(eng.toRC(sc.start[0], sc.start[1]), eng.toRC(sc.end[0], sc.end[1]), r.objective as Objective)!;
  const m = eng.metrics(p, sc.D_flat_uGy_d);
  console.log(`  ${r.objective}: ${(performance.now() - t0).toFixed(0)} ms, ${p.length} nodes`);
  check(`${r.objective} distance_m`, m.distance_m, r.distance_m);
  check(`${r.objective} time_h`, m.time_h, r.time_h);
  check(`${r.objective} dose_uGy`, m.dose_uGy, r.dose_uGy);
}

// 2. break-even: legacy Maria Gordon Notch and Mt Mercou cases
for (const [name, be] of Object.entries(js("breakeven.json")) as [string, any][]) {
  const t0 = performance.now();
  const res = breakEven(eng, be.start, be.end, be.target, be.radius_m, be.D_flat_uGy_d, be.model_error);
  console.log(`  break-even ${name}: ${(performance.now() - t0).toFixed(0)} ms, ${res.nCandidates} candidates (py ${be.n_candidates})`);
  check(`${name} n_candidates`, res.nCandidates, be.n_candidates);
  for (const o of be.options) {
    const j = res.options.find((q) => q.keys[0] === o.keys[0])!;
    check(`${name} ${o.keys.join("")} walk_dose`, j.W, o.walk_dose_uGy);
    check(`${name} ${o.keys.join("")} stop_rate`, j.r, o.stop_rate_uGy_h);
  }
  for (const b of be.breaks) {
    const j = res.breaks.find((q) => q.less === b.less_walking && q.more === b.more_sheltered)!;
    check(`${name} ${b.less_walking}->${b.more_sheltered} t_h`, j.t_h, b.t_h);
    if (j.status !== b.resolvability) { failures++; console.log(`FAIL status ${j.status} vs ${b.resolvability}`); }
  }
}
console.log(failures ? `\n${failures} FAILURES` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
