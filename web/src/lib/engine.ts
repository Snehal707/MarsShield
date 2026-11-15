// Client-side route and break-even engine: a line-by-line port of science/marsshield/routing.py and
// breakeven.py, operating on the exported 5 m grids (height, rel_sky, B, slope). It is verified against the
// Python implementation by web/scripts/verify-engine.mjs. No terrain ray tracing happens here: sky blocking
// and the dose-rate map were computed by the Python pipeline and are only looked up.

export type Objective = "shortest" | "fastest" | "low_dose" | "shelter" | "gentle";
export type GridMeta = { shape: [number, number]; res: number; x0: number; y0: number };
export type EngineInput = {
  meta: GridMeta; height: Float32Array; relSky: Float32Array; B: Float32Array; slope: Float32Array;
  alpha: number; suit: number; maxSlopeDeg?: number;
};

export const SUIT_FACTOR = 0.6;
export const MAX_SLOPE_DEG = 25;
export const STOP_MAX_SLOPE_DEG = 15;
const OFFSETS: [number, number][] = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
  if (dy === 0 && dx === 0) continue;
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  if (g(Math.abs(dy), Math.abs(dx)) === 1) OFFSETS.push([dy, dx]);
}

export const tobler = (s: number) => 6 * Math.exp(-3.5 * Math.abs(s + 0.05));

export function relTotalOf(relSky: number, B: number, alpha: number) {
  const a = alpha / (1 - alpha);
  return (relSky + (1 + B) * a) / (1 + a);
}

// The Python pipeline evaluates the rate map on float32 grids (NumPy keeps float32 with Python scalars), so the
// engine reproduces that rounding exactly. Break-even times divide by small rate differences and would
// otherwise differ in the 5th significant digit.
const f = Math.fround;
export function relTotalF32(relSky: number, B: number, alpha: number) {
  const a = f(alpha / (1 - alpha));
  return f(f(relSky + f(f(1 + B) * a)) / f(1 + a));
}

class MinHeap {
  k: Float64Array; v: Int32Array; n = 0;
  constructor(cap: number) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); }
  push(key: number, val: number) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop(): [number, number] {
    const rk = this.k[0], rv = this.v[0];
    const lk = this.k[--this.n], lv = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= lk) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = lk; this.v[i] = lv;
    return [rk, rv];
  }
}

export class Engine {
  ny: number; nx: number; res: number; x0: number; y0: number;
  z: Float32Array; rate: Float64Array; slope: Float32Array; B: Float32Array;
  suit: number; maxSlope: number;

  constructor(inp: EngineInput) {
    [this.ny, this.nx] = inp.meta.shape; this.res = inp.meta.res; this.x0 = inp.meta.x0; this.y0 = inp.meta.y0;
    this.z = inp.height; this.slope = inp.slope; this.B = inp.B;
    this.suit = inp.suit; this.maxSlope = Math.tan(((inp.maxSlopeDeg ?? MAX_SLOPE_DEG) * Math.PI) / 180);
    this.rate = new Float64Array(this.ny * this.nx);
    for (let i = 0; i < this.rate.length; i++)
      this.rate[i] = Number.isFinite(this.z[i]) ? relTotalF32(inp.relSky[i], inp.B[i], inp.alpha) : 1;
  }

  toRC(x: number, y: number): [number, number] { return [Math.round((this.y0 - y) / this.res), Math.round((x - this.x0) / this.res)]; }
  toXY(r: number, c: number): [number, number] { return [this.x0 + c * this.res, this.y0 - r * this.res]; }
  inside(r: number, c: number) { return r >= 0 && r < this.ny && c >= 0 && c < this.nx; }

  // weight of the directed edge a -> b (a, b flat indices); NaN if impassable
  private weight(a: number, b: number, h: number, obj: Objective): number {
    const dz = this.z[b] - this.z[a];
    if (!Number.isFinite(dz)) return NaN;
    const s = dz / h;
    if (Math.abs(s) > this.maxSlope) return NaN;
    if (obj === "shortest") return Math.hypot(h, dz);
    const t = h / 1000 / (tobler(s) * this.suit);
    if (obj === "fastest") return t;
    const r = 0.5 * (this.rate[a] + this.rate[b]);
    if (obj === "low_dose") return t * r;
    if (obj === "shelter") return Math.hypot(h, dz) * Math.pow(r, 12);
    const g = Math.abs(s) / Math.tan((8 * Math.PI) / 180);
    return t * (1 + g * g);
  }

