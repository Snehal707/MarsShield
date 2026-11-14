"use client";
import { useState } from "react";
import type { BreakEven, BEOption, Period, Resolvability } from "@/lib/data";
import { fmt, OPTION_COLORS, RESOLVE_LABEL } from "@/lib/data";

// Visual grammar used across the app: measured data, model output, and simulation assumptions.
export function Kind({ k }: { k: "measured" | "modeled" | "assumption" }) {
  const label = k === "measured" ? "Measured" : k === "modeled" ? "Modeled" : "Assumption";
  return <span className={`kind kind-${k}`}>{label}</span>;
}

export function ResolveChip({ r }: { r: Resolvability }) {
  return <span className={`res res-${r}`}>{RESOLVE_LABEL[r]}</span>;
}

const STATUS_LABEL: Record<string, string> = {
  recommended: "Move to the recommended stop",
  conditional: "Depends on stop duration",
  unresolved: "Model cannot rank the stops",
  stay: "Work at the target",
};
export function StatusChip({ s }: { s: string }) {
  return <span className={`status status-${s}`}>{STATUS_LABEL[s] ?? s}</span>;
}

const key = (o: BEOption) => o.keys[0];
const optName = (o: BEOption) => `${o.keys.join(" = ")}: ${o.labels.join(" / ")}`;

function preferredAt(be: BreakEven, t: number) {
  let best = be.options[0], bv = Infinity;
  for (const o of be.options) {
    const v = o.walk_dose_uGy + t * o.stop_rate_uGy_h;
    if (v < bv) { bv = v; best = o; }
  }
  return { best, total: bv };
}

function resolvedVsA(be: BreakEven, o: BEOption): Resolvability | null {
  const A = be.options.find((q) => q.keys.includes("A"));
  if (!A || A === o) return null;
  const d = Math.abs(A.rel_rate - o.rel_rate) * 100;
  return d >= be.model_error.rmse_pp ? "resolved" : d >= be.model_error.mae_pp ? "marginal" : "unresolved";
}

