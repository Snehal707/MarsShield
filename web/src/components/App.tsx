"use client";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import TerrainScene, { type Focus, type Layer, type ScenePin } from "./TerrainScene";
import { MissionMode, type SceneSpec } from "./MissionMode";
import { ExperimentMode } from "./ExperimentMode";
import { EvidenceMode } from "./EvidenceMode";
import type { Dataset, Stop } from "@/lib/data";
import { BASE, loadDataset, relTotal, sampleGrid } from "@/lib/data";
import { useEngine, type CalcStatus } from "@/lib/useEngine";
import { NotchStory, type StoryScene } from "./Story";
import { M, P, sgn, Tabs } from "./ui";
import { DockCtx, DockShell, type DockSize } from "./Dock";
import { DEFAULT_SCENARIO, type Scenario } from "./RadiationLab";
import { loadIndex, type RegionIndex } from "@/lib/regions";
import { MarsOverview, RegionalView } from "./RegionView";

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

function LayerControl({ layer, setLayer, showObs, setShowObs, exag, setExag, readout, top, resetKey }: {
  layer: Layer; setLayer: (l: Layer) => void; showObs: boolean; setShowObs: (v: boolean) => void; exag: number; setExag: (v: number) => void;
  readout: { z: number; slope: number; B: number; rel: number } | null; top: boolean; resetKey: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  const cur = LAYERS.find((l) => l.k === layer)!;
  // closes on Escape (focus returns to the button), on a click or tap outside, and whenever the mode or step changes
  useEffect(() => { setOpen(false); }, [resetKey]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", key); window.addEventListener("pointerdown", down, true);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", down, true); };
  }, [open]);
  return (
    <div className={`layerctl${top ? " top" : ""}`} ref={root}>
      {open && (
        <div className="layer-pop" role="dialog" aria-label="Map layers">
          <div className="layer-list" role="radiogroup" aria-label="Map layer">
            {LAYERS.map((l) => (
              <button key={l.k} role="radio" aria-checked={layer === l.k} tabIndex={layer === l.k ? 0 : -1} onClick={() => setLayer(l.k)}
                onKeyDown={(e) => { const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return; e.preventDefault(); const i = (LAYERS.findIndex((q) => q.k === layer) + d + LAYERS.length) % LAYERS.length; setLayer(LAYERS[i].k);
                  ((e.currentTarget.parentElement?.children[i]) as HTMLElement | undefined)?.focus(); }}>
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
        <button className="layer-btn" ref={btn} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 5 8 8.5 1 5Z M1 8l7 3.5L15 8 M1 11l7 3.5 7-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          <span>{cur.name}</span>
        </button>
        {cur.ramp && <div className="mini-ramp"><i style={{ background: cur.ramp.grad }} /><span>{cur.ramp.lo}</span><span>{cur.ramp.hi}</span></div>}
      </div>
    </div>
  );
}

/** Map labels: keep each inside the visible terrain (left of the panel, above the dock) and hide a label that would overlap
 *  one already placed (the selected marker's label first). Its marker stays; hovering it still names it. */
function useLabelLayout(stage: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const st = stage.current;
      if (!st) return;
      const sr = st.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>(".panel:not(.hidden)"), dock = document.querySelector<HTMLElement>(".dock:not([hidden])");
      const desk = window.innerWidth > 860;
      const right = desk && panel ? panel.getBoundingClientRect().left - 6 : sr.right - 6;
      const bottom = desk && dock ? dock.getBoundingClientRect().top - 6 : sr.bottom - 6;
      const top = desk ? 62 : sr.top + 4, left = sr.left + 6;
      const labels = Array.from(st.querySelectorAll<HTMLElement>(".pin-label"));
      labels.sort((a, b) => Number(!!b.closest("[data-sel]")) - Number(!!a.closest("[data-sel]")));
      const placed: DOMRect[] = [];
      for (const el of labels) {
        el.style.translate = ""; el.style.visibility = "";
        const pin = el.parentElement!.getBoundingClientRect(), r = el.getBoundingClientRect();
        const cx = pin.left + pin.width / 2, cy = pin.top + pin.height / 2;
        if (cx < left || cx > right || cy < top || cy > bottom) { el.style.visibility = "hidden"; continue; }
        const dx = r.left < left ? left - r.left : r.right > right ? right - r.right : 0;
        const dy = r.top < top ? top - r.top : r.bottom > bottom ? bottom - r.bottom : 0;
        const q = new DOMRect(r.left + dx, r.top + dy, r.width, r.height);
        if (placed.some((o) => q.left < o.right + 4 && q.right > o.left - 4 && q.top < o.bottom + 2 && q.bottom > o.top - 2)) { el.style.visibility = "hidden"; continue; }
        if (dx || dy) el.style.translate = `${dx}px ${dy}px`;
        placed.push(q);
      }
    };
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [stage, active]);
}

export default function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("mission");
  const [welcome, setWelcome] = useState(false);   // true while the optional Maria Gordon Notch case study is open
  const [layer, setLayer] = useState<Layer>("dose");
  const [showObs, setShowObs] = useState(false);     // Curiosity's 322 RAD stops: in Layers, off by default
  const [story, setStory] = useState<StoryScene | null>(null);
  const [initExp, setInitExp] = useState<"parking" | null>(null);   // the story can hand over straight to an experiment
  // desktop: the panel covers the right of the canvas and the dock its bottom, so centre the camera's focus in what remains
  const [vw, setVw] = useState(1440), [vh, setVh] = useState(900);
  useEffect(() => { const f = () => { setVw(window.innerWidth); setVh(window.innerHeight); }; f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  useEffect(() => { setDockH(Math.round(Math.max(320, window.innerHeight * 0.45))); }, []);   // split view: a little under half the screen
  const [exag, setExag] = useState(1);
  const [webgl, setWebgl] = useState(true);
  const [panel, setPanel] = useState(true);
  // Evidence can open as a full-width reading view; Mission, Experiment and the story keep the narrow panel.
  const [reading, setReading] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);
  const [scene, setScene] = useState<SceneSpec>({});
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ cx: number; cy: number; body: ReactNode } | null>(null);
  const [card, setCard] = useState<Stop | null>(null);
  const [calc, setCalc] = useState<CalcStatus>({ running: 0, last: null });
  // regions: Gale is the full experience; other regions are terrain views described by manifests, loaded on demand
  const [region, setRegion] = useState("mars");    // the entry is the Mars overview
  const [sc, setSc] = useState<Scenario>(DEFAULT_SCENARIO);   // matched assumptions, shared by every region
  const [rindex, setRindex] = useState<RegionIndex | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("region");
    if (q) { setRegion(q); if (q === "gale") setDockSize("mid"); }
    loadIndex().then(setRindex).catch(() => setRindex(null));
  }, []);
  const openRegion = useCallback((id: string) => {
    setRegion(id); setCard(null); setTip(null); setDockSize(id === "gale" ? "mid" : "min");
    try { const u = new URL(window.location.href); if (id === "mars") u.searchParams.delete("region"); else u.searchParams.set("region", id); window.history.replaceState(null, "", u); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }, []);
  const eng = useEngine(ds, setCalc);
  // research dock
  const [dockTitle, setDockTitle] = useState<string | null>(null);
  const [dockHead, setDockHead] = useState<HTMLElement | null>(null), [dockBody, setDockBody] = useState<HTMLElement | null>(null);
  // the analysis dock starts collapsed in the overview and regional views (only its bar shows), open in Gale experiments
  const [dockSize, setDockSize] = useState<DockSize>("min");
  const expandDock = useCallback(() => setDockSize((s) => (s === "min" ? "mid" : s)), []);
  const [dockH, setDockH] = useState(340);
  const obsPick = useRef<((s: Stop) => void) | null>(null);    // an experiment can take over clicks on Curiosity's stops
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setWebgl(hasWebGL());
    loadDataset().then(setDs).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  const focusOn = useCallback((x: number, y: number, dist?: number) => setFocus((f) => ({ x, y, dist, n: (f?.n ?? 0) + 1 })), []);
  const overview = useCallback(() => { if (ds) { const c = { x: ds.meta.x0 + (ds.meta.shape[1] * ds.meta.res) / 2, y: ds.meta.y0 - (ds.meta.shape[0] * ds.meta.res) / 2 }; focusOn(c.x, c.y, 2900); } }, [ds, focusOn]);
  const finishWelcome = (m: Mode, exp?: "parking") => {
    if (!welcome && m === mode && !exp) return;     // re-selecting the current mode keeps its state, lines and markers
    setInitExp(exp ?? null);
    setWelcome(false); setMode(m); setCard(null); setScene({});   // each mode draws only its own lines
    if (m !== "mission") overview();
    if (m === "evidence") setLayer("dose");
    try { window.localStorage.setItem("marsshield-welcome", "done"); } catch { /* storage unavailable */ }
  };
  const setStoryScene = useCallback((s: StoryScene) => { setStory(s); focusOn(s.focus.x, s.focus.y, s.focus.dist); }, [focusOn]);
  const replayStory = () => { setWelcome(true); setCard(null); setScene({}); setLayer("dose"); setPanel(true); setReading(false); };
  const openCaseStudy = () => { openRegion("gale"); replayStory(); };
  // median of (model - proxy) over the walk area: the reference for the local-contrast disagreement layer
  const dref = useMemo(() => {
    if (!ds) return 0;
    const v: number[] = [];
    for (let i = 0; i < ds.grids.B.length; i += 7) if (Number.isFinite(ds.grids.height[i])) v.push((relTotal(ds.grids.relSky[i], ds.grids.B[i], 0.21) - (1 - ds.grids.B[i])) * 100);
    v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)];
  }, [ds]);
  const setLayerCb = useCallback((l: "dose" | "disagree" | "image") => setLayer(l), []);
  const setSceneCb = useCallback((s: SceneSpec) => setScene(s), []);
  const setObsPick = useCallback((f: ((s: Stop) => void) | null) => { obsPick.current = f; if (f) setShowObs(true); }, []);
  const dockActive = !!dockTitle && (region !== "gale" || (!welcome && mode === "experiment"));
  useLabelLayout(stageRef, !!ds && webgl);

  const readout = useMemo(() => {
    if (!ds || !hover) return null;
    const z = sampleGrid(ds.meta, ds.grids.height, hover.x, hover.y);
    if (!Number.isFinite(z)) return null;
    const B = sampleGrid(ds.meta, ds.grids.B, hover.x, hover.y);
    return { z, slope: sampleGrid(ds.meta, ds.grids.slope, hover.x, hover.y), B, rel: relTotal(sampleGrid(ds.meta, ds.grids.relSky, hover.x, hover.y), B, 0.21) };
  }, [ds, hover]);

  const regionPick = rindex && (
    <label className="region-pick"><span className="sr-only">Region</span>
      <select value={region} onChange={(e) => openRegion(e.target.value)}>
        {rindex.regions.map((r) => <option key={r.id} value={r.id}>{r.id === "mars" ? "Mars overview" : r.name}</option>)}
      </select></label>);
  if (region !== "gale" && !rindex) return <div className="loading">Loading the Mars regions…</div>;
  if (region !== "gale" && rindex && rindex.regions.some((r) => r.id === region)) {
    const desk = vw > 860, pw = vw > 1180 ? 400 : 370, dmax = Math.max(260, vh - 56 - 16 - 150);
    return (
      <DockCtx.Provider value={{ head: dockHead, body: dockBody, setTitle: setDockTitle, mobile: !desk, expand: expandDock }}>
      <div className="app region-app">
        <a className="skip-link" href="#panel">Skip to the panel</a>
        {dockActive && <a className="skip-link" href="#analysis">Skip to the analysis</a>}
        <header className="topbar">
          <button className="wordmark" onClick={() => openRegion("mars")} title="Mars overview"><b>MarsShield</b><span>Cosmic radiation on Mars</span></button>
          {regionPick}
          <span className="runmode region-note">Model estimates here; measurements only at Gale</span>
        </header>
        {region === "mars" ? <MarsOverview index={rindex} onOpen={openRegion} onCaseStudy={openCaseStudy} sc={sc} setSc={setSc} />
          : <RegionalView id={region} index={rindex} onOpen={openRegion} desktop={desk} sc={sc} setSc={setSc} />}
        <DockShell title={dockActive ? dockTitle : null} size={dockSize} setSize={setDockSize} height={Math.min(dockH, dmax)} setHeight={setDockH} maxH={dmax}
          desktop={desk} right={pw + 32} setHead={setDockHead} setBody={setDockBody} />
      </div>
      </DockCtx.Provider>
    );
  }
  if (err) return <div className="loading">{err}</div>;
  if (!ds) return <div className="loading">Loading Gale Crater terrain and Curiosity&apos;s measurements…</div>;
  const byId = Object.fromEntries(ds.scienceTargets.map((t) => [t.id, t]));
  const targetPins: ScenePin[] = ds.scienceTargets.map((t) => ({ key: t.id, x: t.x, y: t.y, label: t.name.split(",")[0], color: "#b9ab97" }));
  const pins = welcome ? story?.pins ?? [] : mode === "evidence" ? targetPins : scene.pins;
  const skyId = welcome ? (story?.sky ? "mgn" : null) : mode === "mission" ? scene.skyId : null;

  const desktop = vw > 860, evidence = !welcome && mode === "evidence", readView = evidence && reading && desktop;
  const panelW = evidence ? Math.round(Math.min(600, Math.max(480, vw * 0.36))) : vw > 1180 ? 400 : 370;
  const dockMax = Math.max(260, vh - 56 - 16 - 150);
  const dockShown = dockActive && desktop ? (dockSize === "min" ? 48 : dockSize === "max" ? dockMax : Math.min(dockH, dockMax)) : 0;
  const sceneEl = (
    <TerrainScene ds={ds} layer={layer} alpha={0.21} exaggeration={exag} disagreeErrPP={ds.breakeven["Maria Gordon Notch"].model_error.rmse_pp} disagreeRefPP={dref}
      viewShiftPx={panel && desktop && !readView ? Math.round(panelW / 2) + 8 : 0} viewShiftPy={dockShown ? Math.round((dockShown + 16) / 2) : 0}
      lines={welcome || mode === "evidence" ? [] : scene.lines} pins={pins} ring={!welcome && mode === "mission" ? scene.ring : null}
      sky={skyId ? ds.skiesTargets[skyId] : null} showObs={showObs} focus={focus}
      onObsClick={(s) => { setTip(null); if (!welcome && mode === "experiment" && obsPick.current) obsPick.current(s); else setCard(s); }}
      onObsHover={(s, cx, cy) => setTip(s ? { cx, cy, body: <><b>Curiosity stop, sol {s.sol}</b><span className="muted">{s.utc_start?.slice(0, 10)}</span>
        <dl><dt>Measured</dt><dd><M>{s.E_mean?.toFixed(0)} µGy/day</M></dd><dt>Local anomaly</dt><dd><M>{s.anomaly_obs != null ? `${sgn(s.anomaly_obs * 100)} %` : "n/a"}</M></dd>
          <dt>Model</dt><dd><P>{s.anomaly_model != null ? `${sgn(s.anomaly_model * 100)} %` : "n/a"}</P></dd></dl></> } : null)}
      onPinHover={(k, cx, cy) => { const t = k ? byId[k] : null; setTip(t ? { cx, cy, body: <><b>{t.name}</b><span className="muted">{t.objective}</span></> } : null); }}
      onPick={() => setCard(null)} onHover={setHover} />
  );
  const calcText = !eng.ready ? "Preparing the engine…" : calc.running ? "Calculating in your browser…"
    : calc.last ? `Last calculation: ${Math.round(calc.last.ms)} ms in your browser` : "Calculating in your browser";

  return (
    <DockCtx.Provider value={{ head: dockHead, body: dockBody, setTitle: setDockTitle, mobile: !desktop, expand: expandDock }}>
    <div className="app">
      <a className="skip-link" href="#panel">Skip to the panel</a>
      {dockActive && <a className="skip-link" href="#analysis">Skip to the analysis</a>}
      <header className="topbar">
        <button className="wordmark" onClick={() => openRegion("mars")} title="Mars overview"><b>MarsShield</b><span>Cosmic radiation on Mars</span></button>
        {regionPick}
        {!welcome && <button className="btn case-btn" onClick={replayStory}>Case study: Maria Gordon Notch</button>}
        <nav aria-label="Modes" className="modes-nav">
          <Tabs className="modes" label="Experience" manual tabs={[["mission", "Mission"], ["experiment", "Experiment"], ["evidence", "Evidence"]]}
            value={welcome ? null : mode} onChange={(k: Mode) => finishWelcome(k)} />
        </nav>
        <span className="runmode" role="status" title="Routes, trade-offs and experiments are recalculated in this browser. Terrain ray tracing was precomputed by the Python pipeline.">
          <i className={calc.running ? "busy" : ""} />{calcText}</span>
      </header>

      <section className="stage" aria-label="3D terrain of Gale Crater" ref={stageRef}>
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
        {webgl && <LayerControl layer={layer} setLayer={setLayer} showObs={showObs} setShowObs={setShowObs} exag={exag} setExag={setExag} readout={readout}
          top={dockActive && desktop} resetKey={`${welcome}-${mode}-${story?.step ?? ""}`} />}
        <button className="btn ghost panel-toggle" style={{ display: panel ? "none" : undefined }} onClick={() => setPanel(true)}>Show panel</button>
      </section>

      <main id="panel" tabIndex={-1} className={`panel ${panel ? "" : "hidden"}${welcome ? " fit" : ""}${evidence ? " analysis" : ""}${readView ? " reading" : ""}`}
        style={desktop && !readView ? { width: panelW } : undefined}>
        {evidence && desktop && (
          <button className="panel-expand" onClick={() => setReading(!reading)} aria-pressed={reading}
            title={reading ? "Return to the panel beside the terrain" : "Full-width reading view with a section list"}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">{reading
              ? <path d="M9.5 2.5v4h4M6.5 13.5v-4h-4M9.5 6.5 14 2M6.5 9.5 2 14" fill="none" stroke="currentColor" strokeWidth="1.4" />
              : <path d="M10 2.5h3.5V6M6 13.5H2.5V10M13.5 2.5 9 7M2.5 13.5 7 9" fill="none" stroke="currentColor" strokeWidth="1.4" />}</svg>
            {reading ? "Show the terrain" : "Reading view"}</button>)}
        {welcome ? (
          <NotchStory ds={ds} setStoryScene={setStoryScene} onDone={finishWelcome} />
        ) : mode === "mission" ? <MissionMode ds={ds} eng={eng} setScene={setSceneCb} focusOn={focusOn} calc={calc} />
          : mode === "experiment" ? <ExperimentMode ds={ds} setScene={setSceneCb} setLayer={setLayerCb} focusOn={focusOn} initial={initExp} setObsPick={setObsPick} />
          : <EvidenceMode ds={ds} reading={readView} />}
      </main>

      <DockShell title={dockActive ? dockTitle : null} size={dockSize} setSize={setDockSize} height={Math.min(dockH, dockMax)} setHeight={setDockH} maxH={dockMax}
        desktop={desktop} right={panel ? panelW + 32 : 16} setHead={setDockHead} setBody={setDockBody} />
    </div>
    </DockCtx.Provider>
  );
}
