"use client";
import { useEffect, useMemo, useState } from "react";
import type { Dataset, TSRow } from "@/lib/data";
import { corrCI, crossValidate, dMSE, MODELS, parkingPredictions, parkingVerdict, pct, rng, rmse, type ModelId } from "@/lib/stats";
import type { SceneSpec } from "./MissionMode";
import { Chip, download, Grammar, M, More, P, Seg, sgn, Slider } from "./ui";

type Exp = "terrain" | "parking" | "disagree";
const EXPS: { id: Exp; title: string; q: string; n: string }[] = [
  { id: "terrain", title: "Does the landscape explain the radiation Curiosity measured?", q: "After accounting for time and atmospheric pressure, do terrain models predict which of Curiosity's stops had lower dose?", n: "322 rover stops, 2017 to 2023" },
  { id: "parking", title: "Physical model or simple rule at the eight parking spots?", q: "Which predicts the measured dose drops better: the published terrain-albedo model, sky-only shielding, or 'dose falls with blocked sky'?", n: "8 published parking periods at 5 places" },
  { id: "disagree", title: "Where would a measurement best separate the models?", q: "Pick the stops where the two terrain models disagree most, before looking at the data. Which model was closer?", n: "Map of model disagreement, 322 stops" },
];

// published-period sol windows (Guo et al. 2026 Table 1 + Butte M12) for the 'independent of published sites' subset
function inPublished(ds: Dataset, r: TSRow) {
  return Object.values(ds.parking.periods).some((p) => r.mid_sol >= p.sols[0] - 1 && r.mid_sol <= p.sols[1] + 1);
}

function Strip({ rows, pred, revealed, label }: { rows: TSRow[]; pred: number[]; revealed: boolean; label: string }) {
  const W = 380, H = 170, pl = 34, pr = 8, pt = 8, pb = 24;
  const s0 = rows[0]?.mid_sol ?? 0, s1 = rows[rows.length - 1]?.mid_sol ?? 1;
  const vals = pred.concat(revealed ? rows.map((r) => r.y_obs) : []).map((v) => v * 100);
  const lo = Math.max(-25, Math.min(-4, ...vals)), hi = Math.min(15, Math.max(4, ...vals));
  const x = (s: number) => pl + ((s - s0) / (s1 - s0 || 1)) * (W - pl - pr), y = (v: number) => H - pb - ((v - lo) / (hi - lo)) * (H - pb - pt);
  return (
    <figure style={{ margin: 0 }}>
      <div className="legend"><span><i style={{ background: "#7db3cb" }} />{label} prediction</span>{revealed && <span><i style={{ border: "2px solid #f6f1e7", background: "transparent" }} />Measured by RAD</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Predicted and measured local dose anomaly at each stop, in time order">
        <g className="grid">{[-20, -10, 0, 10].filter((v) => v > lo && v < hi).map((v) => <line key={v} x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />)}</g>
        <line x1={pl} x2={W - pr} y1={y(0)} y2={y(0)} stroke="rgba(239,230,216,0.35)" />
        {revealed && rows.map((r, i) => <circle key={`m${i}`} cx={x(r.mid_sol)} cy={y(Math.max(lo, Math.min(hi, r.y_obs * 100)))} r={2.6} fill="none" stroke="#f6f1e7" strokeOpacity={0.75} />)}
        {rows.map((r, i) => <circle key={`p${i}`} cx={x(r.mid_sol)} cy={y(Math.max(lo, Math.min(hi, pred[i] * 100)))} r={2.2} fill="#7db3cb" />)}
        {[-20, -10, 0, 10].filter((v) => v > lo && v < hi).map((v) => <text key={v} x={pl - 5} y={y(v) + 4} textAnchor="end">{v}%</text>)}
        <text x={pl} y={H - 6}>sol {Math.round(s0)}</text><text x={W - pr} y={H - 6} textAnchor="end">sol {Math.round(s1)}</text>
      </svg>
      <figcaption className="muted">Each dot is one rover stop: its dose against the surrounding ±15 sols, in percent. Values beyond the axis are drawn at its edge.</figcaption>
    </figure>
  );
}

function Scatter({ x, y, slope }: { x: number[]; y: number[]; slope?: number }) {
  const W = 380, H = 230, pl = 36, pb = 28, pt = 8, pr = 8, lo = -16, hi = 10;
  const sx = (v: number) => pl + ((v - lo) / (hi - lo)) * (W - pl - pr), sy = (v: number) => H - pb - ((v - lo) / (hi - lo)) * (H - pb - pt);
  const c = (v: number) => Math.max(lo, Math.min(hi, v * 100));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Measured against predicted anomaly">
      <g className="grid">{[-15, -10, -5, 0, 5].map((v) => <g key={v}><line x1={sx(v)} x2={sx(v)} y1={pt} y2={H - pb} /><line x1={pl} x2={W - pr} y1={sy(v)} y2={sy(v)} /></g>)}</g>
      <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} stroke="rgba(239,230,216,0.35)" strokeDasharray="4 4" />
      {slope != null && <line x1={sx(lo)} y1={sy(lo * slope)} x2={sx(hi)} y2={sy(hi * slope)} stroke="#d0904f" strokeWidth={1.6} />}
      {x.map((v, i) => <circle key={i} cx={sx(c(v))} cy={sy(c(y[i]))} r={2.6} fill="none" stroke="#f6f1e7" strokeOpacity={0.7} />)}
      {[-15, -10, -5, 0, 5].map((v) => <text key={`a${v}`} x={sx(v)} y={H - pb + 13} textAnchor="middle">{v}</text>)}
      {[-15, -10, -5, 0, 5].map((v) => <text key={`b${v}`} x={pl - 5} y={sy(v) + 4} textAnchor="end">{v}</text>)}
      <text x={(pl + W) / 2} y={H - 2} textAnchor="middle" className="lbl">predicted, %</text>
      <text x={10} y={(pt + H - pb) / 2} textAnchor="middle" className="lbl" transform={`rotate(-90 10 ${(pt + H - pb) / 2})`}>measured, %</text>
    </svg>
  );
}

