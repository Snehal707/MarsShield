"use client";
import { useEffect, useMemo, useState } from "react";
import type { Dataset, ScienceTarget } from "@/lib/data";
import { dFlat, relTotal, ROUTE_COLORS, sampleGrid } from "@/lib/data";
import type { Objective } from "@/lib/engine";
import type { BEJs, RouteMetrics, useEngine } from "@/lib/useEngine";
import type { ScenePin, SceneLine } from "./TerrainScene";
import { SkyDisc, ZenithBars } from "./SkyDisc";
import { A, Chip, download, Grammar, h, km, M, More, P, Seg, sgn, Slider, TradeoffChart } from "./ui";

type Eng = ReturnType<typeof useEngine>;
export type SceneSpec = { lines?: SceneLine[]; pins?: ScenePin[]; ring?: { x: number; y: number; r: number } | null; skyId?: string | null };
const STEPS = ["Destination", "Route", "Activity", "Trade-off", "Evidence", "Conclusion"];
const STRATS: [Objective, string][] = [["low_dose", "Lowest dose"], ["fastest", "Fastest"], ["shortest", "Shortest"], ["shelter", "Hug shelter"]];
const OPT_COLORS: Record<string, string> = { A: "#3987e5", B: "#d95926", C: "#199e70" };

/** Descriptive terrain flags (port of breakeven.site_flags). Not a hazard model. */
function siteFlags(ds: Dataset, x: number, y: number): string[] {
  const [ny, nx] = ds.meta.shape, res = ds.meta.res;
  const r0 = Math.round((ds.meta.y0 - y) / res), c0 = Math.round((x - ds.meta.x0) / res);
  if (r0 < 0 || r0 >= ny || c0 < 0 || c0 >= nx) return [];
  const out: string[] = [], sl = ds.grids.slope[r0 * nx + c0], z0 = ds.grids.height[r0 * nx + c0];
  if (sl >= 12) out.push(`Steep stop: local slope ${sl.toFixed(1)}°.`);
  const k = Math.ceil(40 / res); let rise = 0;
  for (let r = Math.max(0, r0 - k); r < Math.min(ny, r0 + k + 1); r++) for (let c = Math.max(0, c0 - k); c < Math.min(nx, c0 + k + 1); c++) {
    if (Math.hypot(r - r0, c - c0) * res > 40) continue;
    const i = r * nx + c;
    if (ds.grids.slope[i] >= 30 && ds.grids.height[i] >= z0 + 5) rise = Math.max(rise, ds.grids.height[i] - z0);
  }
  if (rise) out.push(`Below steep terrain rising ${rise.toFixed(0)} m within 40 m. Rockfall is not modeled.`);
  return out;
}

