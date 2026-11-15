"use client";
// Responsive research charts. Each chart is drawn at its container's real pixel size (no viewBox scaling), so text stays
// 11-12 px at any width. Measured values: open rings; models: filled shapes (circle, triangle, square) as well as colour.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [s, setS] = useState({ w: 600, h: 260 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setS({ w: Math.max(240, Math.round(e.contentRect.width)), h: Math.max(110, Math.round(e.contentRect.height)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, s];
}

const niceTicks = (lo: number, hi: number, n = 5) => {
  const span = hi - lo || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
};

export type Shape = "ring" | "circle" | "triangle" | "square";
export function Mark({ shape, x, y, r, color, sel }: { shape: Shape; x: number; y: number; r: number; color: string; sel?: boolean }) {
  const st = sel ? { stroke: "#e7b37d", strokeWidth: 2.5 } : {};
  if (shape === "ring") return <circle cx={x} cy={y} r={r} fill="none" stroke={sel ? "#e7b37d" : color} strokeWidth={sel ? 2.6 : 1.6} />;
  if (shape === "circle") return <circle cx={x} cy={y} r={r * 0.85} fill={color} {...st} />;
  if (shape === "square") return <rect x={x - r * 0.8} y={y - r * 0.8} width={r * 1.6} height={r * 1.6} fill={color} {...st} />;
  return <path d={`M${x},${y - r}L${x + r * 0.95},${y + r * 0.75}L${x - r * 0.95},${y + r * 0.75}Z`} fill={color} {...st} />;
}

export function LegendRow({ items }: { items: { shape: Shape; color: string; label: string }[] }) {
  return (
    <div className="rc-legend">{items.map((it) => (
      <span key={it.label}><svg width="14" height="14" aria-hidden="true"><Mark shape={it.shape} x={7} y={7} r={5} color={it.color} /></svg>{it.label}</span>))}
    </div>
  );
}

