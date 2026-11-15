"use client";
import { Component, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import TerrainScene, { type Focus, type Layer, type ScenePin } from "./TerrainScene";
import { MissionMode, type SceneSpec } from "./MissionMode";
import { ExperimentMode } from "./ExperimentMode";
import { EvidenceMode } from "./EvidenceMode";
import type { Dataset, Stop } from "@/lib/data";
import { BASE, loadDataset, relTotal, sampleGrid } from "@/lib/data";
import { useEngine } from "@/lib/useEngine";
import { M, P, sgn } from "./ui";

type Mode = "mission" | "experiment" | "evidence";

function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function NoWebGL({ ds }: { ds: Dataset }) {
  return (
    <div className="nowebgl">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export */}
      {ds.ortho && <img src={`${BASE}/data/ortho.jpg`} alt="Orbital image of the 3.5 by 3 km study area in Gale Crater (USGS orthophoto from MRO HiRISE)" />}
      <div className="mapcard"><b>The 3D terrain needs WebGL, which is turned off in this browser.</b>
        <p className="muted">Every mission step, experiment and piece of evidence in the panel still works. The image shows the same area from orbit.</p></div>
    </div>
  );
}

const LEGEND: Record<Layer, ReactNode> = {
  dose: (<><div className="ramp" style={{ background: "linear-gradient(90deg, #cfdbe2, #2a5c8c)" }} /><div className="ramp-l"><span>×0.97 open ground</span><span>×0.80 sheltered</span></div>
    <p className="muted small">Modeled cosmic-ray dose rate relative to open flat ground.</p></>),
  disagree: (<><div className="ramp" style={{ background: "linear-gradient(90deg, #6b625a, #eba05a)" }} /><div className="ramp-l"><span>same prediction as nearby ground</span><span>differs by 10+ points</span></div>
    <p className="muted small">How differently the terrain-albedo model and the blocked-sky rule predict a spot&apos;s dose against ordinary ground nearby. Bright spots are where a measurement could tell the models apart.</p></>),
  image: <p className="muted small">USGS Gale orthophoto from MRO HiRISE, 25 cm averaged to 1 m.</p>,
  terrain: <p className="muted small">USGS 1 m elevation model (MRO HiRISE/CTX stereo), shaded relief.</p>,
  sky: (<><div className="ramp" style={{ background: "linear-gradient(90deg, #d9d9d9, #263873)" }} /><div className="ramp-l"><span>0 %</span><span>50 % of sky blocked</span></div></>),
  slope: <p className="muted small">Amber 15–25°; hatched red over 25° (avoided by routes).</p>,
};