export function MissionMode({ ds, eng, setScene, focusOn }: { ds: Dataset; eng: Eng; setScene: (s: SceneSpec) => void; focusOn: (x: number, y: number, dist?: number) => void }) {
  const byId = useMemo(() => Object.fromEntries(ds.scienceTargets.map((t) => [t.id, t])) as Record<string, ScienceTarget>, [ds]);
  const err = ds.breakeven["Maria Gordon Notch"].model_error;
  const alpha = 0.21, phi = 500, Dflat = dFlat(ds.flat, phi, alpha);
  const [step, setStep] = useState(0);
  const [dest, setDest] = useState("mgn");
  const [start, setStart] = useState("nontron");
  const [ret, setRet] = useState(true);
  const [suit, setSuit] = useState(0.6);
  const [dur, setDur] = useState(byId["mgn"].duration_h[1]);
  const [limit, setLimit] = useState(0);
  const [radius, setRadius] = useState(byId["mgn"].work_radius_m);
  const [routes, setRoutes] = useState<Record<string, RouteMetrics[] | null> | null>(null);
  const [sel, setSel] = useState<Objective>("low_dose");
  const [be, setBe] = useState<BEJs | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);   // which compared spot the plan uses (null = default)
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const D = byId[dest], S = byId[start];
  const pickDest = (id: string) => {
    setDest(id); setDur(byId[id].duration_h[1]); setRadius(byId[id].work_radius_m); setBe(null); setPlanKey(null);
    if (id === start) setStart(ds.scienceTargets.find((t) => t.id !== id)!.id);
    focusOn(byId[id].x, byId[id].y, 900);
  };

  // routes: recomputed in the browser whenever the destination, start, return leg or walking speed changes
  useEffect(() => {
    if (!eng.ready || dest === start) return;
    let live = true;
    setBusy(true); setErrMsg(null);
    const legs: [[number, number], [number, number]][] = [[[S.x, S.y], [D.x, D.y]]];
    if (ret) legs.push([[D.x, D.y], [S.x, S.y]]);
    eng.routes(legs, STRATS.map((s) => s[0]), alpha, suit, Dflat)
      .then((r) => { if (live) setRoutes(r); })
      .catch((e) => live && setErrMsg(String(e.message ?? e)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [eng, dest, start, ret, suit, S, D, Dflat]);

  // stop comparison, computed along the SELECTED route strategy (outbound, and return if chosen), from the activity
  // step on. Every total shown afterwards comes from one of these options, so plan, trade-off and summary agree.
  const compare = step >= 2;
  useEffect(() => {
    if (!eng.ready || !compare || dest === start) return;
    let live = true;
    setBe(null); setPlanKey(null);
    eng.breakEven({ start: [S.x, S.y], end: ret ? [S.x, S.y] : null, target: [D.x, D.y], radius, Dflat, err, alpha, suit, stopMaxSlope: 15, objective: sel })
      .then((r) => live && setBe(r)).catch((e) => live && setErrMsg(String(e.message ?? e)));
    return () => { live = false; };
  }, [eng, compare, dest, start, ret, suit, radius, sel, S, D, Dflat, err]);

  const sum = (k: "distance_m" | "time_h" | "dose_uGy", o: string) => (routes?.[o] ?? []).reduce((s, m) => s + m[k], 0);
  const R = routes?.[sel];
  const tgtRel = relTotal(sampleGrid(ds.meta, ds.grids.relSky, D.x, D.y), sampleGrid(ds.meta, ds.grids.B, D.x, D.y), alpha);
  const bOpt = be?.options.find((o) => o.keys.includes("B"));

  // decision relative to working at the target (B), screened against validated model error
  const decision = useMemo(() => {
    if (!be || !bOpt) return null;
    const bestAt = (t: number) => be.options.reduce((a, o) => (o.W + t * o.r < a.W + t * a.r ? o : a));
    const best = bestAt(dur), lo = bestAt(D.duration_h[0]), hi = bestAt(D.duration_h[2]);
    if (best === bOpt) return { status: "stay", chip: "supported", label: "Stay at the target", best,
      text: "Working at the science target already has the lowest modeled dose for this duration." };
    const dpp = Math.abs(best.rel - bOpt.rel) * 100, gain = bOpt.W + dur * bOpt.r - (best.W + dur * best.r);
    const res = dpp >= err.rmse_pp ? "resolved" : dpp >= err.mae_pp ? "marginal" : "unresolved";
    const k = best.keys[0];
    if (res === "unresolved") return { status: "unresolved", chip: "unresolved", label: "Model cannot tell", best,
      text: `Spot ${k} would save ${gain.toFixed(2)} µGy, but its dose rate differs from the target by only ${dpp.toFixed(1)} points, less than the model's mean validated error (${err.mae_pp.toFixed(1)} points). The model cannot rank these spots, so the plan stays at the target.` };
    if (res === "marginal") return { status: "marginal", chip: "marginal", label: "Within model error", best,
      text: `Spot ${k} would save ${gain.toFixed(2)} µGy (${dpp.toFixed(1)}-point rate difference). That is above the model's mean error (${err.mae_pp.toFixed(1)}) but below its RMS error (${err.rmse_pp.toFixed(1)}), so the saving is not reliable. The plan stays at the target; you can choose spot ${k} below.` };
    if (!(lo === best && hi === best)) return { status: "duration", chip: "marginal", label: "Depends on duration", best,
      text: `Spot ${k} saves ${gain.toFixed(2)} µGy at ${h(dur)} (${dpp.toFixed(1)}-point difference, resolved), but is not the best spot across the whole planned range (${h(D.duration_h[0])} to ${h(D.duration_h[2])}). The plan stays at the target; you can choose spot ${k} below.` };
    return { status: "recommended", chip: "resolved", label: "Move to the sheltered spot", best,
      text: `Spot ${k} saves ${gain.toFixed(2)} µGy against working at the target (${dpp.toFixed(1)}-point rate difference, resolved against model error) across the planned duration range. The plan uses spot ${k}.` };
  }, [be, bOpt, dur, D, err]);

  // THE plan: one journey. Until the stop comparison is ready it is the selected route to the target point (marked
  // preliminary); afterwards it is the selected strategy's path to the chosen compared spot (and back), with that spot's rate.
  const defaultKey = decision?.status === "recommended" ? decision.best.keys[0] : "B";
  const spot = be?.options.find((o) => o.keys.includes(planKey ?? defaultKey)) ?? bOpt ?? null;
  const plan = useMemo(() => {
    const strategy = STRATS.find((q) => q[0] === sel)?.[1] ?? sel;
    if (spot) {
      const legs = [spot.out, ...(spot.back ? [spot.back] : [])];
      return { prelim: false, strategy, spotKey: spot.keys[0] as string | null, spotLabel: spot.labels[0], fromTarget: spot.dist_from_target_m, rate: spot.r, rel: spot.rel,
        outDose: spot.out.dose_uGy, backDose: spot.back?.dose_uGy ?? 0,
        walkDose: legs.reduce((a, l) => a + l.dose_uGy, 0), walkT: legs.reduce((a, l) => a + l.time_h, 0), distance: legs.reduce((a, l) => a + l.distance_m, 0), xy: spot.xy };
    }
    return { prelim: true, strategy, spotKey: null as string | null, spotLabel: "the target point", fromTarget: 0, rate: (tgtRel * Dflat) / 24, rel: tgtRel,
      outDose: R?.[0]?.dose_uGy ?? 0, backDose: ret ? R?.[1]?.dose_uGy ?? 0 : 0,
      walkDose: R ? R.reduce((a, l) => a + l.dose_uGy, 0) : 0, walkT: R ? R.reduce((a, l) => a + l.time_h, 0) : 0,
      distance: R ? R.reduce((a, l) => a + l.distance_m, 0) : 0, xy: R ? R.flatMap((m, i) => (i ? m.xy.slice(1) : m.xy)) : [] };
  }, [spot, R, sel, ret, tgtRel, Dflat]);
  const stopDose = dur * plan.rate, total = plan.walkDose + stopDose, totalT = plan.walkT + dur;
  const overLimit = limit > 0 && totalT > limit;

  // what the terrain shows
  useEffect(() => {
    const pins: ScenePin[] = ds.scienceTargets.map((t) => ({ key: t.id, x: t.x, y: t.y, label: t.name.split(",")[0], color: t.id === dest ? "#d0904f" : t.id === start ? "#efe6d8" : "#a39582",
      selected: t.id === dest, onClick: step === 0 ? () => pickDest(t.id) : undefined }));
    const lines: SceneLine[] = [];
    if (routes && step >= 1 && step <= 2)
      for (const [o] of STRATS) {
        const ms = routes[o]; if (!ms) continue;
        lines.push({ key: `${o}-${dest}-${start}-${ret}-${suit}`, xy: ms.flatMap((m, i) => (i ? m.xy.slice(1) : m.xy)).filter((_, i, a) => i % 2 === 0 || i === a.length - 1),
          color: ROUTE_COLORS[o], width: o === sel ? 5 : 2, opacity: o === sel ? 1 : 0.55, dashed: o === "shelter", animate: true });
      }
    if (step >= 4 && plan.xy.length) lines.push({ key: `final-${sel}-${plan.spotKey}`, xy: plan.xy, color: ROUTE_COLORS[sel], width: 4 });
    let ring = null;
    if (be && step === 3) {
      for (const o of be.options) {
        lines.push({ key: `be-${o.keys.join("")}-${radius}-${suit}-${sel}-${ret}`, xy: o.xy, color: OPT_COLORS[o.keys[0]], width: o === spot ? 4 : 2, animate: true });
        pins.push({ key: `opt${o.keys.join("")}`, x: o.x, y: o.y, label: o === spot ? `${o.keys.join("=")} · plan` : o.keys.join("="), color: OPT_COLORS[o.keys[0]], high: true, onClick: () => setPlanKey(o.keys[0]) });
      }
      ring = { x: D.x, y: D.y, r: radius };
    }
    setScene({ pins, lines, ring, skyId: step === 4 ? dest : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, step, dest, start, sel, be, radius, ret, suit, spot, plan]);

  // frame the whole work radius so every compared spot stays in view
  const tradeDist = Math.max(520, radius * 5.2);
  const goto = (s: number) => { setStep(s); if (s >= 1 && s <= 2) focusOn((S.x + D.x) / 2, (S.y + D.y) / 2, 2300); if (s === 3) focusOn(D.x, D.y, tradeDist); if (s === 4) focusOn(D.x, D.y, 420); };
  useEffect(() => { if (step === 3) focusOn(D.x, D.y, tradeDist); }, [tradeDist]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportRun = () => download(`marsshield-mission-${dest}.json`, {
    kind: "MarsShield mission plan (modeled exposure; not a safety assessment)", generated: new Date().toISOString(), computed_in: "browser engine (verified against Python pipeline)",
    destination: { id: D.id, name: D.name, sources: D.sources }, start: { id: S.id, name: S.name }, return_leg: ret,
    assumptions: { walking_speed_factor: suit, activity_duration_h: dur, work_radius_m: radius, eva_time_limit_h: limit || null, albedo_share: alpha, solar_modulation_MV: phi, stop_max_slope_deg: 15, walk_max_slope_deg: 25 },
    routes: Object.fromEntries(STRATS.map(([o]) => [o, routes?.[o] ? { distance_m: sum("distance_m", o), time_h: sum("time_h", o), walking_dose_uGy: sum("dose_uGy", o) } : null])),
    plan: {
      route_strategy: sel,
      stop: plan.spotKey ? { option: plan.spotKey, label: plan.spotLabel, x: spot?.x, y: spot?.y, distance_from_target_m: plan.fromTarget, rel_rate: plan.rel } : "target point (stop comparison not computed)",
      walk_out_dose_uGy: plan.outDose, walk_back_dose_uGy: ret ? plan.backDose : null,
      walking: { distance_m: plan.distance, time_h: plan.walkT, dose_uGy: plan.walkDose },
      stationary: { duration_h: dur, rate_uGy_h: plan.rate, dose_uGy: stopDose },
      total_modeled_dose_uGy: total, total_time_h: totalT,
    },
    stop_comparison: be ? { route_strategy: be.objective, options: be.options.map((o) => ({ option: o.keys.join("="), label: o.labels[0], distance_from_target_m: o.dist_from_target_m,
      rel_rate: o.rel, walking_dose_uGy: o.W, total_at_duration_uGy: o.W + dur * o.r })) } : null,
    stop_decision: decision ? { status: decision.status, text: decision.text } : null,
    model_error_used_pp: err, data: ["height.f32", "rel_sky.f32", "B.f32", "slope.f32", "flat_dose.json", "science_targets.json"],
    not_assessed: ["astronaut effective dose", "solar particle events", "rockfall and slope stability", "life support", "operational safety"],
  });

  return (
    <>
      <div className="panel-head">
        <p className="eyebrowless">Plan a science Marswalk</p>
        <p className="sub">{D.name}</p>
        <nav className="steps" aria-label="Mission steps">
          {STEPS.map((s, i) => <button key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""} onClick={() => goto(i)}>{i + 1}. {s}</button>)}
        </nav>
      </div>
      <div className="panel-body">
        {step === 0 && (<>
          <h2 className="q">Where will the astronaut do science?</h2>
          <p className="muted">Nine sites Curiosity actually studied. Choose one here or click its marker on the terrain.</p>
          <div className="dest">
            {ds.scienceTargets.map((t) => (
              <button key={t.id} aria-pressed={t.id === dest} onClick={() => pickDest(t.id)}>
                <i /><b>{t.name}</b><span>{t.objective}</span>
              </button>
            ))}
          </div>
          <More label="Why geologists went there, and the source">
            <p className="prose"><b>Look for:</b> {D.look_for}</p>
            <p className="prose"><b>What Curiosity found:</b> {D.curiosity_found}</p>
            <blockquote className="quote">&ldquo;{D.objective_quote}&rdquo;</blockquote>
            <p className="muted">{D.sources.map((s) => s.cite).join("; ")}. Position: NASA/JPL waypoint {D.waypoint.rmc}, sol {D.waypoint.sol}.</p>
          </More>
          <button className="btn primary" onClick={() => goto(1)}>Plan the route</button>
        </>)}

        {step === 1 && (<>
          <h2 className="q">How should the astronaut get there?</h2>
          <div className="row">
            <label className="muted" htmlFor="start">Start from</label>
            <select id="start" className="sel" value={start} onChange={(e) => setStart(e.target.value)}>
              {ds.scienceTargets.filter((t) => t.id !== dest).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} />Return to start</label>
          </div>
          {busy && !routes && <p className="muted">Computing routes in your browser…</p>}
          {routes && (
            <table className="routes-t">
              <thead><tr><th>Strategy</th><th>Distance</th><th>Time</th><th>Walk dose</th></tr></thead>
              <tbody>{STRATS.map(([o, l]) => routes[o] ? (
                <tr key={o} aria-selected={o === sel} onClick={() => setSel(o)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(o)}>
                  <td><span className="sw" style={{ borderColor: ROUTE_COLORS[o], borderTopStyle: o === "shelter" ? "dashed" : "solid" }} />{l}</td>
                  <td>{km(sum("distance_m", o))}</td><td>{h(sum("time_h", o))}</td>
                  <td><P>{sum("dose_uGy", o).toFixed(1)} µGy</P></td>
                </tr>) : <tr key={o}><td colSpan={4} className="muted">{l}: no passable route</td></tr>)}</tbody>
            </table>
          )}
          {routes?.shelter && routes?.low_dose && (
            <p className="prose">Hugging the cliffs puts the astronaut in modeled shade but adds <b>{sgn((sum("time_h", "shelter") / sum("time_h", "low_dose") - 1) * 100, 0)} %</b> walking time,
              so its dose is <b>{sgn((sum("dose_uGy", "shelter") / sum("dose_uGy", "low_dose") - 1) * 100, 0)} %</b> against the lowest-dose route. Time outside matters more than shade while walking.</p>
          )}
          <Slider label={<>Suited walking speed <A>(Tobler hiking function × factor)</A></>} value={suit} min={0.4} max={0.8} step={0.05} onChange={setSuit} fmt={(v) => `× ${v.toFixed(2)}`} />
          <p className="muted">Routes, times and doses recalculate in your browser (16-direction grid, 5 m, slopes over 25° avoided), using the same engine as the Python pipeline.</p>
          {errMsg && <p className="err">{errMsg}</p>}
          <button className="btn primary" disabled={!routes} onClick={() => goto(2)}>Plan the activity</button>
        </>)}

        {step === 2 && (<>
          <h2 className="q">How long will the science take?</h2>
          <p className="prose">{D.activity_label} at {D.name.split(",")[0]}.</p>
          <Slider label={<>Time at the site <A>(planning assumption)</A></>} value={dur} min={0.25} max={Math.max(8, D.duration_h[2])} step={0.25} onChange={setDur} fmt={h} />
          <div className="row"><span className="muted">Your EVA time limit</span>
            <Seg label="EVA time limit" value={limit} onChange={setLimit} options={[[0, "None"], [4, "4 h"], [6, "6 h"], [8, "8 h"]]} /></div>
          <div className="stats">
            <div><b>{h(totalT)}</b><span>outside in total</span></div>
            <div><b><P>{total.toFixed(1)}</P></b><span>µGy modeled</span></div>
            <div><b>{((total / Dflat) * 100).toFixed(0)} %</b><span>of a day on open ground</span></div>
          </div>
          {plan.prelim && <p className="muted small">Preliminary, to the target point. Checking workable ground (slope up to 15°) within {radius} m…</p>}
          {overLimit && <p className="flagline">This plan exceeds the {limit} h limit you set by {h(totalT - limit)}.</p>}
          <div>
            <div className="budget" aria-label="Dose budget">
              <i style={{ flex: plan.outDose, background: "#7db3cb" }} />
              <i style={{ flex: stopDose, background: "#d0904f" }} />
              {ret && <i style={{ flex: plan.backDose, background: "#4f7f95" }} />}
            </div>
            <div className="budget-key" style={{ marginTop: 6 }}>
              <span><i style={{ background: "#7db3cb" }} />walk out {plan.outDose.toFixed(1)}</span>
              <span><i style={{ background: "#d0904f" }} />at the site {stopDose.toFixed(1)}</span>
              {ret && <span><i style={{ background: "#4f7f95" }} />walk back {plan.backDose.toFixed(1)}</span>}
            </div>
          </div>
          <p className="muted">The time limit is yours to set: MarsShield does not model oxygen, power or life support.</p>
          <button className="btn primary" onClick={() => goto(3)}>Where should the astronaut stand?</button>
        </>)}

        {step === 3 && (<>
          <h2 className="q">Is it worth walking to a more sheltered spot?</h2>
          <p className="prose">The science can be done anywhere within <A>{radius} m</A> of the target. A sheltered spot means extra walking but a lower dose rate while working.
            Walking is compared along your <b>{plan.strategy.toLowerCase()}</b> route{ret ? ", there and back" : ", one way"}.</p>
          {!be && <p className="muted">Comparing every workable spot within the radius, in your browser…</p>}
          {be && (<>
            <TradeoffChart T={be.T} envelope={be.envelope} dwell={dur} err={`${err.mae_pp.toFixed(1)} points`}
              options={be.options.map((o) => ({ key: o.keys.join("="), W: o.W, r: o.r, color: OPT_COLORS[o.keys[0]],
                dashed: o !== be.options[0] && Math.abs(o.rel - be.options[0].rel) * 100 < err.mae_pp }))} />
            <table className="data pick">
              <thead><tr><th>Spot</th><th>From target</th><th>Rate</th><th>Total at {h(dur)}</th></tr></thead>
              <tbody>{be.options.map((o) => (
                <tr key={o.keys.join("")} aria-selected={o === spot} tabIndex={0} onClick={() => setPlanKey(o.keys[0])} onKeyDown={(e) => e.key === "Enter" && setPlanKey(o.keys[0])}><td><span className="sw" style={{ borderColor: OPT_COLORS[o.keys[0]] }} />{o.keys.join("=")}: {o.labels[0]}</td>
                  <td>{o.dist_from_target_m.toFixed(0)} m</td><td><P>×{o.rel.toFixed(3)}</P></td><td><P>{(o.W + dur * o.r).toFixed(1)} µGy</P></td></tr>))}</tbody>
            </table>
            {decision && (
              <div className="callout">
                <div className="row"><Chip kind={decision.chip}>{decision.label}</Chip></div>
                <p className="prose">{decision.text}</p>
                {siteFlags(ds, decision.best.x, decision.best.y).map((f) => <p key={f} className="flagline">{f}</p>)}
                <p className="muted">A screening rule, not a guarantee: the error threshold comes from only eight measured parking periods.</p>
              </div>
            )}
            <p className="plan-note">Your plan: spot <b>{plan.spotKey}</b> ({plan.spotLabel.toLowerCase()}, {plan.fromTarget.toFixed(0)} m from the target){planKey && planKey !== defaultKey ? ", your choice" : ""}.
              {" "}Walking <P>{plan.walkDose.toFixed(1)}</P> + {h(dur)} at the spot <P>{stopDose.toFixed(1)}</P> = <P>{total.toFixed(1)} µGy</P>. Click a row to plan at another spot.</p>
          </>)}
          <Slider label={<>Work radius <A>(how far the task can move)</A></>} value={radius} min={20} max={200} step={10} onChange={(v) => { setRadius(v); }} fmt={(v) => `${v} m`} />
          <button className="btn primary" disabled={!be} onClick={() => goto(4)}>Check the evidence</button>
        </>)}

        {step === 4 && (<>
          <h2 className="q">What did Curiosity actually measure here?</h2>
          <Grammar />
          {D.measured_rad ? (
            <div className="figure-pair">
              <div><b><M>{D.measured_rad.E_mean_uGy_d.toFixed(0)}</M></b><span>µGy/day measured by RAD, {D.measured_rad.utc_start?.slice(0, 10)} to {D.measured_rad.utc_end?.slice(0, 10)}</span></div>
              <div><b><M>{D.measured_rad.local_anomaly != null ? `${sgn(D.measured_rad.local_anomaly * 100)} %` : "n/a"}</M></b><span>against the surrounding ±15 sols</span></div>
            </div>
          ) : <p className="muted">No RAD summary at Curiosity&apos;s position for this site.</p>}
          {(() => {
            const near = ds.terrainSignal?.rows.filter((r) => Math.hypot(r.x - D.x, r.y - D.y) < 40) ?? [];
            if (!near.length) return null;
            const avg = (k: "y_obs" | "m_terrain" | "g_proxy") => (near.reduce((s, r) => s + r[k], 0) / near.length) * 100;
            return <p className="prose">At Curiosity&apos;s {near.length} stop{near.length > 1 ? "s" : ""} here, the dose was <M>{sgn(avg("y_obs"))} %</M> against its surroundings.
              The terrain model predicted <P>{sgn(avg("m_terrain"))} %</P> and the simple blocked-sky rule <P>{sgn(avg("g_proxy"))} %</P>.</p>;
          })()}
          {ds.periods.filter((q) => q.kind === "parking" && Math.hypot(q.x - D.x, q.y - D.y) < 60).map((q) => (
            <p key={q.id} className="prose">Published terrain-shielding period {q.id}: RAD dropped <M>{((q.pub.decrease ?? 0) * 100).toFixed(1)} %</M> against a nearby background position.</p>))}
          {ds.skiesTargets[dest] && (<>
            <SkyDisc sky={ds.skiesTargets[dest]} size={260} />
            <More label="How much dose arrives from each part of the sky"><ZenithBars sky={ds.skiesTargets[dest]} /></More>
          </>)}
          <button className="btn primary" onClick={() => goto(5)}>See the conclusion</button>
        </>)}

        {step === 5 && (<>
          <h2 className="q">Mission summary</h2>
          <ul className="prose" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Route: <b>{plan.strategy.toLowerCase()}</b>, {km(plan.distance)}, {h(plan.walkT)} walking{ret ? " including the return" : ""}.</li>
            <li>Work: {h(dur)} at {D.name.split(",")[0]}, {plan.spotKey ? `standing at spot ${plan.spotKey} (${plan.spotLabel.toLowerCase()}, ${plan.fromTarget.toFixed(0)} m from the target)` : "at the target point"}{limit ? `; ${overLimit ? "exceeds" : "within"} your ${limit} h limit` : ""}.</li>
            <li>Modeled galactic cosmic-ray dose: <P>{plan.walkDose.toFixed(1)}</P> walking + <P>{stopDose.toFixed(1)}</P> working = <P>{total.toFixed(1)} µGy</P>, {h(totalT)} outside.</li>
            {decision && <li>Stop comparison: {decision.label.toLowerCase()}{decision.status !== "stay" && decision.best !== spot ? `; spot ${decision.best.keys[0]} would save ${(plan.walkDose + stopDose - (decision.best.W + dur * decision.best.r)).toFixed(2)} µGy but was not adopted` : ""}.</li>}
          </ul>
          <div className="callout">
            <b>What this plan does not tell you</b>
            <p className="prose">This is modeled absorbed dose in Curiosity&apos;s plastic detector during quiet solar conditions. It is not an astronaut&apos;s effective dose, says nothing about solar storms,
              and is not a safety assessment: rockfall, footing, suit limits and life support are not modeled.</p>
          </div>
          <div className="row">
            <button className="btn primary" onClick={exportRun}>Export this plan (JSON)</button>
            <button className="btn" onClick={() => goto(0)}>Plan another</button>
          </div>
        </>)}
      </div>
    </>
  );
}
