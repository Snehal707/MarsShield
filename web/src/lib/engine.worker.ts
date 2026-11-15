/// <reference lib="webworker" />
// Runs the client-side engine off the main thread. Messages: {id, kind, ...}.
import { breakEven, Engine, type EngineInput, type Objective } from "./engine";

let base: Omit<EngineInput, "alpha" | "suit"> | null = null;
const cache = new Map<string, Engine>();

function engine(alpha: number, suit: number) {
  const k = `${alpha.toFixed(3)}|${suit.toFixed(3)}`;
  let e = cache.get(k);
  if (!e) {
    if (cache.size > 6) cache.clear();
    e = new Engine({ ...(base as Omit<EngineInput, "alpha" | "suit">), alpha, suit });
    cache.set(k, e);
  }
  return e;
}

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  try {
    if (m.kind === "init") { base = m.data; cache.clear(); (self as unknown as Worker).postMessage({ id: m.id, ok: true }); return; }
    if (!base) throw new Error("engine not initialised");
    const e = engine(m.alpha, m.suit);
    if (m.kind === "routes") {
      const out: Record<string, unknown> = {};
      for (const obj of m.objectives as Objective[]) {
        const legs = (m.legs as [[number, number], [number, number]][]).map(([a, b]) => e.path(e.toRC(a[0], a[1]), e.toRC(b[0], b[1]), obj));
        if (legs.some((l) => !l)) { out[obj] = null; continue; }
        out[obj] = legs.map((l) => e.metrics(l as Int32Array, m.Dflat));
      }
      (self as unknown as Worker).postMessage({ id: m.id, ok: true, result: out });
    } else if (m.kind === "breakeven") {
      const r = breakEven(e, m.start, m.end, m.target, m.radius, m.Dflat, m.err, m.stopMaxSlope);
      const opts = r.options.map((o) => {
        const p1 = e.path(e.toRC(m.start[0], m.start[1]), e.toRC(o.x, o.y), "low_dose");
        const p2 = e.path(e.toRC(o.x, o.y), e.toRC(m.end[0], m.end[1]), "low_dose");
        const xy = [...(p1 ? e.metrics(p1, m.Dflat).xy : []), ...(p2 ? e.metrics(p2, m.Dflat).xy.slice(1) : [])];
        return { ...o, xy: xy.filter((_, i) => i % 2 === 0 || i === xy.length - 1) };
      });
      (self as unknown as Worker).postMessage({ id: m.id, ok: true, result: { ...r, options: opts, classify: undefined } });
    } else if (m.kind === "rate") {
      (self as unknown as Worker).postMessage({ id: m.id, ok: true, result: (m.points as [number, number][]).map(([x, y]) => e.rateAt(x, y)) });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
