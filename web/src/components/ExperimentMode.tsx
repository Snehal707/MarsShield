"use client";
// Experiments: the narrow panel holds the reasoning (question, prediction, reveal, result, explanation); the research dock
// holds the charts, the data table and the downloads, all linked to one selection that is also shown on the terrain.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dataset, Stop, TSRow } from "@/lib/data";
import { corrCI, crossValidate, dMSE, MODELS, parkingPredictions, parkingVerdict, pct, rng, rmse, siteDMSE, siteOf, siteShares, type ModelId } from "@/lib/stats";
import type { SceneSpec } from "./MissionMode";
import { Chip, M, More, P, Seg, sgn, Slider, Step, Tabs, useMedia } from "./ui";
import { DataTable, datasetId, DownloadBar, software } from "./ExperimentTools";
import { DockPortal } from "./Dock";
import { DotRowsChart, IntervalChart, ScatterChart, TimeSeriesChart } from "./ResearchCharts";
import { disagreeCSV, disagreePackage, parkingCSV, parkingPackage, terrainCSV, terrainPackage, type ScreeningRow, type TerrainInput } from "@/lib/exports";

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

function slopeCI(x: number[], y: number[], L = 20, B = 2000) {
  const s = (ix: number[]) => ix.reduce((a, i) => a + x[i] * y[i], 0) / ix.reduce((a, i) => a + x[i] * x[i], 0);
  const r = rng(17), bs: number[] = [], n = x.length;
  for (let b = 0; b < B; b++) { const ix: number[] = []; while (ix.length < n) { const st = Math.floor(r() * Math.max(1, n - L + 1)); for (let i = st; i < Math.min(st + L, n) && ix.length < n; i++) ix.push(i); } bs.push(s(ix)); }
  return { slope: s(x.map((_, i) => i)), lo: pct(bs, 0.025), hi: pct(bs, 0.975) };
}

type ObsPick = (f: ((s: Stop) => void) | null) => void;
export function ExperimentMode({ ds, setScene, setLayer, focusOn, initial = null, setObsPick }: { ds: Dataset; setScene: (s: SceneSpec) => void; setLayer: (l: "dose" | "disagree" | "image") => void;
  focusOn: (x: number, y: number, dist?: number) => void; initial?: Exp | null; setObsPick?: ObsPick }) {
  const [exp, setExp] = useState<Exp | null>(initial);
  const [revealed, setRevealedRaw] = useState(false);
  const ts = ds.terrainSignal;
  useEffect(() => { setRevealedRaw(false); }, [exp]);
  useEffect(() => { setLayer(exp === "disagree" ? "disagree" : "dose"); }, [exp, setLayer]);
  // after Reveal, focus moves to the result heading (the Reveal button itself is replaced)
  const setRevealed = useCallback((v: boolean) => {
    setRevealedRaw(v);
    if (v) window.setTimeout(() => document.getElementById("exp-result-h")?.focus(), 60);
  }, []);

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
        {exp === "terrain" && <TerrainExp ds={ds} revealed={revealed} setRevealed={setRevealed} setScene={setScene} focusOn={focusOn} setObsPick={setObsPick} />}
        {exp === "parking" && <ParkingExp ds={ds} revealed={revealed} setRevealed={setRevealed} setScene={setScene} focusOn={focusOn} />}
        {exp === "disagree" && <DisagreeExp ds={ds} revealed={revealed} setRevealed={setRevealed} setScene={setScene} focusOn={focusOn} />}
      </div>
    </>
  );
}

type ExpProps = { ds: Dataset; revealed: boolean; setRevealed: (v: boolean) => void; setScene: (s: SceneSpec) => void; focusOn: (x: number, y: number, dist?: number) => void; setObsPick?: ObsPick };
const SUBSETS: Record<string, string> = { all: "All 322 stops", nomgn: "Without Maria Gordon Notch (site 92)", nopub: "Without the published Guo et al. periods",
  nostrong: "Without the 5 % strongest modeled terrain anomalies", long: "Stops with at least 2 sols of RAD data" };
// Units: anomalies are natural-log ratios y (the statistical target); the public view shows the actual change 100*(e^y - 1).
// Differences between two actual percentages are percentage points. RMSE/MSE stay on the log scale (x100) they are computed on.
const pctLog = (y: number) => (Math.exp(y) - 1) * 100;
const pcL = (y: number) => sgn(pctLog(y), 1);
const pcF = (f: number) => sgn(f * 100, 1);
const ppD = (a: number, b: number) => sgn(pctLog(a) - pctLog(b), 1);

const RevealBtn = ({ onClick }: { onClick: () => void }) => <button className="btn primary reveal" onClick={onClick}>Reveal Curiosity&apos;s measurements</button>;
const CalcNote = ({ ms, what }: { ms: number; what: string }) => <p className="muted calc-time">{what} recalculated in your browser in {Math.max(1, Math.round(ms))} ms.</p>;

