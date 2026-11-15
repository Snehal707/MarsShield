# MarsShield demo script (about 3 minutes)

Use the public demo at https://snehal707.github.io/MarsShield/.
Everything below runs in the browser, with no Python backend. Routes, trade-offs and experiments are recalculated live from the precomputed terrain.

## 1. The notch story (45 s)

The site opens on Maria Gordon Notch with two markers: Curiosity's two parking spots, 16 m apart.
1. **The place**, then **Ask the question**. The dark curtain is the sky the walls hide: 33 % inside, 18 % at the mouth (modeled).
2. Drag **Your guess**. Then **See the prediction**: the physical model's bar shows a 9.8 % drop.
3. **Reveal the measurement**: Curiosity's bar shows 19.4 %, twice the model's drop.
4. **What it means**: a simple rule came closer here (18 %), but across the eight measured spots neither model is reliably better.

Measured values are white, model values blue, and planning assumptions underlined in dashed gold, throughout the app.

Click **Plan a Marswalk to the notch**.

## 2. Mission (70 s)

1. **Destination.** Nine targets in a compact grid. The selected one shows its objective, work time and work area, with geology and sources on demand.
2. **Route.** Click **Plan the route**.
   - Four strategies are computed in the browser, return trip included, in about a second.
   - Point out that the lowest-dose and fastest routes match, while hugging the cliffs costs about 30 % more time and dose.
   - Move the walking-speed slider: everything recalculates.
3. **Activity.** Set the work duration and an optional EVA limit. The budget bar shows walking versus working time.
4. **Where to stand.** The decision and the actual dose difference come first.
   - At the notch's 30 m work area the verdict is **Model cannot tell**: spot C would save 0.36 µGy, a 0.9-point rate difference below the model's error.
   - Widen the work area to 150 m: C saves 2.5 µGy, still within model error.
   - Click spot C. Its route, totals, explanation and **its own** hazard flags (14.9° slope, terrain rising 20 m above) replace spot B's.
   - The dose-versus-time chart is under **Investigate**.
5. **Evidence.** Shows the Curiosity RAD measurements near the stop and the published periods.
6. **Summary.** Gives the plan, what it does *not* tell you (effective dose, solar storms, rockfall, life support), and a JSON export.

## 3. Experiment (60 s)

Open **Experiment**, then **Does the landscape explain the radiation Curiosity measured?** Every experiment runs the same five steps.
1. **Question.**
2. **Prediction.** The terrain model's blue dots for 322 stops, made on held-out time blocks.
3. Click **Reveal**: white rings show what RAD measured.
4. **Result.** The terrain model is 11.7 % closer to the measurements (typical error).
5. **Explanation.** 6 stops at Maria Gordon Notch carry 59 % of that gain. Click **Test again without the notch**: 5.5 %, smaller but still real. Without the 10 % most shielded stops it is indistinguishable from zero. A note states that the test reconstructs local anomalies and is only partly independent.

Then open **Physical model or simple rule?** and **Where would a measurement settle it?** Both end in **Cannot tell them apart**, with the reason given.

## 4. Evidence (30 s)

The **RAD + pressure analysis** tab shows that pressure adds nothing measurable at stop level, that terrain lowers RMSE by 11.7 %, where that gain comes from, the robustness variants, and why the test is only partly independent.

**Validation** and **Limitations** list every number, including the P6 and P8 geometry misses.
