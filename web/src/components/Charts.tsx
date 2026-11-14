"use client";
import { useState } from "react";
import type { Route } from "@/lib/data";
import { ROUTE_COLORS } from "@/lib/data";

type Tip = { x: number; y: number; text: string } | null;

function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const el = tip ? <div className="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div> : null;
  return { tip: el, show: (e: React.MouseEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text }), hide: () => setTip(null) };
}

function ticks(lo: number, hi: number, n = 4) {
  const span = hi - lo;
  const step = Math.pow(10, Math.floor(Math.log10(span / n)));
  const err = (n * step) / span;
  const s = err <= 0.15 ? step * 10 : err <= 0.35 ? step * 5 : err <= 0.75 ? step * 2 : step;
  const out = [];
  for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10));
  return out;
}

// ---------------------------------------------------------------------------------------
// Predicted vs measured dose-rate change per parking/background pair (dot plot, one axis)
export function PairDotPlot({ pairs }: { pairs: { pair: string; site: string; measured_ours: number; pred_proportional: number; pred_sky_only: number; pred_albedo_019: number }[] }) {
  const { tip, show, hide } = useTip();
  const W = 380, rowH = 26, top = 18, pl = 92, pr = 10;
  const H = top + pairs.length * rowH + 22;
  const lo = -32, hi = 4;
  const x = (v: number) => pl + ((v - lo) / (hi - lo)) * (W - pl - pr);
  const series = [
    { k: "pred_albedo_019", name: "Sky + terrain albedo (this model)", color: "#3987e5" },
    { k: "pred_sky_only", name: "Sky only", color: "#d95926" },
    { k: "pred_proportional", name: "Proportional to blocked sky", color: "#199e70" },
  ] as const;
  return (
    <figure style={{ margin: 0 }}>
      <div className="legend">
        <span><i style={{ background: "transparent", border: "2px solid #fff" }} />Measured by RAD</span>
        {series.map((s) => <span key={s.k}><i style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Predicted versus measured dose-rate change">
        <g className="grid">{ticks(lo, hi, 6).map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 22} />)}</g>
        <line x1={x(0)} x2={x(0)} y1={top - 6} y2={H - 22} stroke="rgba(236,230,218,0.35)" />
        {pairs.map((p, i) => {
          const cy = top + i * rowH + rowH / 2;
          return (
            <g key={p.pair}>
              <text x={pl - 8} y={cy + 4} textAnchor="end" className="lbl">{p.pair.split("/")[0]}</text>
              <text x={pl - 8} y={cy + 15} textAnchor="end" style={{ fontSize: 9.5 }}>{p.site.replace("Maria Gordon Notch", "M. Gordon N.")}</text>
              {series.map((s, j) => {
                const v = (p[s.k] as number) * 100;
                return <circle key={s.k} cx={x(v)} cy={cy - 6 + j * 6} r={4} fill={s.color} stroke="#1c2333" strokeWidth={1.5}
                  onMouseEnter={(e) => show(e, `${p.pair} ${s.name}: ${v.toFixed(1)} %`)} onMouseLeave={hide} />;
              })}
              <circle cx={x(p.measured_ours * 100)} cy={cy} r={6} fill="none" stroke="#fff" strokeWidth={2}
                onMouseEnter={(e) => show(e, `${p.pair} measured (NASA RAD L2, detector E): ${(p.measured_ours * 100).toFixed(1)} %`)} onMouseLeave={hide} />
            </g>
          );
        })}
        {ticks(lo, hi, 6).map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{t}%</text>)}
      </svg>
      {tip}
    </figure>
  );
}

