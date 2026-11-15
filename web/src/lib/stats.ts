// In-browser statistics for the experiments. Point estimates replicate science/marsshield/terrain_signal.py and
// validation.py exactly (verified by scripts/verify-stats.mts); bootstrap intervals are recomputed here with a
// seeded generator, so they agree with Python within Monte Carlo error, not to the last digit.
import type { ParkingExperiment, TSRow } from "./data";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
export const rmse = (e: number[]) => Math.sqrt(mean(e.map((v) => v * v)));
export const mae = (e: number[]) => mean(e.map(Math.abs));
export function pct(a: number[], q: number) {   // numpy 'linear' percentile
  const s = [...a].filter(Number.isFinite).sort((x, y) => x - y);
  const h = (s.length - 1) * q, lo = Math.floor(h);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (h - lo);
}
export function corr(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
}

// least squares without intercept for 1 or 2 columns
function ols(X: number[][], y: number[]): number[] {
  if (X.length === 1) {
    const x = X[0]; let sxy = 0, sxx = 0;
    for (let i = 0; i < y.length; i++) { sxy += x[i] * y[i]; sxx += x[i] * x[i]; }
    return [sxy / sxx];
  }
  const [a, b] = X; let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
  for (let i = 0; i < y.length; i++) { aa += a[i] * a[i]; ab += a[i] * b[i]; bb += b[i] * b[i]; ay += a[i] * y[i]; by += b[i] * y[i]; }
  const det = aa * bb - ab * ab;
  return [(bb * ay - ab * by) / det, (aa * by - ab * ay) / det];
}

export type ModelId = "M0" | "M1" | "M2" | "M3" | "M4" | "M5" | "M6";
export const MODELS: Record<ModelId, { label: string; short: string; fit: (keyof TSRow)[]; fixed: keyof TSRow | null }> = {
  M0: { label: "Time only (no terrain, no pressure)", short: "Time only", fit: [], fixed: null },
  M1: { label: "Atmospheric pressure", short: "Pressure", fit: ["x_p"], fixed: null },
  M2: { label: "Blocked-sky proxy", short: "Sky proxy", fit: [], fixed: "g_proxy" },
  M3: { label: "Published terrain model", short: "Terrain model", fit: [], fixed: "m_terrain" },
  M4: { label: "Pressure + terrain model", short: "Pressure + terrain", fit: ["x_p"], fixed: "m_terrain" },
  M5: { label: "Pressure + sky proxy", short: "Pressure + proxy", fit: ["x_p"], fixed: "g_proxy" },
  M6: { label: "Pressure + rescaled terrain", short: "Pressure + scaled terrain", fit: ["x_p", "m_terrain"], fixed: null },
};

export function quantileEdges(v: number[], k: number) {
  const s = [...v].sort((a, b) => a - b);
  return Array.from({ length: k + 1 }, (_, j) => { const h = (s.length - 1) * (j / k), lo = Math.floor(h); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (h - lo); });
}

/** Leave-one-time-block-out CV, with a +/-window buffer so training targets never share background data with the test block. */
export function crossValidate(rows: TSRow[], models: ModelId[], k: number, window: number) {
  const sols = rows.map((r) => r.mid_sol);
  const edges = quantileEdges(sols, k);
  const block = sols.map((s) => { let j = 0; while (j < k && edges[j + 1] <= s) j++; return Math.min(Math.max(j, 0), k - 1); });
  const pred: Record<string, number[]> = {};
  const coefs: Record<string, number[][]> = {};
  for (const m of models) { pred[m] = new Array(rows.length).fill(NaN); coefs[m] = []; }
  for (let j = 0; j < k; j++) {
    const te = rows.map((_, i) => i).filter((i) => block[i] === j);
    if (!te.length) continue;
    const lo = Math.min(...te.map((i) => sols[i])) - window, hi = Math.max(...te.map((i) => sols[i])) + window;
    const tr = rows.map((_, i) => i).filter((i) => block[i] !== j && (sols[i] < lo || sols[i] > hi));
    for (const m of models) {
      const spec = MODELS[m];
      const off = (i: number) => (spec.fixed ? (rows[i][spec.fixed] as number) : 0);
      let c: number[] = [];
      if (spec.fit.length) {
        c = ols(spec.fit.map((f) => tr.map((i) => rows[i][f] as number)), tr.map((i) => rows[i].y_obs - off(i)));
      }
      coefs[m].push(c);
      for (const i of te) pred[m][i] = off(i) + spec.fit.reduce((s, f, q) => s + c[q] * (rows[i][f] as number), 0);
    }
  }
  return { pred, coefs, block, edges };
}

function mbbIndices(n: number, L: number, r: () => number) {
  const out: number[] = [];
  while (out.length < n) { const s = Math.floor(r() * Math.max(1, n - L + 1)); for (let i = s; i < Math.min(s + L, n) && out.length < n; i++) out.push(i); }
  return out;
}

