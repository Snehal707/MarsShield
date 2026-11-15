"use client";
// Three-region radiation comparison: one published transport model (Zhang et al. 2022) at one atmosphere source (MCD v6.2),
// under assumptions the visitor sets once and that apply to every site. Shared by the Mars overview and the regional views.
import { useEffect, useState, type ReactNode } from "react";
import { cumulative, loadRadiation, noiseFor, QUANTITIES, rateAt, sitePressure, type Quantity, type Radiation } from "@/lib/radiation";
import { makeZip } from "@/lib/zip";
import { saveFile, software } from "./ExperimentTools";
import { LegendRow, Mark, useSize } from "./ResearchCharts";
import { Seg, Slider } from "./ui";

export type Scenario = { q: Quantity; phi: number; season: "mean" | "low" | "high"; sols: number };
export const DEFAULT_SCENARIO: Scenario = { q: "effective", phi: 700, season: "mean", sols: 500 };
const SEASON_LABEL = { mean: "Annual mean", low: "Ls 150 (low pressure)", high: "Ls 255 (high pressure)" } as const;
const SITE_COLOR: Record<string, string> = { gale: "#e7b37d", jezero: "#7db3cb", olympus: "#c48bd6" };

export function useRadiation() {
  const [R, setR] = useState<Radiation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadRadiation().then(setR).catch((e) => setErr(String(e))); }, []);
  return { R, err };
}

export function rows(R: Radiation, sc: Scenario) {
  const phi = QUANTITIES[sc.q].phiFixed ?? sc.phi;
  const gale = R.sites.find((s) => s.id === "gale")!;
  const g = rateAt(R, sc.q, phi, sitePressure(gale, sc.season)).v;
  const noise = noiseFor(R, sc.q, phi);
  return R.sites.map((s) => {
    const p = sitePressure(s, sc.season), r = rateAt(R, sc.q, phi, p);
    // range over the whole seasonal pressure span (the published curve is not monotonic at the Monte Carlo noise level,
    // so the two seasonal end points alone can miss the annual-mean value)
    const span = Array.from({ length: 41 }, (_, k) => rateAt(R, sc.q, phi, s.season_low.pressure_pa + (k / 40) * (s.season_high.pressure_pa - s.season_low.pressure_pa)).v);
    const lo = Math.min(...span), hi = Math.max(...span);
    const band = s.pressure_assumption_band ? [rateAt(R, sc.q, phi, p * (1 - s.pressure_assumption_band.rel)).v, rateAt(R, sc.q, phi, p * (1 + s.pressure_assumption_band.rel)).v] : null;
    const d = r.v / g - 1;
    return { s, p, X: p / 37.1, rate: r.v, edge: r.edge, perSol: (r.v * R.sol_days) / 365.25, total: cumulative(R, r.v, sc.sols),
      seasonRange: [Math.min(lo, hi), Math.max(lo, hi)] as [number, number], band, dVsGale: d, resolved: s.id === "gale" ? null : Math.abs(d) > 2 * noise };
  });
}

export function ScenarioControls({ sc, set, compact = false }: { sc: Scenario; set: (s: Scenario) => void; compact?: boolean }) {
  const fixed = QUANTITIES[sc.q].phiFixed;
  return (
    <div className="scenario" role="group" aria-label="Matched assumptions for every site">
      <div className="row"><span className="muted">Quantity</span>
        <Seg label="Quantity" value={sc.q} onChange={(q) => set({ ...sc, q })} options={[["effective", "Effective dose"], ["doseEq", "Dose equivalent"], ["water", "Absorbed (water)"]]} /></div>
      <div className="row"><span className="muted">Solar modulation</span>
        {fixed ? <span className="muted small">{fixed} MV (the only value published for this quantity)</span>
          : <Seg label="Solar modulation potential" value={sc.phi} onChange={(phi) => set({ ...sc, phi })} options={[[400, "400 MV, solar minimum"], [700, "700 MV"], [1000, "1000 MV, solar maximum"]]} />}</div>
      <div className="row"><span className="muted">Season</span>
        <Seg label="Season" value={sc.season} onChange={(season) => set({ ...sc, season })} options={[["mean", "Annual mean"], ["low", "Ls 150"], ["high", "Ls 255"]]} /></div>
      {!compact && <Slider label="Mission duration on the surface" value={sc.sols} min={10} max={1000} step={10} onChange={(sols) => set({ ...sc, sols })} fmt={(v) => `${v} sols`} />}
      <p className="muted small">{QUANTITIES[sc.q].desc}. The same values apply to every site.</p>
    </div>
  );
}