// Dose difference against stop A (least walking) versus dwell time. A line crossing zero is the break-even with A.
export function BreakEvenChart({ be, dwell, setDwell }: { be: BreakEven; dwell: number; setDwell: (t: number) => void }) {
  const W = 380, H = 230, pl = 48, pr = 16, pt = 12, pb = 34;
  const T = be.dwell_h;
  const tmax = T[T.length - 1];
  const A = be.options.find((o) => o.keys.includes("A")) ?? be.options[0];
  const diff = (o: BEOption, t: number) => (o.walk_dose_uGy - A.walk_dose_uGy) + t * (o.stop_rate_uGy_h - A.stop_rate_uGy_h);
  const env = T.map((t, i) => be.envelope_uGy[i] - (A.walk_dose_uGy + t * A.stop_rate_uGy_h));
  const vals = be.options.flatMap((o) => [diff(o, 0), diff(o, tmax)]).concat(env, [0]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padv = (hi - lo) * 0.08 || 1; lo -= padv; hi += padv;
  const x = (t: number) => pl + (t / tmax) * (W - pl - pr);
  const y = (v: number) => H - pb - ((v - lo) / (hi - lo)) * (H - pb - pt);
  const [tip, setTip] = useState<string | null>(null);
  const step = (hi - lo) / 3;
  const yt = [lo + step * 0.5, lo + step * 1.5, lo + step * 2.5];
  const pref = preferredAt(be, dwell);
  const toT = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(tmax, ((((e.clientX - r.left) / r.width) * W - pl) / (W - pl - pr)) * tmax));
  };
  return (
    <figure style={{ margin: 0 }}>
      <div className="legend">
        {be.options.map((o) => (
          <span key={key(o)}><i style={{ background: OPTION_COLORS[key(o)] }} />{optName(o)}</span>
        ))}
        <span><i style={{ background: "transparent", border: "1.5px dashed #b9b3a8" }} />Best of all {be.n_candidates} stop cells</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
        aria-label="Whole-walk dose of each stop option minus that of the least-walking stop, against time spent at the stop"
        onMouseMove={(e) => {
          const t = toT(e); const p = preferredAt(be, t);
          setTip(`${t.toFixed(2)} h at the stop: lowest modeled dose ${key(p.best)}; ` + be.options.map((o) => `${key(o)} ${diff(o, t) >= 0 ? "+" : "−"}${Math.abs(diff(o, t)).toFixed(2)}`).join(", ") + " µGy vs A");
        }}
        onMouseLeave={() => setTip(null)}
        onClick={(e) => setDwell(Math.round(toT(e) * 4) / 4)}>
        <rect x={pl} y={y(0)} width={W - pl - pr} height={Math.max(0, y(lo) - y(0))} fill="rgba(57,135,229,0.07)" />
        <g className="grid">
          {yt.map((v) => <line key={v} x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />)}
          {[0, 3, 6, 9, 12].filter((t) => t <= tmax).map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={pt} y2={H - pb} />)}
        </g>
        <line x1={pl} x2={W - pr} y1={y(0)} y2={y(0)} stroke="rgba(236,230,218,0.45)" />
        <path d={T.map((t, i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(env[i]).toFixed(1)}`).join("")}
          fill="none" stroke="#b9b3a8" strokeWidth={1.5} strokeDasharray="4 4" />
        {be.options.map((o) => {
          const r = resolvedVsA(be, o);
          return <path key={key(o)} d={`M${x(0)},${y(diff(o, 0))} L${x(tmax)},${y(diff(o, tmax))}`}
            stroke={OPTION_COLORS[key(o)]} strokeWidth={pref.best === o ? 2.8 : 1.8} fill="none"
            strokeDasharray={r === "unresolved" ? "6 4" : undefined} opacity={r === "unresolved" ? 0.7 : 1} />;
        })}
        {be.options.map((o) => (
          <text key={`l${key(o)}`} x={W - pr + 3} y={y(diff(o, tmax)) + 4} className="lbl" style={{ fontWeight: 600 }}>{key(o)}</text>
        ))}
        {be.breaks.filter((b) => b.t_h <= tmax).map((b) => {
          const o = be.options.find((q) => key(q) === b.less_walking)!;
          return <circle key={`${b.less_walking}${b.more_sheltered}`} cx={x(b.t_h)} cy={y(diff(o, b.t_h))} r={4.5} fill="#1c2333"
            stroke="#ece6da" strokeWidth={1.5} strokeDasharray={b.resolvability === "unresolved" ? "2 2" : undefined}>
            <title>{`${b.less_walking} and ${b.more_sheltered} break even at ${b.t_h.toFixed(2)} h (${RESOLVE_LABEL[b.resolvability].toLowerCase()})`}</title>
          </circle>;
        })}
        <line x1={x(dwell)} x2={x(dwell)} y1={pt} y2={H - pb} stroke="#ece6da" strokeWidth={1.2} />
        {yt.map((v) => <text key={v} x={pl - 6} y={y(v) + 4} textAnchor="end">{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(Math.abs(hi - lo) < 3 ? 2 : 1)}</text>)}
        <text x={pl + 4} y={y(lo) - 6} className="lbl">less dose than A</text>
        <text x={pl + 4} y={y(hi) + 12} className="lbl">more dose than A</text>
        {[0, 3, 6, 9, 12].filter((t) => t <= tmax).map((t) => <text key={t} x={x(t)} y={H - pb + 14} textAnchor="middle">{t} h</text>)}
        <text x={(pl + W - pr) / 2} y={H - 4} textAnchor="middle" className="lbl">Time spent at the science stop</text>
        <text x={12} y={(pt + H - pb) / 2} textAnchor="middle" className="lbl" transform={`rotate(-90 12 ${(pt + H - pb) / 2})`}>Dose vs stop A, µGy</text>
      </svg>
      <figcaption className="muted" style={{ minHeight: 18 }}>{tip ?? "Below zero: less whole-walk dose than the least-walking stop. Dashed lines and circles are differences the model cannot resolve. Click the chart or use the slider to set the stop duration."}</figcaption>
    </figure>
  );
}

export type BEScenario = { id: string; label: string; be: BreakEven; target?: string };

export function BreakEvenPanel(p: {
  scenarios: BEScenario[]; scenarioId: string; setScenario: (id: string) => void; be: BreakEven; custom: boolean;
  dwell: number; setDwell: (t: number) => void; online: boolean; busy: boolean; err: string | null;
  pickTarget: () => void; picking: boolean; radius: number; setRadius: (r: number) => void; recompute: () => void;
  nearbyPeriods: Period[]; staticDemo: boolean;
}) {
  const { be, dwell } = p;
  const pref = preferredAt(be, dwell);
  const ac = be.breaks.find((b) => b.less_walking === "A" && b.more_sheltered === "C");
  const err = be.model_error;
  const parking = p.nearbyPeriods.filter((q) => q.kind === "parking" && q.pub.decrease != null);
  const strongest = parking.reduce((a, q) => Math.max(a, q.pub.decrease ?? 0), 0);
  return (
    <>
      <div className="section">
        <h2>Radiation break-even explorer</h2>
        <p className="prose">
          A science task can be done somewhere near a target. Walking to a more sheltered spot costs extra dose on the way;
          a lower dose rate while you work pays it back. How long must the stop last before the detour wins, and can the model actually tell?
        </p>
        <div className="row">
          {p.scenarios.map((s) => (
            <button key={s.id} className="chip" aria-pressed={!p.custom && p.scenarioId === s.id} onClick={() => p.setScenario(s.id)}>{s.label}</button>
          ))}
          {p.custom && <button className="chip" aria-pressed>Custom target</button>}
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Work radius {be.radius_m} m around the target. Walking legs follow the lowest-modeled-dose route.</p>
      </div>

      {be.recommendation && (
        <div className="section decision">
          <div className="row"><StatusChip s={be.recommendation.status} /><Kind k="modeled" /></div>
          <p className="prose" style={{ marginTop: 6 }}>{be.recommendation.text}</p>
          <p className="muted">Planned duration {fmt.h(be.recommendation.duration_h[0])} to {fmt.h(be.recommendation.duration_h[2])}, nominal {fmt.h(be.recommendation.duration_h[1])} <Kind k="assumption" /></p>
        </div>
      )}

      <div className="section">
        <BreakEvenChart be={be} dwell={dwell} setDwell={p.setDwell} />
        <label className="slider" style={{ marginTop: 6 }}>Time at the science stop<output>{fmt.h(dwell)}</output>
          <input type="range" min={0} max={be.dwell_h[be.dwell_h.length - 1]} step={0.25} value={dwell} onChange={(e) => p.setDwell(+e.target.value)} />
        </label>
        <div className="facts" style={{ marginTop: 10 }}>
          <div className="fact"><b style={{ color: OPTION_COLORS[key(pref.best)] }}>{key(pref.best)}</b><span>lowest modeled dose at this duration</span></div>
          <div className="fact"><b>{pref.total.toFixed(1)} µGy</b><span>whole walk including the stop</span></div>
          <div className="fact">
            <b>{ac ? (ac.resolvability === "unresolved" ? "Unresolved" : fmt.h(ac.t_h)) : "None"}</b>
            <span>break-even, least walking to most sheltered{ac && ac.resolvability !== "unresolved" ? ` (${RESOLVE_LABEL[ac.resolvability].toLowerCase()})` : ""}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>What the model says, and what Curiosity measured</h3>
        <ul className="assumptions">
          <li><Kind k="modeled" /> {ac ? <>Moving from A to C changes the stationary rate by {ac.rate_difference_pp.toFixed(1)} rate points. The model&apos;s validated error on such nearby-position differences is {err.mae_pp.toFixed(1)} pp (mean) and {err.rmse_pp.toFixed(1)} pp (RMSE) over all {err.n} measured RAD parking periods, so this difference is <b>{RESOLVE_LABEL[ac.resolvability].toLowerCase()}</b>.</> : "No option combines more walking with a lower stationary rate."}</li>
          <li><Kind k="measured" /> {parking.length ? <>Curiosity&apos;s RAD recorded {parking.map((q) => `${fmt.pct(-(q.pub.decrease as number) * 100)} (${q.id}, ${q.utc[0].slice(0, 7)})`).join(", ")} near this target when parked, compared with nearby background positions.{" "}
            {strongest >= 0.1 ? "The observations support a strong local shelter effect here." : "The observations show only small local shelter effects here."}</> : "Curiosity has no published terrain-shielding measurement within 60 m of this target."}</li>
        </ul>
      </div>

      <div className="section">
        <h3>Stop options <Kind k="modeled" /></h3>
        <table className="data">
          <thead><tr><th>Option</th><th>From target</th><th>Walk</th><th>Walk dose</th><th>Stop rate</th><th>Total at {dwell} h</th></tr></thead>
          <tbody>{be.options.map((o) => (
            <tr key={key(o)}>
              <td><span className="swatch" style={{ borderColor: OPTION_COLORS[key(o)] }} />{optName(o)}
                {o.flags.length > 0 && <ul className="flags">{o.flags.map((f) => <li key={f}>{f}</li>)}</ul>}</td>
              <td>{o.dist_from_target_m.toFixed(0)} m</td>
              <td>{fmt.m(o.distance_m)}</td>
              <td>{o.walk_dose_uGy.toFixed(2)} µGy</td>
              <td>{o.stop_rate_uGy_h.toFixed(2)} µGy/h (×{o.rel_rate.toFixed(3)})</td>
              <td>{(o.walk_dose_uGy + dwell * o.stop_rate_uGy_h).toFixed(2)} µGy</td>
            </tr>
          ))}</tbody>
        </table>
        <h3>Break-even times <Kind k="modeled" /></h3>
        <table className="data">
          <thead><tr><th>Switch</th><th>Extra walk</th><th>Rate gap</th><th>Status</th><th>Break-even</th><th>Within model error</th><th>Albedo 18–24 %</th></tr></thead>
          <tbody>{be.breaks.map((b) => (
            <tr key={b.less_walking + b.more_sheltered}>
              <td>{b.less_walking} to {b.more_sheltered}</td>
              <td>{b.extra_distance_m.toFixed(0)} m, {b.extra_walk_dose_uGy.toFixed(2)} µGy</td>
              <td>{b.rate_difference_pp.toFixed(1)} pp</td>
              <td><ResolveChip r={b.resolvability} /></td>
              <td><b>{b.resolvability === "unresolved" ? <s>{fmt.h(b.t_h)}</s> : fmt.h(b.t_h)}</b></td>
              <td>{fmt.h(b.t_h_model_error_band[0])} to {b.t_h_model_error_band[1] == null ? "no break-even" : fmt.h(b.t_h_model_error_band[1])}</td>
              <td>{b.t_h_alpha_band.map((v) => (v == null ? "n/a" : fmt.h(v))).join(" to ")}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="muted">
          Break-even = extra walking dose ÷ stationary rate saved. A switch is resolved when its rate gap exceeds the model&apos;s RMSE ({err.rmse_pp.toFixed(1)} pp),
          marginal above the mean error ({err.mae_pp.toFixed(1)} pp) and unresolved below it. Unresolved times are struck through and are not recommendations.
          &ldquo;Within model error&rdquo; recomputes the break-even with the rate gap shifted by ±RMSE. Break-even times do not depend on solar modulation φ.
        </p>
        {be.sensitivity.length > 0 && (
          <>
            <h3>Sensitivity of the A to C switch <Kind k="assumption" /></h3>
            <table className="data">
              <thead><tr><th>Changed assumption</th><th>Break-even</th><th>Rate gap</th><th>Status</th></tr></thead>
              <tbody>
                {ac && <tr><td>Baseline (speed factor {be.assumptions.suit_factor}, radius {be.radius_m} m, slope limit {be.assumptions.stop_max_slope_deg}°)</td><td>{fmt.h(ac.t_h)}</td><td>{ac.rate_difference_pp.toFixed(1)} pp</td><td><ResolveChip r={ac.resolvability} /></td></tr>}
                {be.sensitivity.map((s) => (
                  <tr key={s.case}><td>{s.case}</td>
                    {s.error ? <td colSpan={3} className="muted">{s.error}</td> : <>
                      <td>{s.t_h_A_to_C == null ? "none" : fmt.h(s.t_h_A_to_C)}</td>
                      <td>{s.rate_difference_pp?.toFixed(1)} pp</td>
                      <td>{s.resolvability && <ResolveChip r={s.resolvability} />}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="section">
        <h3>Curiosity measurements near each option <Kind k="measured" /></h3>
        <table className="data">
          <thead><tr><th>Option</th><th>Curiosity stop</th><th>Dates (UTC)</th><th>RAD E</th><th>Local anomaly</th></tr></thead>
          <tbody>{be.options.map((o) => {
            const r = o.nearest_rad;
            return r ? (
              <tr key={key(o)}><td>{key(o)}</td><td>sol {r.sol}, {r.distance_m.toFixed(0)} m away</td>
                <td>{r.utc_start?.slice(0, 10)} to {r.utc_end?.slice(5, 10)}</td>
                <td>{r.E_mean_uGy_d.toFixed(1)} ± {(r.E_sem ?? 0).toFixed(1)} µGy/d</td>
                <td>{r.local_anomaly != null ? fmt.pct(r.local_anomaly * 100) : "n/a"}</td></tr>
            ) : (
              <tr key={key(o)}><td>{key(o)}</td><td colSpan={4} className="muted">No Curiosity RAD stop within 30 m</td></tr>
            );
          })}</tbody>
        </table>
        <p className="muted">RAD detector E, NASA Level 2, flagged records removed. Context only, never an input to the calculation. Raw rates from different dates are not comparable because the cosmic-ray flux changes over the solar cycle.</p>
      </div>

      <div className="section">
        <h3>Try your own target <Kind k="assumption" /></h3>
        {p.staticDemo ? (
          <p className="note">This public demo runs on precomputed results. Custom targets need the MarsShield science service, which you can run locally (see the README).</p>
        ) : (
          <>
            <div className="row">
              <button className="btn" disabled={!p.online} onClick={p.pickTarget}>{p.picking ? "Click the terrain…" : "Place science target"}</button>
              <label className="slider" style={{ flex: 1, minWidth: 180 }}>Work radius<output>{p.radius} m</output>
                <input type="range" min={30} max={300} step={10} value={p.radius} onChange={(e) => p.setRadius(+e.target.value)} />
              </label>
              <button className="btn primary" disabled={!p.online || p.busy} onClick={p.recompute}>{p.busy ? "Computing (up to 2 min)…" : "Recompute"}</button>
            </div>
            {!p.online && <p className="note">The science service is not running, so only the precomputed cases are shown.</p>}
          </>
        )}
        {p.err && <p className="err">{p.err}</p>}
        <ul className="assumptions">
          <li>The science task can be done anywhere within the work radius.</li>
          <li>A workable stop has local slope at most {be.assumptions.stop_max_slope_deg}°; walking avoids slopes over {be.assumptions.max_slope_deg.toFixed(0)}°.</li>
          <li>Walking speed is Tobler&apos;s Earth hiking function × {be.assumptions.suit_factor}; the sensitivity table shows 0.4 and 0.8.</li>
          <li>Stationary dose rate is the modeled total (sky + terrain albedo) at {be.assumptions.h_obs_m} m height, with no suit or vehicle shielding.</li>
          <li>Not modeled: {be.assumptions.not_modeled ?? "rockfall, slope stability, footing, suit shielding, solar particle events"}. Flags mark steep stops and stops below steep terrain; they are not a hazard assessment.</li>
        </ul>
      </div>
    </>
  );
}