/** Moving-block bootstrap CI for the difference in mean squared error (a minus b), in pp^2. */
export function dMSE(y: number[], pa: number[], pb: number[], L: number, B = 2000, seed = 7) {
  const d = y.map((v, i) => (v - pa[i]) ** 2 - (v - pb[i]) ** 2);
  const r = rng(seed), bs: number[] = [];
  for (let b = 0; b < B; b++) { const idx = mbbIndices(d.length, L, r); bs.push(mean(idx.map((i) => d[i]))); }
  return { mean: mean(d) * 1e4, lo: pct(bs, 0.025) * 1e4, hi: pct(bs, 0.975) * 1e4, pImproves: bs.filter((v) => v < 0).length / B };
}

export const siteOf = (r: TSRow) => Number(r.rmc.split("_")[0]);

/** 95 % interval of the MSE difference resampling whole Curiosity navigation sites (stops at one site share terrain and time). */
export function siteDMSE(rows: TSRow[], y: number[], pa: number[], pb: number[], B = 2000, seed = 29) {
  const d = y.map((v, i) => (v - pa[i]) ** 2 - (v - pb[i]) ** 2);
  const bySite = new Map<number, number[]>();
  rows.forEach((r, i) => { const s = siteOf(r); if (!bySite.has(s)) bySite.set(s, []); bySite.get(s)!.push(i); });
  const groups = [...bySite.values()], r = rng(seed), bs: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0, n = 0;
    for (let j = 0; j < groups.length; j++) for (const i of groups[Math.floor(r() * groups.length)]) { s += d[i]; n++; }
    bs.push(s / n);
  }
  return { mean: mean(d) * 1e4, lo: pct(bs, 0.025) * 1e4, hi: pct(bs, 0.975) * 1e4, nSites: groups.length };
}

/** Share of the squared-error reduction (baseline -> model) carried by each site, largest first. */
export function siteShares(rows: TSRow[], y: number[], pModel: number[], pBase: number[]) {
  const c = y.map((v, i) => (v - pBase[i]) ** 2 - (v - pModel[i]) ** 2), tot = c.reduce((s, v) => s + v, 0);
  const by = new Map<number, { site: number; n: number; gain: number }>();
  rows.forEach((r, i) => { const s = siteOf(r); const e = by.get(s) ?? { site: s, n: 0, gain: 0 }; e.n++; e.gain += c[i]; by.set(s, e); });
  return [...by.values()].map((e) => ({ ...e, share: e.gain / tot })).sort((a, b) => b.share - a.share);
}

export function corrCI(x: number[], y: number[], L: number, B = 2000, seed = 3) {
  const r = rng(seed), bs: number[] = [];
  for (let b = 0; b < B; b++) { const idx = mbbIndices(x.length, L, r); bs.push(corr(idx.map((i) => x[i]), idx.map((i) => y[i]))); }
  return { r: corr(x, y), lo: pct(bs, 0.025), hi: pct(bs, 0.975) };
}

// ------------------------------------------------------------------ parking-period hypothesis
export type ParkModel = "albedo" | "sky" | "proportional";
export function parkingPredictions(ex: ParkingExperiment, alpha: number, p6Alt = false) {
  const a = alpha / (1 - alpha);
  return ex.pairs.map(({ parking: P, background: G }) => {
    const p = ex.periods[P], g = ex.periods[G];
    const tot = (q: typeof p) => q.D_sky + (1 + q.B) * a * q.Dfs;
    const measured = P === "P6" && p6Alt ? -ex.p6_alternative.section4_decrease : p.D_RAD_ours / g.D_RAD_ours - 1;
    return { pair: `${P}/${G}`, parking: P, site: p.site, measured,
      albedo: tot(p) / tot(g) - 1, sky: p.D_sky / g.D_sky - 1, proportional: (1 - p.B) / (1 - g.B) - 1,
      dB: p.B - g.B, utc: p.utc, x: p.x, y: p.y };
  });
}

/** Errors per model plus a site-cluster bootstrap of the RMSE difference (pairs at one site are not independent). */
export function parkingVerdict(rows: ReturnType<typeof parkingPredictions>, B = 4000, seed = 13) {
  const err = (m: ParkModel) => rows.map((r) => r[m] - r.measured);
  const summary = (["albedo", "sky", "proportional"] as ParkModel[]).map((m) => ({ model: m, mae: mae(err(m)) * 100, rmse: rmse(err(m)) * 100,
    wins: rows.filter((r) => (["albedo", "sky", "proportional"] as ParkModel[]).every((o) => Math.abs(r[m] - r.measured) <= Math.abs(r[o] - r.measured))).length }));
  const sites = [...new Set(rows.map((r) => r.site))];
  const rr = rng(seed), d: number[] = [];
  for (let b = 0; b < B; b++) {
    const pick: typeof rows = [];
    for (let k = 0; k < sites.length; k++) { const s = sites[Math.floor(rr() * sites.length)]; pick.push(...rows.filter((r) => r.site === s)); }
    const ea = pick.map((r) => r.albedo - r.measured), ep = pick.map((r) => r.proportional - r.measured);
    d.push((rmse(ea) - rmse(ep)) * 100);
  }
  const lo = pct(d, 0.025), hi = pct(d, 0.975);
  const verdict = hi < 0 ? "favours the physical model" : lo > 0 ? "favours the simple proxy" : "cannot distinguish the models";
  return { summary, dRMSE: { mean: (rmse(err("albedo")) - rmse(err("proportional"))) * 100, lo, hi }, verdict, clusters: sites.length };
}