function slopeCI(x: number[], y: number[], L = 20, B = 2000) {
  const s = (ix: number[]) => ix.reduce((a, i) => a + x[i] * y[i], 0) / ix.reduce((a, i) => a + x[i] * x[i], 0);
  const r = rng(17), bs: number[] = [], n = x.length;
  for (let b = 0; b < B; b++) { const ix: number[] = []; while (ix.length < n) { const st = Math.floor(r() * Math.max(1, n - L + 1)); for (let i = st; i < Math.min(st + L, n) && ix.length < n; i++) ix.push(i); } bs.push(s(ix)); }
  return { slope: s(x.map((_, i) => i)), lo: pct(bs, 0.025), hi: pct(bs, 0.975) };
}

export function ExperimentMode({ ds, setScene, setLayer }: { ds: Dataset; setScene: (s: SceneSpec) => void; setLayer: (l: "dose" | "disagree" | "image") => void }) {
  const [exp, setExp] = useState<Exp | null>(null);
  const [revealed, setRevealed] = useState(false);
  const ts = ds.terrainSignal;
  useEffect(() => { setRevealed(false); }, [exp]);
  useEffect(() => { setLayer(exp === "disagree" ? "disagree" : "dose"); }, [exp, setLayer]);

  if (!exp || !ts) return (
    <>
      <div className="panel-head"><p className="eyebrowless">Radiation laboratory</p><p className="sub">Test a hypothesis against NASA&apos;s historical Curiosity measurements.</p></div>
      <div className="panel-body">
        {!ts && <p className="err">The terrain-signal data were not exported; run the pipeline.</p>}
        {EXPS.map((e) => (
          <button key={e.id} className="callout" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setExp(e.id)}>
            <b>{e.title}</b><span className="muted">{e.q}</span><span className="muted small">{e.n}</span>
          </button>
        ))}
        <p className="muted">Every number is recalculated in your browser from exported NASA-derived data. Revealing the measurements is a retrospective exercise on historical RAD data, not a new measurement.</p>
      </div>
    </>
  );
  const meta = EXPS.find((e) => e.id === exp)!;
  return (
    <>
      <div className="panel-head">
        <button className="linklike small" onClick={() => setExp(null)}>All experiments</button>
        <p className="eyebrowless" style={{ marginTop: 6 }}>{meta.title}</p>
        <p className="sub">{meta.n}</p>
      </div>
      <div className="panel-body">
        {exp === "terrain" && <TerrainExp ds={ds} revealed={revealed} setRevealed={setRevealed} setScene={setScene} />}
        {exp === "parking" && <ParkingExp ds={ds} revealed={revealed} setRevealed={setRevealed} setScene={setScene} />}
        {exp === "disagree" && <DisagreeExp ds={ds} revealed={revealed} setRevealed={setRevealed} setScene={setScene} />}
      </div>
    </>
  );
}

