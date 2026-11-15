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
import { NotchStory, type StoryScene } from "./Story";
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

type LayerInfo = { k: Layer; name: string; desc: string; ramp?: { grad: string; lo: string; hi: string } };
const LAYERS: LayerInfo[] = [
  { k: "dose", name: "Radiation", desc: "Modeled cosmic-ray dose rate, relative to open flat ground", ramp: { grad: "linear-gradient(90deg, #cfdbe2, #2a5c8c)", lo: "×0.97 open", hi: "×0.80 sheltered" } },
  { k: "image", name: "Orbital image", desc: "USGS orthophoto from MRO HiRISE, 25 cm averaged to 1 m" },
  { k: "terrain", name: "Relief", desc: "USGS 1 m elevation model (HiRISE and CTX stereo), shaded" },
  { k: "disagree", name: "Model disagreement", desc: "Where the physical model and the blocked-sky rule differ, against nearby ground", ramp: { grad: "linear-gradient(90deg, #6b625a, #eba05a)", lo: "agree", hi: "differ by 10+ points" } },
  { k: "sky", name: "Sky blocked", desc: "Share of the sky hidden by terrain, from ray tracing", ramp: { grad: "linear-gradient(90deg, #d9d9d9, #263873)", lo: "0 %", hi: "50 %" } },
  { k: "slope", name: "Slope", desc: "Amber 15–25°; hatched red over 25° (avoided by routes)" },
];

function LayerControl({ layer, setLayer, showObs, setShowObs, exag, setExag, readout }: {
  layer: Layer; setLayer: (l: Layer) => void; showObs: boolean; setShowObs: (v: boolean) => void; exag: number; setExag: (v: number) => void;
  readout: { z: number; slope: number; B: number; rel: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const cur = LAYERS.find((l) => l.k === layer)!;
  return (
    <div className="layerctl">
      {open && (
        <div className="layer-pop" role="dialog" aria-label="Map layers">
          <div className="layer-list" role="radiogroup" aria-label="Map layer">
            {LAYERS.map((l) => (
              <button key={l.k} role="radio" aria-checked={layer === l.k} onClick={() => setLayer(l.k)}>
                <b>{l.name}</b><span>{l.desc}</span>
              </button>))}
          </div>
          <label className="check"><input type="checkbox" checked={showObs} onChange={(e) => setShowObs(e.target.checked)} />Curiosity&apos;s radiation measurements (322 stops)</label>
          {showObs && <p className="muted small"><i className="dot-m" />Ring: measured. Fill: dose <span style={{ color: "#5b9be8" }}>lower</span> or <span style={{ color: "#e07445" }}>higher</span> than on nearby days.</p>}
          <label className="check"><input type="checkbox" checked={exag === 2} onChange={(e) => setExag(e.target.checked ? 2 : 1)} />Exaggerate relief ×2</label>
          {readout && <p className="muted small">Under the cursor: {readout.z.toFixed(0)} m, {readout.slope.toFixed(0)}° slope, {(readout.B * 100).toFixed(0)} % of sky blocked, <P>×{readout.rel.toFixed(3)}</P> dose rate</p>}
        </div>
      )}
      <div className="layer-bar">
        <button className="layer-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 5 8 8.5 1 5Z M1 8l7 3.5L15 8 M1 11l7 3.5 7-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          <span>{cur.name}</span>
        </button>
        {cur.ramp && <div className="mini-ramp"><i style={{ background: cur.ramp.grad }} /><span>{cur.ramp.lo}</span><span>{cur.ramp.hi}</span></div>}
      </div>
    </div>
  );
}

export default function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("mission");
  const [welcome, setWelcome] = useState(true);
  const [layer, setLayer] = useState<Layer>("dose");
  const [showObs, setShowObs] = useState(false);     // Curiosity's 322 RAD stops: in Layers, off by default
  const [story, setStory] = useState<StoryScene | null>(null);
  const [initExp, setInitExp] = useState<"parking" | null>(null);   // the story can hand over straight to an experiment
  // desktop: the panel covers the right of the canvas, so centre the camera's focus in what remains
  const [vw, setVw] = useState(1440);
  useEffect(() => { const f = () => setVw(window.innerWidth); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
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
  const finishWelcome = (m: Mode, exp?: "parking") => {
    setInitExp(exp ?? null);
    setWelcome(false); setMode(m); setCard(null); setScene({});   // each mode draws only its own lines
    if (m !== "mission") overview();
    if (m === "evidence") setLayer("dose");
    try { window.localStorage.setItem("marsshield-welcome", "done"); } catch { /* storage unavailable */ }
  };
  const setStoryScene = useCallback((s: StoryScene) => { setStory(s); focusOn(s.focus.x, s.focus.y, s.focus.dist); }, [focusOn]);
  const replayStory = () => { setWelcome(true); setCard(null); setScene({}); setLayer("dose"); setPanel(true); };
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
  const targetPins: ScenePin[] = ds.scienceTargets.map((t) => ({ key: t.id, x: t.x, y: t.y, label: t.name.split(",")[0], color: "#b9ab97" }));
  const pins = welcome ? story?.pins ?? [] : mode === "evidence" ? targetPins : scene.pins;
  const skyId = welcome ? (story?.sky ? "mgn" : null) : mode === "mission" ? scene.skyId : null;

  const sceneEl = (
    <TerrainScene ds={ds} layer={layer} alpha={0.21} exaggeration={exag} disagreeErrPP={ds.breakeven["Maria Gordon Notch"].model_error.rmse_pp} disagreeRefPP={dref} viewShiftPx={panel && vw > 860 ? (vw > 1180 ? 208 : 193) : 0}
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
        <button className="wordmark" onClick={replayStory} title="Replay the Maria Gordon Notch story"><b>MarsShield</b><span>Terrain and cosmic radiation in Gale Crater</span></button>
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
        {webgl && <LayerControl layer={layer} setLayer={setLayer} showObs={showObs} setShowObs={setShowObs} exag={exag} setExag={setExag} readout={readout} />}
        <button className="btn ghost panel-toggle" style={{ display: panel ? "none" : undefined }} onClick={() => setPanel(true)}>Show panel</button>
      </section>

      <aside className={`panel ${panel ? "" : "hidden"}${welcome ? " fit" : ""}`} aria-label="Panel">
        {welcome ? (
          <NotchStory ds={ds} setStoryScene={setStoryScene} onDone={finishWelcome} />
        ) : mode === "mission" ? <MissionMode ds={ds} eng={eng} setScene={setSceneCb} focusOn={focusOn} />
          : mode === "experiment" ? <ExperimentMode ds={ds} setScene={setSceneCb} setLayer={setLayerCb} initial={initExp} />
          : <EvidenceMode ds={ds} />}
      </aside>
    </div>
  );
}
