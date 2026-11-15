"use client";
// The guided opening: one real comparison at Maria Gordon Notch, told in five steps. Every number is read from the
// exported NASA RAD reduction (experiment_parking.json, validation.json); nothing here is animated data.
import { useEffect, useState } from "react";
import type { Dataset } from "@/lib/data";
import type { ScenePin } from "./TerrainScene";
import { dropScale, GUESS_MAX } from "@/lib/storyScale";
import { M, P } from "./ui";

type Mode = "mission" | "experiment" | "evidence";
export type StoryScene = { pins: ScenePin[]; sky: boolean; focus: { x: number; y: number; dist: number } };
const STEPS = ["The place", "The question", "The model", "The measurement", "What it means"];

export function NotchStory({ ds, setStoryScene, onDone }: { ds: Dataset; setStoryScene: (s: StoryScene) => void; onDone: (m: Mode, exp?: "parking") => void }) {
  const [step, setStep] = useState(0);
  const [guess, setGuess] = useState<number | null>(null);
  const inside = ds.parking.periods.P6, mouth = ds.parking.periods.BG6;
  const pair = ds.validation.pairs.find((q: { pair: string }) => q.pair.startsWith("P6")) as
    { measured_ours: number; pred_albedo_019: number; pred_proportional: number };
  const measured = -pair.measured_ours, model = -pair.pred_albedo_019, rule = -pair.pred_proportional;
  const apart = Math.hypot(inside.x - mouth.x, inside.y - mouth.y);
  const date = new Date(inside.utc[0]).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  useEffect(() => {
    const pins: ScenePin[] = [
      { key: "p6", x: inside.x, y: inside.y, label: "Inside the notch", color: "#f6f1e7", size: 4.6, selected: step >= 3 },
      { key: "bg6", x: mouth.x, y: mouth.y, label: "Notch mouth", color: "#b9ab97", size: 4.6 },
    ];
    const dist = [620, 330, 380, 380, 520][step];
    setStoryScene({ pins, sky: step >= 1, focus: { x: (inside.x + mouth.x) / 2, y: (inside.y + mouth.y) / 2, dist } });
  }, [step, inside, mouth, setStoryScene]);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  return (
    <>
      <div className="panel-head story-head">
        <p className="kicker">Gale Crater, Mars</p>
        <h1 className="story-title">Maria Gordon Notch</h1>
        <div className="progress" role="list" aria-label="Story progress">
          {STEPS.map((s, i) => (
            <button key={s} role="listitem" aria-label={`${i + 1}. ${s}`} title={s} aria-current={i === step ? "step" : undefined}
              className={i < step ? "done" : ""} onClick={() => setStep(i)} />))}
        </div>
        <p className="progress-label"><b>{STEPS[step]}</b><span>{step + 1} of {STEPS.length}</span></p>
      </div>
      <div className="panel-body story">
        {step === 0 && (<>
          <p className="lede">In {date}, Curiosity drove into a narrow notch below Mount Sharp and parked twice, <b>{apart.toFixed(0)} m apart</b>: first deep inside, then at the open mouth.</p>
          <p className="prose">At both spots its radiation detector, RAD, recorded the cosmic-ray dose for two to three days. The two markers on the terrain are those parking spots.</p>
        </>)}
        {step === 1 && (<>
          <p className="lede">Deep inside, the walls hide <P>{(inside.B * 100).toFixed(0)} %</P> of the sky. At the mouth, <P>{(mouth.B * 100).toFixed(0)} %</P>.</p>
          <p className="prose">Cosmic rays arrive from the sky, so the walls should shield. But rock struck by cosmic rays also sends some radiation back out. The dark curtain on the terrain is the sky the walls hide.</p>
          <div className="guess">
            <label htmlFor="guess"><b>How much lower was the dose deep inside?</b> <span className="muted">Your guess, optional</span></label>
            <div className="guess-row">
              <input id="guess" type="range" min={0} max={GUESS_MAX} step={1} value={guess ?? 0} onChange={(e) => setGuess(+e.target.value)}
                onPointerUp={(e) => setGuess(+e.currentTarget.value)} onKeyUp={(e) => setGuess(+e.currentTarget.value)} />
              <output>{guess == null ? "–" : `${guess} % lower`}</output>
            </div>
          </div>
        </>)}
        {step >= 2 && (
          <ShieldBars model={model} measured={measured} rule={rule} showMeasured={step >= 3} showRule={step >= 4} guess={guess} mouth={mouth.D_RAD_ours} inside={inside.D_RAD_ours} />
        )}
        {step === 2 && (<>
          <p className="lede">The published physical model counts both effects and predicts the dose inside to be <P>{(model * 100).toFixed(1)} % lower</P>.</p>
          <p className="prose">It traces the sky the walls block and adds radiation re-emitted by the rock (Guo et al. 2021, 2026), using the terrain you see.</p>
          <p className="caveat"><b>A look back, not a blind test.</b> How much radiation the rock re-emits is the model&apos;s one adjustable setting, and its authors partly derived it from Curiosity&apos;s parking measurements, including this notch.</p>
        </>)}
        {step === 3 && (<>
          <p className="lede">Curiosity measured <M>{inside.D_RAD_ours.toFixed(0)} µGy/day</M> inside against <M>{mouth.D_RAD_ours.toFixed(0)}</M> at the mouth: <M>{(measured * 100).toFixed(1)} % lower</M>, twice the predicted drop.</p>
          {guess != null && <p className="prose">Your guess was {guess} %. {Math.abs(guess - measured * 100) < Math.abs(model * 100 - measured * 100) ? "Closer than the model." : "The model was closer."}</p>}
          <p className="muted">NASA RAD Level 2, detector E, {inside.n_obs} and {mouth.n_obs} records at the two spots.</p>
        </>)}
        {step === 4 && (<>
          <p className="lede">Here, the terrain shielded about twice as much as the physical model predicts.</p>
          <ul className="story-points">
            <li>A simpler rule, <i>dose falls in proportion to blocked sky</i>, predicted <P>{(rule * 100).toFixed(0)} %</P> here, much closer.</li>
            <li>But across all eight places where Curiosity parked beside terrain, neither model is reliably better.</li>
            <li>Across Curiosity&apos;s 322 stops, most of the measurable terrain effect comes from strongly shielded places like this notch.</li>
          </ul>
          <p className="muted">Absorbed dose in a plastic detector during quiet solar conditions; not an astronaut&apos;s effective dose or a safety assessment.</p>
        </>)}
        {step < STEPS.length - 1 ? (
          <div className="story-nav">
            {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="btn primary" onClick={next}>{["Ask the question", "See the prediction", "Reveal the measurement", "What it means"][step]}</button>
            <button className="linklike small skip" onClick={() => onDone("mission")}>Skip the story</button>
          </div>
        ) : (
          <div className="story-cta">
            <p className="bridge">Is the notch typical? Put the same two models up against all eight places Curiosity parked beside terrain.</p>
            <button className="btn primary" onClick={() => onDone("experiment", "parking")}>Test the models at all eight spots</button>
            <button className="btn" onClick={() => onDone("mission")}>Plan a Marswalk to the notch</button>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button className="linklike small" onClick={() => setStep(step - 1)}>Back</button>
              <button className="linklike small" onClick={() => onDone("evidence")}>See all the evidence</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** The comparison the story is about: how much lower the dose was deep inside than at the mouth.
 *  Bars are the drop in percent (zero-based), so "twice the predicted drop" is visible as twice the length. */
function ShieldBars({ model, measured, rule, showMeasured, showRule, guess, mouth, inside }: {
  model: number; measured: number; rule: number; showMeasured: boolean; showRule: boolean; guess: number | null; mouth: number; inside: number;
}) {
  const { max, ticks, grid } = dropScale([model * 100, measured * 100, rule * 100], guess);
  const W = 380, pl = 118, pr = 58, x = (v: number) => pl + (Math.min(Math.max(v, 0), max) / max) * (W - pl - pr);
  // keep the guess label inside the plot at the extremes (0 % and the top of the scale)
  const gAnchor = guess == null ? "middle" : x(guess) - pl < 30 ? "start" : W - pr - x(guess) < 30 ? "end" : "middle";
  const rows: { k: string; label: string; sub: string; v: number | null; cls: string }[] = [
    { k: "model", label: "Physical model", sub: "prediction", v: model, cls: "bar-model" },
    ...(showRule ? [{ k: "rule", label: "Simple rule", sub: "prediction", v: rule, cls: "bar-rule" }] : []),
    { k: "meas", label: "Curiosity", sub: "measured by RAD", v: showMeasured ? measured : null, cls: "bar-measured" },
  ];
  const rowH = 40, top = 4, H = top + rows.length * rowH + 20;
  return (
    <figure className="notch-bars" style={{ margin: 0 }}>
      <p className="bars-title">How much lower the dose was deep inside</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
        aria-label={`Drop in dose rate inside the notch: model ${(model * 100).toFixed(1)} %${showMeasured ? `, measured ${(measured * 100).toFixed(1)} %` : ""}${showRule ? `, simple rule ${(rule * 100).toFixed(1)} %` : ""}`}>
        <g className="grid">{grid.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={top} y2={H - 18} />)}</g>
        {guess != null && <g data-guess={guess}>
          <line x1={x(guess)} x2={x(guess)} y1={top} y2={H - 18} stroke="#e7b37d" strokeWidth={2} strokeDasharray="5 3" />
          <text x={x(guess)} y={H - 4} textAnchor={gAnchor} className="guess-lbl">your guess {guess} %</text></g>}
        {rows.map((r, i) => {
          const cy = top + i * rowH;
          return (
            <g key={r.k}>
              <text x={pl - 12} y={cy + 17} textAnchor="end" className="lbl" style={{ fontWeight: 600, fontSize: 12.5 }}>{r.label}</text>
              <text x={pl - 12} y={cy + 30} textAnchor="end">{r.sub}</text>
              {r.v == null
                ? <><rect x={x(0)} y={cy + 6} width={x(max) - x(0)} height={24} rx={4} className="bar-pending" />
                    <text x={(x(0) + x(max)) / 2} y={cy + 22} textAnchor="middle" className="lbl">?</text></>
                : <><rect x={x(0)} y={cy + 6} width={x(r.v * 100) - x(0)} height={24} rx={4} className={`bar ${r.cls}`} />
                    <text x={x(r.v * 100) + 8} y={cy + 23} className={`bar-num ${r.cls}`}>{(r.v * 100).toFixed(1)} %</text></>}
            </g>
          );
        })}
        {ticks.map((t) => {
          // hide a tick label wherever the guess label (about 92 px wide) would overlap it
          if (guess != null) {
            const gx = x(guess), [l, r] = gAnchor === "start" ? [gx, gx + 92] : gAnchor === "end" ? [gx - 92, gx] : [gx - 46, gx + 46];
            if (x(t) > l - 18 && x(t) < r + 18) return null;
          }
          return <text key={t} x={x(t)} y={H - 4} textAnchor={t === 0 ? "start" : "middle"}>{t} %</text>;
        })}
      </svg>
      {showMeasured && <figcaption className="muted">Measured dose rate: <span className="v-measured">{mouth.toFixed(0)} µGy/day</span> at the mouth, <span className="v-measured">{inside.toFixed(0)}</span> deep inside.</figcaption>}
    </figure>
  );
}