type Tip = { x: number; y: number; body: ReactNode } | null;
function useTip(): [Tip, (t: Tip) => void] { return useState<Tip>(null); }
const TipBox = ({ tip }: { tip: Tip }) => (tip ? <div className="rc-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.body}</div> : null);

/** Time series of one value per item (x = sol), with measured rings and predicted dots; brush to zoom, click to select. */
export function TimeSeriesChart({ items, x, measured, predicted, revealed, selected, onSelect, yLabel, describe, predLabel }: {
  items: string[]; x: number[]; measured: number[]; predicted: number[]; revealed: boolean; selected: string | null; onSelect: (i: number) => void;
  yLabel: string; describe: (i: number) => ReactNode; predLabel: string;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const [tip, setTip] = useTip();
  const pl = 46, pr = 12, pt = 10, pb = 28;
  const x0 = zoom?.[0] ?? Math.min(...x), x1 = zoom?.[1] ?? Math.max(...x);
  const vis = items.map((_, i) => x[i] >= x0 && x[i] <= x1);
  const vals = predicted.concat(revealed ? measured : []).filter((_, i) => vis[i % items.length]);
  const lo = Math.max(-25, Math.min(-4, ...vals)) - 1, hi = Math.min(15, Math.max(4, ...vals)) + 1;
  const sx = (v: number) => pl + ((v - x0) / (x1 - x0 || 1)) * (w - pl - pr), sy = (v: number) => h - pb - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (h - pb - pt);
  const inv = (px: number) => x0 + ((px - pl) / (w - pl - pr)) * (x1 - x0);
  const r = w > 700 ? 3.6 : 3;
  const local = (e: React.MouseEvent) => { const b = (e.currentTarget as SVGElement).getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  return (
    <div className="rc-wrap">
      <div className="rc-tools">
        <LegendRow items={[{ shape: "circle", color: "#7db3cb", label: `${predLabel} (predicted)` }, ...(revealed ? [{ shape: "ring" as Shape, color: "#f6f1e7", label: "Curiosity RAD (measured)" }] : [])]} />
        {zoom ? <button className="linklike small" onClick={() => setZoom(null)}>Reset zoom</button> : <span className="muted small">Drag across the chart to zoom</span>}
      </div>
      <div className="rc-area" ref={ref}>
        <svg width={w} height={h} role="img" aria-label={`${yLabel} for each stop in time order; ${revealed ? "measured and predicted" : "predicted only"}`}
          onMouseDown={(e) => { const [px] = local(e); if (px > pl) setBrush([px, px]); }}
          onMouseMove={(e) => { const [px] = local(e); if (brush) setBrush([brush[0], px]); }}
          onMouseUp={() => { if (brush && Math.abs(brush[1] - brush[0]) > 8) setZoom([inv(Math.min(...brush)), inv(Math.max(...brush))]); setBrush(null); }}
          onMouseLeave={() => { setBrush(null); setTip(null); }}>
          <g className="rc-grid">{niceTicks(lo, hi, 6).map((v) => <g key={v}><line x1={pl} x2={w - pr} y1={sy(v)} y2={sy(v)} /><text x={pl - 6} y={sy(v) + 4} textAnchor="end">{v}%</text></g>)}</g>
          <line x1={pl} x2={w - pr} y1={sy(0)} y2={sy(0)} className="rc-zero" />
          {niceTicks(x0, x1, Math.max(3, Math.floor(w / 140))).map((v) => <text key={v} x={sx(v)} y={h - 8} textAnchor="middle" className="rc-axis">sol {Math.round(v)}</text>)}
          <text x={12} y={pt + (h - pb - pt) / 2} transform={`rotate(-90 12 ${pt + (h - pb - pt) / 2})`} textAnchor="middle" className="rc-axis">{yLabel}</text>
          {items.map((id, i) => vis[i] && (
            <g key={id} onClick={() => onSelect(i)} style={{ cursor: "pointer" }}
              onMouseEnter={(e) => { const [px, py] = local(e as unknown as React.MouseEvent); setTip({ x: px, y: py, body: describe(i) }); }}>
              {revealed && <line x1={sx(x[i])} x2={sx(x[i])} y1={sy(predicted[i])} y2={sy(measured[i])} className="rc-resid" />}
              <Mark shape="circle" x={sx(x[i])} y={sy(predicted[i])} r={r} color="#7db3cb" />
              {revealed && <Mark shape="ring" x={sx(x[i])} y={sy(measured[i])} r={r + 0.8} color="#f6f1e7" />}
              <circle cx={sx(x[i])} cy={sy(revealed ? measured[i] : predicted[i])} r={12} fill="transparent" />
            </g>))}
          {items.map((id, i) => id === selected && vis[i] && (
            <g key="sel" pointerEvents="none"><line x1={sx(x[i])} x2={sx(x[i])} y1={pt} y2={h - pb} className="rc-sel-line" />
              <Mark shape="ring" x={sx(x[i])} y={sy(revealed ? measured[i] : predicted[i])} r={r + 4} color="#e7b37d" sel /></g>))}
          {brush && <rect x={Math.min(...brush)} y={pt} width={Math.abs(brush[1] - brush[0])} height={h - pb - pt} className="rc-brush" />}
        </svg>
        <TipBox tip={tip} />
      </div>
    </div>
  );
}

/** Measured against predicted (same units on both axes), 1:1 line and fitted slope line with its interval. */
export function ScatterChart({ items, pred, meas, slope, selected, onSelect, describe }: {
  items: string[]; pred: number[]; meas: number[]; slope?: { slope: number; lo: number; hi: number } | null; selected: string | null; onSelect: (i: number) => void; describe: (i: number) => ReactNode;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [tip, setTip] = useTip();
  const pl = 46, pr = 12, pt = 10, pb = 34;
  const all = pred.concat(meas), lo = Math.max(-25, Math.min(...all)) - 1, hi = Math.min(15, Math.max(...all)) + 1;
  const side = Math.min(w - pl - pr, h - pt - pb);
  const sx = (v: number) => pl + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * side, sy = (v: number) => pt + side - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * side;
  const local = (e: React.MouseEvent) => { const b = (e.currentTarget.closest("svg") as SVGElement).getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  // the slope is fitted on the log anomaly (measured y = s * predicted y), so in actual percent the fit is a curve
  const fx = (s: number, p: number) => 100 * ((1 + p / 100) ** s - 1);
  const xs = Array.from({ length: 41 }, (_, k) => lo + ((hi - lo) * k) / 40);
  const curve = (s: number) => xs.map((p, k) => `${k ? "L" : "M"}${sx(p).toFixed(1)},${sy(fx(s, p)).toFixed(1)}`).join("");
  const band = (a: number, b: number) => curve(a) + xs.slice().reverse().map((p) => `L${sx(p).toFixed(1)},${sy(fx(b, p)).toFixed(1)}`).join("") + "Z";
  return (
    <div className="rc-wrap">
      <div className="rc-tools"><LegendRow items={[{ shape: "ring", color: "#f6f1e7", label: "one stop" }]} />
        <span className="muted small">Dashed: perfect agreement{slope ? <>; gold: fitted slope {slope.slope.toFixed(2)} on the log scale (95 % {slope.lo.toFixed(2)}–{slope.hi.toFixed(2)}, shaded)</> : null}</span></div>
      <div className="rc-area" ref={ref}>
        <svg width={w} height={h} role="img" aria-label="Measured against predicted change, one ring per stop" onMouseLeave={() => setTip(null)}>
          <g className="rc-grid">{niceTicks(lo, hi, 6).map((v) => <g key={v}><line x1={sx(v)} x2={sx(v)} y1={pt} y2={pt + side} /><line x1={pl} x2={pl + side} y1={sy(v)} y2={sy(v)} />
            <text x={sx(v)} y={pt + side + 14} textAnchor="middle">{v}</text><text x={pl - 6} y={sy(v) + 4} textAnchor="end">{v}</text></g>)}</g>
          <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} className="rc-one" />
          {slope && <path d={band(slope.lo, slope.hi)} className="rc-band" />}
          {slope && <path d={curve(slope.slope)} className="rc-fit" />}
          {items.map((id, i) => <g key={id} onClick={() => onSelect(i)} style={{ cursor: "pointer" }}
            onMouseEnter={(e) => { const [px, py] = local(e as unknown as React.MouseEvent); setTip({ x: px, y: py, body: describe(i) }); }}>
            <Mark shape="ring" x={sx(pred[i])} y={sy(meas[i])} r={3.4} color="#f6f1e7" sel={id === selected} /><circle cx={sx(pred[i])} cy={sy(meas[i])} r={12} fill="transparent" /></g>)}
          <text x={pl + side / 2} y={pt + side + 30} textAnchor="middle" className="rc-axis">predicted change, %</text>
          <text x={12} y={pt + side / 2} transform={`rotate(-90 12 ${pt + side / 2})`} textAnchor="middle" className="rc-axis">measured change, %</text>
        </svg>
        <TipBox tip={tip} />
      </div>
    </div>
  );
}

/** Horizontal interval plot: point estimates with 95 % intervals against a zero line (uncertainty at a glance). */
export function IntervalChart({ rows, unit, note }: { rows: { label: string; mid: number; lo: number; hi: number; color?: string }[]; unit: string; note?: ReactNode }) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const pl = Math.min(260, w * 0.42), pr = 16, rowH = 30, h = rows.length * rowH + 30;
  const all = rows.flatMap((r) => [r.lo, r.hi, 0]), lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 1;
  const sx = (v: number) => pl + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (w - pl - pr);
  return (
    <div className="rc-wrap rc-fixed">
      <div className="rc-area rc-auto" ref={ref}>
        <svg width={w} height={h} role="img" aria-label={`95 % intervals, ${unit}`}>
          <g className="rc-grid">{niceTicks(lo - pad, hi + pad, 6).map((v) => <g key={v}><line x1={sx(v)} x2={sx(v)} y1={4} y2={h - 22} /><text x={sx(v)} y={h - 6} textAnchor="middle">{v}</text></g>)}</g>
          <line x1={sx(0)} x2={sx(0)} y1={4} y2={h - 22} className="rc-zero-v" />
          {rows.map((r, i) => { const cy = 18 + i * rowH; return <g key={r.label}>
            <text x={pl - 10} y={cy + 4} textAnchor="end" className="rc-lbl">{r.label}</text>
            <line x1={sx(r.lo)} x2={sx(r.hi)} y1={cy} y2={cy} stroke={r.color ?? "#7db3cb"} strokeWidth={3} strokeLinecap="round" />
            <circle cx={sx(r.mid)} cy={cy} r={4.5} fill={r.color ?? "#7db3cb"} stroke="#1a1511" strokeWidth={1.5} /></g>; })}
        </svg>
      </div>
      <p className="muted small">{unit}. A bar that does not cross the zero line is a difference the data support.{note ? <> {note}</> : null}</p>
    </div>
  );
}

/** One row per item with several values on a shared % axis (measured ring + model shapes); click a row to select it. */
export function DotRowsChart({ rows, series, selected, onSelect, lo: lo0, hi: hi0, unit }: {
  rows: { id: string; label: string; sub?: string; values: Record<string, number | null> }[];
  series: { key: string; label: string; shape: Shape; color: string }[]; selected: string | null; onSelect: (id: string) => void; lo?: number; hi?: number; unit: string;
}) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const rowH = rows.length > 24 ? 22 : 30, pl = Math.min(150, w * 0.3), pr = 16, h = rows.length * rowH + 28;
  const vals = rows.flatMap((r) => Object.values(r.values).filter((v): v is number => v != null));
  const lo = lo0 ?? Math.min(0, ...vals) - 2, hi = hi0 ?? Math.max(0, ...vals) + 2;
  const sx = (v: number) => pl + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (w - pl - pr);
  return (
    <div className="rc-wrap rc-fixed">
      <div className="rc-tools"><LegendRow items={series.map((s) => ({ shape: s.shape, color: s.color, label: s.label }))} /></div>
      <div className="rc-area rc-auto" ref={ref}>
        <svg width={w} height={h} role="img" aria-label={`${unit} for each item, measured and modeled`}>
          <g className="rc-grid">{niceTicks(lo, hi, 7).map((v) => <g key={v}><line x1={sx(v)} x2={sx(v)} y1={4} y2={h - 22} /><text x={sx(v)} y={h - 6} textAnchor="middle">{v}%</text></g>)}</g>
          <line x1={sx(0)} x2={sx(0)} y1={4} y2={h - 22} className="rc-zero-v" />
          {rows.map((r, i) => { const cy = 14 + i * rowH; const sel = r.id === selected; return (
            <g key={r.id} onClick={() => onSelect(r.id)} style={{ cursor: "pointer" }}>
              <rect x={0} y={cy - rowH / 2} width={w} height={rowH} fill={sel ? "rgba(231,179,125,0.12)" : "transparent"} />
              <text x={pl - 10} y={cy + (r.sub && rowH > 24 ? 0 : 4)} textAnchor="end" className="rc-lbl">{r.label}</text>
              {r.sub && rowH > 24 && <text x={pl - 10} y={cy + 11} textAnchor="end" className="rc-sub">{r.sub}</text>}
              {series.map((s) => r.values[s.key] != null && <Mark key={s.key} shape={s.shape} x={sx(r.values[s.key] as number)} y={cy} r={s.shape === "ring" ? 6 : 4.6} color={s.color} sel={sel && s.shape !== "ring"} />)}
            </g>); })}
        </svg>
      </div>
    </div>
  );
}

/** Keep the selected table row visible inside its own scroller only (never scroll the page). */
export function useScrollRowIntoView(container: React.RefObject<HTMLElement | null>, key: string | null) {
  useEffect(() => {
    const c = container.current;
    if (!c || !key) return;
    const row = c.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`);
    if (!row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < c.scrollTop + 30 || bottom > c.scrollTop + c.clientHeight) c.scrollTop = Math.max(0, top - c.clientHeight / 2);
  }, [container, key]);
}