function TerrainExp({ ds, revealed, setRevealed, setScene, focusOn, setObsPick }: ExpProps) {
  const ts = ds.terrainSignal!;
  const mobile = useMedia("(max-width: 860px)");
  const [a, setA] = useState<ModelId>("M3");
  const [b, setB] = useState<ModelId>("M0");
  const [subset, setSubset] = useState<"all" | "nomgn" | "nopub" | "nostrong" | "long">("all");
  const [k, setK] = useState(8);
  const [L, setL] = useState(20);
  const [sel, setSel] = useState<string | null>(null);
  const [sort, setSort] = useState<"time" | "residual">("time");
  const [view, setView] = useState<"time" | "scatter" | "unc">("time");
  const rows = useMemo(() => {
    let r = ts.rows;
    if (subset === "nopub") r = r.filter((q) => !inPublished(ds, q));
    if (subset === "nomgn") r = r.filter((q) => siteOf(q) !== MGN_SITE);
    if (subset === "long") r = r.filter((q) => q.data_sols >= 2);
    if (subset === "nostrong") { const cut = pct(r.map((q) => Math.abs(q.m_terrain)), 0.95); r = r.filter((q) => Math.abs(q.m_terrain) <= cut); }
    return r;
  }, [ts, subset, ds]);
  const res = useMemo(() => {
    const t0 = performance.now();
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
    const out = { cv, y, d, ds: ds_, skillA: skill(a), skillB: skill(b), rmseA, rmseB, sl, rc, coefs: cv.coefs[a],
      mseRed: 1 - (rmseA / rmseB) ** 2, rmseRed: 1 - rmseA / rmseB, shares: siteShares(rows, y, cv.pred[a], cv.pred[b]) };
    return { ...out, ms: performance.now() - t0 };
  }, [rows, a, b, k, L, ts.window_sols]);
  // conservative verdict: both the time-block and the whole-site interval must exclude zero
  const better = res.d.hi < 0 && res.ds.hi < 0, worse = res.d.lo > 0 && res.ds.lo > 0;
  const verdict = better ? ["supported", `${MODELS[a].short} predicts better than ${MODELS[b].short.toLowerCase()}`]
    : worse ? ["against", `${MODELS[a].short} predicts worse than ${MODELS[b].short.toLowerCase()}`] : ["inconclusive", "The data cannot distinguish them"];
  const top = res.shares[0];
  const input = (): TerrainInput => ({ rows, excluded: ts.rows.filter((q) => !rows.includes(q)).map((q) => q.rmc), subset: { id: subset, label: SUBSETS[subset] },
    model: a, baseline: b, k, L, window: ts.window_sols, pred: res.cv.pred, block: res.cv.block, edges: res.cv.edges, coefs: res.cv.coefs, pub: (q) => inPublished(ds, q),
    results: { rmseA: res.rmseA, rmseB: res.rmseB, rmseRed: res.rmseRed, mseRed: res.mseRed, skillA: res.skillA, skillB: res.skillB, d: res.d, ds: res.ds,
      shares: res.shares, slope: res.sl, corr: res.rc, verdict: verdict[1] },
    screening: subset === "all" && a === "M3" && b === "M0" && k === 8 ? (ts as unknown as { sep_screening?: { variants: ScreeningRow[] } }).sep_screening?.variants : undefined });
  // linked selection: a chart point, a table row or one of Curiosity's stops on the terrain selects the same stop everywhere
  const selRow = rows.find((q) => q.rmc === sel) ?? null, selI = selRow ? rows.indexOf(selRow) : -1;
  const pick = useCallback((q: TSRow) => { setSel(q.rmc); focusOn(q.x, q.y, 700); }, [focusOn]);
  useEffect(() => {
    setScene({ pins: selRow ? [{ key: `stop-${selRow.rmc}`, x: selRow.x, y: selRow.y, label: `Sol ${selRow.sol}, stop ${selRow.rmc}`, color: "#e7b37d", size: 5.5, selected: true }] : [], lines: [] });
  }, [selRow, setScene]);
  useEffect(() => {
    if (!setObsPick) return;
    setObsPick((s) => { const q = rows.find((r) => r.sol === s.sol && Math.hypot(r.x - s.x, r.y - s.y) < 3) ?? rows.find((r) => Math.hypot(r.x - s.x, r.y - s.y) < 3); if (q) pick(q); });
    return () => setObsPick(null);
  }, [setObsPick, rows, pick]);
  useEffect(() => { if (!revealed) setView("time"); }, [revealed]);
  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    return sort === "time" ? idx : idx.sort((i, j) => Math.abs(rows[j].y_obs - res.cv.pred[a][j]) - Math.abs(rows[i].y_obs - res.cv.pred[a][i]));
  }, [rows, sort, res, a]);
  const opts: [ModelId, string][] = (["M3", "M4", "M2", "M5", "M6", "M1"] as ModelId[]).map((m) => [m, MODELS[m].short]);
  const nameA = MODELS[a].short.toLowerCase(), nameB = MODELS[b].short.toLowerCase();
  const rob = (v: string) => (ts as unknown as { robustness?: { variant: string; rmse_reduction?: { M3: number }; dMSE_vs_M0_site_ci95_pp2?: { M3: [number, number] } }[] }).robustness?.find((r) => r.variant.startsWith(v));
  const x5 = rob("excluding the 5 %"), x10 = rob("excluding the 10 %");
  const fixed = MODELS[a].fixed;
  const describe = (i: number) => <><b>Stop {rows[i].rmc}, sol {rows[i].sol}</b><span>{MODELS[a].short}: {pcL(res.cv.pred[a][i])} %</span>{revealed && <span>Measured: {pcL(rows[i].y_obs)} %</span>}</>;
  const views: ["time" | "scatter" | "unc", string][] = revealed ? [["time", "Over time"], ...(fixed && res.sl ? [["scatter", "Measured against predicted"] as ["scatter", string]] : []), ["unc", "Uncertainty"]] : [["time", "Over time"]];

  return (<>
    <DockPortal title={`${rows.length} stops: ${revealed ? "measured and " : ""}predicted change`}
      head={<DownloadBar name={`terrain-${a}-vs-${b}-${subset}`} rows={rows.length} csv={() => terrainCSV(input())}
        pkg={async () => terrainPackage(input(), software(), await datasetId("terrain_signal.json", "science/marsshield/terrain_signal.py", (ts as unknown as { generated_utc?: string }).generated_utc))}
        note={<>{SUBSETS[subset].toLowerCase()}, {MODELS[a].short.toLowerCase()} against {MODELS[b].short.toLowerCase()}, {k} time blocks</>} />}>
      <div className="dock-grid">
        <div className="dock-main">
          {views.length > 1 && <Tabs className="subnav dock-tabs" label="Chart" tabs={views} value={view} onChange={setView} />}
          {view === "time" && <TimeSeriesChart items={rows.map((q) => q.rmc)} x={rows.map((q) => q.mid_sol)} measured={rows.map((q) => pctLog(q.y_obs))}
            predicted={res.cv.pred[a].map(pctLog)} revealed={revealed} selected={sel} onSelect={(i) => pick(rows[i])} yLabel="change against neighbours, %"
            describe={describe} predLabel={MODELS[a].short} />}
          {view === "scatter" && fixed && res.sl && <ScatterChart items={rows.map((q) => q.rmc)} pred={rows.map((q) => pctLog(q[fixed] as number))} meas={rows.map((q) => pctLog(q.y_obs))}
            slope={res.sl} selected={sel} onSelect={(i) => pick(rows[i])} describe={describe} />}
          {view === "unc" && <IntervalChart unit="Difference in mean squared error, model minus baseline, pp² (log scale × 100)"
            rows={[{ label: `Resampling ${res.ds.nSites} Curiosity sites`, mid: res.d.mean, lo: res.ds.lo, hi: res.ds.hi, color: "#e7b37d" },
              { label: `Resampling blocks of ${L} stops in time`, mid: res.d.mean, lo: res.d.lo, hi: res.d.hi }]}
            note="Left of zero: the tested model has the smaller error. The verdict needs both bars to stay on one side." />}
          <p className="muted small dock-cap">{view === "time" ? <>One mark per rover stop: its dose rate against Curiosity&apos;s other stops within ±15 sols, actual % change{revealed ? "; thin lines join prediction and measurement" : ""}. Values beyond the axis sit at its edge.</>
            : view === "scatter" ? <>One ring per stop; on the dashed line the prediction would be exact. Values beyond the axis sit at its edge.</> : null} Select a stop to show it on the terrain and in the table.</p>
        </div>
        <div className="dock-side">
          {revealed ? (<>
            <div className="dataset-head"><h3>The data behind this result</h3>
              <Seg label="Sort stops" value={sort} onChange={setSort} options={[["time", "In time order"], ["residual", "Largest model error"]]} /></div>
            {selRow && (
              <div className="sel-card" aria-live="polite">
                <b>Stop {selRow.rmc}, sol {selRow.sol}</b>
                <span>{selRow.utc_start.slice(0, 10)}, {selRow.n_obs} RAD records, <M>{selRow.E_mean.toFixed(0)} µGy/day</M>, <M>{selRow.P_mean.toFixed(0)} Pa</M></span>
                <span>Measured <M>{pcL(selRow.y_obs)} %</M> against its neighbours; {MODELS[a].short.toLowerCase()} <P>{pcL(res.cv.pred[a][selI])} %</P>; {(selRow.B * 100).toFixed(0)} % of the sky blocked (modeled).</span>
              </div>)}
            <DataTable rows={order.map((i) => i)} id={(i) => rows[i].rmc} selected={sel} onSelect={(i) => pick(rows[i])} compact={mobile}
              caption={`${rows.length} stops in the selection; select a row to find it on the terrain`}
              cols={[
                { key: "stop", label: "Stop", render: (i) => rows[i].rmc },
                { key: "sol", label: "Sol", num: true, render: (i) => rows[i].sol },
                { key: "dose", label: "µGy/day", title: "RAD measured dose rate", num: true, wide: true, render: (i) => <M>{rows[i].E_mean.toFixed(0)}</M> },
                { key: "p", label: "Pa", title: "REMS pressure", num: true, wide: true, render: (i) => <M>{rows[i].P_mean.toFixed(0)}</M> },
                { key: "B", label: "Sky blocked", title: "Modeled blocked fraction", num: true, wide: true, render: (i) => <P>{(rows[i].B * 100).toFixed(0)} %</P> },
                { key: "obs", label: "Measured", title: "Measured change against neighbours, actual %", num: true, render: (i) => <M>{pcL(rows[i].y_obs)}</M> },
                { key: "pred", label: MODELS[a].short, title: "Predicted change, actual %", num: true, render: (i) => <P>{pcL(res.cv.pred[a][i])}</P> },
                { key: "res", label: "Error", title: "Measured minus predicted change, percentage points", num: true, render: (i) => ppD(rows[i].y_obs, res.cv.pred[a][i]) },
                { key: "blk", label: "Block", title: "Held-out time block", num: true, wide: true, render: (i) => res.cv.block[i] },
              ]} />
            <p className="muted small">Percentages are actual changes, 100 × (e<sup>y</sup> − 1), of the log anomaly y used in the calculation; errors are percentage-point differences. Measured values are NASA RAD and REMS data aggregated by MarsShield; the downloads add every column and its definition.</p>
          </>) : <p className="muted dock-wait">The table of measured values appears after you reveal Curiosity&apos;s measurements in the panel.</p>}
        </div>
      </div>
    </DockPortal>

    <Step n={1} title="Question">
      <p className="lede">Curiosity&apos;s dose rate rose and fell with the Sun&apos;s cycle and the seasons. Compared with its other stops at about the same time, was a stop&apos;s dose lower where the terrain shields more?</p>
    </Step>
    <Step n={2} title="Prediction">
      <p className="prose">The {nameA} predicts each stop&apos;s difference from its neighbours in time: the blue dots in the analysis area. {MODELS[a].fit.length ? <>Its coefficients are fitted on other blocks of time and it is scored on the {k} blocks it was not fitted to.</> : <>It has no fitted parameters: it uses only the terrain, so the time blocks matter only for models with fitted coefficients (pressure, rescaled terrain).</>}</p>
      <More label="Change the test">
        <div className="row"><label className="muted" htmlFor="exp-a">Test</label>
          <select id="exp-a" className="sel" value={a} onChange={(e) => { setA(e.target.value as ModelId); setRevealed(false); }}>{opts.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>
          <label className="muted" htmlFor="exp-b">against</label>
          <select id="exp-b" className="sel" value={b} onChange={(e) => { setB(e.target.value as ModelId); setRevealed(false); }}>{(["M0", "M1", "M2", "M3"] as ModelId[]).filter((m) => m !== a).map((m) => <option key={m} value={m}>{MODELS[m].short}</option>)}</select></div>
        <div className="row"><span className="muted">Stops</span>
          <Seg label="Data subset" value={subset} onChange={(v) => { setSubset(v); setRevealed(false); }} options={[["all", "All"], ["nomgn", "No notch"], ["nopub", "Not published"], ["nostrong", "No extreme"], ["long", "≥ 2 sols"]]} /></div>
        <Slider label="Held-out time blocks" value={k} min={4} max={12} step={1} onChange={setK} fmt={(v) => String(v)} />
        <div className="row"><span className="muted">Bootstrap block length</span><Seg label="Block length" value={L} onChange={setL} options={[[10, "10"], [20, "20"], [40, "40"]]} /></div>
        <p className="muted">Coefficients (pressure, rescaling) are fitted only on training blocks; stops within ±15 sols of a test block are dropped from training because they share background data.</p>
        <CalcNote ms={res.ms} what="Cross-validation and both bootstraps" />
      </More>
    </Step>
    {!revealed ? <RevealBtn onClick={() => setRevealed(true)} /> : (<>
      <Step n={3} title="NASA observations">
        <p className="prose">White rings: what RAD measured at each of the {rows.length} stops. Most sit within a few percent of their neighbours; a few are 10 to 20 % lower.</p>
      </Step>
      <Step n={4} title="Result" id="exp-result">
        <Chip kind={verdict[0]}>{verdict[1]}</Chip>
        <p className="verdict-head">The {nameA}&apos;s typical error is <P>{res.rmseA.toFixed(2)}</P> against {res.rmseB.toFixed(2)} for {nameB}: {Math.abs(res.rmseRed * 100).toFixed(1)} % {res.rmseRed >= 0 ? "smaller" : "larger"}.</p>
        <p className="muted">Typical error is the RMSE of the log anomaly × 100, which at these sizes is close to percentage points of dose-rate change. The {Math.abs(res.rmseRed * 100).toFixed(1)} % is a relative reduction of that error, not {Math.abs(res.rmseRed * 100).toFixed(1)} percentage points of radiation.</p>
        <p className="muted">{rows.length} stops; {verdict[0] === "supported" ? "the improvement holds when whole sites or blocks of time are resampled" : "within the uncertainty from resampling whole sites and blocks of time"}. The intervals are under Uncertainty in the analysis area.</p>
      </Step>
      <Step n={5} title="Explanation">
        {top && top.share > 0.4 && res.mseRed > 0 && (<>
          <p className="prose">Most of this comes from one place: <b>{top.n} stops {top.site === MGN_SITE ? "at Maria Gordon Notch" : `at site ${top.site}`} carry {(top.share * 100).toFixed(0)} %</b> of the improvement.</p>
          {top.site === MGN_SITE && <button className="btn" onClick={() => setSubset("nomgn")}>Test again without the notch</button>}
        </>)}
        {subset === "nomgn" && <p className="prose">Without the notch the {nameA}&apos;s typical error is {Math.abs(res.rmseRed * 100).toFixed(1)} % {res.rmseRed >= 0 ? "smaller" : "larger"}: {verdict[0] === "supported" ? "smaller, but still a real improvement" : "no longer distinguishable"}.</p>}
        {x5?.rmse_reduction && x10?.rmse_reduction && <p className="prose">The terrain signal lives at strongly shielded places. Without the 5 % most shielded stops the terrain model&apos;s error is only {(x5.rmse_reduction.M3 * 100).toFixed(1)} % smaller, and without the 10 % it is {(x10.rmse_reduction.M3 * 100).toFixed(1)} % smaller, indistinguishable from zero.</p>}
        <div className="note">
          <p><b>What this tests.</b> Whether terrain predicts how much a stop&apos;s dose differs from Curiosity&apos;s other stops at about the same time: a local anomaly of a few percent. It does not predict absolute dose at a new place.</p>
          <p><b>Not fully independent.</b> The terrain model was not fitted here, but its one free parameter (the albedo share) was derived by Guo et al. (2026) from RAD data at the published periods, including the notch.</p>
        </div>
        <More label="Uncertainty and statistics">
          <p className="prose">Mean squared error {sgn(-res.mseRed * 100, 1)} % ({sgn(res.d.mean, 2)} pp²). 95 % interval resampling whole Curiosity sites ({res.ds.nSites}): {sgn(res.ds.lo, 2)} to {sgn(res.ds.hi, 2)};
            resampling blocks of {L} stops in time: {sgn(res.d.lo, 2)} to {sgn(res.d.hi, 2)}. The verdict needs both intervals to exclude zero.</p>
          {res.sl && res.rc && (
            <p className="prose">Measured anomalies are <b>{res.sl.slope.toFixed(2)}×</b> the {nameA} prediction on the log scale (95 % CI {res.sl.lo.toFixed(2)} to {res.sl.hi.toFixed(2)}; 1 = calibrated).
              Correlation r = {res.rc.r.toFixed(2)} ({res.rc.lo.toFixed(2)} to {res.rc.hi.toFixed(2)}). The scatter plot is under Measured against predicted in the analysis area.</p>)}
          <p className="prose">Pressure: at this stop-level design, pressure differences between a stop and its neighbourhood are only a few pascals (spread {ts.predictor_spread_pp.pressure_term.toFixed(2)} pp of dose), so pressure control barely changes predictions. That does not mean pressure is unimportant: it drives the daily dose cycle (Guo et al. 2015).</p>
          <p className="prose">Two solar particle events fall inside the stops: 10–13 September 2017 and 28–29 October 2021 (detected in the RAD records).
            The reference result keeps every record, a choice made before this check (the analysis was not pre-registered). Removing the event records is a sensitivity analysis in Evidence → RAD + pressure analysis.</p>
        </More>
      </Step>
    </>)}
  </>);
}