type ExpProps = { ds: Dataset; revealed: boolean; setRevealed: (v: boolean) => void; setScene: (s: SceneSpec) => void };

function TerrainExp({ ds, revealed, setRevealed, setScene }: ExpProps) {
  const ts = ds.terrainSignal!;
  const [a, setA] = useState<ModelId>("M3");
  const [b, setB] = useState<ModelId>("M0");
  const [subset, setSubset] = useState<"all" | "nopub" | "nostrong" | "long">("all");
  const [k, setK] = useState(8);
  const [L, setL] = useState(20);
  useEffect(() => { setScene({ pins: [], lines: [] }); }, [setScene]);
  const rows = useMemo(() => {
    let r = ts.rows;
    if (subset === "nopub") r = r.filter((q) => !inPublished(ds, q));
    if (subset === "long") r = r.filter((q) => q.data_sols >= 2);
    if (subset === "nostrong") { const cut = pct(r.map((q) => Math.abs(q.m_terrain)), 0.95); r = r.filter((q) => Math.abs(q.m_terrain) <= cut); }
    return r;
  }, [ts, subset, ds]);
  const res = useMemo(() => {
    const cv = crossValidate(rows, [a, b, "M0"], k, ts.window_sols);
    const y = rows.map((q) => q.y_obs);
    const d = dMSE(y, cv.pred[a], cv.pred[b], L);
    const m0 = y.reduce((s, v, i) => s + (v - cv.pred.M0[i]) ** 2, 0) / y.length;
    const skill = (m: ModelId) => 1 - y.reduce((s, v, i) => s + (v - cv.pred[m][i]) ** 2, 0) / y.length / m0;
    const fixed = MODELS[a].fixed;
    const sl = fixed ? slopeCI(rows.map((q) => q[fixed] as number), y) : null;
    const rc = fixed ? corrCI(rows.map((q) => q[fixed] as number), y, L) : null;
    return { cv, y, d, skillA: skill(a), skillB: skill(b), rmseA: rmse(y.map((v, i) => v - cv.pred[a][i])) * 100, rmseB: rmse(y.map((v, i) => v - cv.pred[b][i])) * 100, sl, rc,
      coefs: cv.coefs[a] };
  }, [rows, a, b, k, L, ts.window_sols]);
  const verdict = res.d.hi < 0 ? ["supported", `${MODELS[a].short} predicts better than ${MODELS[b].short.toLowerCase()}`] : res.d.lo > 0 ? ["against", `${MODELS[a].short} predicts worse than ${MODELS[b].short.toLowerCase()}`] : ["inconclusive", "The data cannot distinguish them"];
  const exportRun = () => download("marsshield-experiment-terrain-signal.json", {
    experiment: "Does terrain explain RAD dose variation after controlling for time and pressure?", retrospective: "historical NASA RAD L2 + REMS data; not a new measurement",
    choices: { model: a, baseline: b, subset, k_time_blocks: k, bootstrap_block_length: L, detrending_window_sols: ts.window_sols },
    results: { n_stops: rows.length, rmse_model_pp: res.rmseA, rmse_baseline_pp: res.rmseB, skill_model_vs_time_only: res.skillA, skill_baseline_vs_time_only: res.skillB,
      dMSE_pp2: res.d, calibration_slope: res.sl, correlation: res.rc, verdict: verdict[1] },
    method: "leave-one-time-block-out CV with a ±15-sol buffer; moving-block bootstrap; computed in the browser (point estimates verified against science/marsshield/terrain_signal.py)",
    data: { file: "terrain_signal.json", generated_utc: (ts as unknown as { generated_utc?: string }).generated_utc, sources: ["NASA RAD L2 (SPDF)", "NASA REMS MODRDR (PDS)", "USGS Gale DEM", "MSL waypoints"] },
  });
  const opts: [ModelId, string][] = (["M3", "M4", "M2", "M5", "M6", "M1"] as ModelId[]).map((m) => [m, MODELS[m].short]);
  return (<>
    <p className="prose">Curiosity&apos;s dose rate changes with the solar cycle and seasons, so each stop is compared with the ±15 sols around it.
      The question is whether the terrain models can predict which stops come out lower, <b>without being fitted to the measurements they are scored on</b>.</p>
    <div className="row"><span className="muted">Test</span>
      <select className="sel" value={a} onChange={(e) => { setA(e.target.value as ModelId); setRevealed(false); }}>{opts.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>
      <span className="muted">against</span>
      <select className="sel" value={b} onChange={(e) => { setB(e.target.value as ModelId); setRevealed(false); }}>{(["M0", "M1", "M2", "M3"] as ModelId[]).filter((m) => m !== a).map((m) => <option key={m} value={m}>{MODELS[m].short}</option>)}</select></div>
    <div className="row"><span className="muted">Stops</span>
      <Seg label="Data subset" value={subset} onChange={(v) => { setSubset(v); setRevealed(false); }} options={[["all", "All"], ["nopub", "Not published sites"], ["nostrong", "No extreme"], ["long", "≥ 2 sols"]]} /></div>
    <More label="Advanced: validation design">
      <Slider label="Held-out time blocks" value={k} min={4} max={12} step={1} onChange={setK} fmt={(v) => String(v)} />
      <div className="row"><span className="muted">Bootstrap block length</span><Seg label="Block length" value={L} onChange={setL} options={[[10, "10"], [20, "20"], [40, "40"]]} /></div>
      <p className="muted">Coefficients (pressure, rescaling) are fitted only on training blocks; stops within ±15 sols of a test block are dropped from training because they share background data.</p>
    </More>
    <Strip rows={rows} pred={res.cv.pred[a]} revealed={revealed} label={MODELS[a].short} />
    {!revealed ? (
      <button className="btn primary" onClick={() => setRevealed(true)}>Reveal Curiosity&apos;s measurements</button>
    ) : (<>
      <Grammar />
      <div className="stats">
        <div><b>{res.rmseA.toFixed(2)}</b><span>pp error, {MODELS[a].short.toLowerCase()}</span></div>
        <div><b>{res.rmseB.toFixed(2)}</b><span>pp error, {MODELS[b].short.toLowerCase()}</span></div>
        <div><b>{(res.skillA * 100).toFixed(0)} %</b><span>variance explained beyond time</span></div>
      </div>
      <div className="callout">
        <div className="row"><Chip kind={verdict[0]}>{verdict[1]}</Chip></div>
        <p className="prose">Difference in mean squared error {sgn(res.d.mean, 2)} pp² (95 % block-bootstrap interval {sgn(res.d.lo, 2)} to {sgn(res.d.hi, 2)}). Held-out over {k} time blocks, {rows.length} stops.</p>
      </div>
      {res.sl && res.rc && (<>
        <Scatter x={rows.map((q) => q[MODELS[a].fixed!] as number)} y={res.y} slope={res.sl.slope} />
        <p className="prose">Measured anomalies are <b>{res.sl.slope.toFixed(2)}×</b> the {MODELS[a].short.toLowerCase()} prediction (95 % CI {res.sl.lo.toFixed(2)} to {res.sl.hi.toFixed(2)}; 1 = calibrated).
          Correlation r = {res.rc.r.toFixed(2)} ({res.rc.lo.toFixed(2)} to {res.rc.hi.toFixed(2)}).</p>
      </>)}
      <More label="What else to know">
        <p className="prose">Pressure: at this stop-level design, pressure differences between a stop and its neighbourhood are only a few pascals (spread {ts.predictor_spread_pp.pressure_term.toFixed(2)} pp of dose), so pressure control barely changes predictions. That does not mean pressure is unimportant: it drives the daily dose cycle (Guo et al. 2015).</p>
        <p className="prose">Most of the terrain information comes from a few strongly shielded stops: try &ldquo;No extreme&rdquo;.</p>
      </More>
      <button className="btn" onClick={exportRun}>Export this experiment (JSON)</button>
    </>)}
  </>);
}

function ParkingExp({ ds, revealed, setRevealed, setScene }: ExpProps) {
  const ex = ds.parking;
  const [alpha, setAlpha] = useState(ex.alpha_prior);
  const [p6alt, setP6alt] = useState(false);
  const rows = useMemo(() => parkingPredictions(ex, alpha, p6alt), [ex, alpha, p6alt]);
  const v = useMemo(() => parkingVerdict(rows), [rows]);
  useEffect(() => {
    setScene({ pins: rows.map((r) => ({ key: r.parking, x: r.x, y: r.y, label: r.parking, color: "#efe6d8" })), lines: [] });
  }, [rows, setScene]);
  const name: Record<string, string> = { albedo: "Terrain-albedo model", sky: "Sky shielding only", proportional: "Proportional rule" };
  return (<>
    <p className="prose">At eight moments Curiosity parked beside a butte, hill or cliff. The <b>proportional rule</b> says dose falls with the fraction of sky blocked.
      The <b>terrain-albedo model</b> adds radiation re-emitted by the blocking rock (Guo et al. 2026).</p>
    <Slider label={<>Rock re-emission (albedo share of flat-ground dose)</>} value={alpha} min={0.18} max={0.24} step={0.01} onChange={(x) => { setAlpha(x); }} fmt={(x) => `${Math.round(x * 100)} %`} />
    <label className="check"><input type="checkbox" checked={p6alt} onChange={(e) => setP6alt(e.target.checked)} />Use the paper&apos;s Section 4 value for P6 (17 %) instead of Table 1 and NASA data (19.4 %)</label>
    <table className="data">
      <thead><tr><th>Period</th><th>Terrain model</th><th>Sky only</th><th>Rule</th>{revealed && <th>Measured</th>}</tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.pair}><td>{r.parking} <span className="muted">{r.site}</span></td>
          <td><P>{sgn(r.albedo * 100)}</P></td><td><P>{sgn(r.sky * 100)}</P></td><td><P>{sgn(r.proportional * 100)}</P></td>
          {revealed && <td><M>{sgn(r.measured * 100)}</M></td>}</tr>))}</tbody>
    </table>
    {!revealed ? <button className="btn primary" onClick={() => setRevealed(true)}>Reveal Curiosity&apos;s measurements</button> : (<>
      <table className="data">
        <thead><tr><th>Model</th><th>Mean error</th><th>RMSE</th><th>Closest at</th></tr></thead>
        <tbody>{v.summary.map((s) => <tr key={s.model}><td>{name[s.model]}</td><td>{s.mae.toFixed(2)} pp</td><td>{s.rmse.toFixed(2)} pp</td><td>{s.wins} of 8</td></tr>)}</tbody>
      </table>
      <div className="callout">
        <div className="row"><Chip kind={v.verdict.startsWith("cannot") ? "inconclusive" : "supported"}>{v.verdict}</Chip></div>
        <p className="prose">RMSE difference, terrain model minus rule: {sgn(v.dRMSE.mean, 2)} pp (95 % interval {sgn(v.dRMSE.lo, 2)} to {sgn(v.dRMSE.hi, 2)}, resampling the {v.clusters} sites, because periods at one site are not independent).</p>
      </div>
      <More label="Why the result is limited">
        <p className="prose">Two periods dominate the errors: at P8 our terrain geometry blocks more sky than the published analysis, and at P6 (Maria Gordon Notch) Curiosity measured twice the drop the model predicts. With eight periods at five places, no ranking is statistically secure.</p>
      </More>
      <button className="btn" onClick={() => download("marsshield-experiment-parking.json", { experiment: "parking periods", retrospective: true, alpha, p6_value: p6alt ? 0.17 : 0.194, rows, verdict: v, provenance: ex.provenance })}>Export this experiment (JSON)</button>
    </>)}
  </>);
}

