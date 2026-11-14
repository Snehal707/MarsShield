"use client";
import type { Dataset, Mission, ScienceTarget } from "@/lib/data";
import { fmt, relTotal, sampleGrid } from "@/lib/data";
import { Kind, StatusChip } from "./BreakEven";

function MagnitudeContext({ m }: { m: Mission }) {
  const t = m.totals, c = m.context;
  const walkShare = t.walk_uGy / t.total_uGy;
  return (
    <div className="section">
      <h3>How big is this dose?</h3>
      <div className="facts">
        <div className="fact"><b>{t.total_uGy.toFixed(0)} µGy</b><span>whole Marswalk <Kind k="modeled" /></span></div>
        <div className="fact"><b>{(walkShare * 100).toFixed(0)} %</b><span>while walking; {((1 - walkShare) * 100).toFixed(0)} % at stops</span></div>
        <div className="fact"><b>{(c.fraction_of_one_sol_on_open_ground * 100).toFixed(0)} %</b><span>of one full day on open ground</span></div>
      </div>
      <ul className="assumptions">
        <li><Kind k="measured" /> Curiosity&apos;s RAD averaged {c.curiosity_surface_mean_uGy_d.value} ± {c.curiosity_surface_mean_uGy_d.plus_minus} µGy/day on the surface
          (<a href={c.curiosity_surface_mean_uGy_d.url} target="_blank" rel="noreferrer">Hassler et al. 2014</a>) and {c.curiosity_cruise_mean_uGy_d.value} ± {c.curiosity_cruise_mean_uGy_d.plus_minus} µGy/day
          inside the spacecraft during the cruise to Mars (<a href={c.curiosity_cruise_mean_uGy_d.url} target="_blank" rel="noreferrer">Zeitlin et al. 2013</a>).</li>
        <li><Kind k="modeled" /> The same {t.eva_hours.toFixed(1)} hours on open flat ground would give {t.open_flat_same_hours_uGy.toFixed(0)} µGy, so the terrain along this route lowers the modeled total by {(100 * (1 - t.total_uGy / t.open_flat_same_hours_uGy)).toFixed(0)} %.
          Choosing stop locations changes it by {t.saving_vs_targets_uGy.toFixed(2)} µGy compared with working at each target.</li>
        <li>The model&apos;s validated error on dose differences between nearby positions is {c.model_error_pp.mae_pp.toFixed(1)} rate points (mean), about {(c.model_error_pp.mae_pp / 100 * t.total_uGy).toFixed(1)} µGy on this whole walk.
          Absorbed dose in RAD&apos;s plastic detector is not an astronaut&apos;s effective dose.</li>
      </ul>
    </div>
  );
}