const PARK_COLORS = { albedo: "#3987e5", sky: "#d95926", proportional: "#199e70" } as const;

function ParkingExp({ ds, revealed, setRevealed, setScene, focusOn }: ExpProps) {
  const ex = ds.parking;
  const mobile = useMedia("(max-width: 860px)");
  const [alpha, setAlpha] = useState(ex.alpha_prior);
  const [p6alt, setP6alt] = useState(false);
  const [view, setView] = useState<"rows" | "unc">("rows");
  const calc = useMemo(() => { const t0 = performance.now(); const rows = parkingPredictions(ex, alpha, p6alt); const v = parkingVerdict(rows); return { rows, v, ms: performance.now() - t0 }; }, [ex, alpha, p6alt]);
  const { rows, v } = calc;
  const [sel, setSel] = useState<string | null>(null);
  const pickP = useCallback((id: string) => { const r = rows.find((q) => q.parking === id); if (r) { setSel(id); focusOn(r.x, r.y, 600); } }, [rows, focusOn]);
  // the selected period shows its parking position, its background position and the line between them
  useEffect(() => {
    const pins: SceneSpec["pins"] = rows.map((r) => ({ key: r.parking, x: r.x, y: r.y, label: r.parking, color: r.parking === sel ? "#e7b37d" : "#efe6d8",
      selected: r.parking === sel, size: r.parking === sel ? 5.5 : 4, onClick: () => pickP(r.parking) }));
    const lines: SceneSpec["lines"] = [];
    const sr = rows.find((r) => r.parking === sel);
    if (sr) {
      const g = ex.periods[sr.pair.split("/")[1]];
      pins!.push({ key: `bg-${sr.pair}`, x: g.x, y: g.y, label: `${sr.pair.split("/")[1]} (background)`, color: "#b9ab97", size: 4 });
      lines.push({ key: `pair-${sr.pair}`, xy: [[sr.x, sr.y], [g.x, g.y]], color: "#e7b37d", width: 2, dashed: true });
    }
    setScene({ pins, lines });
  }, [rows, setScene, sel, ex, pickP]);
  useEffect(() => { if (!revealed) setView("rows"); }, [revealed]);
  const pin = { ex, alpha, p6alt, rows, verdict: v };
  const name: Record<string, string> = { albedo: "Physical model (sky + rock re-emission)", sky: "Sky shielding only", proportional: "Proportional rule" };
  const best = [...v.summary].sort((p, q) => p.mae - q.mae);
  const series = [...(revealed ? [{ key: "measured", label: "Curiosity RAD (measured)", shape: "ring" as const, color: "#f6f1e7" }] : []),
    { key: "albedo", label: "Physical model", shape: "circle" as const, color: PARK_COLORS.albedo },
    { key: "sky", label: "Sky only", shape: "triangle" as const, color: PARK_COLORS.sky },
    { key: "proportional", label: "Proportional rule", shape: "square" as const, color: PARK_COLORS.proportional }];
  return (<>
    <DockPortal title={`Eight parking periods: ${revealed ? "measured and " : ""}predicted change`}
      head={<DownloadBar name={`parking-albedo${Math.round(alpha * 100)}${p6alt ? "-p6sec4" : ""}`} rows={rows.length} csv={() => parkingCSV(pin)}
        pkg={async () => parkingPackage(pin, software(), await datasetId("experiment_parking.json", "science/marsshield/pipeline.py (export_experiments)"))}
        note={<>albedo share {Math.round(alpha * 100)} %{p6alt ? ", P6 at the paper's 17 %" : ""}</>} />}>
      <div className="dock-grid">
        <div className="dock-main">
          {revealed && <Tabs className="subnav dock-tabs" label="Chart" tabs={[["rows", "By period"], ["unc", "Uncertainty"]]} value={view} onChange={setView} />}
          {view === "rows" && <DotRowsChart unit="Change in dose rate against the background position" series={series} selected={sel} onSelect={pickP} lo={-30} hi={4}
            rows={rows.map((r) => ({ id: r.parking, label: r.parking, sub: r.site.replace("Maria Gordon Notch", "M. Gordon Notch"),
              values: { measured: revealed ? r.measured * 100 : null, albedo: r.albedo * 100, sky: r.sky * 100, proportional: r.proportional * 100 } }))} />}
          {view === "unc" && <IntervalChart unit="RMSE difference, physical model minus proportional rule, percentage points"
            rows={[{ label: `Resampling the ${v.clusters} sites`, mid: v.dRMSE.mean, lo: v.dRMSE.lo, hi: v.dRMSE.hi, color: "#e7b37d" }]}
            note="Left of zero would favour the physical model, right of zero the rule." />}
          <p className="muted small dock-cap">Further left means more shielding. Shapes as well as colours distinguish the models; the ring is the measurement. Select a period to show its parking and background positions on the terrain.</p>
        </div>
        <div className="dock-side">
          {revealed ? (<>
            <div className="dataset-head"><h3>The data behind this result</h3></div>
            <DataTable rows={rows} id={(r) => r.parking} selected={sel} onSelect={(r) => pickP(r.parking)} compact={mobile} caption="Eight parking periods; select a row to find it on the terrain"
              cols={[
                { key: "p", label: "Period", render: (r) => r.parking },
                { key: "site", label: "Site", wide: true, render: (r) => r.site },
                { key: "m", label: "Measured", num: true, render: (r) => <M>{pcF(r.measured)}</M> },
                { key: "a", label: "Physical", num: true, render: (r) => <P>{pcF(r.albedo)}</P> },
                { key: "s", label: "Sky only", num: true, render: (r) => <P>{pcF(r.sky)}</P> },
                { key: "r", label: "Rule", num: true, render: (r) => <P>{pcF(r.proportional)}</P> },
                { key: "dB", label: "Δ sky blocked (pts)", num: true, wide: true, render: (r) => <P>{pcF(r.dB)}</P> },
              ]} />
            <table className="data">
              <thead><tr><th>Model</th><th>Mean error</th><th>RMSE</th><th>Closest at</th></tr></thead>
              <tbody>{v.summary.map((q) => <tr key={q.model}><td>{name[q.model]}</td><td>{q.mae.toFixed(2)} pp</td><td>{q.rmse.toFixed(2)} pp</td><td>{q.wins} of 8</td></tr>)}</tbody>
            </table>
          </>) : <p className="muted dock-wait">The table of measured values appears after you reveal Curiosity&apos;s measurements in the panel.</p>}
        </div>
      </div>
    </DockPortal>

    <Step n={1} title="Question">
      <p className="lede">Eight times, Curiosity parked beside a butte, hill or cliff, and RAD recorded the dose dropping. Which explanation predicts those drops?</p>
    </Step>
    <Step n={2} title="Prediction">
      <ul className="models">
        <li><i style={{ background: PARK_COLORS.proportional, borderRadius: 1 }} /><b>Proportional rule</b> (square). Dose falls with the share of sky blocked.</li>
        <li><i style={{ background: PARK_COLORS.sky, clipPath: "polygon(50% 0, 100% 100%, 0 100%)", borderRadius: 0 }} /><b>Sky only</b> (triangle). Remove the radiation from the blocked directions.</li>
        <li><i style={{ background: PARK_COLORS.albedo }} /><b>Physical model</b> (circle). Also add radiation re-emitted by the blocking rock (Guo et al. 2026).</li>
      </ul>
      <p className="prose">Their predictions for each period are in the analysis area.</p>
      <More label="Change the assumptions">
        <Slider label={<>Rock re-emission (albedo share of flat-ground dose)</>} value={alpha} min={0.18} max={0.24} step={0.01} onChange={(x) => { setAlpha(x); }} fmt={(x) => `${Math.round(x * 100)} %`} />
        <label className="check"><input type="checkbox" checked={p6alt} onChange={(e) => setP6alt(e.target.checked)} />Use the paper&apos;s Section 4 value for P6 (17 %) instead of Table 1 and NASA data (19.4 %)</label>
        <CalcNote ms={calc.ms} what="Predictions and the site bootstrap" />
      </More>
    </Step>
    {!revealed ? <RevealBtn onClick={() => setRevealed(true)} /> : (<>
      <Step n={3} title="NASA observations">
        <p className="prose">White rings: the drops RAD measured, from {Math.min(...rows.map((r) => -r.measured * 100)).toFixed(1)} to {Math.max(...rows.map((r) => -r.measured * 100)).toFixed(1)} %.</p>
      </Step>
      <Step n={4} title="Result" id="exp-result">
        <Chip kind={v.verdict.startsWith("cannot") ? "inconclusive" : "supported"}>{v.verdict.startsWith("cannot") ? "Cannot tell them apart" : v.verdict}</Chip>
        <p className="verdict-head">On average the predictions miss by {best.map((q, i) => <span key={q.model}>{i ? (i === best.length - 1 ? " and " : ", ") : ""}<P>{q.mae.toFixed(1)}</P> points ({name[q.model].split(" (")[0].toLowerCase()})</span>)}.</p>
        <p className="muted">Close averages; with eight periods at five places the differences are within the uncertainty.</p>
      </Step>
      <Step n={5} title="Explanation">
        <p className="prose">The models trade places from spot to spot. At Maria Gordon Notch (P6) the physical model predicted half the measured drop; at P8 our terrain geometry blocks more sky than the published analysis. Eight periods at five places cannot rank them.</p>
        <More label="Uncertainty and statistics">
          <p className="prose">RMSE difference, physical model minus proportional rule: {sgn(v.dRMSE.mean, 2)} pp (95 % interval {sgn(v.dRMSE.lo, 2)} to {sgn(v.dRMSE.hi, 2)}, resampling the {v.clusters} sites, because periods at one site are not independent).</p>
        </More>
      </Step>
    </>)}
  </>);
}