function DisagreeExp({ ds, revealed, setRevealed, setScene }: ExpProps) {
  const ts = ds.terrainSignal!;
  const [n, setN] = useState(20);
  const ranked = useMemo(() => [...ts.rows].sort((p, q) => Math.abs(q.m_terrain - q.g_proxy) - Math.abs(p.m_terrain - p.g_proxy)), [ts]);
  const top = ranked.slice(0, n);
  useEffect(() => {
    setScene({ pins: top.map((r, i) => ({ key: `d${i}`, x: r.x, y: r.y, color: "#d0904f", size: 2.4 })), lines: [] });
  }, [top, setScene]);
  const res = useMemo(() => {
    const site = top.map((r) => r.rmc.split("_")[0]), sites = [...new Set(site)];
    const em = top.map((r) => r.y_obs - r.m_terrain), eg = top.map((r) => r.y_obs - r.g_proxy);
    const R = rng(29), bs: number[] = [];
    for (let b = 0; b < 3000; b++) {
      const idx: number[] = [];
      for (let k = 0; k < sites.length; k++) { const s = sites[Math.floor(R() * sites.length)]; site.forEach((q, i) => { if (q === s) idx.push(i); }); }
      bs.push((rmse(idx.map((i) => em[i])) - rmse(idx.map((i) => eg[i]))) * 100);
    }
    const perSite = sites.filter((s) => rmse(em.filter((_, i) => site[i] === s)) < rmse(eg.filter((_, i) => site[i] === s))).length;
    return { d: (rmse(em) - rmse(eg)) * 100, lo: pct(bs, 0.025), hi: pct(bs, 0.975), stops: em.filter((e, i) => Math.abs(e) < Math.abs(eg[i])).length, sites: sites.length, perSite };
  }, [top]);
  const cal = (ts as unknown as { calibration: Record<string, { slope: number; ci95_site_cluster: [number, number] }> }).calibration;
  return (<>
    <p className="prose">The map shows where the two terrain models disagree about a spot compared with ordinary ground nearby: brighter means the physical model predicts relatively more dose than the blocked-sky rule. Where they agree, no measurement can tell them apart.</p>
    <Slider label="Stops with the largest disagreement" value={n} min={10} max={60} step={5} onChange={(v) => { setN(v); setRevealed(false); }} fmt={(v) => String(v)} />
    <p className="muted">Selected from model values only, before any measurement is shown: {res.sites} Curiosity sites, disagreement at least {(Math.abs(top[top.length - 1].m_terrain - top[top.length - 1].g_proxy) * 100).toFixed(1)} points.</p>
    {!revealed ? <button className="btn primary" onClick={() => setRevealed(true)}>Reveal Curiosity&apos;s measurements</button> : (<>
      <div className="stats">
        <div><b>{res.stops} / {n}</b><span>stops where the physical model was closer</span></div>
        <div><b>{res.perSite} / {res.sites}</b><span>sites where it was closer</span></div>
        <div><b>{sgn(res.d, 2)}</b><span>pp RMSE, physical minus rule</span></div>
      </div>
      <div className="callout">
        <div className="row"><Chip kind={res.hi < 0 ? "supported" : res.lo > 0 ? "against" : "inconclusive"}>{res.hi < 0 ? "Favours the physical model" : res.lo > 0 ? "Favours the rule" : "Cannot distinguish"}</Chip></div>
        <p className="prose">95 % interval {sgn(res.lo, 2)} to {sgn(res.hi, 2)} pp, resampling whole Curiosity sites. Counting stops looks convincing, but stops at one site are not independent: judged by sites, the evidence {res.hi < 0 || res.lo > 0 ? "is" : "is not"} decisive.</p>
      </div>
      {cal && <p className="prose">Across all 322 stops (site-cluster bootstrap), measured anomalies are <M>{cal.sky_proxy.slope.toFixed(2)}×</M> the rule&apos;s prediction ({cal.sky_proxy.ci95_site_cluster[0].toFixed(2)} to {cal.sky_proxy.ci95_site_cluster[1].toFixed(2)}): the rule overstates shielding.
        For the physical model the factor is <M>{cal.terrain_model.slope.toFixed(2)}×</M> ({cal.terrain_model.ci95_site_cluster[0].toFixed(2)} to {cal.terrain_model.ci95_site_cluster[1].toFixed(2)}), consistent with 1.</p>}
      <p className="muted">Where to measure next: bright areas on the map with no white Curiosity markers are where a new dosimeter reading would discriminate the models best.</p>
      <button className="btn" onClick={() => download("marsshield-experiment-disagreement.json", { experiment: "model disagreement", retrospective: true, n, result: res, calibration: cal, stops: top.map((r) => ({ rmc: r.rmc, sol: r.sol, measured: r.y_obs, physical: r.m_terrain, rule: r.g_proxy })) })}>Export this experiment (JSON)</button>
    </>)}
  </>);
}