// ---------------------------------------------------------------------------------------
export function ScatterXY({ pts, xLabel, yLabel, lo, hi, identity = true, unit = "", color = "#3987e5", fmtv = (v: number) => v.toFixed(3) }: {
  pts: { x: number; y: number; label: string; ring?: boolean }[]; xLabel: string; yLabel: string; lo: number; hi: number; identity?: boolean; unit?: string; color?: string; fmtv?: (v: number) => string;
}) {
  const { tip, show, hide } = useTip();
  const W = 360, H = 260, pl = 44, pb = 36, pt = 10, pr = 10;
  const x = (v: number) => pl + ((v - lo) / (hi - lo)) * (W - pl - pr);
  const y = (v: number) => H - pb - ((v - lo) / (hi - lo)) * (H - pb - pt);
  const tk = ticks(lo, hi, 5);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`${yLabel} versus ${xLabel}`}>
        <g className="grid">{tk.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={pt} y2={H - pb} /><line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} /></g>)}</g>
        {identity && <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="rgba(236,230,218,0.4)" strokeDasharray="4 4" />}
        {pts.map((p, i) => (
          <circle key={i} cx={x(Math.max(lo, Math.min(hi, p.x)))} cy={y(Math.max(lo, Math.min(hi, p.y)))} r={p.ring ? 5 : 3.2}
            fill={p.ring ? "none" : color} fillOpacity={p.ring ? 0 : 0.7} stroke={p.ring ? "#fff" : "#1c2333"} strokeWidth={p.ring ? 2 : 1}
            onMouseEnter={(e) => show(e, `${p.label}: ${xLabel} ${fmtv(p.x)}${unit}, ${yLabel} ${fmtv(p.y)}${unit}`)} onMouseLeave={hide} />
        ))}
        {tk.map((t) => <text key={`x${t}`} x={x(t)} y={H - pb + 14} textAnchor="middle">{t}</text>)}
        {tk.map((t) => <text key={`y${t}`} x={pl - 6} y={y(t) + 4} textAnchor="end">{t}</text>)}
        <text x={(pl + W - pr) / 2} y={H - 4} textAnchor="middle" className="lbl">{xLabel}</text>
        <text x={12} y={(pt + H - pb) / 2} textAnchor="middle" className="lbl" transform={`rotate(-90 12 ${(pt + H - pb) / 2})`}>{yLabel}</text>
      </svg>
      {tip}
    </figure>
  );
}

// ---------------------------------------------------------------------------------------
export function HorizonCompare({ az, a, b }: { az: number[]; a: number[]; b: number[] }) {
  const { tip, show, hide } = useTip();
  const W = 380, H = 170, pl = 30, pb = 24, pt = 8, pr = 6;
  const hi = Math.ceil(Math.max(...a, ...b) / 10) * 10;
  const x = (v: number) => pl + (v / 360) * (W - pl - pr);
  const y = (v: number) => H - pb - (Math.max(v, 0) / hi) * (H - pb - pt);
  const path = (v: number[]) => v.map((e, i) => `${i ? "L" : "M"}${x(az[i]).toFixed(1)},${y(e).toFixed(1)}`).join("");
  const [hx, setHx] = useState<number | null>(null);
  return (
    <figure style={{ margin: 0 }}>
      <div className="legend">
        <span><i style={{ background: "#fff" }} />RAD-team mask (Zenodo, published)</span>
        <span><i style={{ background: "#3987e5" }} />MarsShield ray tracing on the USGS 1 m DEM</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Horizon elevation versus azimuth at Butte M12"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const v = ((e.clientX - r.left) / r.width) * W;
          const i = Math.max(0, Math.min(az.length - 1, Math.round(((v - pl) / (W - pl - pr)) * 360)));
          setHx(i); show(e, `Azimuth ${az[i]}°: mask ${a[i].toFixed(1)}°, DEM ${b[i].toFixed(1)}°`);
        }} onMouseLeave={() => { setHx(null); hide(); }}>
        <g className="grid">{ticks(0, hi, 3).map((t) => <line key={t} x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} />)}</g>
        <path d={path(a)} fill="none" stroke="#fff" strokeWidth={2} />
        <path d={path(b)} fill="none" stroke="#3987e5" strokeWidth={2} />
        {hx != null && <line x1={x(az[hx])} x2={x(az[hx])} y1={pt} y2={H - pb} stroke="#ece6da" strokeOpacity={0.5} />}
        {[0, 90, 180, 270, 360].map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{["N", "E", "S", "W", "N"][t / 90]}</text>)}
        {ticks(0, hi, 3).map((t) => <text key={t} x={pl - 5} y={y(t) + 4} textAnchor="end">{t}°</text>)}
      </svg>
      {tip}
    </figure>
  );
}

