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
// 3. mission consistency: for every route strategy, the walking dose used in the stop comparison (W, accumulated on the
//    Dijkstra trees) equals the dose of the actual outbound + return paths the plan reports; one-way has no return leg;
//    and the low_dose comparison is unchanged from the Python-verified one above.
{
  const be = (js("breakeven.json") as Record<string, any>)["Maria Gordon Notch"];
  const base = breakEven(eng, be.start, be.end, be.target, be.radius_m, be.D_flat_uGy_d, be.model_error);
  for (const obj of ["low_dose", "fastest", "shortest", "shelter"] as Objective[]) {
    const res = breakEven(eng, be.start, be.end, be.target, be.radius_m, be.D_flat_uGy_d, be.model_error, undefined, obj);
    for (const o of res.options) {
      check(`plan ${obj} ${o.keys.join("")}: W = out + back path dose`, o.W, o.out.dose_uGy + (o.back?.dose_uGy ?? 0), 1e-9);
      const p = o.out.xy, q = o.back!.xy;
      if (Math.hypot(p[p.length - 1][0] - o.x, p[p.length - 1][1] - o.y) > 1e-6 || Math.hypot(q[0][0] - o.x, q[0][1] - o.y) > 1e-6) {
        failures++; console.log(`FAIL plan ${obj} ${o.keys.join("")}: path does not pass through the stop`);
      }
    }
    if (obj === "low_dose") for (const o of res.options) check(`plan low_dose ${o.keys.join("")} = default`, o.W, base.options.find((q) => q.i === o.i)!.W, 1e-12);
  }
  const one = breakEven(eng, be.start, null, be.target, be.radius_m, be.D_flat_uGy_d, be.model_error, undefined, "fastest");
  for (const o of one.options) {
    if (o.back !== null) { failures++; console.log("FAIL one-way plan has a return leg"); }
    check(`one-way fastest ${o.keys.join("")}: W = out path dose`, o.W, o.out.dose_uGy, 1e-9);
  }
}
console.log(failures ? `\n${failures} FAILURES` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