function DisagreeExp({ ds, revealed, setRevealed, setScene, focusOn }: ExpProps) {
  const ts = ds.terrainSignal!;
  const mobile = useMedia("(max-width: 860px)");
  const [n, setN] = useState(20);
  const [view, setView] = useState<"rows" | "unc">("rows");
  const ranked = useMemo(() => [...ts.rows].sort((p, q) => Math.abs(q.m_terrain - q.g_proxy) - Math.abs(p.m_terrain - p.g_proxy)), [ts]);
  const top = useMemo(() => ranked.slice(0, n), [ranked, n]);
  const [sel, setSel] = useState<string | null>(null);
  const pickD = useCallback((r: TSRow) => { setSel(r.rmc); focusOn(r.x, r.y, 700); }, [focusOn]);
  useEffect(() => {
    setScene({ pins: top.map((r) => ({ key: `d${r.rmc}`, x: r.x, y: r.y, color: r.rmc === sel ? "#e7b37d" : "#d0904f", size: r.rmc === sel ? 5 : 2.6,
      selected: r.rmc === sel, label: r.rmc === sel ? `Sol ${r.sol}` : undefined, onClick: () => pickD(r) })), lines: [] });
  }, [top, setScene, sel, pickD]);
  useEffect(() => { if (!revealed) setView("rows"); }, [revealed]);
  const res = useMemo(() => {
    const t0 = performance.now();
    const site = top.map((r) => r.rmc.split("_")[0]), sites = [...new Set(site)];
    const em = top.map((r) => r.y_obs - r.m_terrain), eg = top.map((r) => r.y_obs - r.g_proxy);
    const R = rng(29), bs: number[] = [];
    for (let b = 0; b < 3000; b++) {
      const idx: number[] = [];
      for (let k = 0; k < sites.length; k++) { const s = sites[Math.floor(R() * sites.length)]; site.forEach((q, i) => { if (q === s) idx.push(i); }); }
      bs.push((rmse(idx.map((i) => em[i])) - rmse(idx.map((i) => eg[i]))) * 100);
    }
    const perSite = sites.filter((s) => rmse(em.filter((_, i) => site[i] === s)) < rmse(eg.filter((_, i) => site[i] === s))).length;
    return { d: (rmse(em) - rmse(eg)) * 100, lo: pct(bs, 0.025), hi: pct(bs, 0.975), stops: em.filter((e, i) => Math.abs(e) < Math.abs(eg[i])).length, sites: sites.length, perSite,
      ms: performance.now() - t0 };
  }, [top]);
  const cal = (ts as unknown as { calibration: Record<string, { slope: number; ci95_site_cluster: [number, number] }> }).calibration;
  const decisive = res.hi < 0 || res.lo > 0;
  const { ms: _ms, ...resOut } = res;   // the timing is shown, not exported
  void _ms;
  const din = { top, n, pub: (q: TSRow) => inPublished(ds, q), result: resOut, calibration: cal };
  const series = [...(revealed ? [{ key: "obs", label: "Curiosity RAD (measured)", shape: "ring" as const, color: "#f6f1e7" }] : []),
    { key: "m", label: "Physical model", shape: "circle" as const, color: PARK_COLORS.albedo },
    { key: "g", label: "Blocked-sky rule", shape: "square" as const, color: PARK_COLORS.proportional }];
  return (<>
    <DockPortal title={`The ${n} stops where the models disagree most`}
      head={<DownloadBar name={`disagreement-top${n}`} rows={top.length} csv={() => disagreeCSV(din)}
        pkg={async () => disagreePackage(din, software(), await datasetId("terrain_signal.json", "science/marsshield/terrain_signal.py", (ts as unknown as { generated_utc?: string }).generated_utc))}
        note={<>the {n} stops with the largest model disagreement</>} />}>
      <div className="dock-grid">
        <div className="dock-main">
          {revealed && <Tabs className="subnav dock-tabs" label="Chart" tabs={[["rows", "By stop"], ["unc", "Uncertainty"]]} value={view} onChange={setView} />}
          {view === "rows" && <DotRowsChart unit="Change against neighbours" series={series} selected={sel} onSelect={(id) => { const r = top.find((q) => q.rmc === id); if (r) pickD(r); }}
            rows={top.map((r) => ({ id: r.rmc, label: `${r.rmc}`, sub: `sol ${r.sol}`, values: { obs: revealed ? pctLog(r.y_obs) : null, m: pctLog(r.m_terrain), g: pctLog(r.g_proxy) } }))} />}
          {view === "unc" && <IntervalChart unit="RMSE difference, physical model minus rule, percentage points (log scale × 100)"
            rows={[{ label: `Resampling the ${res.sites} Curiosity sites`, mid: res.d, lo: res.lo, hi: res.hi, color: "#e7b37d" }]}
            note="Left of zero would favour the physical model." />}
          <p className="muted small dock-cap">Ranked by how far the two models disagree, chosen from the models alone. Select a stop to show it on the terrain and in the table.</p>
        </div>
        <div className="dock-side">
          {revealed ? (<>
            <div className="dataset-head"><h3>The data behind this result</h3></div>
            <DataTable rows={top} id={(r) => r.rmc} selected={sel} onSelect={pickD} compact={mobile} caption={`The ${n} stops with the largest disagreement; select a row to find it on the terrain`}
              cols={[
                { key: "rank", label: "#", num: true, render: (r) => top.indexOf(r) + 1 },
                { key: "stop", label: "Stop", render: (r) => r.rmc },
                { key: "sol", label: "Sol", num: true, wide: true, render: (r) => r.sol },
                { key: "obs", label: "Measured", num: true, render: (r) => <M>{pcL(r.y_obs)}</M> },
                { key: "m", label: "Physical", num: true, render: (r) => <P>{pcL(r.m_terrain)}</P> },
                { key: "g", label: "Rule", num: true, render: (r) => <P>{pcL(r.g_proxy)}</P> },
                { key: "c", label: "Closer", render: (r) => (Math.abs(r.y_obs - r.m_terrain) < Math.abs(r.y_obs - r.g_proxy) ? "physical" : "rule") },
              ]} />
          </>) : <p className="muted dock-wait">The table of measured values appears after you reveal Curiosity&apos;s measurements in the panel.</p>}
        </div>
      </div>
    </DockPortal>

    <Step n={1} title="Question">
      <p className="lede">The physical model and the blocked-sky rule mostly agree. Where they disagree, a measurement can tell them apart. Did Curiosity stop at such places, and which model did its measurements favour?</p>
    </Step>
    <Step n={2} title="Prediction">
      <p className="prose">The map shows where the models disagree: brighter ground means the physical model predicts relatively more dose there than the rule. The {n} Curiosity stops with the largest disagreement are marked in gold, chosen from the models alone.</p>
      <Slider label="Stops with the largest disagreement" value={n} min={10} max={60} step={5} onChange={(q) => { setN(q); setRevealed(false); }} fmt={(q) => String(q)} />
      <p className="muted">{res.sites} Curiosity sites; disagreement at least {(Math.abs(top[top.length - 1].m_terrain - top[top.length - 1].g_proxy) * 100).toFixed(1)} points.</p>
      <CalcNote ms={res.ms} what="The site bootstrap" />
    </Step>
    {!revealed ? <RevealBtn onClick={() => setRevealed(true)} /> : (<>
      <Step n={3} title="NASA observations">
        <div className="stats">
          <div><b>{res.stops} / {n}</b><span>stops where the physical model was closer</span></div>
          <div><b>{res.perSite} / {res.sites}</b><span>places where it was closer</span></div>
          <div><b>{sgn(res.d, 2)}</b><span>points of error, physical minus rule</span></div>
        </div>
      </Step>
      <Step n={4} title="Result" id="exp-result">
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
      </Step>
    </>)}
  </>);
}