  /** Single-source Dijkstra. reverse=true computes cost from every node TO the source. */
  dijkstra(src: number, obj: Objective, reverse = false, target = -1): { dist: Float64Array; pred: Int32Array } {
    const N = this.ny * this.nx, nx = this.nx, ny = this.ny;
    const dist = new Float64Array(N).fill(Infinity);
    const pred = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const heap = new MinHeap(1 << 16);
    dist[src] = 0; heap.push(0, src);
    const hs = OFFSETS.map(([dy, dx]) => this.res * Math.hypot(dy, dx));
    while (heap.n) {
      const [d, u] = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === target) break;
      const ur = (u / nx) | 0, uc = u - ur * nx;
      for (let k = 0; k < OFFSETS.length; k++) {
        const vr = ur + OFFSETS[k][0], vc = uc + OFFSETS[k][1];
        if (vr < 0 || vr >= ny || vc < 0 || vc >= nx) continue;
        const v = vr * nx + vc;
        if (done[v]) continue;
        const w = reverse ? this.weight(v, u, hs[k], obj) : this.weight(u, v, hs[k], obj);
        if (!(w >= 0)) continue;
        const nd = d + w;
        if (nd < dist[v]) { dist[v] = nd; pred[v] = u; heap.push(nd, v); }
      }
    }
    return { dist, pred };
  }

  path(a: [number, number], b: [number, number], obj: Objective): Int32Array | null {
    const s = a[0] * this.nx + a[1], t = b[0] * this.nx + b[1];
    const { dist, pred } = this.dijkstra(s, obj, false, t);
    if (!Number.isFinite(dist[t])) return null;
    const out: number[] = [t];
    while (out[out.length - 1] !== s) out.push(pred[out[out.length - 1]]);
    return Int32Array.from(out.reverse());
  }

  /** Same metrics as Router.metrics in routing.py. */
  metrics(nodes: Int32Array, Dflat: number) {
    const nx = this.nx;
    let dist = 0, hor = 0, time = 0, asc = 0, desc = 0, maxS = 0, sw = 0, sws = 0, tr = 0, shade = 0, minRate = Infinity;
    const xy: [number, number][] = [], prof = { s_m: [0] as number[], z: [] as number[], rel_rate: [] as number[] };
    for (let i = 0; i < nodes.length; i++) {
      const r = (nodes[i] / nx) | 0, c = nodes[i] - r * nx;
      xy.push(this.toXY(r, c));
      prof.z.push(this.z[nodes[i]]); prof.rel_rate.push(this.rate[nodes[i]]);
      minRate = Math.min(minRate, this.rate[nodes[i]]);
      if (i === 0) continue;
      const pr = (nodes[i - 1] / nx) | 0, pc = nodes[i - 1] - pr * nx;
      const h = this.res * Math.hypot(r - pr, c - pc), dz = this.z[nodes[i]] - this.z[nodes[i - 1]];
      const s = dz / h, t = h / 1000 / (tobler(s) * this.suit), sr = 0.5 * (this.rate[nodes[i]] + this.rate[nodes[i - 1]]);
      const l3 = Math.hypot(h, dz);
      dist += l3; hor += h; time += t; tr += t * sr;
      if (dz > 0) asc += dz; else desc -= dz;
      maxS = Math.max(maxS, Math.abs(s)); sw += h; sws += Math.abs(s) * h;
      if (sr < 0.93) shade += t;
      prof.s_m.push(dist);
    }
    return {
      distance_m: dist, horizontal_m: hor, time_h: time, ascent_m: asc, descent_m: desc,
      max_slope_deg: (Math.atan(maxS) * 180) / Math.PI, mean_slope_deg: sw ? (Math.atan(sws / sw) * 180) / Math.PI : 0,
      mean_rel_rate: time ? tr / time : NaN, min_rel_rate: minRate, frac_time_shielded: time ? shade / time : 0,
      dose_uGy: (tr * Dflat) / 24, xy, profile: prof,
    };
  }

  rateAt(x: number, y: number) {
    const [r, c] = this.toRC(x, y);
    const rr = Math.min(Math.max(r, 0), this.ny - 1), cc = Math.min(Math.max(c, 0), this.nx - 1);
    return this.rate[rr * this.nx + cc];
  }
}

