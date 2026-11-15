"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- results are loosely typed JSON produced by the Python pipeline */
// Evidence > Audit: scientific corrections, solar particle event screening, Maria Gordon Notch geometry and the
// parking-period comparisons. Data are fetched only when this section is opened (progressive loading).
import { useEffect, useState } from "react";
import { BASE } from "@/lib/data";
import { M, P, sgn } from "./ui";

const fetchJSON = (n: string) => fetch(`${BASE}/data/${n}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export const CORRECTIONS: [string, string, string, string][] = [
  ["Mission evidence, parking comparison text", "Every site with a parking pair was described as 'deep inside against the notch mouth … the comparison in the opening story'", "Site-specific: positions, separation, dates, modeled sky blocked and the solar-modulation share; only P6 at Maria Gordon Notch is linked to the story", "Reviewer finding, confirmed in MissionMode.tsx"],
  ["Notch target: where 19.4 % was measured", "'RAD recorded a 19.4 % lower dose rate here (P6)' at waypoint 92_0", "At parking position P6 (stop 92_84, 1.6 m from the waypoint) against the notch mouth BG6, 16 m away", "Distance computed from the waypoints"],
  ["Story: model prediction at the notch", "'The published physical model … predicts 9.8 %'; 'twice the predicted drop'", "9.8 % on MarsShield's reconstructed geometry; 13.3 % with the published geometry; measured 19.4 % is about 2× and 1.5× those", "Reproduced in parking_audit.py"],
  ["Story: independence caveat", "Albedo setting 'derived from Curiosity's parking measurements, including this notch'", "The story's 19 % comes from Guo et al. (2021), Murray Buttes; the 18–24 % range (map, 322 stops: 21 %) was derived from these parking periods. The story is retrospective because the geometry was reconstructed afterwards", "Source check"],
  ["Units: stop anomalies shown as %", "100 × log ratio labelled % (e.g. notch stops −17 % and −21 %; event stop +49 %; five-stop average −9.5 %)", "Actual change 100 × (eʸ − 1): −15.9 %, −19.3 %, +62.9 %, −8.7 %; differences in percentage points; RMSE kept on the log scale and labelled", "Unit audit"],
  ["Result wording", "'11.7 % closer to the measurements'", "'11.7 % smaller typical error (RMSE of the log anomaly)', with an explicit note that this is not percentage points of radiation", "Unit audit"],
  ["Effective sample size", "'effective n ≈ 294 of 322'", "Removed: the formula applied to correlations, not to the tested error difference, and ignored site clustering. Uncertainty is stated by resampling the 35 sites", "Reviewer finding, confirmed in terrain_signal.py"],
  ["Pre-specification wording", "'kept, as pre-specified'", "'a choice made before this check; the analysis was not pre-registered'", "Consistency"],
  ["Solar particle events", "Only September 2017 named; data described as quiet-time", "Record-level detection of September 2017 and October 2021; full-sample reference kept, screened results added as sensitivity analyses", "sep_events.py"],
  ["Export metadata", "mid_sol 'midpoint of RAD records'; README '(-4.11 % lower RMSE)'; no background quantities; no input manifest", "Occupancy-window midpoint; 'higher RMSE' wording; stop and background log dose exported; input_manifest.json with file hashes and URLs", "exports.ts, pipeline.py"],
];

function EventChart({ e }: { e: any }) {
  const s: [string, number, number][] = e.series_hourly ?? [];
  const w = e.windows?.["0.10"];
  if (!s.length || !w?.detected) return null;
  const t = s.map((q) => Date.parse(q[0])), v = s.map((q) => q[1]);
  const W = 640, H = 200, pl = 46, pr = 10, pt = 10, pb = 26;
  const t0 = t[0], t1 = t[t.length - 1], hi = Math.max(...v) * 1.05, lo = Math.min(...v) * 0.9;
  const x = (q: number) => pl + ((q - t0) / (t1 - t0)) * (W - pl - pr), y = (q: number) => H - pb - ((q - lo) / (hi - lo)) * (H - pb - pt);
  const [ea, eb] = w.enhancement.map((q: string) => Date.parse(q)), fd = w.forbush?.map((q: string) => Date.parse(q));
  const ticks = [lo, w.baseline_uGy_d, hi].map((q) => Math.round(q / 50) * 50);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Hourly RAD dose rate during the ${e.name}, with the detected event window`}>
        {fd && <rect x={x(fd[0])} y={pt} width={Math.max(1, x(fd[1]) - x(fd[0]))} height={H - pb - pt} fill="rgba(125,179,203,0.10)" />}
        <rect x={x(ea)} y={pt} width={Math.max(1, x(eb) - x(ea))} height={H - pb - pt} fill="rgba(231,179,125,0.18)" />
        <line x1={pl} x2={W - pr} y1={y(w.baseline_uGy_d)} y2={y(w.baseline_uGy_d)} stroke="rgba(239,230,216,0.45)" strokeDasharray="4 4" />
        <path d={t.map((q, i) => `${i ? "L" : "M"}${x(q).toFixed(1)},${y(v[i]).toFixed(1)}`).join("")} fill="none" stroke="#f6f1e7" strokeWidth={1.4} />
        {ticks.map((q) => <text key={q} x={pl - 6} y={y(q) + 4} textAnchor="end">{q}</text>)}
        <text x={pl} y={H - 6}>{s[0][0].slice(0, 10)}</text><text x={W - pr} y={H - 6} textAnchor="end">{s[s.length - 1][0].slice(0, 10)}</text>
        <text x={x(ea) + 4} y={pt + 12} className="lbl">event window</text>
      </svg>
      <figcaption className="muted">NASA RAD detector-E dose rate, hourly medians of the Level 2 records (µGy/day). Shaded gold: detected enhancement ({w.enhancement[0].slice(0, 16)} to {w.enhancement[1].slice(0, 16)} UTC); shaded blue: Forbush decrease used only in a sensitivity variant; dashed: pre-event quiet median.</figcaption>
    </figure>
  );
}

