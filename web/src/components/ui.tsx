"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// One shared grammar instead of badges on every line: shown once per view, then encoded by colour and style.
export function Grammar() {
  return (
    <div className="grammar" aria-label="How values are shown">
      <span><i className="dot-m" />NASA measurement</span>
      <span><i className="dot-p" />Model prediction</span>
      <span><i className="dot-a" />Planning assumption</span>
    </div>
  );
}
export const M = ({ children }: { children: ReactNode }) => <span className="v-measured">{children}</span>;
export const P = ({ children }: { children: ReactNode }) => <span className="v-model">{children}</span>;
export const A = ({ children }: { children: ReactNode }) => <span className="v-assume">{children}</span>;

export function Chip({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`chip ${kind}`}>{children}</span>;
}

export function More({ label, children, open = false }: { label: string; children: ReactNode; open?: boolean }) {
  return <details className="more" open={open}><summary>{label}</summary>{children}</details>;
}

export function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="slider">
      <label htmlFor={id} id={`${id}-l`}>{label}</label><output htmlFor={id}>{fmt(value)}</output>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={fmt(value)} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, label }: { options: [T, string][]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={String(v)} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export const h = (v: number) => { const t = Math.round(v * 60), hh = Math.floor(t / 60), mm = t - hh * 60; return hh ? `${hh} h ${String(mm).padStart(2, "0")}` : `${mm} min`; };
export const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);
export const sgn = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

export function download(name: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Dose of each stop option relative to option A as a function of time at the stop (straight lines). */
export function TradeoffChart({ options, T, envelope, dwell, err }: {
  options: { key: string; W: number; r: number; color: string; dashed: boolean }[]; T: number[]; envelope: number[]; dwell: number; err?: string;
}) {
  const W = 380, H = 180, pl = 44, pr = 18, pt = 10, pb = 30, tmax = T[T.length - 1];
  const A = options[0];
  const diff = (o: { W: number; r: number }, t: number) => (o.W - A.W) + t * (o.r - A.r);
  const env = T.map((t, i) => envelope[i] - (A.W + t * A.r));
  const vals = options.flatMap((o) => [diff(o, 0), diff(o, tmax)]).concat(env, [0]);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const x = (t: number) => pl + (t / tmax) * (W - pl - pr), y = (v: number) => H - pb - ((v - lo) / (hi - lo)) * (H - pb - pt);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Whole-walk modeled dose of each stop option relative to option A, against time at the stop">
        <rect x={pl} y={y(0)} width={W - pl - pr} height={Math.max(0, y(lo) - y(0))} fill="rgba(125,179,203,0.06)" />
        <g className="grid">{[0, 3, 6, 9, 12].filter((t) => t <= tmax).map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={pt} y2={H - pb} />)}</g>
        <line x1={pl} x2={W - pr} y1={y(0)} y2={y(0)} stroke="rgba(239,230,216,0.4)" />
        <path d={T.map((t, i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(env[i]).toFixed(1)}`).join("")} fill="none" stroke="#8f8373" strokeDasharray="3 4" />
        {options.map((o) => <path key={o.key} d={`M${x(0)},${y(diff(o, 0))} L${x(tmax)},${y(diff(o, tmax))}`} stroke={o.color} strokeWidth={2.2} fill="none"
          strokeDasharray={o.dashed ? "6 4" : undefined} opacity={o.dashed ? 0.75 : 1} />)}
        {options.map((o) => <text key={`l${o.key}`} x={W - pr + 4} y={y(diff(o, tmax)) + 4} className="lbl" style={{ fontWeight: 700 }}>{o.key}</text>)}
        <line x1={x(dwell)} x2={x(dwell)} y1={pt} y2={H - pb} stroke="#e7b37d" strokeWidth={1.4} />
        {[0, 3, 6, 9, 12].filter((t) => t <= tmax).map((t) => <text key={t} x={x(t)} y={H - pb + 13} textAnchor="middle">{t} h</text>)}
        <text x={pl - 6} y={y(hi) + 10} textAnchor="end">more</text>
        <text x={pl - 6} y={y(lo) - 2} textAnchor="end">less</text>
        <text x={(pl + W - pr) / 2} y={H - 3} textAnchor="middle" className="lbl">time at the stop</text>
      </svg>
      <figcaption className="muted">Whole-walk dose relative to stop A, µGy. Below the line means less dose than A. Dashed lines differ from A by less than the model&apos;s validated error{err ? ` (${err})` : ""}. The vertical line is your planned duration.</figcaption>
    </figure>
  );
}

/** One stage of an experiment's fixed sequence: Question, Prediction, NASA observations, Result, Explanation. */
export function Step({ n, title, children, id }: { n: number; title: string; children: ReactNode; id?: string }) {
  return <section className="exp-step" aria-labelledby={`${id ?? `step${n}`}-h`}><h3 id={`${id ?? `step${n}`}-h`} tabIndex={id ? -1 : undefined}><i aria-hidden="true">{n}</i>{title}</h3>{children}</section>;
}

/** True while the media query matches (false during static render). */
export function useMedia(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); f(); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, [q]);
  return m;
}

/** WAI-ARIA tabs: one tab stop, arrow keys move between tabs, Home/End jump. With `manual`, arrows only move focus and
 *  Enter/Space activates (used where activating a tab is expensive, such as switching mode). */
export function Tabs<T extends string>({ tabs, value, onChange, label, className, manual = false, vertical = false }: {
  tabs: [T, string][]; value: T | null; onChange: (v: T) => void; label: string; className?: string; manual?: boolean; vertical?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const cur = Math.max(0, tabs.findIndex(([k]) => k === value));
  const [focusI, setFocusI] = useState(cur);
  useEffect(() => setFocusI(cur), [cur]);
  const move = (e: KeyboardEvent, i: number) => {
    const n = tabs.length, next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
    if (next == null || (!vertical && (e.key === "ArrowUp" || e.key === "ArrowDown"))) return;
    e.preventDefault();
    const j = (next + n) % n;
    setFocusI(j); refs.current[j]?.focus();
    if (!manual) onChange(tabs[j][0]);
  };
  return (
    <div className={className} role="tablist" aria-label={label} aria-orientation={vertical ? "vertical" : "horizontal"}>
      {tabs.map(([k, l], i) => (
        <button key={k} ref={(el) => { refs.current[i] = el; }} role="tab" aria-selected={k === value} tabIndex={i === focusI ? 0 : -1}
          onClick={() => onChange(k)} onKeyDown={(e) => move(e, i)} onFocus={() => setFocusI(i)}>{l}</button>))}
    </div>
  );
}