export function MissionPanel(p: {
  ds: Dataset; mission: Mission; selected: string[]; toggle: (id: string) => void; reset: () => void;
  plan: () => void; busy: boolean; err: string | null; online: boolean; staticDemo: boolean;
  openBreakEven: (targetId: string) => void; focusOn: (x: number, y: number) => void;
}) {
  const { ds, mission: m } = p;
  const byId: Record<string, ScienceTarget> = Object.fromEntries(ds.scienceTargets.map((t) => [t.id, t]));
  const stopFor = (id: string) => m.stops.find((s) => s.target === id);
  const t = m.totals;
  return (
    <>
      <div className="section">
        <h2>Science Marswalk</h2>
        <p className="prose">
          Visit sites Curiosity actually studied in Gale Crater. For each stop you see why geologists went there, what to look for,
          what Curiosity found, and how long you would work there. MarsShield then decides where to stand while you work, but only
          when its radiation model can genuinely tell the options apart.
        </p>
      </div>

      <div className="section">
        <h3>Choose science objectives</h3>
        <div className="targets">
          {ds.scienceTargets.map((st) => (
            <label key={st.id} className="target-row">
              <input type="checkbox" checked={p.selected.includes(st.id)} onChange={() => p.toggle(st.id)} disabled={p.staticDemo} />
              <span><b>{st.name}</b><em>{st.unit}</em></span>
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {!p.staticDemo && <button className="btn primary" disabled={!p.online || p.busy || p.selected.length < 2} onClick={p.plan}>
            {p.busy ? "Planning (up to 4 min)…" : "Plan this Marswalk"}</button>}
          <button className="btn" onClick={p.reset}>Show example Marswalk</button>
        </div>
        {p.staticDemo && <p className="note" style={{ marginTop: 8 }}>This public demo shows the precomputed example Marswalk. Planning other combinations needs the MarsShield science service (run it locally; see the README).</p>}
        {!p.staticDemo && !p.online && <p className="note" style={{ marginTop: 8 }}>The science service is not running: showing the precomputed example Marswalk.</p>}
        {p.err && <p className="err">{p.err}</p>}
        <p className="muted">Objectives are visited in the order Curiosity reached them. The first is the start and the last is the end of the walk.</p>
      </div>

      <div className="section">
        <div className="facts">
          <div className="fact"><b>{fmt.m(t.distance_m)}</b><span>walking distance <Kind k="modeled" /></span></div>
          <div className="fact"><b>{fmt.h(t.walk_time_h)}</b><span>walking <Kind k="assumption" /></span></div>
          <div className="fact"><b>{fmt.h(t.stationary_time_h)}</b><span>at science stops <Kind k="assumption" /></span></div>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Total {fmt.h(t.eva_hours)} outside. MarsShield does not model life support, EVA-duration limits, rockfall or footing.</p>
      </div>

      <ol className="timeline">
        {m.ids.map((id, i) => {
          const st = byId[id];
          const stop = stopFor(id);
          const role = i === 0 ? "Start" : i === m.ids.length - 1 ? "End" : `Stop ${i}`;
          const ep = m.endpoints.find((e) => e.target === id);
          const xy = stop ? stop.used_xy : ep ? ep.xy : [st.x, st.y];
          const rel = relTotal(sampleGrid(ds.meta, ds.grids.relSky, xy[0], xy[1]), sampleGrid(ds.meta, ds.grids.B, xy[0], xy[1]), m.alpha);
          return (
            <li key={id} className="stop">
              <div className="stop-head">
                <span className="stop-num">{i + 1}</span>
                <div>
                  <button className="linklike" onClick={() => p.focusOn(st.x, st.y)}><b>{st.name}</b></button>
                  <div className="muted">{role}. {st.unit}. Curiosity: {st.curiosity_target}, sols {st.sols[0]}–{st.sols[1]}.</div>
                </div>
              </div>
              <p className="prose"><strong>Objective.</strong> {st.objective}</p>
              <blockquote className="quote">&ldquo;{st.objective_quote}&rdquo;</blockquote>
              <p className="prose"><strong>Look for.</strong> {st.look_for}</p>
              <p className="prose"><strong>What Curiosity found.</strong> {st.curiosity_found}</p>
              <p className="muted">Source: {st.sources.map((s, k) => <a key={k} href={s.url} target="_blank" rel="noreferrer">{s.cite}</a>).reduce((a: React.ReactNode[], el, k) => (k ? [...a, "; ", el] : [el]), [])}</p>
              <table className="data">
                <tbody>
                  <tr><td>Activity <Kind k="assumption" /></td><td>{st.activity_label}: {fmt.h(m.durations_h[id] ?? st.duration_h[1])} planned (range {fmt.h(st.duration_h[0])} to {fmt.h(st.duration_h[2])}), work radius {st.work_radius_m} m</td></tr>
                  <tr><td>Dose rate here <Kind k="modeled" /></td><td>×{rel.toFixed(3)} of open flat ground, {(rel * m.D_flat_uGy_d / 24).toFixed(2)} µGy/h; {((rel * m.D_flat_uGy_d / 24) * (m.durations_h[id] ?? st.duration_h[1])).toFixed(1)} µGy for the planned activity</td></tr>
                  <tr><td>Curiosity RAD here <Kind k="measured" /></td><td>{st.measured_rad ? `${st.measured_rad.E_mean_uGy_d.toFixed(1)} ± ${(st.measured_rad.E_sem ?? 0).toFixed(1)} µGy/day, ${st.measured_rad.utc_start?.slice(0, 10)} to ${st.measured_rad.utc_end?.slice(0, 10)}${st.measured_rad.local_anomaly != null ? `, ${fmt.pct(st.measured_rad.local_anomaly * 100)} against the surrounding ±15 sols` : ""}` : "No RAD summary for this stop"}</td></tr>
                </tbody>
              </table>
              {stop && (
                <div className="decision">
                  <div className="row"><StatusChip s={stop.decision.status} /><Kind k="modeled" /></div>
                  <p className="prose" style={{ marginTop: 6 }}>{stop.decision.text}</p>
                  {stop.used_flags.length > 0 && <ul className="flags">{stop.used_flags.map((f) => <li key={f}>{f}</li>)}</ul>}
                  <button className="btn" onClick={() => p.openBreakEven(id)}>See the break-even analysis</button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <MagnitudeContext m={m} />
    </>
  );
}
