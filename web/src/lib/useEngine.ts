"use client";
// Main-thread client for the engine worker. Falls back to running the engine on the main thread if Workers
// are unavailable. Every call resolves with real recalculated numbers, never a precomputed lookup.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dataset } from "./data";
import { breakEven, Engine, type Objective } from "./engine";

export type RouteMetrics = ReturnType<Engine["metrics"]>;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Measured wall-clock time of the last engine call (performance.now, in this browser), and calls still running. */
export type CalcStatus = { running: number; last: { kind: string; ms: number } | null };

export function useEngine(ds: Dataset | null, onStatus?: (s: CalcStatus) => void) {
  const status = useRef<CalcStatus>({ running: 0, last: null });
  const report = useRef(onStatus);
  useEffect(() => { report.current = onStatus; }, [onStatus]);
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const seq = useRef(0);
  const [ready, setReady] = useState(false);
  const fallback = useRef<Map<string, Engine>>(new Map());

  useEffect(() => {
    if (!ds) return;
    const data = { meta: { shape: ds.meta.shape, res: ds.meta.res, x0: ds.meta.x0, y0: ds.meta.y0 },
      height: ds.grids.height, relSky: ds.grids.relSky, B: ds.grids.B, slope: ds.grids.slope };
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev) => {
        const p = pending.current.get(ev.data.id);
        if (!p) return;
        pending.current.delete(ev.data.id);
        if (ev.data.ok) p.resolve(ev.data.result); else p.reject(new Error(ev.data.error));
      };
      w.onerror = () => { worker.current = null; setReady(true); };
      worker.current = w;
      const id = ++seq.current;
      pending.current.set(id, { resolve: () => setReady(true), reject: () => { worker.current = null; setReady(true); } });
      w.postMessage({ id, kind: "init", data });
    } catch {
      worker.current = null; setReady(true);
    }
    return () => { w?.terminate(); };
  }, [ds]);

  return useMemo(() => {
    const local = (alpha: number, suit: number) => {
      const k = `${alpha}|${suit}`;
      let e = fallback.current.get(k);
      if (!e && ds) {
        e = new Engine({ meta: ds.meta, height: ds.grids.height, relSky: ds.grids.relSky, B: ds.grids.B, slope: ds.grids.slope, alpha, suit });
        fallback.current.set(k, e);
      }
      return e as Engine;
    };
    const call = <T,>(msg: Record<string, unknown>, run: () => T): Promise<T> => {
      const t0 = performance.now();
      status.current = { ...status.current, running: status.current.running + 1 };
      report.current?.(status.current);
      const done = () => {
        status.current = { running: Math.max(0, status.current.running - 1), last: { kind: String(msg.kind), ms: performance.now() - t0 } };
        report.current?.(status.current);
      };
      return callRaw<T>(msg, run).finally(done);
    };
    const callRaw = <T,>(msg: Record<string, unknown>, run: () => T): Promise<T> => {
      if (worker.current) {
        const id = ++seq.current;
        return new Promise<T>((resolve, reject) => {
          pending.current.set(id, { resolve: resolve as (v: unknown) => void, reject });
          worker.current!.postMessage({ id, ...msg });
        });
      }
      return new Promise<T>((resolve, reject) => setTimeout(() => { try { resolve(run()); } catch (e) { reject(e as Error); } }, 0));
    };
    return {
      ready,
      routes: (legs: [[number, number], [number, number]][], objectives: Objective[], alpha: number, suit: number, Dflat: number) =>
        call<Record<string, RouteMetrics[] | null>>({ kind: "routes", legs, objectives, alpha, suit, Dflat }, () => {
          const e = local(alpha, suit), out: Record<string, RouteMetrics[] | null> = {};
          for (const o of objectives) {
            const ls = legs.map(([a, b]) => e.path(e.toRC(a[0], a[1]), e.toRC(b[0], b[1]), o));
            out[o] = ls.some((l) => !l) ? null : ls.map((l) => e.metrics(l as Int32Array, Dflat));
          }
          return out;
        }),
      breakEven: (p: { start: [number, number]; end: [number, number] | null; target: [number, number]; radius: number; Dflat: number;
        err: { mae_pp: number; rmse_pp: number }; alpha: number; suit: number; stopMaxSlope: number; objective: Objective }) =>
        call<BEJs>({ kind: "breakeven", ...p }, () => {
          const e = local(p.alpha, p.suit);
          const r = breakEven(e, p.start, p.end, p.target, p.radius, p.Dflat, p.err, p.stopMaxSlope, p.objective);
          return { ...r, options: r.options.map((o) => ({ ...o, xy: [...o.out.xy, ...(o.back ? o.back.xy.slice(1) : [])] })) } as unknown as BEJs;
        }),
    };
  }, [ready, ds]);
}

export type BELeg = { distance_m: number; time_h: number; dose_uGy: number };
export type BEJs = {
  options: { keys: string[]; labels: string[]; i: number; x: number; y: number; dist_from_target_m: number; W: number; r: number; rel: number; slope: number;
    out: BELeg; back: BELeg | null; xy: [number, number][] }[];
  objective: Objective;
  breaks: { less: string; more: string; t_h: number; dpp: number; status: "resolved" | "marginal" | "unresolved"; band: [number, number | null]; extraW: number }[];
  nCandidates: number; T: number[]; envelope: number[];
};