const fmt = (v: number, d = 1) => v.toLocaleString("en", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} %`;

export function CompareTable({ R, sc, highlight }: { R: Radiation; sc: Scenario; highlight?: string }) {
  const rs = rows(R, sc), u = QUANTITIES[sc.q].unit, cu = u.replace("/yr", "");
  return (
    <div className="cmp-wrap">
      <table className="dt wrap cmp-t">
        <caption className="sr-only">{QUANTITIES[sc.q].label} at each site, {SEASON_LABEL[sc.season]}, matched assumptions</caption>
        <thead><tr><th scope="col">Site</th><th scope="col" className="num">Air overhead (MCD)</th>
          <th scope="col" className="num">{QUANTITIES[sc.q].short}</th><th scope="col" className="num">{sc.sols} sols</th><th scope="col" className="num">vs Gale</th></tr></thead>
        <tbody>{rs.map((r) => (
          <tr key={r.s.id} aria-current={r.s.region === highlight ? "true" : undefined}>
            <td><i className="site-dot" style={{ background: SITE_COLOR[r.s.region] }} aria-hidden="true" />{r.s.name}{r.edge && <span className="flag" title="Below the lowest published pressure (82 Pa): evaluated at that node, not extrapolated"> grid edge</span>}</td>
            <td className="num">{fmt(r.p, 0)} Pa<span className="range">{fmt(r.X, 2)} g/cm²</span></td>
            <td className="num"><span className="v-model">{fmt(r.rate)}</span> <span className="muted small">{u}</span>
              <span className="range">season {fmt(r.seasonRange[0])}–{fmt(r.seasonRange[1])}{r.band ? `; ±10 % pressure ${fmt(Math.min(...r.band))}–${fmt(Math.max(...r.band))}` : ""}</span></td>
            <td className="num"><span className="v-model">{fmt(r.total)}</span> <span className="muted small">{cu}</span></td>
            <td className="num">{r.resolved == null ? "reference" : <>{pct(r.dVsGale)}<span className={`res ${r.resolved ? "yes" : "no"}`}>{r.resolved ? "beyond table scatter" : "within table scatter"}</span></>}</td>
          </tr>))}</tbody>
      </table>
      <p className="muted small">All values are model estimates: AtRIS/Geant4 surface tables (Zhang et al. 2022) at Mars Climate Database pressures, quiet-time galactic cosmic rays, open flat ground, no habitat or suit shielding. &ldquo;Beyond table scatter&rdquo; means the difference exceeds twice the point-to-point scatter of the published curves ({(noiseFor(R, sc.q, sc.phi) * 100).toFixed(1)} %). That scatter is an empirical indicator, not a verified Monte Carlo uncertainty interval, so these labels are a model comparison, not a statistical significance test. Cumulative dose uses 1 sol = {R.sol_days.toFixed(4)} Earth days.</p>
    </div>
  );
}

export function MeasuredContext({ R }: { R: Radiation }) {
  const m = R.gale_rad_measured;
  return (
    <div className="measured-box">
      <p className="role">Measured, Gale only, a different quantity</p>
      <p><b className="v-measured">{fmt(m.median)} µGy/day</b> median RAD E dose rate at Curiosity&apos;s {m.n_stops} stops, {m.period[0]} to {m.period[1]} (range {fmt(m.range[0], 0)}–{fmt(m.range[1], 0)}).</p>
      <p className="muted small">{m.note} No ionizing-radiation detector has operated at Jezero or Olympus Mons.</p>
    </div>
  );
}

/** Dose against surface pressure: the published curve (nodes joined), a ±2× table-scatter band (not a confidence interval), and the sites with seasonal ranges. */
export function DoseVsPressure({ R, sc }: { R: Radiation; sc: Scenario }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const phi = QUANTITIES[sc.q].phiFixed ?? sc.phi;
  const nodes = sc.q === "effective" ? R.model.pressures_pa : sc.q === "water" ? R.tables.water_absorbed_mGy_yr_580MV.pressures_pa : R.tables.dose_equivalent_mSv_yr_580MV.pressures_pa;
  const vals = nodes.map((p) => rateAt(R, sc.q, phi, p).v), noise = noiseFor(R, sc.q, phi);
  const rs = rows(R, sc);
  const all = vals.flatMap((v) => [v * (1 - 2 * noise), v * (1 + 2 * noise)]).concat(rs.flatMap((r) => r.seasonRange));
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.1;
  const pl = 54, pr = 16, pt = 12, pb = 40;
  const lx = (p: number) => Math.log(p), x0 = lx(70), x1 = lx(1300);
  const sx = (p: number) => pl + ((lx(p) - x0) / (x1 - x0)) * (w - pl - pr), sy = (v: number) => pt + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (h - pt - pb);
  const curve = nodes.map((p, i) => `${i ? "L" : "M"}${sx(p).toFixed(1)},${sy(vals[i]).toFixed(1)}`).join("");
  const band = nodes.map((p, i) => `${i ? "L" : "M"}${sx(p).toFixed(1)},${sy(vals[i] * (1 + 2 * noise)).toFixed(1)}`).join("") +
    nodes.slice().reverse().map((p, k) => `L${sx(p).toFixed(1)},${sy(vals[nodes.length - 1 - k] * (1 - 2 * noise)).toFixed(1)}`).join("") + "Z";
  const ticks = [100, 200, 500, 1000];
  const u = QUANTITIES[sc.q].unit;
  return (
    <div className="rc-wrap">
      <div className="rc-tools">
        <LegendRow items={[{ shape: "circle", color: "#7db3cb", label: "Published model nodes" }, { shape: "square", color: "#c48bd6", label: "Site estimate (bar: season)" }]} />
        <span className="muted small">Shaded: ±2× table scatter (not a confidence interval)</span>
      </div>
      <div className="rc-area" ref={ref} onMouseLeave={() => setTip(null)}>
        <svg width={w} height={h} role="img" aria-label={`${QUANTITIES[sc.q].label} against surface pressure from the published model, with the three sites marked`}>
          <g className="rc-grid">{ticks.map((t) => <g key={t}><line x1={sx(t)} x2={sx(t)} y1={pt} y2={h - pb} /><text x={sx(t)} y={h - pb + 14} textAnchor="middle">{t} Pa</text></g>)}</g>
          <text x={pl + (w - pl - pr) / 2} y={h - 6} textAnchor="middle" className="rc-axis">surface pressure (log scale); column depth = pressure / 37.1 Pa per g/cm²</text>
          <text x={14} y={pt + (h - pt - pb) / 2} transform={`rotate(-90 14 ${pt + (h - pt - pb) / 2})`} textAnchor="middle" className="rc-axis">{u}</text>
          {[lo, (lo + hi) / 2, hi].map((v) => <text key={v} x={pl - 6} y={sy(v) + 4} textAnchor="end" className="rc-axis-n">{fmt(v)}</text>)}
          <path d={band} className="rc-band" />
          <path d={curve} fill="none" stroke="#7db3cb" strokeWidth={1.6} strokeDasharray="4 3" />
          {nodes.map((p, i) => <Mark key={p} shape="circle" x={sx(p)} y={sy(vals[i])} r={4} color="#7db3cb" />)}
          {rs.map((r) => {
            const xx = sx(r.p), c = SITE_COLOR[r.s.region];
            return (<g key={r.s.id} onMouseEnter={() => setTip({ x: xx, y: sy(r.rate), body: <><b>{r.s.name}</b><span>{fmt(r.p, 0)} Pa ({fmt(r.X, 2)} g/cm²)</span><span>{fmt(r.rate)} {u}; season {fmt(r.seasonRange[0])}–{fmt(r.seasonRange[1])}</span></> })}>
              <line x1={xx} x2={xx} y1={sy(r.seasonRange[0])} y2={sy(r.seasonRange[1])} stroke={c} strokeWidth={2} />
              <Mark shape="square" x={xx} y={sy(r.rate)} r={5} color={c} />
              <circle cx={xx} cy={sy(r.rate)} r={12} fill="transparent" />
            </g>);
          })}
        </svg>
        {tip && <div className="rc-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.body}</div>}
      </div>
      <p className="muted small dock-cap">Published nodes at {nodes.join(", ")} Pa{QUANTITIES[sc.q].phiFixed ? ` (${QUANTITIES[sc.q].phiFixed} MV)` : ` (${phi} MV)`}; between them the model is a straight line in pressure, and it is never extended beyond them. The Olympus sites sit at the 82 Pa end, which the paper computed for the top of Olympus Mons.</p>
    </div>
  );
}

export function ValidationNotes({ R }: { R: Radiation }) {
  const v = R.validation, s = v.rad_pressure_slope;
  return (
    <div className="val-notes">
      <div className="note"><p><b>Reproduction (achieved).</b> {v.reproduction.what}: {v.reproduction.integrated_mGy_yr.map((x, i) => `${fmt(x, 2)} against ${fmt(v.reproduction.published_mGy_yr[i], 2)}`).join("; ")} mGy/yr at {v.reproduction.pressures_pa.join(", ")} Pa (within {Math.max(...v.reproduction.rel_diff.map(Math.abs)) * 100 < 1.5 ? "1.5" : "2"} %).</p></div>
      <div className="note"><p><b>Pressure response at Gale (a limitation, not a like-for-like test).</b> Curiosity&apos;s RAD E detector (plastic, inside the rover) sees dose fall as pressure rises over the day: {s.rad_observed.value} ± {s.rad_observed.sigma} {s.rad_observed.unit} ({s.rad_observed.source}). The model&apos;s water-sphere absorbed dose changes by {s.model_water_total_uGy_day_Pa} {s.rad_observed.unit} between whole-year surface simulations near Gale&apos;s pressure, roughly 50× less. The detector material, geometry and observing conditions differ, so this is not a direct validation failure; it does mean the model&apos;s small pressure dependence, and the regional differences that follow from it, are uncertain.</p></div>
      <div className="note"><p><b>Atmosphere check.</b> At Jezero, MEDA pressure (normalised to the landing elevation) and the Mars Climate Database differ by {v.pressure_checks.meda_vs_mcd_jezero_pct} %. Nothing comparable exists for Olympus Mons.</p></div>
      <div className="note"><p><b>What has and has not been shown.</b> Fitting: {v.levels.fitting}. Reproduction: {v.levels.reproduction}. Independent validation: {v.levels.independent_validation}.</p></div>
    </div>
  );
}

export function UncertaintyList({ R }: { R: Radiation }) {
  return (
    <ul className="unc-list">{R.uncertainty.terms.map((t) => (
      <li key={t.term}><span className={`unc-kind k-${t.kind.replace(/\s/g, "-")}`}>{t.kind}</span><b>{t.term}</b><span>{t.value}. {t.source}.</span></li>))}</ul>
  );
}

export function Blockers({ R }: { R: Radiation }) {
  return <ul className="blockers">{R.blockers.map((b) => <li key={b}>{b}</li>)}</ul>;
}

export function RadiationDownloads({ R, sc }: { R: Radiation; sc: Scenario }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const csv = () => {
    const phi = QUANTITIES[sc.q].phiFixed ?? sc.phi;
    const head = ["site_id", "site_name", "season", "pressure_pa", "pressure_source", "column_g_cm2", "quantity", "unit", "phi_MV", "rate_per_year", "season_low", "season_high",
      "olympus_pressure_band_low", "olympus_pressure_band_high", "at_grid_edge", "mission_sols", "cumulative", "rel_diff_vs_gale", "beyond_2x_table_scatter", "status"];
    const lines = rows(R, sc).map((r) => [r.s.id, `"${r.s.name}"`, sc.season, r.p.toFixed(1), r.s.pressure_source, r.X.toFixed(3), sc.q, QUANTITIES[sc.q].unit, phi, r.rate.toFixed(3),
      r.seasonRange[0].toFixed(3), r.seasonRange[1].toFixed(3), r.band ? Math.min(...r.band).toFixed(3) : "", r.band ? Math.max(...r.band).toFixed(3) : "", r.edge, sc.sols, r.total.toFixed(3),
      r.dVsGale.toFixed(5), r.resolved ?? "reference", "model estimate; not validated outside Gale"].join(","));
    return [head.join(","), ...lines].join("\n") + "\n";
  };
  const pkg = () => {
    const sw = software();
    const readme = `# MarsShield three-region radiation comparison

