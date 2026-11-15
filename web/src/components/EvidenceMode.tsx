"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- results are loosely typed JSON produced by the Python pipeline */
import { useState } from "react";
import type { Dataset } from "@/lib/data";
import { HorizonCompare, PairDotPlot, ScatterXY, SensitivityBars } from "./Charts";
import { Grammar, M, More, P, sgn } from "./ui";

type Sec = "overview" | "signal" | "validation" | "limits" | "data";
const SECS: [Sec, string][] = [["overview", "Overview"], ["signal", "RAD + pressure analysis"], ["validation", "Validation"], ["limits", "Limitations"], ["data", "Data & reproducibility"]];

export function EvidenceMode({ ds }: { ds: Dataset }) {
  const [sec, setSec] = useState<Sec>("overview");
  const v = ds.validation, au = ds.audit, ts = ds.terrainSignal;
  const A8 = au.A3_eight_pairs["P6_19.4pct_table1"];
  const t = ts as any;
  return (
    <>
      <div className="panel-head">
        <p className="eyebrowless">Evidence</p>
        <p className="sub">What was measured, what was modeled, and how well they agree.</p>
        <div className="subnav" role="tablist">{SECS.map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} aria-pressed={undefined} onClick={() => setSec(k)}>{l}</button>)}</div>
      </div>
      <div className="panel-body">
        <Grammar />
        {sec === "overview" && (<>
          <h2 className="q">Findings</h2>
          <ol className="prose" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 8 }}>
            <li><b>Terrain measurably lowers cosmic-ray dose.</b> Beside cliffs and buttes, Curiosity&apos;s RAD recorded drops of <M>2.1 to 19.4 %</M> (8 published parking periods, reproduced from NASA RAD data).</li>
            {t && <li><b>Across 322 stops, terrain helps reconstruct where dose was locally lower, mostly at one notch.</b> On held-out time blocks the terrain model lowers the typical error against time alone by <P>{(t.rmse_reduction_vs_M0.M3 * 100).toFixed(1)} %</P> (mean squared error by {(t.performance.M3.skill_vs_M0 * 100).toFixed(0)} %).
              {" "}{(t.influence.mgn_site.share * 100).toFixed(0)} % of that gain comes from {t.influence.mgn_site.n} stops at Maria Gordon Notch, a site also used to calibrate the model. Without them the gain is smaller but still clear; without the 10 % most shielded stops it is not distinguishable from zero.</li>}
            {t && <li><b>Pressure control does not change this.</b> After whole-sol averaging, pressure differences between nearby stops are a few pascals: a {t.predictor_spread_pp.pressure_term.toFixed(2)}-point effect.</li>}
            {t && <li><b>Blocking sky overstates shielding.</b> Measured anomalies are <M>{t.calibration.sky_proxy.slope.toFixed(2)}×</M> the blocked-sky prediction (95 % CI {t.calibration.sky_proxy.ci95_site_cluster.map((x: number) => x.toFixed(2)).join(" to ")}), while the terrain-albedo model is consistent with the data (<M>{t.calibration.terrain_model.slope.toFixed(2)}×</M>, {t.calibration.terrain_model.ci95_site_cluster.map((x: number) => x.toFixed(2)).join(" to ")}).</li>}
            <li><b>But head-to-head, the two models are not distinguishable.</b> Neither at the 8 parking periods (MAE {A8.pred_albedo_019.mae_pp.toFixed(2)} vs {A8.pred_proportional.mae_pp.toFixed(2)} pp) nor where they disagree most, once stops are grouped by site.</li>
            <li><b>For walking, time beats shade.</b> Routes that hug cliffs add more dose through extra time than shelter removes.</li>
          </ol>
          <More label="What is measured, what is modeled">
            <p className="prose"><b>Measured:</b> RAD detector-E dose rate (NASA L2, µGy/day), REMS surface pressure (NASA PDS), rover positions (NASA/JPL), terrain and imagery (USGS from MRO HiRISE/CTX).</p>
            <p className="prose"><b>Modeled:</b> sky blocking from our ray tracing on the 1 m terrain, and dose from the published zenith-angle model (Guo et al. 2021, 2026) with terrain albedo.</p>
            <p className="prose"><b>Assumed:</b> walking speeds, activity durations, work radii and slope limits.</p>
          </More>
        </>)}

        {sec === "signal" && t && (<>
          <h2 className="q">Does terrain add information beyond pressure and time?</h2>
          <p className="prose">Each of {t.rows.length} stops is compared with all RAD data within ±{t.window_sols} sols, and the same detrending is applied to every predictor. Models are scored on held-out time blocks ({t.k_blocks} blocks, ±15-sol buffer).</p>
          <div className="note">
            <p><b>What this tests.</b> Whether terrain predicts a stop&apos;s <i>local anomaly</i>: how much its dose differs from Curiosity&apos;s other stops at about the same time (typically a few percent). It reconstructs past anomalies along Curiosity&apos;s traverse; it does not predict absolute dose at new locations.</p>
          </div>
          <table className="data">
            <thead><tr><th>Model</th><th>RMSE (pp)</th><th>RMSE change</th><th>MSE change</th></tr></thead>
            <tbody>{Object.entries(t.performance).map(([k, r]: [string, any]) => (
              <tr key={k}><td>{r.label}</td><td>{r.rmse_pp.toFixed(2)}</td><td>{sgn(-t.rmse_reduction_vs_M0[k] * 100, 1)} %</td><td>{sgn(-r.skill_vs_M0 * 100, 1)} %</td></tr>))}</tbody>
          </table>
          <p className="muted">Changes are against time only. Terrain model vs time only, 95 % interval of ΔMSE resampling whole sites: {t.site_ci95_dMSE_vs_M0_pp2.M3.map((x: number) => sgn(x, 2)).join(" to ")} pp² (blocked-sky proxy: {t.site_ci95_dMSE_vs_M0_pp2.M2.map((x: number) => sgn(x, 2)).join(" to ")}).</p>
          <h2 className="q">Where the gain comes from</h2>
          <table className="data">
            <thead><tr><th>Curiosity site</th><th>Stops</th><th>Share of the gain</th></tr></thead>
            <tbody>{t.influence.site_shares_M3_vs_M0.slice(0, 4).map((r: any) => (
              <tr key={r.site}><td>{r.site}{r.site === 92 ? ", Maria Gordon Notch" : ""}</td><td>{r.n}</td><td>{(r.share * 100).toFixed(0)} %</td></tr>))}</tbody>
          </table>
          <p className="prose">Two notch stops (sols 3322 and 3324, measured −17 % and −21 %) carry {((t.influence.top_stops[0].share + t.influence.top_stops[1].share) * 100).toFixed(0)} % on their own.
            Dropping one site at a time and rerunning the test, the terrain model&apos;s MSE gain ranges from {(t.influence.leave_one_site_out.min.skill_M3 * 100).toFixed(0)} % (without site {t.influence.leave_one_site_out.min.site}) to {(t.influence.leave_one_site_out.max.skill_M3 * 100).toFixed(0)} % (without site {t.influence.leave_one_site_out.max.site}, which contains a solar particle event).</p>
          <More label="Dependence-aware intervals (moving-block bootstrap, 20 stops)">
            <table className="data">
              <thead><tr><th>Comparison</th><th>ΔMSE (pp²)</th><th>95 % interval</th></tr></thead>
              <tbody>{Object.entries(t.mse_differences).map(([k, r]: [string, any]) => (
                <tr key={k}><td>{k.replace("-", " vs ")}</td><td>{sgn(r.L20.mean_dMSE_pp2, 2)}</td><td>{sgn(r.L20.ci95_pp2[0], 2)} to {sgn(r.L20.ci95_pp2[1], 2)}</td></tr>))}</tbody>
            </table>
          </More>
          <h2 className="q">Robustness</h2>
          <table className="data">
            <thead><tr><th>Variant</th><th>n</th><th>Terrain</th><th>Proxy</th></tr></thead>
            <tbody>{t.robustness.map((r: any) => {
              const ok = (m: "M2" | "M3") => r.dMSE_vs_M0_ci95_pp2[m][1] < 0 && (!r.dMSE_vs_M0_site_ci95_pp2 || r.dMSE_vs_M0_site_ci95_pp2[m][1] < 0);
              const v = (m: "M2" | "M3") => (r.rmse_reduction ? sgn(-r.rmse_reduction[m] * 100, 1) : sgn(-r.skill[m] * 100, 0));
              return <tr key={r.variant}><td>{r.variant}</td><td>{r.n}</td><td className={ok("M3") ? "good" : ""}>{v("M3")} %</td><td className={ok("M2") ? "good" : ""}>{v("M2")} %</td></tr>;
            })}</tbody>
          </table>
          <p className="muted">RMSE change against time only. Green: the 95 % interval excludes zero both when resampling time blocks and when resampling whole sites.
            Excluding the solar particle event would raise the relative numbers only because it lowers the baseline error; the pre-specified baseline keeps it.</p>
          <h2 className="q">Is this independent validation?</h2>
          <p className="prose">Partly. The terrain model is not fitted in this cross-validation, but its one free parameter, the albedo share (18–24 %), was derived by Guo et al. (2026) from RAD measurements at the eight parking periods and their backgrounds, including the notch (P6).
            {" "}{t.evaluation_overlap.n_in_published_periods} of the {t.rows.length} stops fall inside those periods, and the stop the day before P6 is at the same notch. The model-error threshold used for stop recommendations comes from the same eight periods.
            Our own design choices (15-sol window, 8 blocks) were reused from the earlier analysis rather than tuned here, but the analysis was not pre-registered.</p>
          <h2 className="q">Dependence between stops</h2>
          <p className="prose">The residual lag-1 autocorrelation is {t.correlations.terrain_model.lag1_autocorr.observed.toFixed(2)} (effective n ≈ {Math.round(t.correlations.terrain_model.n_eff)} of {t.rows.length}).
            The terrain correlation is r = {t.correlations.terrain_model.r.toFixed(2)} (block bootstrap {t.correlations.terrain_model.block20_ci95.map((x: number) => x.toFixed(2)).join(" to ")}; rank correlation {t.spearman_terrain.toFixed(2)}).
            The earlier r = 0.36 used a less consistent comparison; this replaces it.</p>
          <h2 className="q">Pressure</h2>
          <p className="prose">Fitted pressure coefficient {(t.pressure_coefficient.fitted_uGy_d_per_pa).toFixed(3)} µGy/day/Pa, against {t.pressure_coefficient.literature.value} ± {t.pressure_coefficient.literature.err} from diurnal variations (Guo et al. 2015).
            The stop-level design has little pressure leverage, so this coefficient is poorly constrained and pressure control gives no measurable gain. {(t.meta.frac_obs_with_pressure * 100).toFixed(0)} % of RAD observations have a REMS pressure within an hour.</p>
        </>)}

        {sec === "validation" && (<>
          <h2 className="q">The eight parking periods</h2>
          <PairDotPlot pairs={v.pairs} />
          <table className="data">
            <thead><tr><th>Model, all 8</th><th>MAE</th><th>RMSE</th></tr></thead>
            <tbody>{(["pred_albedo_019", "pred_sky_only", "pred_proportional"] as const).map((k) => <tr key={k}><td>{A8[k].name}</td><td>{A8[k].mae_pp.toFixed(2)} pp</td><td>{A8[k].rmse_pp.toFixed(2)} pp</td></tr>)}</tbody>
          </table>
          <h2 className="q">Terrain geometry against published values</h2>
          <ScatterXY lo={0} hi={0.4} xLabel="Published blocked sky" yLabel="MarsShield blocked sky"
            pts={Object.entries(v.periods).map(([k, r]: [string, any]) => ({ x: r.ROS_pub, y: r.B_model, label: `${k} ${r.site}` }))} />
          <p className="muted">Reproduced at 13 of 15 periods; P6 and P8 (narrow canyons) are not.</p>
          <More label="Butte M12 horizon against the RAD team's mask">
            <HorizonCompare az={v.v3_m12_mask.az} a={v.v3_m12_mask.elev_mask} b={v.v3_m12_mask.elev_dem} />
            <p className="muted">RMSE {v.v3_m12_mask.rmse_deg.toFixed(2)}°.</p>
          </More>
          <More label="Sensitivity of blocked sky">
            <SensitivityBars label="Change in blocked sky at the 15 RAD periods"
              rows={[...v.sensitivity.S1_resolution.map((r: any) => ({ name: `DEM ${r.res_m} m`, mean: r.mae_dB * 100, max: r.max_abs_dB * 100 })),
                ...v.sensitivity.S3_height.filter((r: any) => r.h_m !== 1).map((r: any) => ({ name: `Height ${r.h_m} m`, mean: r.mae_dB * 100, max: r.max_abs_dB * 100 }))]} />
          </More>
          <More label="Audit against Guo et al. (2026)">
            <p className="prose">{au.A1_table1_transcription.cells_checked} Table 1 cells checked, {au.A1_table1_transcription.mismatches} mismatches. The paper states two drops for Maria Gordon Notch (19.4 % in Table 1, 17 % in Section 4); NASA data reproduce 19.4 %.</p>
          </More>
        </>)}

        {sec === "limits" && (
          <ul className="prose" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 8 }}>
            <li>Over the eight parking periods the physical model is not demonstrably better than the simple proportional rule.</li>
            <li>Terrain geometry is not reproduced at P6 and P8; a 3 m position error moves blocked sky by about ±4 points in narrow canyons.</li>
            <li>The terrain signal across 322 stops is concentrated at a few strongly shielded sites: about 59 % of the terrain model&apos;s gain comes from 6 stops at Maria Gordon Notch. Without the 10 % most shielded stops it is not distinguishable from zero.</li>
            <li>The 322-stop test reconstructs local anomalies along Curiosity&apos;s past traverse; it does not validate absolute dose predictions at new locations.</li>
            <li>The test is not fully independent: the model&apos;s albedo parameter was calibrated by Guo et al. (2026) on RAD data that include the notch stops.</li>
            <li>Model-error thresholds for stop recommendations are screening heuristics from eight periods, not calibrated guarantees.</li>
            <li>Doses are absorbed dose in RAD&apos;s plastic detector, not human effective dose. Terrain shielding does not establish astronaut safety.</li>
            <li>Not modeled: solar particle events, rockfall and slope stability, footing, suit or vehicle shielding, life support.</li>
            <li>Walking speeds (Tobler hiking function × 0.6), slope limits, activity durations and work radii are planning assumptions.</li>
          </ul>
        )}

        {sec === "data" && (<>
          <h2 className="q">NASA mission data used</h2>
          <table className="data">
            <tbody>
              <tr><td>MSL Curiosity RAD</td><td>Level 2 dosimetry, detector E (NASA SPDF)</td></tr>
              <tr><td>MSL Curiosity REMS</td><td>Surface pressure, MODRDR (NASA PDS Atmospheres)</td></tr>
              <tr><td>MSL navigation</td><td>Localized waypoints (NASA/JPL MMGIS)</td></tr>
              <tr><td>MRO HiRISE and CTX</td><td>USGS Gale 1 m DEM and 25 cm orthophoto</td></tr>
              <tr><td>MGS MOLA, Mars Express HRSC</td><td>Far-field terrain (USGS 200 m blend)</td></tr>
            </tbody>
          </table>
          <h2 className="q">What runs where</h2>
          <p className="prose"><b>In your browser:</b> routes, travel times, walking dose, stop-position break-even, walking-speed and radius sensitivity, all three experiments with their cross-validation and bootstraps. Verified against the Python pipeline to better than 10⁻⁶.</p>
          <p className="prose"><b>Python only:</b> downloading and reducing NASA data, terrain ray tracing (the dose map and sky views are precomputed), and building the analysis tables.</p>
          <More label="Reproduce everything">
            <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>{`pip install -r science/requirements.txt
cd science
python -m marsshield.pipeline     # downloads NASA/USGS data, ~40 min
python -m pytest tests -q
cd ../web && node scripts/verify-engine.mts && node scripts/verify-stats.mts`}</pre>
          </More>
          <More label="All sources">
            <ul className="sources" style={{ paddingLeft: 18 }}>
              {ds.meta.sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>. {s.used}.</li>)}
              <li><a href="https://pds-atmospheres.nmsu.edu/PDS/data/mslrem_1001/" target="_blank" rel="noreferrer">MSL REMS MODRDR (NASA PDS)</a>. Surface pressure sampled at about 180 rows per sol.</li>
              <li><a href="https://doi.org/10.1088/0004-637X/810/1/24" target="_blank" rel="noreferrer">Guo et al. (2015) ApJ 810, 24</a>. Published pressure coefficient for comparison.</li>
              <li><a href="https://doi.org/10.1029/2022JE007185" target="_blank" rel="noreferrer">Bennett et al. (2023) JGR Planets</a>. Science objectives of the Marswalk sites.</li>
            </ul>
          </More>
        </>)}
      </div>
    </>
  );
}
