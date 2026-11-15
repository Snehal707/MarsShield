"use client";
import { useEffect, useMemo, useState } from "react";
import type { Dataset, TSRow } from "@/lib/data";
import { corrCI, crossValidate, dMSE, MODELS, parkingPredictions, parkingVerdict, pct, rng, rmse, siteDMSE, siteOf, siteShares, type ModelId } from "@/lib/stats";
import type { SceneSpec } from "./MissionMode";
import { Chip, download, M, More, P, Seg, sgn, Slider, Step } from "./ui";

type Exp = "terrain" | "parking" | "disagree";
const EXPS: { id: Exp; title: string; q: string; n: string }[] = [
  { id: "terrain", title: "Does the landscape explain the radiation Curiosity measured?", q: "Can a terrain model tell which of Curiosity's stops had lower dose than the stops around them in time?", n: "322 rover stops, 2017 to 2023" },
  { id: "parking", title: "Physical model or simple rule?", q: "Eight times Curiosity parked beside a butte, hill or cliff. Which explanation predicts the dose drops it measured?", n: "8 parking periods at 5 places" },
  { id: "disagree", title: "Where would a measurement settle it?", q: "Find the places where the two terrain models disagree most, then see which one Curiosity's measurements favour.", n: "Map of model disagreement, 322 stops" },
];

