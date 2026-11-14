"use client";
import { Component, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import TerrainScene, { type Layer } from "./TerrainScene";
import { SkyDisc, ZenithBars } from "./SkyDisc";
import { HorizonCompare, PairDotPlot, RouteProfiles, ScatterXY, SensitivityBars } from "./Charts";
import { BreakEvenPanel, Kind, type BEScenario } from "./BreakEven";
import { MissionPanel } from "./Mission";
import type { BreakEven, Dataset, Mission, Plan, Sky, Stop } from "@/lib/data";
import { BASE, fmt, loadDataset, OPTION_COLORS, relTotal, ROUTE_COLORS, ROUTE_DASH, ROUTE_ORDER, sampleGrid } from "@/lib/data";
import { apiHealth, fetchBreakEven, fetchMission, fetchRoutes, fetchSky, STATIC_DEMO } from "@/lib/api";

type Tab = "mission" | "explore" | "plan" | "breakeven" | "evidence" | "report";
type Pick = "start" | "end" | "stop" | "target" | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteEval = any;

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function NoWebGL({ ds }: { ds: Dataset }) {
  return (
    <div className="nowebgl">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
      {ds.ortho && <img src={`${BASE}/data/ortho.jpg`} alt="Orbital image of the study area in Gale Crater (USGS HiRISE-based orthophoto)" />}
      <div className="dock">
        <b>The 3D terrain needs WebGL, which this browser or device has turned off.</b>
        <p className="muted">Every analysis in the side panel still works. The image shows the same 3.5 × 3 km of Gale Crater from orbit (USGS orthophoto built from HiRISE).
          To see the 3D view, enable hardware acceleration or open MarsShield in a current desktop browser.</p>
      </div>
    </div>
  );
}

function ObsCard({ s, onClose }: { s: Stop; onClose: () => void }) {
  return (
    <div className="dock obs-card" role="dialog" aria-label={`Curiosity RAD observation at sol ${s.sol}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>Curiosity stop, sol {s.sol}</b>
        <button className="linklike" onClick={onClose} aria-label="Close">Close</button>
      </div>
      <div style={{ marginTop: 4 }}><Kind k="measured" /></div>
      <dl>
        <dt>Dates (UTC)</dt><dd>{s.utc_start?.slice(0, 10)} to {s.utc_end?.slice(0, 10)}</dd>
        <dt>RAD E dose rate</dt><dd>{s.E_mean?.toFixed(1)} ± {(s.E_sem ?? 0).toFixed(1)} µGy/day</dd>
        <dt>Observations</dt><dd>{s.n_obs} over {(s.data_sols ?? 0).toFixed(1)} sols</dd>
        <dt>Local anomaly</dt><dd>{s.anomaly_obs != null ? fmt.pct(s.anomaly_obs * 100) : "n/a"}</dd>
      </dl>
      <div style={{ marginTop: 6 }}><Kind k="modeled" /></div>
      <dl>
        <dt>Modeled anomaly</dt><dd>{s.anomaly_model != null ? fmt.pct(s.anomaly_model * 100) : "n/a"}</dd>
        <dt>Sky blocked</dt><dd>{fmt.pctAbs(s.B)}</dd>
      </dl>
      <p className="muted small">Local anomaly: this stop&apos;s mean against the median of all other RAD data within ±15 sols, which removes the solar-cycle trend. NASA RAD Level 2, detector E, flagged records removed.</p>
    </div>
  );
}

function Intro({ ds, onStart, onClose }: { ds: Dataset; onStart: () => void; onClose: () => void }) {
  const m = ds.mission, R1 = ds.validation && ds.breakeven;
  const notch = ds.breakeven["Maria Gordon Notch"]?.breaks.find((b) => b.less_walking === "A" && b.more_sheltered === "C");
  void R1;
  return (
    <div className="intro" role="dialog" aria-labelledby="intro-title">
      <h2 id="intro-title">On a Marswalk, where you stop matters more than how you walk.</h2>
      <ul>
        <li><Kind k="measured" /> Next to cliffs and buttes in Gale Crater, NASA&apos;s Curiosity rover measured cosmic-ray dose rates up to 19.4 % lower than nearby.</li>
        <li><Kind k="modeled" /> Rerouting a walk to hug that shelter almost never pays: the extra walking time costs more dose than the shade saves.</li>
        <li><Kind k="modeled" /> Where an astronaut stands while working can matter{notch ? `: within 150 m of Maria Gordon Notch, the most sheltered spot repays its extra walk after about ${Math.round(notch.t_h * 60)} minutes of work` : ""}. Elsewhere, such as Mt Mercou, the differences are smaller than the model&apos;s error, and MarsShield says so.</li>
      </ul>
      <p className="muted">Real terrain from NASA&apos;s Mars Reconnaissance Orbiter (USGS 1 m elevation model) and real radiation data from Curiosity. A {fmt.m(m.totals.distance_m)} science Marswalk is ready to explore.</p>
      <div className="row">
        <button className="btn primary" onClick={onStart}>Start the science Marswalk</button>
        <button className="btn" onClick={onClose}>Explore on my own</button>
      </div>
    </div>
  );
}

export default function MarsShield() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [routeEval, setRouteEval] = useState<RouteEval>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("mission");
  const [layer, setLayer] = useState<Layer>("dose");
  const [alpha, setAlpha] = useState(0.21);
  const [phi, setPhi] = useState(500);
  const [exag, setExag] = useState(1);
  const [showObs, setShowObs] = useState(true);
  const [online, setOnline] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [intro, setIntro] = useState(true);
  const [obs, setObs] = useState<Stop | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  const [skyBusy, setSkyBusy] = useState(false);
  const [skyErr, setSkyErr] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selRoute, setSelRoute] = useState<string | null>("low_dose");
  const [pick, setPick] = useState<Pick>(null);
  const [start, setStart] = useState<[number, number] | undefined>();
  const [end, setEnd] = useState<[number, number] | undefined>();
  const [stops, setStops] = useState<[number, number][]>([]);
  const [dwell, setDwell] = useState(2);
  const [planBusy, setPlanBusy] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [missionSel, setMissionSel] = useState<string[]>([]);
  const [missionBusy, setMissionBusy] = useState(false);
  const [missionErr, setMissionErr] = useState<string | null>(null);
  const [beScenario, setBeScenario] = useState("");
  const [beCustom, setBeCustom] = useState<BreakEven | null>(null);
  const [beDwell, setBeDwell] = useState(1);
  const [beRadius, setBeRadius] = useState(150);
  const [beTarget, setBeTarget] = useState<[number, number] | null>(null);
  const [beBusy, setBeBusy] = useState(false);
  const [beErr, setBeErr] = useState<string | null>(null);

  useEffect(() => {
    setWebgl(hasWebGL());
    try { if (window.localStorage.getItem("marsshield-intro") === "seen") setIntro(false); } catch { /* storage unavailable */ }
    loadDataset()
      .then((d) => {
        setDs(d);
        setSky(d.skies["Maria Gordon Notch"]);
        const s = d.scenario.multi;
        setPlan(s); setStart(s.start); setEnd(s.end); setStops(s.stops); setDwell(typeof s.dwell_h === "number" ? s.dwell_h : 2);
        setMission(d.mission); setMissionSel(d.mission.ids);
        setBeScenario(d.mission.stops[0] ? `mission:${d.mission.stops[0].target}` : "legacy:Maria Gordon Notch");
      })
      .catch((e) => setErr(String(e.message ?? e)));
    fetch(`${BASE}/data/route_eval.json`).then((r) => r.json()).then(setRouteEval).catch(() => undefined);
    apiHealth().then(setOnline);
  }, []);

  const closeIntro = useCallback(() => {
    setIntro(false);
    try { window.localStorage.setItem("marsshield-intro", "seen"); } catch { /* storage unavailable */ }
  }, []);

  const scenarios: BEScenario[] = useMemo(() => {
    if (!ds) return [];
    const byId = Object.fromEntries(ds.scienceTargets.map((t) => [t.id, t]));
    const m = mission ?? ds.mission;
    const ms = m.stops.map((s) => ({ id: `mission:${s.target}`, label: `Marswalk stop: ${byId[s.target]?.name ?? s.target}`, be: s.breakeven, target: s.target }));
    const legacy = Object.entries(ds.breakeven).map(([name, b]) => ({ id: `legacy:${name}`, label: `${name}, 150 m radius`, be: b }));
    return [...ms, ...legacy];
  }, [ds, mission]);

  const analysePoint = useCallback(async (x: number, y: number) => {
    if (!ds || !online) return;
    setSkyBusy(true); setSkyErr(null);
    try { setSky(await fetchSky(x, y, ds.meta.h_obs, phi, alpha)); } catch (e) { setSkyErr(e instanceof Error ? e.message : String(e)); }
    setSkyBusy(false);
  }, [ds, online, phi, alpha]);

  const currentScenario = scenarios.find((s) => s.id === beScenario) ?? scenarios[0];

  const runBreakEven = useCallback(async (target: [number, number], radius: number) => {
    if (!currentScenario) return;
    const b = currentScenario.be;
    setBeBusy(true); setBeErr(null);
    try {
      setBeCustom(await fetchBreakEven({ start: b.start, end: b.end, target, radius_m: radius, phi, alpha, duration_h: b.recommendation?.duration_h ?? null }));
    } catch (e) {
      setBeErr(e instanceof Error ? e.message : String(e));
    }
    setBeBusy(false);
  }, [currentScenario, phi, alpha]);

  const onPick = useCallback((x: number, y: number) => {
    setObs(null);
    if (pick === "target") { setBeTarget([x, y]); setPick(null); runBreakEven([x, y], beRadius); return; }
    if (pick === "start") { setStart([x, y]); setPick(null); return; }
    if (pick === "end") { setEnd([x, y]); setPick(null); return; }
    if (pick === "stop") { setStops((s) => [...s, [x, y]]); setPick(null); return; }
    if (tab === "explore") analysePoint(x, y);
  }, [pick, analysePoint, runBreakEven, beRadius, tab]);

  const computePlan = useCallback(async () => {
    if (!start || !end) return;
    setPlanBusy(true); setPlanErr(null);
    try {
      const p = await fetchRoutes({ start, end, stops, dwell_h: dwell, phi, alpha });
      setPlan(p); setSelRoute("low_dose");
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : String(e));
    }
    setPlanBusy(false);
  }, [start, end, stops, dwell, phi, alpha]);

  const planMission = useCallback(async () => {
    if (!ds) return;
    const order = ds.scienceTargets.map((t) => t.id).filter((id) => missionSel.includes(id));
    setMissionBusy(true); setMissionErr(null);
    try {
      const m = await fetchMission({ ids: order, phi, alpha });
      setMission(m);
      if (m.stops[0]) { setBeCustom(null); setBeScenario(`mission:${m.stops[0].target}`); }
    } catch (e) {
      setMissionErr(e instanceof Error ? e.message : String(e));
    }
    setMissionBusy(false);
  }, [ds, missionSel, phi, alpha]);

  const hoverInfo = useMemo(() => {
    if (!ds || !hover) return null;
    const z = sampleGrid(ds.meta, ds.grids.height, hover.x, hover.y);
    if (!Number.isFinite(z)) return null;
    const rs = sampleGrid(ds.meta, ds.grids.relSky, hover.x, hover.y);
    const B = sampleGrid(ds.meta, ds.grids.B, hover.x, hover.y);
    const sl = sampleGrid(ds.meta, ds.grids.slope, hover.x, hover.y);
    return { z, B, slope: sl, rel: relTotal(rs, B, alpha), relSky: rs };
  }, [ds, hover, alpha]);

  if (err) return <div className="loading">{err}</div>;
  if (!ds || !mission || !currentScenario) return <div className="loading">Loading Gale Crater terrain…</div>;

  const be = beCustom ?? currentScenario.be;
  const beOn = tab === "breakeven";
  const missionOn = tab === "mission";
  const bePref = be.options.reduce((a, o) => (o.walk_dose_uGy + beDwell * o.stop_rate_uGy_h < a.walk_dose_uGy + beDwell * a.stop_rate_uGy_h ? o : a));
  const byId = Object.fromEntries(ds.scienceTargets.map((t) => [t.id, t]));
  const missionRoute = mission.plan.routes.find((r) => r.objective === "low_dose");
  const nearbyPeriods = ds.periods.filter((q) => Math.hypot(q.x - be.target[0], q.y - be.target[1]) <= 60);

  const scene = (
    <TerrainScene ds={ds} layer={layer} alpha={alpha} exaggeration={exag} plan={beOn || missionOn ? null : plan} selectedRoute={selRoute}
      sky={tab === "explore" ? sky : null}
      markers={beOn ? { start: be.start, end: be.end, stops: [] } : missionOn ? { stops: [] } : { start, end, stops }} showObs={showObs}
      extraRoutes={beOn ? be.options.map((o) => ({ key: o.keys[0], xy: o.xy, color: OPTION_COLORS[o.keys[0]], width: o === bePref ? 5 : 2 }))
        : missionOn && missionRoute ? [{ key: "mission", xy: missionRoute.xy, color: "#3987e5", width: 4 }] : undefined}
      extraPins={beOn ? [...be.options.map((o) => ({ key: o.keys[0], x: o.x, y: o.y, color: OPTION_COLORS[o.keys[0]], label: o.keys.join("=") })),
        { key: "tgt", x: be.target[0], y: be.target[1], color: "#e5a53a", label: "" }]
        : missionOn ? mission.stops.filter((s) => s.decision.status === "recommended").map((s) => ({ key: s.target, x: s.used_xy[0], y: s.used_xy[1], color: "#199e70", label: "Work here" })) : undefined}
      sitePins={missionOn ? mission.ids.map((id, i) => ({ key: id, x: byId[id].x, y: byId[id].y, label: `${i + 1}. ${byId[id].name.split(",")[0]}` })) : undefined}
      ring={beOn ? { x: be.target[0], y: be.target[1], r: be.radius_m } : null}
      onObsClick={(s) => setObs(s)}
      onPick={onPick} onHover={setHover} focus={focus} />
  );

  return (
    <div className={`shell ${tab === "evidence" || tab === "report" ? "wide" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <h1>MarsShield</h1>
          <span>Gale Crater, Glen Torridon to Paraitepuy</span>
        </div>
        <nav className="tabs" role="tablist" aria-label="Views">
          {([["mission", "Science Marswalk"], ["explore", "Explore the sky"], ["plan", "Routes"], ["breakeven", "Break-even"], ["evidence", "Evidence"], ["report", "Findings"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => { setTab(k); setObs(null); }}>{l}</button>
          ))}
        </nav>
        <div className={`api ${online ? "on" : ""}`}
          title={online ? "The MarsShield science service is running: custom routes and analyses are live" : "Precomputed results: custom routes and analyses need the science service"}>
          <i />{online ? "Live model" : STATIC_DEMO ? "Public demo, precomputed" : "Precomputed"}
        </div>
      </header>

      <div className="main">
        <section className="stage" aria-label="3D terrain">
          {webgl ? <SceneBoundary fallback={<NoWebGL ds={ds} />}>{scene}</SceneBoundary> : <NoWebGL ds={ds} />}
          {intro && <Intro ds={ds} onStart={() => { closeIntro(); setTab("mission"); }} onClose={closeIntro} />}
          {pick && <div className="pick-banner">Click the terrain to place the {pick === "stop" ? "science stop" : pick === "target" ? "science target" : pick === "start" ? "start" : "destination"}</div>}
          {obs && <ObsCard s={obs} onClose={() => setObs(null)} />}
          {hoverInfo && !obs && webgl && (
            <div className="dock hover-card" aria-live="polite">
              <dl>
                <dt>Elevation</dt><dd>{hoverInfo.z.toFixed(0)} m</dd>
                <dt>Slope</dt><dd>{hoverInfo.slope.toFixed(0)}°{hoverInfo.slope > 25 ? " (too steep)" : ""}</dd>
                <dt>Sky blocked</dt><dd>{fmt.pctAbs(hoverInfo.B)}</dd>
                <dt>Modeled dose rate</dt><dd>×{hoverInfo.rel.toFixed(3)}</dd>
              </dl>
              <div className="muted small" style={{ marginTop: 4 }}>Model, relative to open flat ground</div>
            </div>
          )}
          {webgl && (
            <div className="legend-dock">
              <div className="dock">
                <div className="layers" role="group" aria-label="Map layer">
                  {([["dose", "Modeled dose rate"], ["sky", "Sky blocked"], ["slope", "Slope"], ["image", "Orbital image"], ["terrain", "Relief"]] as [Layer, string][])
                    .filter(([k]) => k !== "image" || ds.ortho).map(([k, l]) => (
                      <button key={k} className="chip" aria-pressed={layer === k} onClick={() => setLayer(k)}>{l}</button>
                    ))}
                </div>
                <LayerKey layer={layer} />
                <div className="row" style={{ marginTop: 8, gap: 14 }}>
                  <label className="key-row"><input type="checkbox" checked={showObs} onChange={(e) => setShowObs(e.target.checked)} />
                    <span className="key-obs" />Curiosity RAD stops (click one)</label>
                  <label className="key-row"><input type="checkbox" checked={exag === 2} onChange={(e) => setExag(e.target.checked ? 2 : 1)} />Relief ×2</label>
                </div>
                {showObs && (
                  <div className="obs-key">
                    <span className="ramp-labels"><span>Measured local anomaly</span></span>
                    <div className="ramp" style={{ background: "linear-gradient(90deg, #3987e5, #8b8678, #d95926)" }} />
                    <div className="ramp-labels"><span>−8 % lower dose</span><span>0</span><span>+8 % higher</span></div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="aside">
          <div className="aside-inner">
            {tab === "mission" && (
              <MissionPanel ds={ds} mission={mission} selected={missionSel}
                toggle={(id) => setMissionSel((s) => (s.includes(id) ? s.filter((q) => q !== id) : [...s, id]))}
                reset={() => { setMission(ds.mission); setMissionSel(ds.mission.ids); setMissionErr(null); }}
                plan={planMission} busy={missionBusy} err={missionErr} online={online} staticDemo={STATIC_DEMO}
                openBreakEven={(id) => { setBeCustom(null); setBeScenario(`mission:${id}`); setBeDwell(mission.durations_h[id] ?? 1); setTab("breakeven"); setFocus([byId[id].x, byId[id].y]); }}
                focusOn={(x, y) => setFocus([x, y])} />
            )}
            {tab === "explore" && (
              <ExplorePanel ds={ds} sky={sky} busy={skyBusy} online={online} err={skyErr}
                onSite={(name) => { const t = ds.targets.find((q) => q.name === name)!; setSky(ds.skies[name]); setFocus([t.x, t.y]); if (online) analysePoint(t.x, t.y); }} />
            )}
            {tab === "plan" && (
              <PlanPanel plan={plan} sel={selRoute} setSel={setSelRoute} pick={pick} setPick={setPick} start={start} end={end}
                stops={stops} clearStops={() => setStops([])} dwell={dwell} setDwell={setDwell} phi={phi} setPhi={setPhi}
                alpha={alpha} setAlpha={setAlpha} online={online} busy={planBusy} err={planErr} compute={computePlan}
                reset={() => { const s = ds.scenario.multi; setPlan(s); setStart(s.start); setEnd(s.end); setStops(s.stops); setDwell(typeof s.dwell_h === "number" ? s.dwell_h : 2); }} />
            )}
            {tab === "breakeven" && (
              <BreakEvenPanel be={be} scenarios={scenarios} scenarioId={currentScenario.id} custom={!!beCustom}
                setScenario={(id) => { setBeCustom(null); setBeScenario(id); const s = scenarios.find((q) => q.id === id); if (s) { setFocus([s.be.target[0], s.be.target[1]]); if (s.be.recommendation) setBeDwell(s.be.recommendation.duration_h[1]); } }}
                dwell={beDwell} setDwell={setBeDwell} online={online} busy={beBusy} err={beErr}
                pickTarget={() => setPick("target")} picking={pick === "target"} radius={beRadius} setRadius={setBeRadius}
                recompute={() => runBreakEven(beTarget ?? be.target, beRadius)} nearbyPeriods={nearbyPeriods} staticDemo={STATIC_DEMO} />
            )}
            {tab === "evidence" && <EvidencePanel ds={ds} routeEval={routeEval} />}
            {tab === "report" && <ReportPanel ds={ds} plan={plan} routeEval={routeEval} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function LayerKey({ layer }: { layer: Layer }) {
  if (layer === "dose")
    return (<>
      <div className="ramp" style={{ background: "linear-gradient(90deg, rgb(199,219,235), rgb(23,77,148))" }} />
      <div className="ramp-labels"><span>×0.97 open</span><span>×0.90</span><span>×0.80 sheltered</span></div>
      <div className="key-row" style={{ marginTop: 6 }}><span className="key-model" />Model: GCR absorbed dose relative to open flat ground</div>
    </>);
  if (layer === "sky")
    return (<>
      <div className="ramp" style={{ background: "linear-gradient(90deg, rgb(217,217,217), rgb(38,56,115))" }} />
      <div className="ramp-labels"><span>0 %</span><span>25 %</span><span>50 % of sky blocked</span></div>
    </>);
  if (layer === "slope")
    return <div className="ramp-labels" style={{ marginTop: 8 }}><span>Amber: 15–25°</span><span>Hatched red: over 25°, impassable</span></div>;
  if (layer === "image")
    return <div className="ramp-labels" style={{ marginTop: 8 }}><span>USGS Gale orthophoto (MRO HiRISE), 25 cm averaged to 1 m</span></div>;
  return <div className="ramp-labels" style={{ marginTop: 8 }}><span>USGS 1 m elevation model hillshade, elevation tint</span></div>;
}

// ---------------------------------------------------------------------------------------
function ExplorePanel({ ds, sky, busy, online, err, onSite }: { ds: Dataset; sky: Sky | null; busy: boolean; online: boolean; err: string | null; onSite: (n: string) => void }) {
  return (
    <>
      <div className="section">
        <p className="lede">
          On Mars, the ground itself is a radiation shield. A cliff or canyon wall blocks part of the sky, but it also
          sends back secondary radiation of its own. Click anywhere on the terrain to see the sky from that spot.
        </p>
      </div>
      {sky && (
        <div className="section">
          <h2>{busy ? "Tracing the horizon…" : `Sky from ${nearestName(ds, sky)}`}</h2>
          <SkyDisc sky={sky} />
          <div className="facts" style={{ marginTop: 10 }}>
            <div className="fact"><b>{fmt.pctAbs(sky.B)}</b><span>of the sky blocked by terrain</span></div>
            <div className="fact"><b>{fmt.pct((sky.dose.rel_sky - 1) * 100)}</b><span>dose from the sky</span></div>
            <div className="fact"><b>{fmt.pct((sky.dose.rel_total - 1) * 100)}</b><span>total, with terrain albedo</span></div>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Compared with open flat ground. The total falls less than the sky dose because the blocking terrain adds
            albedo radiation (Guo et al. 2026). Modeled at {sky.h_obs} m height, φ = {sky.phi} MV, albedo {Math.round(sky.alpha * 100)} % of flat-ground dose.
          </p>
          <h3>Where the dose comes from</h3>
          <ZenithBars sky={sky} />
          {err && <p className="err">{err}</p>}
          {!online && <p className="note">Precomputed results: the five sites below can be analysed. Analysing any clicked point needs the MarsShield science service, which you can run locally (see the README).</p>}
        </div>
      )}
      <div className="section">
        <h2>Where Curiosity measured terrain shielding</h2>
        <div className="sitelist">
          {ds.targets.map((t) => {
            const ps = ds.periods.filter((p) => p.site === t.name && p.kind === "parking");
            const best = ps.reduce((a, p) => Math.max(a, p.pub.decrease ?? 0), 0);
            return (
              <button key={t.name} className="site" onClick={() => onSite(t.name)}>
                <b>{t.name}</b>
                <em>{best ? `${fmt.pct(-best * 100)} measured` : ""}</em>
                <span>{t.description}</span>
              </button>
            );
          })}
        </div>
        <p className="muted">Measured: drop in RAD detector-E dose rate while parked, versus nearby background periods (NASA RAD Level 2 data; Guo et al. 2026).</p>
      </div>
    </>
  );
}

function nearestName(ds: Dataset, sky: Sky) {
  let best = "the selected point", d = 60;
  for (const t of ds.targets) {
    const dd = Math.hypot(t.x - sky.x, t.y - sky.y);
    if (dd < d) { d = dd; best = t.name; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------
function PlanPanel(p: {
  plan: Plan | null; sel: string | null; setSel: (s: string) => void; pick: Pick; setPick: (p: Pick) => void;
  start?: [number, number]; end?: [number, number]; stops: [number, number][]; clearStops: () => void;
  dwell: number; setDwell: (v: number) => void; phi: number; setPhi: (v: number) => void; alpha: number; setAlpha: (v: number) => void;
  online: boolean; busy: boolean; err: string | null; compute: () => void; reset: () => void;
}) {
  const routes = p.plan ? ROUTE_ORDER.map((k) => p.plan!.routes.find((r) => r.objective === k)!).filter(Boolean) : [];
  const sel = routes.find((r) => r.objective === p.sel);
  return (
    <>
      <div className="section">
        <h2>Plan a Marswalk</h2>
        <p className="prose">Set a start, a destination and optional science stops, then compare five route strategies across distance, slope, walking time and modeled dose.</p>
        <div className="row">
          <button className="btn" aria-pressed={p.pick === "start"} onClick={() => p.setPick("start")}>Place start</button>
          <button className="btn" onClick={() => p.setPick("end")}>Place destination</button>
          <button className="btn" onClick={() => p.setPick("stop")}>Add science stop</button>
          {p.stops.length > 0 && <button className="btn" onClick={p.clearStops}>Remove stops</button>}
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label className="slider">Time at each science stop<output>{p.dwell.toFixed(1)} h</output>
            <input type="range" min={0} max={6} step={0.5} value={p.dwell} onChange={(e) => p.setDwell(+e.target.value)} /></label>
          <label className="slider">Solar modulation φ (higher = solar maximum, fewer cosmic rays)<output>{p.phi} MV</output>
            <input type="range" min={400} max={800} step={10} value={p.phi} onChange={(e) => p.setPhi(+e.target.value)} /></label>
          <label className="slider">Flat-ground albedo share of total dose (Guo et al. 2026: 18–24 %)<output>{Math.round(p.alpha * 100)} %</output>
            <input type="range" min={0.18} max={0.24} step={0.01} value={p.alpha} onChange={(e) => p.setAlpha(+e.target.value)} /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!p.online || p.busy || !p.start || !p.end} onClick={p.compute}>{p.busy ? "Computing routes…" : "Compute routes"}</button>
          <button className="btn" onClick={p.reset}>Show example walk</button>
        </div>
        {!p.online && <p className="note" style={{ marginTop: 8 }}>Precomputed results: Tower Buttes to Paraitepuy with stops at Mt Mercou and Maria Gordon Notch. Computing new routes needs the MarsShield science service, which you can run locally (see the README).</p>}
        {p.err && <p className="err">{p.err}</p>}
      </div>
      {p.plan && (
        <div className="section">
          <h2>Route comparison</h2>
          <table className="routes">
            <thead><tr><th>Strategy</th><th>Distance</th><th>Walk time</th><th>Max slope</th><th>Dose</th><th>Δ dose</th></tr></thead>
            <tbody>
              {routes.map((r) => r.feasible ? (
                <tr key={r.objective} aria-selected={p.sel === r.objective} onClick={() => p.setSel(r.objective)} tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && p.setSel(r.objective)}>
                  <td><span className="swatch" style={{ borderColor: ROUTE_COLORS[r.objective], borderTopStyle: ROUTE_DASH[r.objective] ? "dashed" : "solid" }} />{r.label}</td>
                  <td>{fmt.m(r.distance_m)}</td>
                  <td>{fmt.h(r.time_h)}</td>
                  <td>{r.max_slope_deg.toFixed(0)}°</td>
                  <td>{r.total_dose_uGy.toFixed(1)}</td>
                  <td className={r.vs_baseline && r.vs_baseline.dose_pct < -0.05 ? "delta-good" : r.vs_baseline && r.vs_baseline.dose_pct > 0.05 ? "delta-bad" : ""}>
                    {r.objective === "shortest" ? "baseline" : fmt.pct(r.vs_baseline?.dose_pct ?? 0)}
                  </td>
                </tr>
              ) : (
                <tr key={r.objective}><td>{r.label}</td><td colSpan={5} className="muted">No passable route under the {p.plan!.assumptions.max_slope_deg}° slope limit</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Dose: modeled RAD-E-equivalent absorbed dose in µGy (Δ: change against the shortest route) for walking plus {p.plan.dwell_h} h at each stop. Open flat ground: {p.plan.D_flat_uGy_d.toFixed(0)} µGy/day at φ = {p.plan.phi} MV. Not an effective (medical) dose.</p>
          {sel && sel.feasible && (
            <>
              <h3>{sel.label}</h3>
              <div className="facts">
                <div className="fact"><b>{fmt.uGy(sel.dose_uGy)}</b><span>while walking</span></div>
                <div className="fact"><b>{fmt.uGy(sel.dwell_dose_uGy)}</b><span>at science stops</span></div>
                <div className="fact"><b>{fmt.pctAbs(sel.frac_time_shielded, 0)}</b><span>of walk time in terrain shade (rate below ×0.93)</span></div>
              </div>
              <p className="muted">Uncertainty: {sel.dose_band_alpha_uGy[0].toFixed(1)}–{sel.dose_band_alpha_uGy[1].toFixed(1)} µGy across the 18–24 % albedo range; {sel.dose_band_phi_uGy[0].toFixed(1)}–{sel.dose_band_phi_uGy[1].toFixed(1)} µGy across solar modulation 400–800 MV.
                Ascent {sel.ascent_m.toFixed(0)} m, descent {sel.descent_m.toFixed(0)} m, mean slope {sel.mean_slope_deg.toFixed(1)}°.</p>
              <RouteProfiles routes={routes} selected={p.sel} />
            </>
          )}
          <p className="muted">Walking speed follows Tobler&apos;s hiking function scaled by {p.plan.assumptions.suit_factor} for a pressurised suit (an Earth-derived assumption), with a {p.plan.assumptions.max_slope_deg}° slope limit on a {p.plan.assumptions.grid_m} m grid.</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------
function EvidencePanel({ ds, routeEval }: { ds: Dataset; routeEval: RouteEval }) {
  const v = ds.validation;
  const periods = Object.entries(v.periods) as [string, { site: string; B_model: number; ROS_pub: number; D_sky_model: number; D_sky_pub: number; D_RAD_pub: number; rad: { E_mean: number; E_sem: number; n: number; utc_start: string; utc_end: string } }][];
  const st = ds.observations.anomaly_stats;
  const s = v.sensitivity;
  const obsPts = ds.observations.stops.filter((q) => q.anomaly_obs != null && q.anomaly_model != null && (q.data_sols ?? 0) >= 1)
    .map((q) => ({ x: (q.anomaly_model as number) * 100, y: (q.anomaly_obs as number) * 100, label: `Sol ${q.sol} (${q.rmc})` }));
  const ex = v.pair_error_summary_excl_P6_P8;
  const au = ds.audit;
  const A8 = au.A3_eight_pairs["P6_19.4pct_table1"], A17 = au.A3_eight_pairs["P6_17pct_section4"];
  return (
    <>
      <div className="section">
        <h2>What is measured, and what is modeled</h2>
        <div className="prose">
          <p><strong>Measured:</strong> Curiosity&apos;s RAD detector-E dose rate (tissue-equivalent plastic, µGy/day) from NASA&apos;s Level 2 archive, with quality-flagged records removed; rover positions from NASA/JPL localisations; terrain from the USGS 1 m Gale DEM.</p>
          <p><strong>Modeled:</strong> sky blocking from our ray tracing, and dose from the published zenith-angle model of Guo et al. (2021, 2026): downward GCR dose from every unblocked direction, plus terrain albedo proportional to blocked solid angle. Absorbed dose is not effective (medical) dose, and solar particle events are out of scope.</p>
        </div>
      </div>

      <div className="section">
        <h2>Does the model predict the dose drops Curiosity saw? <Kind k="measured" /><Kind k="modeled" /></h2>
        <p className="prose">All eight parking periods (P1–P8, at five locations), each compared with a nearby background period. The albedo share (19 %) comes from an earlier Murray Buttes study (Guo et al. 2021), not fitted to these periods.</p>
        <PairDotPlot pairs={v.pairs} />
        <table className="data" style={{ marginTop: 8 }}>
          <thead><tr><th>Model, all 8 periods</th><th>MAE</th><th>RMSE</th><th>Bias</th><th>Worst</th><th>Best on</th></tr></thead>
          <tbody>{(["pred_albedo_019", "pred_sky_only", "pred_proportional"] as const).map((k) => {
            const r = A8[k];
            return <tr key={k}><td>{r.name}</td><td>{r.mae_pp.toFixed(2)} pp</td><td>{r.rmse_pp.toFixed(2)} pp</td><td>{r.bias_pp >= 0 ? "+" : "−"}{Math.abs(r.bias_pp).toFixed(2)} pp</td><td>{r.max_abs_pp.toFixed(1)} pp</td><td>{au.A3_eight_pairs.best_model_count[k]} of 8</td></tr>;
          })}</tbody>
        </table>
        <p className="prose" style={{ marginTop: 8 }}>
          <strong>Reading this honestly:</strong> on all eight periods the sky + albedo model has the lowest mean absolute error but not the lowest RMSE,
          so with n = 8 it is not demonstrably better than simply scaling dose by unblocked sky. Its two large misses are P8 (our DEM horizon does not
          reproduce the published geometry) and P6 (the albedo assumption fails in the self-shielded notch, as Guo et al. note).
          Leaving those two out gives MAE {ex.pred_albedo_019.mae_pp.toFixed(1)} pp (sky only {ex.pred_sky_only.mae_pp.toFixed(1)}, proportional {ex.pred_proportional.mae_pp.toFixed(1)}), shown only as a secondary figure.
        </p>
        <details>
          <summary>Error for each period (model minus measured, percentage points)</summary>
          <table className="data">
            <thead><tr><th>Period</th><th>Measured</th><th>Albedo model</th><th>Sky only</th><th>Proportional</th></tr></thead>
            <tbody>{v.pairs.map((q: { pair: string; site: string; measured_ours: number }) => (
              <tr key={q.pair}><td>{q.pair} {q.site}</td><td>{fmt.pct(q.measured_ours * 100)}</td>
                {(["pred_albedo_019", "pred_sky_only", "pred_proportional"] as const).map((k) => <td key={k}>{A8[k].per_pair_pp[q.pair].toFixed(1)}</td>)}</tr>
            ))}</tbody>
          </table>
        </details>
        <p className="note" style={{ marginTop: 8 }}>
          Geometry not reproduced at two periods: at P8 (Paraitepuy) our DEM horizon blocks {fmt.pctAbs(v.v4.outliers.P8.B_model)} of the sky against the published {fmt.pctAbs(v.v4.outliers.P8.ROS_pub)}; at P6 (Maria Gordon Notch) {fmt.pctAbs(v.v4.outliers.P6.B_model)} against {fmt.pctAbs(v.v4.outliers.P6.ROS_pub)}.
          In these narrow canyons a 3 m position error moves blocked sky by ±{(s.S4_position.sigma_3m.P6.std * 100).toFixed(1)} pp (P6) and ±{(s.S4_position.sigma_3m.P8.std * 100).toFixed(1)} pp (P8). We did not adjust rover positions to fit.
        </p>
      </div>

      <div className="section">
        <h2>Audit against Guo et al. (2026)</h2>
        <ul className="assumptions">
          <li>Table 1 transcription: {au.A1_table1_transcription.cells_checked} numeric cells in {au.A1_table1_transcription.rows_checked} rows checked against the paper text, {au.A1_table1_transcription.mismatches} mismatches.</li>
          <li>
            Maria Gordon Notch (P6 vs BG6): the paper gives two different observed drops. Table 1, Section 3.4 and the abstract give {fmt.pctAbs(au.A2_maria_gordon_notch.table1_decrease)} (229.8 vs 285.1 µGy/d);
            Section 4 says &ldquo;the observed dose drop is 17%&rdquo;. Our reduction of the NASA RAD L2 data gives {fmt.pctAbs(au.A2_maria_gordon_notch.ours_nasa_l2.decrease)} ({au.A2_maria_gordon_notch.ours_nasa_l2.P6.toFixed(1)} vs {au.A2_maria_gordon_notch.ours_nasa_l2.BG6.toFixed(1)} µGy/d), matching the table, so we use 19.4 %.
          </li>
          <li>
            If the 17 % figure is used instead, the eight-period errors become: albedo model MAE {A17.pred_albedo_019.mae_pp.toFixed(2)} / RMSE {A17.pred_albedo_019.rmse_pp.toFixed(2)} pp,
            sky only {A17.pred_sky_only.mae_pp.toFixed(2)} / {A17.pred_sky_only.rmse_pp.toFixed(2)}, proportional {A17.pred_proportional.mae_pp.toFixed(2)} / {A17.pred_proportional.rmse_pp.toFixed(2)}. Either way the P6 drop is larger than our model predicts ({fmt.pct(-au.A2_maria_gordon_notch.model_prediction.sky_albedo * 100)}).
          </li>
        </ul>
      </div>

      <div className="section">
        <h2>Sky blocking: our DEM ray tracing against published values <Kind k="modeled" /></h2>
        <ScatterXY lo={0} hi={0.4} xLabel="Published blocked sky (Guo et al. 2026)" yLabel="MarsShield blocked sky"
          pts={periods.map(([k, r]) => ({ x: r.ROS_pub, y: r.B_model, label: `${k} ${r.site}` }))} />
        <p className="muted">15 periods. Mean difference {(v.v4.B_minus_ROSpub_mean * 100).toFixed(1)} pp, mean absolute {(v.v4.B_minus_ROSpub_mae * 100).toFixed(1)} pp. Modeled sky dose matches the published values within {(v.v4.Dsky_rel_err_mae_excl_P6P8 * 100).toFixed(1)} % on average outside P6 and P8.</p>
        <h3>Butte M12 horizon, sol 1455</h3>
        <HorizonCompare az={v.v3_m12_mask.az} a={v.v3_m12_mask.elev_mask} b={v.v3_m12_mask.elev_dem} />
        <p className="muted">RMSE {v.v3_m12_mask.rmse_deg.toFixed(2)}°, bias {v.v3_m12_mask.bias_deg.toFixed(2)}°. Blocked solid angle {fmt.pctAbs(v.v3_m12_mask.B_dem)} (ours) against {fmt.pctAbs(v.v3_m12_mask.B_mask)} (mask); Ehresmann et al. (2021) report 19 %.</p>
      </div>

      <div className="section">
        <h2>Every rover stop, not only the famous ones <Kind k="measured" /><Kind k="modeled" /></h2>
        <p className="prose">At {st.n} stops in the walk area with at least {st.min_sols} sol of RAD data, we compare each stop&apos;s dose against the surrounding ±{st.window_sols} sols (removing the solar-cycle trend) with the same comparison in the model.</p>
        <ScatterXY lo={-15} hi={10} unit=" %" fmtv={(q) => q.toFixed(1)} xLabel="Modeled local anomaly (%)" yLabel="Observed local anomaly (%)" pts={obsPts} />
        <p className="muted">Correlation r = {st.pearson_r.toFixed(2)} (95 % bootstrap interval {st.pearson_r_95ci?.[0].toFixed(2)} to {st.pearson_r_95ci?.[1].toFixed(2)}), slope {st.slope_obs_on_model.toFixed(2)}.
          Points beyond the axes are drawn on the edge. Observed stop-to-stop scatter ({st.obs_anomaly_std_pp.toFixed(1)} pp) is about three times the modeled terrain signal ({st.model_anomaly_std_pp.toFixed(1)} pp): most variation at short stops comes from diurnal sampling, pressure and space weather, not terrain.</p>
      </div>

      <div className="section">
        <h2>Our reading of the raw NASA data <Kind k="measured" /></h2>
        <table className="data">
          <thead><tr><th>Period</th><th>Dates (UTC)</th><th>Obs.</th><th>RAD E, ours</th><th>Published</th></tr></thead>
          <tbody>{periods.map(([k, r]) => (
            <tr key={k}><td>{k}</td><td>{r.rad.utc_start.slice(0, 10)} to {r.rad.utc_end.slice(5, 10)}</td><td>{r.rad.n}</td><td>{r.rad.E_mean.toFixed(1)} ± {r.rad.E_sem.toFixed(1)}</td><td>{r.D_RAD_pub.toFixed(1)}</td></tr>
          ))}</tbody>
        </table>
        <p className="muted">µGy/day. Median difference {(v.v5.rel_diff_median * 100).toFixed(1)} %; largest {(v.v5.rel_diff_max * 100).toFixed(1)} % ({v.v5.worst}, a one-sol window).</p>
      </div>

      <div className="section">
        <h2>Horizon engine on shapes with known answers</h2>
        <table className="data">
          <thead><tr><th>Geometry</th><th>Expected</th><th>Computed</th><th>Max error</th></tr></thead>
          <tbody>{v.v1_analytic.cases.map((c: { case: string; expected_deg: number; got_deg: number; abs_err_deg: number }) => (
            <tr key={c.case}><td>{c.case}</td><td>{c.expected_deg.toFixed(4)}°</td><td>{c.got_deg.toFixed(4)}°</td><td>{c.abs_err_deg.toExponential(1)}°</td></tr>
          ))}</tbody>
        </table>
      </div>

      <div className="section">
        <h2>Sensitivity of blocked sky</h2>
        <SensitivityBars label="Change in blocked sky at the 15 RAD periods"
          rows={[
            ...s.S1_resolution.map((r: { res_m: number; mae_dB: number; max_abs_dB: number }) => ({ name: `DEM ${r.res_m} m`, mean: r.mae_dB * 100, max: r.max_abs_dB * 100 })),
            ...s.S2_radius.filter((r: { r_max_m: number }) => r.r_max_m !== 20000).map((r: { r_max_m: number; mae_dB: number; max_abs_dB: number }) => ({ name: `Radius ${r.r_max_m >= 1000 ? r.r_max_m / 1000 + " km" : r.r_max_m + " m"}`, mean: r.mae_dB * 100, max: r.max_abs_dB * 100 })),
            ...s.S3_height.filter((r: { h_m: number }) => r.h_m !== 1).map((r: { h_m: number; mae_dB: number; max_abs_dB: number }) => ({ name: `Height ${r.h_m} m`, mean: r.mae_dB * 100, max: r.max_abs_dB * 100 })),
          ]} />
        <p className="muted">Reference: 1 m DEM, 20 km radius, 1 m sensor height (Guo et al. 2026 settings). Coarser DEMs always under-count shielding; terrain beyond 20 km (Mount Sharp) adds about 1 pp. Across φ 380–800 MV, albedo 18–24 % and heavy-ion factor 1.08–1.12, the modeled total at the Maria Gordon Notch geometry ranges ×{s.S5_parameters.rel_total_P6_range[0].toFixed(3)} to ×{s.S5_parameters.rel_total_P6_range[1].toFixed(3)}.</p>
      </div>

      {routeEval && (
        <div className="section">
          <h2>Route engine against the shortest-distance baseline</h2>
          <table className="data">
            <thead><tr><th>Strategy</th><th>Distance</th><th>Time</th><th>Dose (median)</th><th>Dose 10–90 %</th></tr></thead>
            <tbody>{ROUTE_ORDER.filter((k) => k !== "shortest").map((k) => {
              const r = routeEval.R1.summary[k];
              return <tr key={k}><td>{ds.scenario.multi.routes.find((q) => q.objective === k)?.label}</td><td>{fmt.pct(r.distance_pct_median)}</td><td>{fmt.pct(r.time_pct_median)}</td><td>{fmt.pct(r.dose_pct_median)}</td><td>{fmt.pct(r.dose_pct_p10)} to {fmt.pct(r.dose_pct_p90)}</td></tr>;
            })}</tbody>
          </table>
          <p className="muted">{routeEval.R1.n} random start/destination pairs at least 600 m apart. Compared with the fastest route, the lowest-dose route saves a median {Math.abs(routeEval.R1.summary.low_dose_vs_fastest.dose_pct_median).toFixed(2)} % (best case {Math.abs(routeEval.R1.summary.low_dose_vs_fastest.dose_pct_min).toFixed(1)} %).
            Grid paths are {routeEval.R2.excess_pct_median.toFixed(1)} % longer than straight lines on flat ground (median, n = {routeEval.R2.n}). The 72-direction routing map agrees with full 720-direction horizon traces within {routeEval.R3.rel_max_pp.toFixed(2)} pp of dose rate at {routeEval.R3.n} stops.</p>
        </div>
      )}

      <div className="section">
        <h2>Sources</h2>
        <ul className="sources" style={{ paddingLeft: 18 }}>
          {ds.meta.sources.map((src) => <li key={src.id}><b>{src.kind}</b>: <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a>. {src.used}.</li>)}
        </ul>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------
function ReportPanel({ ds, plan, routeEval }: { ds: Dataset; plan: Plan | null; routeEval: RouteEval }) {
  const near = useMemo(() => {
    // MEASURED: Curiosity RAD stops lying within 25 m of the lowest-dose route of the current plan
    const low = plan?.routes.find((r) => r.objective === "low_dose" && r.feasible);
    if (!low) return [];
    return ds.observations.stops.filter((s) => s.E_mean != null && low.xy.some(([x, y]) => Math.hypot(x - s.x, y - s.y) <= 25));
  }, [ds, plan]);
  if (!plan) return <p className="prose">Plan a walk first.</p>;
  const R = Object.fromEntries(plan.routes.filter((r) => r.feasible).map((r) => [r.objective, r]));
  const base = R.shortest, low = R.low_dose, fast = R.fastest, shel = R.shelter, gen = R.gentle;
  const walkShare = low ? low.dose_uGy / low.total_dose_uGy : 1;
  const v = ds.validation, au = ds.audit;
  const A8 = au.A3_eight_pairs["P6_19.4pct_table1"];
  const p6 = v.pairs.find((q: { pair: string }) => q.pair.startsWith("P6"));
  const beN = ds.breakeven["Maria Gordon Notch"], beM = ds.breakeven["Mt Mercou"];
  const brk = (b: BreakEven) => b.breaks.find((q) => q.less_walking === "A" && q.more_sheltered === "C");
  const bN = brk(beN), bM = brk(beM);
  const nearAnom = near.filter((s) => s.anomaly_obs != null && s.anomaly_model != null && (s.data_sols ?? 0) >= 1);
  const meas = ds.periods.filter((q) => q.kind === "parking").map((q) => (q.pub.decrease as number) * 100);
  const st = ds.observations.anomaly_stats;
  const R1 = routeEval?.R1;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return (
    <>
      <div className="section">
        <h2>Scientific findings</h2>
        <div className="prose">
          <p><strong>1. Martian terrain measurably shields cosmic radiation, by up to about a fifth.</strong> <Kind k="measured" />{" "}
            At eight parking periods beside buttes, hills and cliffs, Curiosity&apos;s RAD recorded dose-rate drops of {Math.min(...meas).toFixed(1)} to {Math.max(...meas).toFixed(1)} % (NASA RAD L2; our reduction agrees with Guo et al. 2026 Table 1 to a median {(v.v5.rel_diff_median * 100).toFixed(1)} %).
            Our ray tracing on the USGS 1 m DEM reproduces the published sky blocking at 13 of 15 periods (mean absolute difference {(v.v4.B_minus_ROSpub_mae * 100).toFixed(1)} pp over all 15) and the RAD team&apos;s Butte M12 horizon to {v.v3_m12_mask.rmse_deg.toFixed(2)}° RMSE.</p>
          <p><strong>2. Blocking sky is not the same as blocking dose.</strong> <Kind k="modeled" />{" "}
            Terrain that hides the sky also emits albedo radiation, so modeled dose falls far less than the blocked fraction. Against all eight measured drops, the sky + albedo model has MAE {A8.pred_albedo_019.mae_pp.toFixed(2)} pp
            (RMSE {A8.pred_albedo_019.rmse_pp.toFixed(2)}) against {A8.pred_proportional.mae_pp.toFixed(2)} pp (RMSE {A8.pred_proportional.rmse_pp.toFixed(2)}) for a naive proportional proxy. With eight periods the physical model is <em>not</em> demonstrably better.
            It fails at P6, where RAD saw {fmt.pct(p6.measured_ours * 100)} and the model predicts {fmt.pct(p6.pred_albedo_019 * 100)}.</p>
          {R1 && (
            <p><strong>3. For a walking astronaut, time outside sets the dose.</strong> <Kind k="modeled" />{" "}
              Across {R1.n} random walks, the lowest-dose route matches the fastest route to within a median {Math.abs(R1.summary.low_dose_vs_fastest.dose_pct_median).toFixed(2)} %. Routes that hug cliffs for shade raise dose by a median {fmt.pct(R1.summary.shelter.dose_pct_median)}, because they are longer and slower.</p>
          )}
          {bN && bM && (
            <p><strong>4. Where you stop can matter, but only where the model can resolve it.</strong> <Kind k="modeled" />{" "}
              Near Maria Gordon Notch (150 m work radius), the most sheltered spot is {bN.rate_difference_pp.toFixed(1)} rate points below the spot that minimises walking.
              That is larger than the model&apos;s validated error ({beN.model_error.rmse_pp.toFixed(1)} pp RMSE), and moving there pays back after {fmt.h(bN.t_h)} of work
              ({fmt.h(bN.t_h_model_error_band[0])} to {bN.t_h_model_error_band[1] == null ? "no break-even" : fmt.h(bN.t_h_model_error_band[1])} within model error). That spot is on a steep slope below cliffs, and MarsShield does not model rockfall.
              At Mt Mercou the same comparison differs by only {bM.rate_difference_pp.toFixed(1)} points, below the model&apos;s mean error ({beM.model_error.mae_pp.toFixed(1)} pp): it is <b>unresolved</b> and gives no recommendation.</p>
          )}
          <p><strong>5. Most stop-to-stop variation in measured dose is not terrain.</strong> <Kind k="measured" />{" "}
            At {st.n} rover stops, the observed local dose anomaly correlates with the modeled one at r = {st.pearson_r.toFixed(2)} (95 % interval {st.pearson_r_95ci?.[0].toFixed(2)} to {st.pearson_r_95ci?.[1].toFixed(2)}), but observed scatter ({st.obs_anomaly_std_pp.toFixed(1)} pp) is about three times the modeled terrain signal ({st.model_anomaly_std_pp.toFixed(1)} pp).</p>
        </div>
      </div>

      <div className="section">
        <h2>Which conclusions rest on observations?</h2>
        <table className="data">
          <thead><tr><th>Conclusion</th><th>Basis</th></tr></thead>
          <tbody>
            <tr><td>Terrain near cliffs and buttes lowers the cosmic-ray dose rate, by up to 19.4 % at Maria Gordon Notch</td><td><Kind k="measured" /> NASA RAD L2, 8 parking periods (Guo et al. 2026, reproduced)</td></tr>
            <tr><td>Our terrain ray tracing reproduces the published sky geometry at 13 of 15 periods</td><td><Kind k="measured" /> Compared against published values and the RAD team&apos;s horizon mask</td></tr>
            <tr><td>Terrain albedo offsets part of the sky shielding</td><td><Kind k="modeled" /> Published model; measured RAD drops are smaller than the published sky-dose drops at 6 of 8 periods (equal at P3, larger at P5)</td></tr>
            <tr><td>Time outside dominates walking dose; shelter-hugging routes add dose</td><td><Kind k="modeled" /> Route engine; follows from the size of modeled rate differences (a few points) compared with time differences (tens of percent)</td></tr>
            <tr><td>Moving to shelter at Maria Gordon Notch pays back within about half an hour</td><td><Kind k="modeled" /> Resolved against model error; direction supported by the measured −19.4 % there</td></tr>
            <tr><td>Stop choice at Mt Mercou</td><td><Kind k="modeled" /> Unresolved: no conclusion</td></tr>
            <tr><td>Any statement about safety, hazard or effective dose</td><td>Not supported: not modeled</td></tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <h2>The example route plan: science along the way</h2>
        <p className="prose">
          This plan crosses {low ? fmt.m(low.distance_m) : "n/a"} of Gale Crater from Tower Buttes to the Paraitepuy canyon{plan.stops.length ? `, with ${plan.stops.length} science stop${plan.stops.length > 1 ? "s" : ""} of ${plan.dwell_h} h each` : ""}.
          On open flat ground the model gives {plan.D_flat_uGy_d.toFixed(0)} µGy/day of absorbed dose (RAD detector-E equivalent, φ = {plan.phi} MV).
        </p>
        <table className="data">
          <thead><tr><th>Stop</th><th>Sky blocked <Kind k="modeled" /></th><th>Dose rate <Kind k="modeled" /></th><th>Nearest RAD measurement <Kind k="measured" /></th></tr></thead>
          <tbody>{plan.stops.map((sp, i) => {
            const B = sampleGrid(ds.meta, ds.grids.B, sp[0], sp[1]);
            const rs = sampleGrid(ds.meta, ds.grids.relSky, sp[0], sp[1]);
            const dist = (x: number, y: number) => Math.hypot(x - sp[0], y - sp[1]);
            const tgt = ds.targets.reduce((a, t) => (dist(t.x, t.y) < dist(a.x, a.y) ? t : a));
            const obs = ds.observations.stops.filter((o) => o.E_mean != null).reduce((a, o) => (dist(o.x, o.y) < dist(a.x, a.y) ? o : a));
            const d = dist(obs.x, obs.y);
            return (
              <tr key={i}>
                <td>{i + 1}. {dist(tgt.x, tgt.y) < 40 ? tgt.name : "Custom stop"}</td>
                <td>{fmt.pctAbs(B)}</td>
                <td>×{relTotal(rs, B, plan.alpha).toFixed(3)}</td>
                <td>{d < 40 ? `Sol ${obs.sol} (${obs.utc_start?.slice(0, 10)}): ${(obs.E_mean as number).toFixed(1)} µGy/d, ${d.toFixed(0)} m away` : "None within 40 m"}</td>
              </tr>
            );
          })}</tbody>
        </table>
        <p className="muted">
          Along the lowest-dose route Curiosity made {near.length} RAD-measured stops within 25 m of the path
          {nearAnom.length ? `. At the ${nearAnom.length} with at least one sol of data, the measured local anomaly averages ${fmt.pct(mean(nearAnom.map((s) => s.anomaly_obs as number)) * 100)} against ${fmt.pct(mean(nearAnom.map((s) => s.anomaly_model as number)) * 100)} modeled` : ""}.
          They are the white-ringed markers on the map: measurements on the ground the astronaut would cross. Raw rates from different dates are not directly comparable because the cosmic-ray flux changes over the solar cycle.
        </p>
        <div className="prose">
          {base && low && (
            <p><strong>Why the routes differ.</strong> The shortest route is {fmt.m(base.distance_m)} with slopes up to {base.max_slope_deg.toFixed(0)}°. The lowest-dose route is {fmt.pct(low.vs_baseline!.distance_pct)} in distance and {fmt.pct(low.vs_baseline!.time_pct)} in time, which changes dose by {fmt.pct(low.vs_baseline!.dose_pct)}.
              It wins by being quicker to walk, not by finding shade{fast ? `; it is within ${Math.abs((low.total_dose_uGy / fast.total_dose_uGy) * 100 - 100).toFixed(2)} % of the fastest route` : ""}.</p>
          )}
          {shel && <p><strong>Hugging the cliffs does not pay.</strong> The maximum-shielding route averages ×{shel.mean_rel_rate.toFixed(3)} of open ground but walks {fmt.pct(shel.vs_baseline!.distance_pct)} farther and takes {fmt.pct(shel.vs_baseline!.time_pct)} longer, so its total dose changes by {fmt.pct(shel.vs_baseline!.dose_pct)}.</p>}
          {gen && <p><strong>Gentlest slopes.</strong> The gentlest route keeps mean slope at {gen.mean_slope_deg.toFixed(1)}° (shortest {base?.mean_slope_deg.toFixed(1)}°) for {fmt.pct(gen.vs_baseline!.dose_pct)} dose. Slope is a simple terrain measure, not a validated safety assessment.</p>}
          {low && plan.stops.length > 0 && (
            <p><strong>Where the land does help.</strong> Walking is {(walkShare * 100).toFixed(0)} % of this plan&apos;s dose and the science stops are {(100 - walkShare * 100).toFixed(0)} %. Where to stand while working is the decision terrain shielding can change; the Break-even view quantifies it.
              When Curiosity parked in Maria Gordon Notch (December 2021), RAD read {fmt.pct(p6.measured_ours * 100)} against background positions 17–40 m away that were themselves partly shielded; for that same comparison the model predicts {fmt.pct(p6.pred_albedo_019 * 100)}.</p>
          )}
        </div>
      </div>

      <div className="section">
        <h2>Mission datasets integrated</h2>
        <table className="data">
          <thead><tr><th>Mission and instrument</th><th>Product</th><th>Role in MarsShield</th></tr></thead>
          <tbody>
            <tr><td>MSL Curiosity RAD (NASA) <Kind k="measured" /></td><td>Level 2 dosimetry, NASA SPDF</td><td>Dose rates at {st.n} stops and 15 published periods; tests every model claim</td></tr>
            <tr><td>MSL Curiosity navigation (NASA/JPL) <Kind k="measured" /></td><td>Localised waypoints (MMGIS)</td><td>Where RAD was when it measured</td></tr>
            <tr><td>MRO HiRISE and CTX (NASA) <Kind k="measured" /></td><td>Stereo DEMs inside the USGS Gale merged 1 m DEM</td><td>Terrain, slopes, horizons, 3D view</td></tr>
            <tr><td>MRO HiRISE (NASA) <Kind k="measured" /></td><td>USGS Gale merged orthophoto mosaic, 25 cm (averaged to 1 m)</td><td>Orbital image layer of the walk area</td></tr>
            <tr><td>MSL Curiosity science team <Kind k="measured" /></td><td>Bennett et al. 2023 (Glen Torridon campaign); NASA mission blogs; NASA/JPL release</td><td>Science objectives, what to look for and Curiosity results at nine Marswalk stops</td></tr>
            <tr><td>Mars Express HRSC (ESA) and MGS MOLA (NASA) <Kind k="measured" /></td><td>DEM gap fill and control; 200 m blended DEM</td><td>Far-field horizon: crater rim and Mount Sharp</td></tr>
            <tr><td>TGO Liulin-MO (ESA/Roscosmos), via Guo et al. 2026</td><td>Solar modulation φ per RAD period (published values, not ingested)</td><td>Model input for the 15 validation periods only</td></tr>
            <tr><td>GEANT4 zenith-angle dose model, Guo et al. 2021 <Kind k="modeled" /></td><td>Zenodo 10.5281/zenodo.4701689</td><td>Downward dose by sky direction</td></tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <h2>Limitations</h2>
        <ul className="assumptions">
          <li>All doses are absorbed dose in RAD&apos;s tissue-equivalent plastic detector from quiet-time galactic cosmic rays. They are not an astronaut&apos;s effective dose (Sv); terrain does not change RAD&apos;s LET view cone, so the quality factor under shielding is unknown.</li>
          <li>Solar particle events, the neutron energy response (Charpentier et al. 2026), regolith composition, and suit or vehicle shielding are not modeled.</li>
          <li>The terrain-albedo assumption breaks down in self-shielded notches (P6), and DEM sky blocking is not reproduced at P8. In narrow canyons a 3 m position error moves blocked sky by about ±4 pp.</li>
          <li>On all eight measured periods the model is not demonstrably better than a proportional proxy (n = 8). Guo et al. (2026) report two different P6 drops (19.4 % and 17 %); we use 19.4 %, which NASA RAD data reproduce.</li>
          <li>Coarser terrain undercounts shielding (−2.3 pp mean at 8 m); the DEM falls back from HiRISE to CTX and HRSC where stereo coverage is missing.</li>
          <li>The most sheltered stops sit on steep ground below cliffs. MarsShield flags them but does not model rockfall, slope stability or footing, and makes no safety claim.</li>
          <li>Break-even times are reported as recommendations only when the rate difference exceeds the model&apos;s validated error; most within-site differences do not.</li>
          <li><Kind k="assumption" /> Walking speed (Tobler × {plan.assumptions.suit_factor}), the {plan.assumptions.max_slope_deg}° slope limit, the 15° workable-stop limit and the science work radius are planning assumptions, not measurements.</li>
        </ul>
      </div>
    </>
  );
}