// ------------------------------------------------------------------ break-even (port of breakeven.py core)
export type BreakEvenResult = ReturnType<typeof breakEven>;
export function breakEven(eng: Engine, start: [number, number], end: [number, number], target: [number, number],
  radius: number, Dflat: number, err: { mae_pp: number; rmse_pp: number }, stopMaxSlope = STOP_MAX_SLOPE_DEG) {
  const s = eng.toRC(...start), e = eng.toRC(...end), t = eng.toRC(...target);
  const fwd = eng.dijkstra(s[0] * eng.nx + s[1], "low_dose");
  const bwd = eng.dijkstra(e[0] * eng.nx + e[1], "low_dose", true);
  const k = Math.ceil(radius / eng.res);
  const cand: { i: number; d: number; W: number; r: number }[] = [];
  for (let r = Math.max(0, t[0] - k); r < Math.min(eng.ny, t[0] + k + 1); r++)
    for (let c = Math.max(0, t[1] - k); c < Math.min(eng.nx, t[1] + k + 1); c++) {
      const d = Math.hypot(r - t[0], c - t[1]) * eng.res, i = r * eng.nx + c;
      if (d > radius || !(eng.slope[i] <= stopMaxSlope)) continue;
      const F = fwd.dist[i] + bwd.dist[i];
      if (!Number.isFinite(F)) continue;
      cand.push({ i, d, W: (F * Dflat) / 24, r: (eng.rate[i] * Dflat) / 24 });
    }
  if (!cand.length) throw new Error("No workable, reachable stop within the work radius.");
  const A = cand.reduce((a, q) => (q.W < a.W ? q : a));
  const Bo = cand.reduce((a, q) => (q.d < a.d ? q : a));
  const Co = cand.reduce((a, q) => (q.r < a.r ? q : a));
  const named: [string, string, typeof A][] = [["A", "Least walking", A], ["B", "At the science target", Bo], ["C", "Most sheltered in reach", Co]];
  const opts: { keys: string[]; labels: string[]; i: number; x: number; y: number; dist_from_target_m: number; W: number; r: number; rel: number; slope: number }[] = [];
  for (const [key, label, q] of named) {
    const ex = opts.find((o) => o.i === q.i);
    if (ex) { ex.keys.push(key); ex.labels.push(label); continue; }
    const rr = (q.i / eng.nx) | 0, cc = q.i - rr * eng.nx;
    const [x, y] = eng.toXY(rr, cc);
    opts.push({ keys: [key], labels: [label], i: q.i, x, y, dist_from_target_m: q.d, W: q.W, r: q.r, rel: eng.rate[q.i], slope: eng.slope[q.i] });
  }
  const classify = (dpp: number) => (dpp >= err.rmse_pp ? "resolved" : dpp >= err.mae_pp ? "marginal" : "unresolved") as "resolved" | "marginal" | "unresolved";
  const breaks: { less: string; more: string; t_h: number; dpp: number; status: ReturnType<typeof classify>; band: [number, number | null]; extraW: number }[] = [];
  for (const o1 of opts) for (const o2 of opts) {
    const dW = o2.W - o1.W, dr = o1.r - o2.r;
    if (!(dW > 0 && dr > 0)) continue;
    const dpp = (o1.rel - o2.rel) * 100, th = dW / dr, e2 = err.rmse_pp;
    breaks.push({ less: o1.keys[0], more: o2.keys[0], t_h: th, dpp, status: classify(dpp),
      band: [th * dpp / (dpp + e2), dpp > e2 ? th * dpp / (dpp - e2) : null], extraW: dW });
  }
  // exact optimum envelope over all candidates for a grid of dwell times
  const T = Array.from({ length: 49 }, (_, j) => j * 0.25);
  const envelope = T.map((tt) => cand.reduce((m, q) => Math.min(m, q.W + tt * q.r), Infinity));
  return { options: opts, breaks, nCandidates: cand.length, T, envelope, classify };
}