export function AuditSection({ ts }: { ts: any }) {
  const [sep, setSep] = useState<any>(null), [pk, setPk] = useState<any>(null);
  useEffect(() => { fetchJSON("sep_events.json").then(setSep); fetchJSON("parking_audit.json").then(setPk); }, []);
  const scr = ts?.sep_screening?.variants ?? [];
  const pc = (f: number) => sgn(f * 100, 1);
  return (<>
    <h2 className="q">Corrections in this version</h2>
    <p className="prose">Each correction keeps the earlier value here so the change can be checked. No source data or validated calculation was altered; the reference results are unchanged.</p>
    <div className="dt-wrap"><table className="dt wrap"><thead><tr><th>Item</th><th>Before</th><th>After</th><th>Basis</th></tr></thead>
      <tbody>{CORRECTIONS.map((c) => <tr key={c[0]}><td>{c[0]}</td><td>{c[1]}</td><td>{c[2]}</td><td>{c[3]}</td></tr>)}</tbody></table></div>

    <h2 className="q">Solar particle events in the RAD record</h2>
    <p className="prose">Two documented solar particle events fall inside the 322 stops. They were located in the time-resolved RAD records (about 17 minutes each) with a fixed rule: the event window is where the smoothed dose rate exceeds the pre-event quiet median by 10 %. This is a record of what RAD observed (level A), not a radiation model.</p>
    {sep?.events?.filter((e: any) => e.windows?.["0.10"]?.detected).map((e: any) => {
      const w = e.windows["0.10"];
      return <div key={e.id} className="fig-block"><h3 className="fig-h">{e.name}</h3><EventChart e={e} />
        <p className="muted">Peak <M>{w.peak_ratio.toFixed(2)}×</M> the quiet median of <M>{w.baseline_uGy_d.toFixed(0)} µGy/day</M>; window {w.enhancement_hours.toFixed(0)} h. With a 5 % or 20 % threshold the window is {e.windows["0.05"].enhancement_hours.toFixed(0)} h or {e.windows["0.20"].enhancement_hours.toFixed(0)} h.</p></div>;
    })}
    {sep?.events?.filter((e: any) => !e.windows?.["0.10"]?.available).map((e: any) => <p key={e.id} className="muted">{e.name}: not in this dataset (no study-area stop within ±15 sols).</p>)}
    {scr.length > 0 && (<>
      <h3 className="fig-h">Terrain result with event records removed</h3>
      <div className="dt-wrap"><table className="dt"><thead><tr><th>Sample</th><th className="num">Stops</th><th className="num">Records removed</th><th className="num">RMSE time only</th><th className="num">RMSE terrain</th><th className="num">RMSE reduction</th><th className="num">Site 95 % ΔMSE</th></tr></thead>
        <tbody>{scr.map((r: any) => <tr key={r.variant}><td>{r.variant}</td><td className="num">{r.n_stops}</td><td className="num">{r.n_rad_records_excluded}</td>
          <td className="num">{r.rmse_pp.M0.toFixed(2)}</td><td className="num">{r.rmse_pp.M3.toFixed(2)}</td><td className="num">{(r["M3-M0"].rmse_reduction * 100).toFixed(1)} %</td>
          <td className="num">{r["M3-M0"].site_ci95_pp2.map((q: number) => q.toFixed(2)).join(" to ")}</td></tr>)}</tbody></table></div>
      <p className="prose">The historical full sample stays the reference result. Removing the event records leaves the absolute gain almost unchanged (the site intervals overlap); the relative reduction rises because the events inflate every model&apos;s error. Stop 91_1544 is not dropped: 124 of its 373 records fall in the October 2021 window, and its measured change falls from {pc(Math.exp(0.1854) - 1)} % to {pc(Math.exp(0.0244) - 1)} % without them. The remaining records are not established to be free of all solar-particle effects; the terrain model and the blocked-sky rule stay indistinguishable in every variant.</p>
    </>)}

    {pk && (<>
      <h2 className="q">Maria Gordon Notch geometry (P6)</h2>
      <p className="prose">MarsShield&apos;s ray tracing gives <P>{(pk.p6.B_ours * 100).toFixed(1)} %</P> of the sky blocked at P6; the published analysis gives {(pk.p6.B_published * 100).toFixed(1)} % (at the mouth: <P>{(pk.p6.B_BG6_ours * 100).toFixed(1)} %</P> against {(pk.p6.B_BG6_published * 100).toFixed(1)} %). The difference is within the geometric uncertainty of a 16 m-wide notch:</p>
      <div className="dt-wrap"><table className="dt"><thead><tr><th>Factor</th><th className="num">Blocked sky at P6</th></tr></thead><tbody>
        <tr><td>Rover position, 1 m (1σ), 5–95 %</td><td className="num">{pk.p6.position_sensitivity.sigma_1m.p05.toFixed(3)} to {pk.p6.position_sensitivity.sigma_1m.p95.toFixed(3)}</td></tr>
        <tr><td>Rover position, 3 m (1σ), 5–95 %</td><td className="num">{pk.p6.position_sensitivity.sigma_3m.p05.toFixed(3)} to {pk.p6.position_sensitivity.sigma_3m.p95.toFixed(3)}</td></tr>
        {Object.entries(pk.p6_sensitivity.height_m).map(([h, b]: any) => <tr key={h}><td>Detector height {h} m{+h === pk.p6_sensitivity.rad_height_used_m ? " (used)" : ""}</td><td className="num">{b.toFixed(3)}</td></tr>)}
        {Object.entries(pk.p6_sensitivity.near_field_resolution).map(([r, b]: any) => <tr key={r}><td>Near-field DEM coarsened to {r}</td><td className="num">{b.toFixed(3)}</td></tr>)}
        <tr><td>Published (rover panoramas)</td><td className="num">{pk.p6.B_published.toFixed(3)}</td></tr></tbody></table></div>
      <p className="prose">Coarser terrain fills in the notch and lowers the blocked sky, so even the 1 m DEM may under-count it; a metre of position error spans the published value. The physical-model prediction follows the geometry:</p>
      <div className="dt-wrap"><table className="dt"><thead><tr><th>Inputs</th><th className="num">Physical model</th><th className="num">Sky only</th><th className="num">Blocked-sky rule</th></tr></thead><tbody>
        {["ours_alpha0.19", "published_alpha0.19", "ours_alpha0.21", "published_alpha0.21"].map((k) => { const q = pk.p6.predictions[k]; return <tr key={k}>
          <td>{k.startsWith("ours") ? "MarsShield geometry" : "Published geometry"}, albedo {k.slice(-4)}</td><td className="num"><P>{pc(q.physical)} %</P></td><td className="num"><P>{pc(q.sky_only)} %</P></td><td className="num"><P>{pc(q.rule)} %</P></td></tr>; })}
        <tr><td>Curiosity measured (P6 against BG6)</td><td className="num" colSpan={3}><M>{pc(pk.p6.measured_change_ours)} %</M> (published {pc(pk.p6.measured_change_published)} %)</td></tr></tbody></table></div>
      <p className="muted">All rows use the same model and formula (science/marsshield/parking_audit.py); only the geometry inputs differ. None is a blind prediction.</p>

      <h2 className="q">The eight parking comparisons</h2>
      <p className="prose">The measured change between a parking and a background period includes any change in solar activity between them. The physical model includes it (each period&apos;s φ); the simple rule does not. Giving the rule the same flat-ground modulation factor makes the comparison like for like.</p>
      <div className="dt-wrap"><table className="dt"><thead><tr><th>Geometry / measurements</th><th className="num">Physical RMSE</th><th className="num">Rule RMSE</th><th className="num">Rule RMSE, same modulation</th><th>Lowest error, like for like</th></tr></thead><tbody>
        {[["ours", "ours"], ["ours", "published"], ["published", "ours"], ["published", "published"]].map(([g, m]) => {
          const a = pk.variants[`geometry_${g}__measured_${m}`].score, b = pk.variants[`geometry_${g}__measured_${m}__rule_with_modulation`].score;
          return <tr key={g + m}><td>{g === "ours" ? "MarsShield" : "Published"} / {m === "ours" ? "MarsShield reduction" : "published"}</td>
            <td className="num">{a.physical.rmse_pp.toFixed(2)}</td><td className="num">{a.rule.rmse_pp.toFixed(2)}</td><td className="num">{b.rule.rmse_pp.toFixed(2)}</td><td>{b.ranking_by_rmse[0] === "physical" ? "physical model" : b.ranking_by_rmse[0]} (not significant)</td></tr>; })}
      </tbody></table></div>
      <p className="prose">Without the modulation factor the ranking flips with the inputs; with it the physical model has the lower error in all four combinations, but resampling the five sites never excludes zero. Eight periods at five sites cannot rank the models.</p>
      <div className="dt-wrap"><table className="dt"><thead><tr><th>Pair</th><th className="num">Measured</th><th className="num">From solar modulation alone</th><th className="num">Terrain part</th></tr></thead><tbody>
        {pk.modulation_only_change.map((r: any) => <tr key={r.pair}><td>{r.pair}</td><td className="num"><M>{pc(r.measured)} %</M></td><td className="num"><P>{pc(r.modulation_only)} %</P></td>
          <td className="num">{pc((1 + r.measured) / (1 + r.modulation_only) - 1)} %</td></tr>)}</tbody></table></div>
      <p className="muted">Modulation-only change: ratio of the modeled open-flat-ground dose at the two periods&apos; φ (Guo et al. 2026 values). P5&apos;s measured drop is almost entirely solar modulation.</p>
      <h3 className="fig-h">P7 dose-rate discrepancy (unresolved)</h3>
      <p className="prose">MarsShield&apos;s reduction gives <M>{pk.p7.ours_mean.toFixed(1)} µGy/day</M> for P7 ({pk.p7.ours_n} records); Guo et al. (2026) Table 1 gives {pk.p7.published}. No half-sol interval near P7 averages below {pk.p7.min_half_sol.toFixed(0)} µGy/day, and including the {pk.p7.flagged_in_window} flagged records gives {pk.p7.including_flagged_mean.toFixed(1)}. The cause is not identified without the authors&apos; exact time selection; the table above shows both values.</p>
    </>)}
    {!pk && <p className="muted">Loading the audit…</p>}
  </>);
}