export default function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("mission");
  const [welcome, setWelcome] = useState(true);
  const [layer, setLayer] = useState<Layer>("dose");
  const [more, setMore] = useState(false);
  const [showObs, setShowObs] = useState(true);
  const [exag, setExag] = useState(1);
  const [webgl, setWebgl] = useState(true);
  const [panel, setPanel] = useState(true);
  const [focus, setFocus] = useState<Focus>(null);
  const [scene, setScene] = useState<SceneSpec>({});
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ cx: number; cy: number; body: ReactNode } | null>(null);
  const [card, setCard] = useState<Stop | null>(null);
  const eng = useEngine(ds);

  useEffect(() => {
    setWebgl(hasWebGL());
    try { if (window.localStorage.getItem("marsshield-welcome") === "done") setWelcome(false); } catch { /* storage unavailable */ }
    loadDataset().then(setDs).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  const focusOn = useCallback((x: number, y: number, dist?: number) => setFocus((f) => ({ x, y, dist, n: (f?.n ?? 0) + 1 })), []);
  const finishWelcome = (m: Mode) => {
    setWelcome(false); setMode(m); setCard(null);
    if (m !== "mission") overview();
    if (m === "evidence") setLayer("dose");
    try { window.localStorage.setItem("marsshield-welcome", "done"); } catch { /* storage unavailable */ }
  };
  const mgn = ds?.scienceTargets.find((t) => t.id === "mgn");
  useEffect(() => { if (ds && welcome && mgn) focusOn(mgn.x, mgn.y, 520); }, [ds, welcome, mgn, focusOn]);
  // median of (model - proxy) over the walk area: the reference for the local-contrast disagreement layer
  const dref = useMemo(() => {
    if (!ds) return 0;
    const v: number[] = [];
    for (let i = 0; i < ds.grids.B.length; i += 7) if (Number.isFinite(ds.grids.height[i])) v.push((relTotal(ds.grids.relSky[i], ds.grids.B[i], 0.21) - (1 - ds.grids.B[i])) * 100);
    v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)];
  }, [ds]);
  const overview = useCallback(() => { if (ds) { const c = { x: ds.meta.x0 + (ds.meta.shape[1] * ds.meta.res) / 2, y: ds.meta.y0 - (ds.meta.shape[0] * ds.meta.res) / 2 }; focusOn(c.x, c.y, 2900); } }, [ds, focusOn]);
  const setLayerCb = useCallback((l: "dose" | "disagree" | "image") => setLayer(l), []);
  const setSceneCb = useCallback((s: SceneSpec) => setScene(s), []);

  const readout = useMemo(() => {
    if (!ds || !hover) return null;
    const z = sampleGrid(ds.meta, ds.grids.height, hover.x, hover.y);
    if (!Number.isFinite(z)) return null;
    const B = sampleGrid(ds.meta, ds.grids.B, hover.x, hover.y);
    return { z, slope: sampleGrid(ds.meta, ds.grids.slope, hover.x, hover.y), B, rel: relTotal(sampleGrid(ds.meta, ds.grids.relSky, hover.x, hover.y), B, 0.21) };
  }, [ds, hover]);

  if (err) return <div className="loading">{err}</div>;
  if (!ds) return <div className="loading">Loading Gale Crater terrain and Curiosity&apos;s measurements…</div>;
  const byId = Object.fromEntries(ds.scienceTargets.map((t) => [t.id, t]));
  const welcomePins: ScenePin[] = ds.scienceTargets.map((t) => ({ key: t.id, x: t.x, y: t.y, label: t.name.split(",")[0], color: t.id === "mgn" ? "#d0904f" : "#a39582", selected: t.id === "mgn" }));
  const pins = welcome ? welcomePins : mode === "evidence" ? welcomePins.map((p) => ({ ...p, selected: false, color: "#a39582" })) : scene.pins;
  const skyId = welcome ? "mgn" : mode === "mission" ? scene.skyId : null;
  const p6 = ds.validation.pairs.find((q: { pair: string }) => q.pair.startsWith("P6"));

  const sceneEl = (
    <TerrainScene ds={ds} layer={layer} alpha={0.21} exaggeration={exag} disagreeErrPP={ds.breakeven["Maria Gordon Notch"].model_error.rmse_pp} disagreeRefPP={dref}
      lines={welcome || mode === "evidence" ? [] : scene.lines} pins={pins} ring={!welcome && mode === "mission" ? scene.ring : null}
      sky={skyId ? ds.skiesTargets[skyId] : null} showObs={showObs} focus={focus}
      onObsClick={(s) => { setCard(s); setTip(null); }}
      onObsHover={(s, cx, cy) => setTip(s ? { cx, cy, body: <><b>Curiosity stop, sol {s.sol}</b><span className="muted">{s.utc_start?.slice(0, 10)}</span>
        <dl><dt>Measured</dt><dd><M>{s.E_mean?.toFixed(0)} µGy/day</M></dd><dt>Local anomaly</dt><dd><M>{s.anomaly_obs != null ? `${sgn(s.anomaly_obs * 100)} %` : "n/a"}</M></dd>
          <dt>Model</dt><dd><P>{s.anomaly_model != null ? `${sgn(s.anomaly_model * 100)} %` : "n/a"}</P></dd></dl></> } : null)}
      onPinHover={(k, cx, cy) => { const t = k ? byId[k] : null; setTip(t ? { cx, cy, body: <><b>{t.name}</b><span className="muted">{t.objective}</span></> } : null); }}
      onPick={() => setCard(null)} onHover={setHover} />
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark"><b>MarsShield</b><span>Terrain and cosmic radiation in Gale Crater</span></div>
        <nav className="modes" role="tablist" aria-label="Experience">
          {([["mission", "Mission"], ["experiment", "Experiment"], ["evidence", "Evidence"]] as [Mode, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={!welcome && mode === k} onClick={() => finishWelcome(k)}>{l}</button>))}
        </nav>
        <span className="runmode" title="Routes, trade-offs and experiments are recalculated in this browser. Terrain ray tracing was precomputed by the Python pipeline.">
          <i />{eng.ready ? "Calculating in your browser" : "Preparing the engine…"}</span>
      </header>

      <section className="stage" aria-label="3D terrain of Gale Crater">
        {webgl ? <SceneBoundary fallback={<NoWebGL ds={ds} />}>{sceneEl}</SceneBoundary> : <NoWebGL ds={ds} />}
        {tip && <div className="tip" style={{ left: Math.min(tip.cx + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300), top: tip.cy + 14, position: "fixed" }}>{tip.body}</div>}
        {card && (
          <div className="mapcard card-pin" role="dialog" aria-label={`Curiosity RAD observation, sol ${card.sol}`}>
            <div className="row" style={{ justifyContent: "space-between" }}><b>Curiosity stop, sol {card.sol}</b><button className="linklike small" onClick={() => setCard(null)}>Close</button></div>
            <p className="muted">{card.utc_start?.slice(0, 10)} to {card.utc_end?.slice(0, 10)}, {card.n_obs} RAD observations</p>
            <dl className="tip" style={{ position: "static", border: 0, padding: 0, background: "none", boxShadow: "none" }}>
              <dt>Dose rate</dt><dd><M>{card.E_mean?.toFixed(1)} ± {(card.E_sem ?? 0).toFixed(1)} µGy/day</M></dd>
              <dt>vs ±15 sols around it</dt><dd><M>{card.anomaly_obs != null ? `${sgn(card.anomaly_obs * 100)} %` : "n/a"}</M></dd>
              <dt>Terrain model</dt><dd><P>{card.anomaly_model != null ? `${sgn(card.anomaly_model * 100)} %` : "n/a"}</P></dd>
              <dt>Sky blocked</dt><dd><P>{(card.B * 100).toFixed(1)} %</P></dd>
            </dl>
            <p className="muted small">NASA RAD Level 2, detector E; flagged records removed.</p>
          </div>
        )}
        {webgl && (
          <div className="mapdock">
            <div className="mapcard">
              <div className="layers" role="group" aria-label="Map layer">
                {([["dose", "Radiation"], ["image", "Orbital image"], ["disagree", "Model disagreement"], ["terrain", "Relief"]] as [Layer, string][])
                  .concat(more ? [["sky", "Sky blocked"], ["slope", "Slope"]] : []).map(([k, l]) => <button key={k} aria-pressed={layer === k} onClick={() => setLayer(k)}>{l}</button>)}
                <button onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Fewer" : "More"}</button>
              </div>
              {LEGEND[layer]}
              <div className="row" style={{ marginTop: 6, gap: 14 }}>
                <label className="check small"><input type="checkbox" checked={showObs} onChange={(e) => setShowObs(e.target.checked)} />Curiosity RAD stops</label>
                <label className="check small"><input type="checkbox" checked={exag === 2} onChange={(e) => setExag(e.target.checked ? 2 : 1)} />Relief ×2</label>
              </div>
              {showObs && <div className="ramp-l" style={{ marginTop: 4 }}><span><i className="dot-m" />ring: measured, fill: lower <span style={{ color: "#3987e5" }}>blue</span> / higher <span style={{ color: "#d95926" }}>orange</span> than nearby days</span></div>}
              {readout && <p className="muted small" style={{ marginTop: 4 }}>Cursor: {readout.z.toFixed(0)} m, {readout.slope.toFixed(0)}° slope, {(readout.B * 100).toFixed(0)} % sky blocked, <P>×{readout.rel.toFixed(3)}</P> dose rate</p>}
            </div>
          </div>
        )}
        <button className="btn ghost panel-toggle" style={{ display: panel ? "none" : undefined }} onClick={() => setPanel(true)}>Show panel</button>
      </section>

      <aside className={`panel ${panel ? "" : "hidden"}`} aria-label="Panel">
        {welcome ? (
          <>
            <div className="panel-head"><button className="linklike small" style={{ float: "right" }} onClick={() => setPanel(false)}>Hide panel</button>
              <p className="eyebrowless">MarsShield</p><p className="sub">A radiation laboratory on real Gale Crater terrain.</p></div>
            <div className="panel-body">
              <p className="lede">Cliffs and canyons block part of the sky, and part of the cosmic radiation that falls from it. But the rock also re-emits radiation of its own. How much does the Martian landscape really protect an astronaut?</p>
              <div className="figure-pair">
                <div><b><M>{sgn((p6?.measured_ours ?? -0.194) * 100)} %</M></b><span>dose rate Curiosity measured in Maria Gordon Notch, December 2021</span></div>
                <div><b><P>{sgn((p6?.pred_albedo_019 ?? -0.098) * 100)} %</P></b><span>what the published terrain model predicts for the same comparison</span></div>
              </div>
              <p className="prose">The notch is on screen: the dark curtain is the sky its walls hide. Here the model underestimates the shelter; across Curiosity&apos;s traverse, a simpler &ldquo;blocked sky&rdquo; rule overstates it. You can plan a walk with these models, or test them against NASA&apos;s measurements.</p>
              <div className="row">
                <button className="btn primary" onClick={() => finishWelcome("mission")}>Plan a Marswalk</button>
                <button className="btn" onClick={() => finishWelcome("experiment")}>Test the radiation models</button>
              </div>
              <button className="linklike small" style={{ alignSelf: "flex-start" }} onClick={() => finishWelcome("evidence")}>Or go straight to the evidence</button>
              <p className="muted">Built on NASA data: Curiosity&apos;s radiation detector (RAD), weather station (REMS) and navigation, and terrain from the Mars Reconnaissance Orbiter. Everything you change is recalculated in this browser.</p>
            </div>
          </>
        ) : mode === "mission" ? <MissionMode ds={ds} eng={eng} setScene={setSceneCb} focusOn={focusOn} />
          : mode === "experiment" ? <ExperimentMode ds={ds} setScene={setSceneCb} setLayer={setLayerCb} />
          : <EvidenceMode ds={ds} />}
      </aside>
    </div>
  );
}
