"use client";
import { useMemo, useState } from "react";
import type { Sky } from "@/lib/data";

// Fisheye of the sky above the astronaut: centre = zenith, rim = horizon (zenith angle 90 deg),
// radius proportional to zenith angle, north up, east right (map orientation).
// Each 1-degree ring is shaded by how much downward GCR dose it delivers (Guo et al. 2021 model),
// so you can see which blocked directions actually matter.
export function SkyDisc({ sky, size = 300 }: { sky: Sky; size?: number }) {
  const R = size / 2 - 18;
  const c = size / 2;
  const dz = sky.zenith_dose_full;
  const maxD = Math.max(...dz);
  const [tip, setTip] = useState<string | null>(null);

  const silhouette = useMemo(() => {
    const pts: string[] = [];
    const n = sky.az.length;
    for (let i = 0; i < n; i++) {
      const a = (sky.az[i] * Math.PI) / 180;
      const th = 90 - Math.max(0, sky.elev[i]);
      const r = (th / 90) * R;
      pts.push(`${(c + r * Math.sin(a)).toFixed(2)},${(c - r * Math.cos(a)).toFixed(2)}`);
    }
    return pts.join(" ");
  }, [sky, R, c]);

  const rings = useMemo(() => {
    const out = [];
    for (let t = 0; t <= 90; t += 2) {
      const v = (dz[t] + (dz[t + 1] ?? dz[t])) / 2 / maxD;
      out.push({ t, r: ((t + 1) / 90) * R, v });
    }
    return out.reverse();
  }, [dz, maxD, R]);

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="chart" role="img"
        aria-label={`Sky view: ${(sky.B * 100).toFixed(1)} percent of the sky is blocked by terrain`}>
        <defs>
          <clipPath id="disc"><circle cx={c} cy={c} r={R} /></clipPath>
          <pattern id="rock" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#6b4a33" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#8a6146" strokeWidth="2" />
          </pattern>
          <mask id="skyonly">
            <rect width={size} height={size} fill="white" />
            <polygon points={silhouette} fill="black" />
          </mask>
        </defs>
        {/* dose-weighted rings: deeper blue = more dose per degree of zenith angle */}
        <g clipPath="url(#disc)">
          {rings.map((g) => (
            <circle key={g.t} cx={c} cy={c} r={g.r} fill={`rgba(111,179,220,${0.08 + 0.72 * g.v})`} />
          ))}
          {/* terrain: everything between the silhouette and the rim */}
          <rect width={size} height={size} fill="url(#rock)" mask="url(#skyonly)" opacity={0.95} />
          <polygon points={silhouette} fill="none" stroke="#ece6da" strokeWidth={1.4} />
        </g>
        {[30, 60].map((t) => (
          <circle key={t} cx={c} cy={c} r={(t / 90) * R} fill="none" stroke="rgba(236,230,218,0.35)" strokeDasharray="2 3" />
        ))}
        <circle cx={c} cy={c} r={R} fill="none" stroke="rgba(236,230,218,0.5)" />
        <text x={c} y={c - (30 / 90) * R - 3} textAnchor="middle">30°</text>
        <text x={c} y={c - (60 / 90) * R - 3} textAnchor="middle">60°</text>
        {[["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([l, a]) => {
          const ang = ((a as number) * Math.PI) / 180;
          return (
            <text key={l as string} x={c + (R + 10) * Math.sin(ang)} y={c - (R + 10) * Math.cos(ang) + 4}
              textAnchor="middle" className="lbl" style={{ fontWeight: 600 }}>{l}</text>
          );
        })}
        {/* hover targets per 10 deg of azimuth */}
        {Array.from({ length: 36 }, (_, k) => {
          const a0 = (k * 10 * Math.PI) / 180, a1 = ((k + 1) * 10 * Math.PI) / 180;
          const p = `M${c},${c} L${c + R * Math.sin(a0)},${c - R * Math.cos(a0)} A${R},${R} 0 0 1 ${c + R * Math.sin(a1)},${c - R * Math.cos(a1)} Z`;
          const n = sky.az.length;
          const i0 = Math.floor((k * 10 * n) / 360), i1 = Math.floor(((k + 1) * 10 * n) / 360);
          let best = -90, d = 0;
          for (let i = i0; i < i1; i++) if (sky.elev[i] > best) { best = sky.elev[i]; d = sky.dist[i]; }
          return (
            <path key={k} d={p} fill="transparent"
              onMouseEnter={() => setTip(`Azimuth ${k * 10}–${k * 10 + 10}°: horizon at ${best.toFixed(1)}° elevation, ${d >= 1000 ? (d / 1000).toFixed(1) + " km" : d.toFixed(0) + " m"} away`)}
              onMouseLeave={() => setTip(null)} />
          );
        })}
      </svg>
      <figcaption className="muted" style={{ minHeight: 34 }}>
        {tip ?? "Looking up from the astronaut. Blue rings show how much cosmic-ray dose each part of the sky delivers; hatched areas are blocked by terrain."}
      </figcaption>
    </figure>
  );
}

// Dose per zenith angle: full sky vs. what still reaches the astronaut.
export function ZenithBars({ sky }: { sky: Sky }) {
  const W = 360, H = 120, pl = 30, pb = 22;
  const full = sky.zenith_dose_full, vis = sky.zenith_dose_vis;
  const max = Math.max(...full);
  const x = (t: number) => pl + (t / 90) * (W - pl - 6);
  const y = (v: number) => H - pb - (v / max) * (H - pb - 8);
  const [hover, setHover] = useState<number | null>(null);
  const bw = (W - pl - 6) / 91 - 0.6;
  return (
    <figure style={{ margin: 0 }}>
      <div className="legend">
        <span><i style={{ background: "#6fb3dc" }} />Reaches the astronaut</span>
        <span><i style={{ background: "#6b4a33" }} />Blocked by terrain</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Downward dose per degree of zenith angle"
        onMouseLeave={() => setHover(null)}>
        <g className="grid">{[0.5, 1].map((f) => <line key={f} x1={pl} x2={W - 6} y1={y(max * f)} y2={y(max * f)} />)}</g>
        {full.map((f, t) => (
          <g key={t} onMouseEnter={() => setHover(t)}>
            <rect x={x(t) - bw / 2} y={y(f)} width={bw} height={y(0) - y(f)} fill="#6b4a33" />
            <rect x={x(t) - bw / 2} y={y(vis[t])} width={bw} height={y(0) - y(vis[t])} fill="#6fb3dc" />
            <rect x={x(t) - bw} y={0} width={bw * 2} height={H - pb} fill="transparent" />
          </g>
        ))}
        <line x1={pl} x2={W - 6} y1={y(0)} y2={y(0)} stroke="rgba(236,230,218,0.3)" />
        {[0, 30, 60, 90].map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{t}°</text>)}
        <text x={pl - 4} y={y(max) + 4} textAnchor="end">{max.toFixed(1)}</text>
        <text x={pl - 4} y={y(0)} textAnchor="end">0</text>
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={4} y2={H - pb} stroke="#ece6da" strokeWidth={1} />
            <text x={Math.min(x(hover) + 6, W - 150)} y={14} className="lbl">
              {`θ ${hover}°: ${vis[hover].toFixed(2)} of ${full[hover].toFixed(2)} µGy/d`}
            </text>
          </g>
        )}
      </svg>
      <figcaption className="muted">Zenith angle from overhead (0°) to horizon (90°). Dose per 1° ring, µGy/day, quiet-time GCR at φ = {sky.phi} MV.</figcaption>
    </figure>
  );
}