// published-period sol windows (Guo et al. 2026 Table 1 + Butte M12) for the 'independent of published sites' subset
const MGN_SITE = 92;   // Maria Gordon Notch navigation site (Guo et al. period P6)

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
      <div className="panel-head"><p className="kicker">Radiation laboratory</p><h1 className="panel-title">Test the models against Curiosity</h1>
        <p className="sub">Each experiment asks one question, lets a model predict, then reveals what NASA&apos;s RAD measured.</p></div>
      <div className="panel-body">
        {!ts && <p className="err">The terrain-signal data were not exported; run the pipeline.</p>}
        <div className="exp-list">
          {EXPS.map((e) => (
            <button key={e.id} className="exp-card" onClick={() => setExp(e.id)}>
              <b>{e.title}</b><span>{e.q}</span><small>{e.n}</small>
            </button>
          ))}
        </div>
        <p className="muted">Every number is recalculated in your browser from exported NASA-derived data. Revealing the measurements is a retrospective exercise on historical RAD data, not a new measurement.</p>
      </div>
    </>
  );
  const meta = EXPS.find((e) => e.id === exp)!;
  return (
    <>
      <div className="panel-head">
        <button className="linklike small" onClick={() => setExp(null)}>All experiments</button>
        <h1 className="panel-title" style={{ marginTop: 8 }}>{meta.title}</h1>
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
  const [subset, setSubset] = useState<"all" | "nomgn" | "nopub" | "nostrong" | "long">("all");
  const [k, setK] = useState(8);
  const [L, setL] = useState(20);
  useEffect(() => { setScene({ pins: [], lines: [] }); }, [setScene]);
  const rows = useMemo(() => {
    let r = ts.rows;
    if (subset === "nopub") r = r.filter((q) => !inPublished(ds, q));
    if (subset === "nomgn") r = r.filter((q) => siteOf(q) !== MGN_SITE);
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
    const ds_ = siteDMSE(rows, y, cv.pred[a], cv.pred[b]);
    const rmseA = rmse(y.map((v, i) => v - cv.pred[a][i])) * 100, rmseB = rmse(y.map((v, i) => v - cv.pred[b][i])) * 100;
    return { cv, y, d, ds: ds_, skillA: skill(a), skillB: skill(b), rmseA, rmseB, sl, rc, coefs: cv.coefs[a],
      mseRed: 1 - (rmseA / rmseB) ** 2, rmseRed: 1 - rmseA / rmseB, shares: siteShares(rows, y, cv.pred[a], cv.pred[b]) };
  }, [rows, a, b, k, L, ts.window_sols]);
  // conservative verdict: both the time-block and the whole-site interval must exclude zero
  const better = res.d.hi < 0 && res.ds.hi < 0, worse = res.d.lo > 0 && res.ds.lo > 0;
  const verdict = better ? ["supported", `${MODELS[a].short} predicts better than ${MODELS[b].short.toLowerCase()}`]
    : worse ? ["against", `${MODELS[a].short} predicts worse than ${MODELS[b].short.toLowerCase()}`] : ["inconclusive", "The data cannot distinguish them"];
  const top = res.shares[0];
  const exportRun = () => download("marsshield-experiment-terrain-signal.json", {
    experiment: "Does terrain explain RAD dose variation after controlling for time and pressure?", retrospective: "historical NASA RAD L2 + REMS data; not a new measurement",
    choices: { model: a, baseline: b, subset, k_time_blocks: k, bootstrap_block_length: L, detrending_window_sols: ts.window_sols },
    results: { n_stops: rows.length, n_sites: res.ds.nSites, rmse_model_pp: res.rmseA, rmse_baseline_pp: res.rmseB, rmse_reduction: res.rmseRed, mse_reduction: res.mseRed,
      skill_model_vs_time_only: res.skillA, skill_baseline_vs_time_only: res.skillB,
      dMSE_pp2_time_block_bootstrap: res.d, dMSE_pp2_site_bootstrap: res.ds, gain_share_by_site: res.shares.slice(0, 5),
      calibration_slope: res.sl, correlation: res.rc, verdict: verdict[1] },
    interpretation: "Reconstructs each stop's local dose anomaly against nearby stops in time (a few percent); does not predict absolute dose at new locations.",
    independence: ts.evaluation_overlap?.status,
    method: "leave-one-time-block-out CV with a ±15-sol buffer; moving-block bootstrap; computed in the browser (point estimates verified against science/marsshield/terrain_signal.py)",
    data: { file: "terrain_signal.json", generated_utc: (ts as unknown as { generated_utc?: string }).generated_utc, sources: ["NASA RAD L2 (SPDF)", "NASA REMS MODRDR (PDS)", "USGS Gale DEM", "MSL waypoints"] },
  });
  const opts: [ModelId, string][] = (["M3", "M4", "M2", "M5", "M6", "M1"] as ModelId[]).map((m) => [m, MODELS[m].short]);
  const nameA = MODELS[a].short.toLowerCase(), nameB = MODELS[b].short.toLowerCase();
  const rob = (v: string) => (ts as unknown as { robustness?: { variant: string; rmse_reduction?: { M3: number }; dMSE_vs_M0_site_ci95_pp2?: { M3: [number, number] } }[] }).robustness?.find((r) => r.variant.startsWith(v));
  const x5 = rob("excluding the 5 %"), x10 = rob("excluding the 10 %");
  return (<>
    <Step n={1} title="Question">
      <p className="lede">Curiosity&apos;s dose rate rose and fell with the Sun&apos;s cycle and the seasons. Compared with its other stops at about the same time, was a stop&apos;s dose lower where the terrain shields more?</p>
    </Step>
    <Step n={2} title="Prediction">
      <p className="prose">The {nameA} predicts each stop&apos;s difference from its neighbours in time: the blue dots. It is scored on {k} blocks of time it was not fitted to.</p>
      <Strip rows={rows} pred={res.cv.pred[a]} revealed={revealed} label={MODELS[a].short} />
      <More label="Change the test">
        <div className="row"><span className="muted">Test</span>
          <select className="sel" value={a} onChange={(e) => { setA(e.target.value as ModelId); setRevealed(false); }}>{opts.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>
          <span className="muted">against</span>
          <select className="sel" value={b} onChange={(e) => { setB(e.target.value as ModelId); setRevealed(false); }}>{(["M0", "M1", "M2", "M3"] as ModelId[]).filter((m) => m !== a).map((m) => <option key={m} value={m}>{MODELS[m].short}</option>)}</select></div>
        <div className="row"><span className="muted">Stops</span>
          <Seg label="Data subset" value={subset} onChange={(v) => { setSubset(v); setRevealed(false); }} options={[["all", "All"], ["nomgn", "No notch"], ["nopub", "Not published"], ["nostrong", "No extreme"], ["long", "≥ 2 sols"]]} /></div>
        <Slider label="Held-out time blocks" value={k} min={4} max={12} step={1} onChange={setK} fmt={(v) => String(v)} />
        <div className="row"><span className="muted">Bootstrap block length</span><Seg label="Block length" value={L} onChange={setL} options={[[10, "10"], [20, "20"], [40, "40"]]} /></div>
        <p className="muted">Coefficients (pressure, rescaling) are fitted only on training blocks; stops within ±15 sols of a test block are dropped from training because they share background data.</p>
      </More>
    </Step>
    {!revealed ? (
      <button className="btn primary reveal" onClick={() => setRevealed(true)}>Reveal Curiosity&apos;s measurements</button>
    ) : (<>
      <Step n={3} title="NASA observations">
        <p className="prose">White rings: what RAD measured at each of the {rows.length} stops. Most sit within a few percent of their neighbours; a few are 10 to 20 % lower.</p>
      </Step>
      <Step n={4} title="Result">
        <Chip kind={verdict[0]}>{verdict[1]}</Chip>
        <p className="verdict-head">On a typical stop the {nameA} is off by <P>{res.rmseA.toFixed(2)}</P> points, against {res.rmseB.toFixed(2)} for {nameB}: {Math.abs(res.rmseRed * 100).toFixed(1)} % {res.rmseRed >= 0 ? "closer" : "further"} to the measurements.</p>
        <p className="muted">{rows.length} stops; {verdict[0] === "supported" ? "the improvement holds when whole sites or blocks of time are resampled" : "within the uncertainty from resampling whole sites and blocks of time"}.</p>
      </Step>
      <Step n={5} title="Explanation">
        {top && top.share > 0.4 && res.mseRed > 0 && (<>
          <p className="prose">Most of this comes from one place: <b>{top.n} stops {top.site === MGN_SITE ? "at Maria Gordon Notch" : `at site ${top.site}`} carry {(top.share * 100).toFixed(0)} %</b> of the improvement.</p>
          {top.site === MGN_SITE && <button className="btn" onClick={() => setSubset("nomgn")}>Test again without the notch</button>}
        </>)}
        {subset === "nomgn" && <p className="prose">Without the notch the {nameA} is {Math.abs(res.rmseRed * 100).toFixed(1)} % {res.rmseRed >= 0 ? "closer" : "further"}: {verdict[0] === "supported" ? "smaller, but still a real improvement" : "no longer distinguishable"}.</p>}
        {x5?.rmse_reduction && x10?.rmse_reduction && <p className="prose">The terrain signal lives at strongly shielded places. Without the 5 % most shielded stops the terrain model is only {(x5.rmse_reduction.M3 * 100).toFixed(1)} % closer, and without the 10 % it is {(x10.rmse_reduction.M3 * 100).toFixed(1)} %, indistinguishable from zero.</p>}
        <div className="note">
          <p><b>What this tests.</b> Whether terrain predicts how much a stop&apos;s dose differs from Curiosity&apos;s other stops at about the same time: a local anomaly of a few percent. It does not predict absolute dose at a new place.</p>
          <p><b>Not fully independent.</b> The terrain model was not fitted here, but its one free parameter (the albedo share) was derived by Guo et al. (2026) from RAD data at the published periods, including the notch.</p>
        </div>
        <More label="Uncertainty and statistics">
          <p className="prose">Mean squared error {sgn(-res.mseRed * 100, 1)} % ({sgn(res.d.mean, 2)} pp²). 95 % interval resampling whole Curiosity sites ({res.ds.nSites}): {sgn(res.ds.lo, 2)} to {sgn(res.ds.hi, 2)};
            resampling blocks of {L} stops in time: {sgn(res.d.lo, 2)} to {sgn(res.d.hi, 2)}. The verdict needs both intervals to exclude zero.</p>
          {res.sl && res.rc && (<>
            <Scatter x={rows.map((q) => q[MODELS[a].fixed!] as number)} y={res.y} slope={res.sl.slope} />
            <p className="prose">Measured anomalies are <b>{res.sl.slope.toFixed(2)}×</b> the {nameA} prediction (95 % CI {res.sl.lo.toFixed(2)} to {res.sl.hi.toFixed(2)}; 1 = calibrated).
              Correlation r = {res.rc.r.toFixed(2)} ({res.rc.lo.toFixed(2)} to {res.rc.hi.toFixed(2)}).</p>
          </>)}
          <p className="prose">Pressure: at this stop-level design, pressure differences between a stop and its neighbourhood are only a few pascals (spread {ts.predictor_spread_pp.pressure_term.toFixed(2)} pp of dose), so pressure control barely changes predictions. That does not mean pressure is unimportant: it drives the daily dose cycle (Guo et al. 2015).</p>
          <p className="prose">Sol 1812 (September 2017) is hit by a solar particle event (+49 %). It inflates every model&apos;s error equally; it is kept, as pre-specified, which makes the relative improvement smaller, not larger.</p>
        </More>
        <button className="btn" onClick={exportRun}>Export this experiment (JSON)</button>
      </Step>
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
  const name: Record<string, string> = { albedo: "Physical model (sky + rock re-emission)", sky: "Sky shielding only", proportional: "Proportional rule" };
  const best = [...v.summary].sort((p, q) => p.mae - q.mae);
  return (<>
    <Step n={1} title="Question">
      <p className="lede">Eight times, Curiosity parked beside a butte, hill or cliff, and RAD recorded the dose dropping. Which explanation predicts those drops?</p>
    </Step>
    <Step n={2} title="Prediction">
      <ul className="models">
        <li><i style={{ background: PARK_COLORS.proportional }} /><b>Proportional rule.</b> Dose falls with the share of sky blocked.</li>
        <li><i style={{ background: PARK_COLORS.sky }} /><b>Sky only.</b> Remove the radiation from the blocked directions.</li>
        <li><i style={{ background: PARK_COLORS.albedo }} /><b>Physical model.</b> Also add radiation re-emitted by the blocking rock (Guo et al. 2026).</li>
      </ul>
      <ParkingDots rows={rows} revealed={revealed} />
      <More label="Change the assumptions">
        <Slider label={<>Rock re-emission (albedo share of flat-ground dose)</>} value={alpha} min={0.18} max={0.24} step={0.01} onChange={(x) => { setAlpha(x); }} fmt={(x) => `${Math.round(x * 100)} %`} />
        <label className="check"><input type="checkbox" checked={p6alt} onChange={(e) => setP6alt(e.target.checked)} />Use the paper&apos;s Section 4 value for P6 (17 %) instead of Table 1 and NASA data (19.4 %)</label>
      </More>
    </Step>
    {!revealed ? <button className="btn primary reveal" onClick={() => setRevealed(true)}>Reveal Curiosity&apos;s measurements</button> : (<>
      <Step n={3} title="NASA observations">
        <p className="prose">White rings: the drops RAD measured, from {Math.min(...rows.map((r) => -r.measured * 100)).toFixed(1)} to {Math.max(...rows.map((r) => -r.measured * 100)).toFixed(1)} %.</p>
      </Step>
      <Step n={4} title="Result">
        <Chip kind={v.verdict.startsWith("cannot") ? "inconclusive" : "supported"}>{v.verdict.startsWith("cannot") ? "Cannot tell them apart" : v.verdict}</Chip>
        <p className="verdict-head">On average the predictions miss by {best.map((q, i) => <span key={q.model}>{i ? (i === best.length - 1 ? " and " : ", ") : ""}<P>{q.mae.toFixed(1)}</P> points ({name[q.model].split(" (")[0].toLowerCase()})</span>)}.</p>
        <p className="muted">Close averages; with eight periods at five places the differences are within the uncertainty.</p>
      </Step>
      <Step n={5} title="Explanation">
        <p className="prose">The models trade places from spot to spot. At Maria Gordon Notch (P6) the physical model predicted half the measured drop; at P8 our terrain geometry blocks more sky than the published analysis. Eight periods at five places cannot rank them.</p>
        <More label="Uncertainty and statistics">
          <table className="data">
            <thead><tr><th>Model</th><th>Mean error</th><th>RMSE</th><th>Closest at</th></tr></thead>
            <tbody>{v.summary.map((q) => <tr key={q.model}><td>{name[q.model]}</td><td>{q.mae.toFixed(2)} pp</td><td>{q.rmse.toFixed(2)} pp</td><td>{q.wins} of 8</td></tr>)}</tbody>
          </table>
          <p className="prose">RMSE difference, physical model minus proportional rule: {sgn(v.dRMSE.mean, 2)} pp (95 % interval {sgn(v.dRMSE.lo, 2)} to {sgn(v.dRMSE.hi, 2)}, resampling the {v.clusters} sites, because periods at one site are not independent).</p>
        </More>
        <button className="btn" onClick={() => download("marsshield-experiment-parking.json", { experiment: "parking periods", retrospective: true, alpha, p6_value: p6alt ? 0.17 : 0.194, rows, verdict: v, provenance: ex.provenance })}>Export this experiment (JSON)</button>
      </Step>
    </>)}
  </>);
}

const PARK_COLORS = { albedo: "#3987e5", sky: "#d95926", proportional: "#199e70" } as const;

/** Predicted (filled) and measured (ring) dose change at each parking period. */
function ParkingDots({ rows, revealed }: { rows: ReturnType<typeof parkingPredictions>; revealed: boolean }) {
  const W = 380, rowH = 28, top = 6, pl = 96, pr = 10, lo = -30, hi = 2, H = top + rows.length * rowH + 22;
  const x = (v: number) => pl + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (W - pl - pr);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Predicted and measured dose change at each parking period">
        <g className="grid">{[-30, -20, -10, 0].map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={top} y2={H - 20} />)}</g>
        <line x1={x(0)} x2={x(0)} y1={top} y2={H - 20} stroke="rgba(239,230,216,0.35)" />
        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2;
          return (
            <g key={r.pair}>
              <text x={pl - 8} y={cy} textAnchor="end" className="lbl" style={{ fontWeight: 600 }}>{r.parking}</text>
              <text x={pl - 8} y={cy + 11} textAnchor="end" style={{ fontSize: 9.5 }}>{r.site.replace("Maria Gordon Notch", "M. Gordon Notch")}</text>
              {(["proportional", "sky", "albedo"] as const).map((k) => <circle key={k} cx={x(r[k] * 100)} cy={cy + 1} r={4.2} fill={PARK_COLORS[k]} stroke="#1d1814" strokeWidth={1.5} />)}
              {revealed && <circle cx={x(r.measured * 100)} cy={cy + 1} r={6.5} fill="none" stroke="#f6f1e7" strokeWidth={2} />}
            </g>
          );
        })}
        {[-30, -20, -10, 0].map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{t} %</text>)}
      </svg>
      <figcaption className="muted">Change in dose rate against a nearby background position. Further left means more shielding.</figcaption>
    </figure>
  );
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
  const decisive = res.hi < 0 || res.lo > 0;
  return (<>
    <Step n={1} title="Question">
      <p className="lede">The physical model and the blocked-sky rule mostly agree. Where they disagree, a measurement can tell them apart. Did Curiosity stop at such places, and which model did its measurements favour?</p>
    </Step>
    <Step n={2} title="Prediction">
      <p className="prose">The map shows where the models disagree: brighter ground means the physical model predicts relatively more dose there than the rule. The {n} Curiosity stops with the largest disagreement are marked in gold, chosen from the models alone.</p>
      <Slider label="Stops with the largest disagreement" value={n} min={10} max={60} step={5} onChange={(q) => { setN(q); setRevealed(false); }} fmt={(q) => String(q)} />
      <p className="muted">{res.sites} Curiosity sites; disagreement at least {(Math.abs(top[top.length - 1].m_terrain - top[top.length - 1].g_proxy) * 100).toFixed(1)} points.</p>
    </Step>
    {!revealed ? <button className="btn primary reveal" onClick={() => setRevealed(true)}>Reveal Curiosity&apos;s measurements</button> : (<>
      <Step n={3} title="NASA observations">
        <div className="stats">
          <div><b>{res.stops} / {n}</b><span>stops where the physical model was closer</span></div>
          <div><b>{res.perSite} / {res.sites}</b><span>places where it was closer</span></div>
          <div><b>{sgn(res.d, 2)}</b><span>points of error, physical minus rule</span></div>
        </div>
      </Step>
      <Step n={4} title="Result">
        <Chip kind={res.hi < 0 ? "supported" : res.lo > 0 ? "against" : "inconclusive"}>{res.hi < 0 ? "Favours the physical model" : res.lo > 0 ? "Favours the rule" : "Cannot tell them apart"}</Chip>
        <p className="verdict-head">The physical model was closer at {res.stops} of {n} stops, but they come from {res.sites} places, and place by place it was closer at {res.perSite}. {decisive ? "That is decisive." : "That is not decisive."}</p>
      </Step>
      <Step n={5} title="Explanation">
        <p className="prose">Stops at one place share the same terrain and the same days, so counting stops overstates the evidence; the test resamples whole places.</p>
        {cal && <p className="prose">Across all 322 stops, measured anomalies are <M>{cal.sky_proxy.slope.toFixed(2)}×</M> the rule&apos;s prediction: the rule overstates shielding. For the physical model the factor is <M>{cal.terrain_model.slope.toFixed(2)}×</M>, consistent with 1.</p>}
        <p className="prose">Where to measure next: bright ground on the map with no Curiosity stop is where a new dosimeter reading would separate the models best.</p>
        <More label="Uncertainty and statistics">
          <p className="prose">RMSE difference, physical model minus rule: {sgn(res.d, 2)} pp; 95 % interval {sgn(res.lo, 2)} to {sgn(res.hi, 2)} pp, resampling whole Curiosity sites.</p>
          {cal && <p className="prose">Calibration slopes with site-cluster 95 % intervals: rule {cal.sky_proxy.ci95_site_cluster[0].toFixed(2)} to {cal.sky_proxy.ci95_site_cluster[1].toFixed(2)}; physical model {cal.terrain_model.ci95_site_cluster[0].toFixed(2)} to {cal.terrain_model.ci95_site_cluster[1].toFixed(2)}.</p>}
        </More>
        <button className="btn" onClick={() => download("marsshield-experiment-disagreement.json", { experiment: "model disagreement", retrospective: true, n, result: res, calibration: cal, stops: top.map((r) => ({ rmc: r.rmc, sol: r.sol, measured: r.y_obs, physical: r.m_terrain, rule: r.g_proxy })) })}>Export this experiment (JSON)</button>
      </Step>
    </>)}
  </>);
}