// ---------------------------------------------------------------------------------------
// Route profiles: two stacked single-axis charts sharing the distance axis (never dual-axis).
export function RouteProfiles({ routes, selected }: { routes: Route[]; selected: string | null }) {
  const { tip, show, hide } = useTip();
  const W = 380, h1 = 110, h2 = 80, pl = 40, pr = 8, gap = 18;
  const feas = routes.filter((r) => r.feasible);
  const maxS = Math.max(...feas.map((r) => r.profile.s_m[r.profile.s_m.length - 1]));
  const zs = feas.flatMap((r) => r.profile.z);
  const zlo = Math.min(...zs), zhi = Math.max(...zs);
  const rs = feas.flatMap((r) => r.profile.rel_rate);
  const rlo = Math.floor(Math.min(...rs) * 50) / 50, rhi = Math.ceil(Math.max(...rs) * 50) / 50;
  const x = (s: number) => pl + (s / maxS) * (W - pl - pr);
  const y1 = (z: number) => h1 - 14 - ((z - zlo) / (zhi - zlo || 1)) * (h1 - 22);
  const y2 = (v: number) => h1 + gap + h2 - 14 - ((v - rlo) / (rhi - rlo || 1)) * (h2 - 22);
  const thin = (a: number[]) => a.filter((_, i) => i % 3 === 0 || i === a.length - 1);
  const ord = [...feas].sort((a) => (a.objective === selected ? 1 : -1));
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${h1 + gap + h2 + 18}`} className="chart" role="img" aria-label="Elevation and modeled dose rate along each route">
        <text x={pl} y={10} className="lbl">Elevation (m, areoid)</text>
        <text x={pl} y={h1 + gap + 4} className="lbl">Modeled dose rate relative to open flat ground</text>
        {ticks(zlo, zhi, 3).map((t) => <g key={t} className="grid"><line x1={pl} x2={W - pr} y1={y1(t)} y2={y1(t)} /><text x={pl - 5} y={y1(t) + 4} textAnchor="end">{t}</text></g>)}
        {ticks(rlo, rhi, 3).map((t) => <g key={t} className="grid"><line x1={pl} x2={W - pr} y1={y2(t)} y2={y2(t)} /><text x={pl - 5} y={y2(t) + 4} textAnchor="end">{t.toFixed(2)}</text></g>)}
        {ord.map((r) => {
          const s = thin(r.profile.s_m), z = thin(r.profile.z), v = thin(r.profile.rel_rate);
          const on = !selected || selected === r.objective;
          const st = { stroke: ROUTE_COLORS[r.objective], strokeWidth: selected === r.objective ? 2.4 : 1.5, opacity: on ? 1 : 0.35, fill: "none" };
          return (
            <g key={r.objective}>
              <path d={s.map((q, i) => `${i ? "L" : "M"}${x(q).toFixed(1)},${y1(z[i]).toFixed(1)}`).join("")} {...st} />
              <path d={s.map((q, i) => `${i ? "L" : "M"}${x(q).toFixed(1)},${y2(v[i]).toFixed(1)}`).join("")} {...st} />
            </g>
          );
        })}
        {ticks(0, maxS, 4).map((t) => <text key={t} x={x(t)} y={h1 + gap + h2 + 12} textAnchor="middle">{t >= 1000 ? `${t / 1000} km` : `${t} m`}</text>)}
        <rect x={pl} y={0} width={W - pl - pr} height={h1 + gap + h2} fill="transparent"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGRectElement).ownerSVGElement!.getBoundingClientRect();
            const sv = ((((e.clientX - r.left) / r.width) * W - pl) / (W - pl - pr)) * maxS;
            const R = feas.find((q) => q.objective === selected) ?? feas[0];
            const i = R.profile.s_m.findIndex((q) => q >= sv);
            if (i >= 0) show(e, `${R.label} at ${(sv / 1000).toFixed(2)} km: ${R.profile.z[i].toFixed(0)} m, rate ×${R.profile.rel_rate[i].toFixed(3)}`);
          }} onMouseLeave={hide} />
      </svg>
      {tip}
    </figure>
  );
}

export function SensitivityBars({ rows, label, unit = "pp" }: { rows: { name: string; mean: number; max: number }[]; label: string; unit?: string }) {
  const { tip, show, hide } = useTip();
  const W = 380, rowH = 20, pl = 70, pr = 40;
  const H = rows.length * rowH + 4;
  const m = Math.max(...rows.map((r) => Math.abs(r.max)), 0.5);
  const x = (v: number) => pl + (v / m) * (W - pl - pr);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
        {rows.map((r, i) => (
          <g key={r.name} onMouseEnter={(e) => show(e, `${r.name}: mean |ΔB| ${r.mean.toFixed(2)} ${unit}, max ${r.max.toFixed(2)} ${unit}`)} onMouseLeave={hide}>
            <text x={pl - 6} y={i * rowH + 14} textAnchor="end" className="lbl">{r.name}</text>
            <rect x={pl} y={i * rowH + 5} width={Math.max(0, x(r.max) - pl)} height={12} rx={2} fill="rgba(57,135,229,0.35)" />
            <rect x={pl} y={i * rowH + 5} width={Math.max(0, x(r.mean) - pl)} height={12} rx={2} fill="#3987e5" />
            <text x={x(r.max) + 4} y={i * rowH + 15}>{r.mean.toFixed(1)} / {r.max.toFixed(1)}</text>
            <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" />
          </g>
        ))}
      </svg>
      <figcaption className="muted">{label}. Dark bar: mean change; light bar: largest change; labels show mean / largest ({unit}).</figcaption>
      {tip}
    </figure>
  );
}
