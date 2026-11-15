# Who MarsShield is for

Three intended audiences, each with one concrete question MarsShield can answer from data, and the path through the app that answers it.

**No external user testing has been done.** The journeys below were walked through by the developer on the public build, at desktop, tablet and phone widths. They describe intended use, not validated use.

## Students and educators

**Question:** *Does standing next to a Martian cliff actually lower your radiation dose, and by how much?*

**Answer in the app:**
- The opening screen shows −19.4 %, measured by Curiosity at Maria Gordon Notch, beside the −9.8 % a published model predicts.
- **Experiment → Does the landscape change the dose?** lets a class choose a model, predict 322 rover stops and only then reveal the measurements.

**Journey:**
1. Opening (30 s).
2. Experiment 1: choose, predict, reveal.
3. Evidence → Overview.

**What it teaches:**
- the difference between a measurement and a model
- why a held-out test matters
- that a result can be "cannot distinguish"

**Weak points:**
- "pp²" and bootstrap intervals need a teacher's explanation. Plain-language verdict chips carry the main message.
- The 3D view needs WebGL; the fallback is a flat orbital image.

## Researchers (planetary radiation, terrain modeling)

**Question:** *After controlling for pressure and time, does local terrain explain additional variation in RAD dose rate, and does a physical terrain-albedo model beat a blocked-sky rule?*

**Answer in the app:**
- Evidence → **RAD + pressure analysis**: seven models scored on held-out time blocks, with block-bootstrap intervals and robustness variants.
- Experiment 3 adds a site-level disagreement test.

The answer for terrain is a qualified yes:
- Held-out RMSE is 11.7 % lower than time alone (MSE 22 %).
- 59 % of the gain comes from six notch stops, a site also used to calibrate the model.
- Without them it is −5.5 %, still clear; without the 10 % most shielded stops it is not distinguishable from zero.
- The test reconstructs local anomalies along Curiosity's past traverse.

The two models cannot be distinguished, and pressure adds no measurable gain at stop level. Experiment 1's "No notch" subset lets a researcher check the concentration directly.

**Journey:**
1. Evidence → RAD + pressure analysis.
2. Data & reproducibility.
3. `docs/VALIDATION.md` (V8) and `science/marsshield/terrain_signal.py`.

**Can change in the browser:**
- model and baseline
- number of time blocks
- bootstrap block length
- subsets
- albedo α and the P6 alternative drop

**Needs Python:** the REMS and RAD reduction, horizon ray tracing, other detrending windows, and the 4 000-resample site bootstraps.

## Mission concept designers

**Question:** *For a science stop of a given duration, is it worth walking farther to a more sheltered spot, and can the model even tell?*

**Answer in the app:** Mission → Trade-off.
- It compares three candidate spots within the work radius and plots whole-walk dose against time at the stop.
- It states whether the difference exceeds the model's validated error (3.4 points at the notch).
- At Maria Gordon Notch with a 30 m radius, the answer is "model cannot tell".

**Journey:** destination, route (with return), activity duration and EVA limit, trade-off, evidence, conclusion and JSON export.

**Out of scope, and stated in the app:**
- effective dose and health risk
- solar particle events
- rockfall and footing
- suit shielding
- life support and oxygen budgets

The EVA limit is a user-set time cap, not a physiological model.