Generated ${new Date().toISOString()} by ${sw.name} ${sw.version} (commit ${sw.commit}), ${sw.app_url}

## Scenario (matched for every site)
- Quantity: ${QUANTITIES[sc.q].label} (${QUANTITIES[sc.q].unit})
- Solar modulation: ${QUANTITIES[sc.q].phiFixed ?? sc.phi} MV (BON2010 convention of the source model)
- Season: ${SEASON_LABEL[sc.season]}
- Mission duration: ${sc.sols} sols (1 sol = ${R.sol_days} Earth days)

## Files
- comparison.csv: one row per site for this scenario
- model_tables.json: the published surface tables used, the site pressures, uncertainty terms, validation results and blockers (radiation.json)
- scenario.json: the settings above

## Method
${R.model.name}, ${R.model.gcr}; doi:${R.model.doi}; data doi:${R.model.data_doi} (md5 ${R.model.data_md5}).
Interpolation: ${R.model.interpolation}.
Site pressures: Mars Climate Database v6.2 (modeled), see each site's query URL in model_tables.json.

## Status
Model estimates. ${R.model.not_rad_e} No ionizing-radiation measurement exists at Jezero or Olympus Mons; these values are not validated there and are not astronaut risk or safety assessments.
`;
    const zip = makeZip([{ name: "README.md", data: readme }, { name: "comparison.csv", data: csv() }, { name: "model_tables.json", data: JSON.stringify(R, null, 2) },
      { name: "scenario.json", data: JSON.stringify({ ...sc, software: sw }, null, 2) }]);
    saveFile(`marsshield-three-region-radiation-${stamp}.zip`, zip as BlobPart, "application/zip");
  };
  return (
    <div className="dl-bar" role="group" aria-label="Download the comparison">
      <div className="dl-actions">
        <button className="btn dl" onClick={() => saveFile(`marsshield-three-region-${sc.q}-${stamp}.csv`, csv(), "text/csv;charset=utf-8")}>Data (CSV)</button>
        <button className="btn dl" onClick={pkg}>Research package (ZIP)</button>
      </div>
    </div>
  );
}

/** The comparison workspace content for the dock: chart on the left, table and context on the right. */
export function CompareDock({ R, sc, highlight }: { R: Radiation; sc: Scenario; highlight?: string }) {
  return (
    <div className="dock-grid cmp-grid">
      <div className="dock-main"><DoseVsPressure R={R} sc={sc} /></div>
      <div className="dock-side"><CompareTable R={R} sc={sc} highlight={highlight} /></div>
    </div>
  );
}

